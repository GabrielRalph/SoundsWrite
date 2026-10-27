import { 
    BackSide, FrontSide,
    MathUtils, Box3, Vector3, 
    Texture,  CanvasTexture, MeshStandardMaterial, SRGBColorSpace, RepeatWrapping, 
    DirectionalLight, HemisphereLight, 
    Group, Mesh, PlaneGeometry,
    PCFShadowMap, 
    PerspectiveCamera, 
    Scene, WebGLRenderer 
} from "three";
import * as pdfjs from 'pdfjs-dist';
pdfjs.GlobalWorkerOptions.workerSrc = import.meta.resolve('./pdf.worker.min.mjs');
import { Bezier } from "bezier-js";

/**
 * @param {import("pdfjs-dist").PDFPageProxy} page
 * @return {Promise<import("pdfjs-dist/types/src/display/api").TextContent>}
 */
async function getTextContentCompat(page) {
    const reader = page.streamTextContent().getReader();

    const textContent = {
        items: [],
        styles: {},
    };

    try {
        while (true) {
            const result = await reader.read();

            if (result.done) {
                break;
            }

            const value = result.value;

            if (value.lang && !textContent.lang) {
                textContent.lang = value.lang;
            }

            Object.assign(textContent.styles, value.styles);
            textContent.items.push(...value.items);
        }
    } finally {
        reader.releaseLock();
    }

    return textContent;
}

function getEvenlySpacedPoints(cubic, segments, resolution = segments * 10) {
    if (!Number.isFinite(segments) || segments <= 0) {
        return [cubic.get(0), cubic.get(1)];
    }

    const safeResolution = Math.max(2, Math.floor(resolution));
    const lut = cubic.getLUT(safeResolution);

    // Build cumulative arc-length table from LUT samples
    const cumulative = new Array(lut.length).fill(0);
    for (let i = 1; i < lut.length; i++) {
        const dx = lut[i].x - lut[i - 1].x;
        const dy = lut[i].y - lut[i - 1].y;
        cumulative[i] = cumulative[i - 1] + Math.hypot(dx, dy);
    }

    const totalLength = cumulative[cumulative.length - 1];
    if (totalLength === 0) {
        const p = cubic.get(0);
        return Array.from({ length: segments + 1 }, () => ({ ...p }));
    }

    const points = [lut[0]];
    let j = 1; // moving index in cumulative table

    // Find interior points at target arc-lengths
    for (let s = 1; s < segments; s++) {
        const target = (s / segments) * totalLength;

        while (j < cumulative.length - 1 && cumulative[j] < target) {
            j++;
        }

        const prev = lut[j - 1];
        const curr = lut[j];
        const prevLen = cumulative[j - 1];
        const currLen = cumulative[j];
        const span = currLen - prevLen || 1;
        const alpha = (target - prevLen) / span;

        // Interpolate t then sample the actual curve point
        const t = prev.t + (curr.t - prev.t) * alpha;
        points.push(cubic.get(t));
    }

    points.push(lut[lut.length - 1]);
    return points;
}

class PageTexture extends CanvasTexture {
    /**
     * @type {import("pdfjs-dist").PageViewport}
     */
    pageViewport;

    /**
     * @type {import("pdfjs-dist").PDFPageProxy}
     */
    page;


    /**
     * @param {HTMLCanvasElement} canvas
     * @param {PDFPageProxy} page
     * @param {import("pdfjs-dist").PageViewport} pageViewport
     * @param {import("pdfjs-dist/types/src/display/api").TextContent} textContent
     */
    constructor(canvas, page, pageViewport, textContent) {
        super(canvas);
        this.colorSpace = SRGBColorSpace;
        this.pageViewport = pageViewport;
        this.page = page;
        this.needsUpdate = true;
        this._textContent = textContent;
    }

    /**
     * returns a deep copy of the text content
     * @param {import("pdfjs-dist/types/src/display/api").TextContent} content
     */
    get textContent() {
        // return a deep copy of the text content
        return JSON.parse(JSON.stringify(this._textContent));
    }

    get width() {
        return this.pageViewport.width;
    }

    get height() {
        return this.pageViewport.height;
    }

    getTransformedTextContent(bbox) {
        const VB = this.pageViewport.viewBox;
        const scaleX = VB[2]/ bbox.width;
        const scaleY = VB[3] / bbox.height;
        const textContent = this.textContent;

        // Adjust the text content items to 
        // match the scaled page dimensions
        textContent.items = textContent.items.map(i => {
            i.width = i.width / scaleX;
            i.height = i.height / scaleY;
            i.transform = i.transform.map((v, idx) => idx % 2 === 0 ? v / scaleX : -v / scaleY);
            i.transform[5] = bbox.height + i.transform[5];
            return i;
        })
        
        return textContent;
    }

    /**
     * @param {PDFDocumentProxy|PDFPageProxy} page
     * @param {number} num1 if pdf this is the page number, 
     *                      if page proxy this is the scale
     * @param {number} num2 if pdf this is the scale
     * @returns {Promise<PageTexture>}
     * 
     * @overload
     * @param {PDFDocumentProxy} page
     * @param {number} num1 page number
     * @param {number} num2 scale
     * @returns {Promise<PageTexture>}
     *
     * @overload
     * @param {PDFPageProxy} page
     * @param {number} num1 scale
     * @returns {Promise<PageTexture>}
     */
    static async make(page, num1, num2) {
        let scale = 1;
        const isDocProxy = page && typeof page.getPage === "function" && typeof page.numPages === "number";
        const isPageProxy = page && typeof page.getViewport === "function" && typeof page.render === "function";
        if (isDocProxy) {
            page = await page.getPage(num1);
            scale = num2;
        } else if (isPageProxy) {
            scale = num1;
        } else {
            throw new Error("Invalid page argument");
        }

        const viewport = page.getViewport({
            scale: scale
        });

        const pdfCanvas = document.createElement("canvas");
        const context = pdfCanvas.getContext("2d", { alpha: false });
        pdfCanvas.width = viewport.width;
        pdfCanvas.height = viewport.height;

        await page.render({
            canvasContext: context,
            viewport
        }).promise;

        const textContent = await getTextContentCompat(page);

        return new PageTexture(pdfCanvas, page, viewport, textContent);
    }
}

class Page3D extends Mesh {
    #bend = 0;
    constructor(width, height) {
        const geometry = new PlaneGeometry(
            width,
            height,
            ...Page3D.SEGMENTS,
        );
        

        geometry.translate(
            width / 2,
            0,
            0
        );

        const material = new MeshStandardMaterial({
            side: FrontSide,
            roughness: .9,
            metalness: 0,
            color: 0xffffff
        });

       
        const back = new MeshStandardMaterial({
            side: BackSide,
            roughness: .9,
            metalness: 0,
            color: 0xffffff
        });

        geometry.clearGroups();
        const drawCount = geometry.index ? geometry.index.count : geometry.attributes.position.count;
        geometry.addGroup(0, drawCount, 0); // front pass
        geometry.addGroup(0, drawCount, 1); // back pass

        super(geometry, [material, back]);
        this.castShadow = true;
        this.receiveShadow = true;

        this.width = width;
        this.height = height;
    }

    /**
     * Get the bounding box of the page in screen coordinates.
     * @param {Camera} camera - The camera used to project the page.
     * @param {Object} screenBBox - The screen bounding box with properties x, y, width, and height.
     * @returns {Object} The screen-space bounding box of the page, including x, y, width, height, left, top, right, and bottom.
     */
    getBBox(camera, screenBBox) {
        // Make sure the page's world matrix is current.
        this.updateWorldMatrix(true, false);

        // Get the page's world-space bounding box.
        const bbox = new Box3().setFromObject(this);
        // The 8 corners of the world-space bounding box.
        const corners = [
            new Vector3(bbox.min.x, bbox.min.y, bbox.min.z),
            new Vector3(bbox.min.x, bbox.min.y, bbox.max.z),
            new Vector3(bbox.min.x, bbox.max.y, bbox.min.z),
            new Vector3(bbox.min.x, bbox.max.y, bbox.max.z),
            new Vector3(bbox.max.x, bbox.min.y, bbox.min.z),
            new Vector3(bbox.max.x, bbox.min.y, bbox.max.z),
            new Vector3(bbox.max.x, bbox.max.y, bbox.min.z),
            new Vector3(bbox.max.x, bbox.max.y, bbox.max.z)
        ];

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        for (const corner of corners) {
            // World → Normalized Device Coordinates
            corner.project(camera);

            // NDC → HTML pixels
            const x = (corner.x + 1) * 0.5 * screenBBox.width + screenBBox.x;
            const y = (1 - corner.y) * 0.5 * screenBBox.height + screenBBox.y;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }

        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,

            // Useful if you need the edges explicitly
            left: minX,
            top: minY,
            right: maxX,
            bottom: maxY
        };
    }

    /**
     * Set the front texture of the page.
     * @param {?PageTexture} texture 
     */
    set frontTexture(texture) {
        if (texture instanceof CanvasTexture) {
            texture.wrapS = RepeatWrapping;
            texture.repeat.x = 1;
            texture.offset.x = 0;
        }
        this.material[0].map = texture;
        if (texture) {
            this.material[0].map.needsUpdate = true;
            this.material[0].needsUpdate = true;
        }

    }

    /**
     * @returns {?PageTexture} The texture applied to the front of the page.
     */
    get frontTexture() {
        return this.material[0].map;
    }

     /**
     * Set the back texture of the page.
     * @param {?PageTexture} texture 
     */
    set backTexture(texture) {
        if (texture instanceof CanvasTexture) {
            texture.wrapS = RepeatWrapping;
            texture.repeat.x = -1;
            texture.offset.x = 1;
        }
        this.material[1].map = texture;
        if (texture) {
            this.material[1].map.needsUpdate = true;
            this.material[1].needsUpdate = true;

        }
    }

     /**
     * @returns {?PageTexture} The texture applied to the back of the page.
     */
    get backTexture() {
        return this.material[1].map;
    }

    /**
     * Get the texture currently visible on the page based on its bend.
     * @returns {?PageTexture} The texture currently visible on the page.
     */
    get visibleTexture() {
        return this.#bend < 0.5 ? this.frontTexture : this.backTexture;
    }

    #flattenPage(dir = 1) {
        const {geometry} = this;
        const positions = geometry.attributes.position;
        const [segments, rows] = Page3D.SEGMENTS;
        for (let j = 0; j <= rows; j++) {
            for (let i = 0; i <= segments; i++) {
                const index = i + j * (segments + 1);
                positions.setX(index, dir * i / segments * this.width);
                positions.setZ(index, 0);
            }
        }
    }

    /**
     * Bend the page by a specified amount.
     * @param {number} amount - The amount to bend the page, between 0 and 1.
     */
    bendPage(amount) {
        const {geometry} = this;
        const positions = geometry.attributes.position;
        const width = this.width;
        const lag = 0.005;

        if (amount <= 0) {
            this.#flattenPage();
            this.#bend = 0;
        } else if (amount >= 1) {
            this.#flattenPage(-1);
            this.#bend = 1;
        } else {
            this.#bend = amount;
            const [segments, rows] = Page3D.SEGMENTS;
            const totalLag = rows * lag;
            for (let j = 0; j <= rows; j++) {

                let a = (amount - j * lag) / (1 - totalLag);
                a = Math.max(0, Math.min(1, a));

                const rad = a * Math.PI;
                const pageX = width * Math.cos(rad);
                const pageZ = width * Math.sin(rad);
    
                let cubic = new Bezier(
                    0,0,
                    0, pageZ * 0.55,
                    pageX * 0.55, pageZ,
                    pageX, pageZ,
                );
    
                let points = getEvenlySpacedPoints(cubic, segments); 
                for (let i = 0; i <= segments; i++) {
                    const {x, y} = points[i];
                    const index = i + j * (segments + 1);
                    positions.setX(index, x);
                    positions.setZ(index, Math.max(y, 0));
                }
            }
        }
        positions.needsUpdate = true;
        geometry.computeVertexNormals();
    }

    static get SEGMENTS() {
        return [32, 5];
    }
}

class Book3D extends Group {
    /** @type {Page3D} */
    leftPage3d;
    /** @type {Page3D} */
    rightPage3d;
    /** @type {Page3D} */
    turningPage3d;

    constructor(width, height) {
        super();
        this.width = width;
        this.height = height;

        this.leftPage3d = new Page3D(width, height)
        this.rightPage3d = new Page3D(width, height);
        this.turningPage3d = new Page3D(width, height);
        
        this.leftPage3d.visible = false;
        this.rightPage3d.visible = false;
        this.turningPage3d.receiveShadow = false;


        this.leftPage3d.bendPage(1);

        this.add(this.leftPage3d);
        this.add(this.rightPage3d);
        this.add(this.turningPage3d);
    }

    /**
     * Turns a page in the 3D book.
     * @param {?Texture} pageTexture1 - The texture for the back of the turning page.
     * @param {?Texture} pageTexture2 - The texture for the front of the next page.
     * @param {number} direction - The direction of the page turn (1 for forward, -1 for backward).
     * @param {number} time - The duration of the page turn animation.
     * @param {Function} onUpdate - Callback function called on each animation frame.
     */
    async turnPage(pageTexture1, pageTexture2, direction = 1, time = 300, onUpdate) {
        const turning = this.turningPage3d;

        if (direction > 0) {
            this.turningBackPage = pageTexture1;
            this.rightPage = pageTexture2;
        } else {
            this.rightPage = turning.frontTexture;
            this.turningBackPage = this.leftPage

            this.leftPage = pageTexture1;
            this.turningFrontPage = pageTexture2;
        }
        
        if (time > 0) {
            await this.#transitionBend(time, onUpdate, direction);
        }

        if (direction > 0) {
            this.leftPage = pageTexture1;
            this.turningFrontPage = pageTexture2;
            this.rightPage = null;
            turning.bendPage(0);
        }
        onUpdate && onUpdate(1, 1);
    }



    set turningBackPage(texture) {
        texture = texture instanceof Texture ? texture : null;
        this.turningPage3d.backTexture = texture;
        this.turningPage3d.visible = texture !== null;
    }
    set turningFrontPage(texture) {
        texture = texture instanceof Texture ? texture : null;
        this.turningPage3d.frontTexture = texture;
        this.turningPage3d.visible = texture !== null;
    }


    set leftPage(texture) {
        texture = texture instanceof Texture ? texture : null;
        this.leftPage3d.backTexture = texture;
        this.leftPage3d.visible = texture !== null;
    }
    get leftPage() {
        return this.leftPage3d.backTexture;
    }

    
    
    set rightPage(texture) {
        texture = texture instanceof Texture ? texture : null;
        this.rightPage3d.frontTexture = texture;
        this.rightPage3d.visible = texture !== null;
    }
    get rightPage() {
        return this.rightPage3d.frontTexture;
    }

    async #transitionBend(time, onUpdate, direction = 1) {
        const start = performance.now();
        const from = direction > 0 ? 0 : 1;
        const to = direction > 0 ? 1 : 0;
        let t = 0;
        

        let set = () => {
            const eased = (1 - Math.cos(t * Math.PI)) / 2;
            const amount = from + (to - from) * eased
            this.turningPage3d.bendPage(amount);
            if (onUpdate) onUpdate(amount, t);
        }

        set();
        while (t < 1) {
            let now = await new Promise(requestAnimationFrame);
            t = Math.min((now - start) / time, 1);
            set();
        }
    }
        
}


class PromiseRacer {
    #processing = false;
    #head = null;
    #currentValue;
    #lastValue;

    /** @type {Promise<boolean>|null} */
    #processingPromise = null;

    get nextValue() { return this.#head ? this.#head.value : undefined; }
    get value() { return this.#head ? this.#head.value : this.#currentValue; }
    get currentValue() { return this.#currentValue; }
    set currentValue(value) { this.#currentValue = value; }
    get lastValue() { return this.#lastValue; }
    get processing() { return this.#processing; }

    reset() {
        if (this.#head) this.#head.resolver(false);
        this.#head = null;
        this.#currentValue = undefined;
        this.#lastValue = undefined;
    }

    async add(promiseFunction, value) {
        let promise = Promise.resolve();

        if (promiseFunction instanceof Function) {

            // Resolve false to indicate the 
            // previous head was replaced
            if (this.#head) this.#head.resolver(false);

            // Create a new promise for the new head
            promise = new Promise((r) => {
                this.#head = {
                    function: promiseFunction,
                    value: value,
                    resolver: r
                };
            });

            // Start processing the head
            this.#process();
        }

        return promise;
    }

    async wait() {
        if (this.#processingPromise) {
            await this.#processingPromise;
        }
    }

    async #process() {
        if (!this.#processing) {
            this.#processing = true;
            this.#processingPromise = (async () => {
                while (this.#head) {
                    const head = this.#head;
                    this.#head = null;
                    this.#lastValue = this.#currentValue;
                    this.#currentValue = head.value;
                    await head.function();
                    head.resolver(true);
                }
                this.#processing = false;
                this.#processingPromise = null;
            })();
            await this.#processingPromise;
        }
    }
}

class PDFViewer3D extends HTMLElement {
    /**
     * @type {import("pdfjs-dist/types/src/display/api").PDFDocumentProxy|null}
     */
    #pdf = null;
    #pageSets = [];

    #pagePR = new PromiseRacer();
    #loaderPR = new PromiseRacer();

    #renderQueued = false;
    #addOverlay = false;
    
    sidePadding = 50;
    transitionDuration = 750;

    #built = false;

    constructor() {
        super();
        // Create canvas element for rendering
        const canvas = document.createElement("canvas");

        // Create WebGL renderer
        const renderer = new WebGLRenderer({
            canvas,
            antialias: true,
            alpha: true,
        });
        renderer.setClearColor(0x000000, 0); 

        
        const pixelRatio = 4
        renderer.setPixelRatio(pixelRatio);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = PCFShadowMap;

        // Create scene
        const scene = new Scene();

        // Add camera
        const camera = new PerspectiveCamera(20, 1, 100, 5000);

        // Add ambient light
        const ambient = new HemisphereLight(
            0xffffff,
            0x202020,
            2
        );
        scene.add(ambient);

        // Add directional key light
        const keyLight = new DirectionalLight(
            0xffffff,
            2.5
        );
        keyLight.castShadow = true;
        keyLight.shadow.bias = -0.0005;
        keyLight.shadow.normalBias = 0.005;
        scene.add(keyLight);

        

        // Store references to renderer, scene, and camera for later use
        this.keyLight = keyLight;
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.canvas = canvas;

        this.resizeObserver = new ResizeObserver(() => this.onresize());
        this.resizeObserver.observe(this);

        window.addEventListener("keydown", (event) => {
            if (event.key === "ArrowRight") {
                this.move(1)
            } else if (event.key === "ArrowLeft") {
                this.move(-1)
            }
        });

        window.mypdf = this;
    }

    build() {
        if (this.#built) return;
        this.#built = true;
        this.appendChild(this.canvas);
        this.pageOverlays = [0, 1].map(i => {
            let page1Div = document.createElement("div");
            this.appendChild(page1Div);
            page1Div.classList.add("overlay-box");
            return page1Div;
        })
    }

    connectedCallback() {
        this.build();
    }


    #clearOverlayContents() {
        this.pageOverlays.forEach(overlay => {
            overlay.innerHTML = '';
        });
    }

    /**
     * @param {Object} bbox - The bounding box of the page.
     * @param {Page3D} page3d - The 3D page object.
     * @param {HTMLElement} overlay - The overlay element to render the text layer into.
     * @param {number} pageNum - The page number.
     * @return {[number, number]} The width and height of the rendered page overlay.
     */
    #renderPageOverlay(bbox, page3d, overlay, pageNum) {
        const pageTexture = page3d.visibleTexture;
        const pageBBox = page3d.getBBox(this.camera, bbox);
        overlay.innerHTML = '';
        overlay.style.position = 'absolute';
        overlay.style.left = `${pageBBox.left - bbox.left}px`;
        overlay.style.top = `${pageBBox.top - bbox.top}px`;
        overlay.style.width = `${pageBBox.width}px`;
        overlay.style.height = `${pageBBox.height}px`;
        const textContent = pageTexture ? pageTexture.getTransformedTextContent(pageBBox) : null;
        try {
            this.renderTextLayer({
                bbox: pageBBox,
                textContent,
                overlay: overlay,
                pageNum: pageNum,
            });
        } catch (error) {
            console.error("Error rendering overlay:", error);
        }
        return [pageBBox.width, pageBBox.height]
    }

    #addOverlayContents() {
        if (!(this.#pdf && this.book)) return;
        let bbox = this.getBoundingClientRect();
        let [i, j] = this.currentPages;
        let [w1, h1] = this.#renderPageOverlay(bbox, this.book.leftPage3d, this.pageOverlays[0], i);
        let [w2, h2] = this.#renderPageOverlay(bbox, this.book.turningPage3d, this.pageOverlays[1], j);
          
        let totalWidth = w1 + w2;
        let maxHeight = Math.max(h1, h2);

        maxHeight = Number.isNaN(maxHeight) ? bbox.height : maxHeight;
        totalWidth = Number.isNaN(totalWidth) ? bbox.width : totalWidth;

        this.actualPadding = {
            top: (bbox.height - maxHeight) / 2,
            left: (bbox.width - totalWidth) / 2,
            bottom: (bbox.height - maxHeight) / 2,
            right: (bbox.width - totalWidth) / 2
        }
        this.dispatchEvent(new CustomEvent('padding-change', { detail: { padding: this.actualPadding } }));
    }

    async #getPages(pages) {
        return await Promise.all(
            pages.map(pageNum => 
                pageNum && pageNum > 0 && pageNum <= this.numPages ? 
                    PageTexture.make(this.#pdf, pageNum, 2) 
                    : 
                    Promise.resolve(null)
            )
        );
    }
   
    #render(addOverlay = false) {
        addOverlay = addOverlay === true;
        if (addOverlay) this.#addOverlay = true;

        if (this.#renderQueued) return;
        this.#renderQueued = true;
        window.requestAnimationFrame(() => {
            this.renderer.render(this.scene, this.camera);
            if (this.#addOverlay) this.#addOverlayContents();
            this.#renderQueued = false;
            this.#addOverlay = false;
        });
    }

    get numPages() {
        return this.#pdf?.numPages || 0;
    }

    get numPageSets() {
        return this.#pageSets.length;
    }

    get pageSetIndex() {
        return this.#pagePR.value ?? 0;
    }

    get currentPages() {
        return this.#pageSets[this.pageSetIndex]
    }

    get nextPageSet() {
        return this.#pagePR.nextValue
    }

    get currentPDFURL() {
        return this.#loaderPR.value ?? null;
    }



    /**
     * Renders the text layer for a given overlay.
     * @param {Object} params - The parameters for rendering the text layer.
     * @param {{x: number, y: number, width: number, height: number}} params.bbox - The bounding box of the page.
     * @param {import("pdfjs-dist/types/src/display/api").TextContent} params.textContent - The text content items to render.
     * @param {HTMLElement} params.overlay - The overlay element to render the text layer into.
     * @param {number} params.pageNum - The page number associated with the overlay.
     * @returns {void} This function does not return a value.
     * 
     * @override
     */
    renderTextLayer({ bbox, textContent, overlay }) {
    
    }

    async load(url) {
        if (url === this.#loaderPR.value) return;
        return await this.#loaderPR.add(
            async () => {
                try {
                    this.#pdf = await pdfjs.getDocument({url}).promise;
                    let pages = this.#pdf.numPages; 
                    let pageSets = [
                        [0, 1], 
                        ...new Array(Math.floor((pages-1)/2))
                            .fill(null)
                            .map((_, i) => [(i+1)*2, (i+1)*2 + 1]),
                        ...(pages % 2 === 0 ? [[pages, pages + 1]] : [])
                    ];
                    let [firstPageTexture] = await this.#getPages([1])
                    const {width, height} = firstPageTexture;

                    // Create a 3D book with the dimensions of the first page
                    if (this.book) this.scene.remove(this.book);
                    this.book = new Book3D(width, height);
                    this.scene.add(this.book);
                    this.#pageSets = pageSets;


                    // Turn the first page of the book with the initial texture
                    let index = this.pageSetIndex
                    index = index > this.numPageSets ? 0 : index;

                    // Set the initial page after the loader promise has resolved
                    requestAnimationFrame(() => {
                        this.setPageSet(index, {force: true, triggerEvent: true, duration: -1});
                        this.onresize();
                    })
                } catch (error) {
                    console.error("Failed to load PDF document:", error);
                    this.#pdf = null;
                    this.#pageSets = [];
                    this.#pagePR.reset();
                    if (this.book) this.scene.remove(this.book);
                    this.#render();
                    this.dispatchEvent(new Event("change"));
                }
            }, url
        );
    }

    /**
     * @typedef {Object} PageSetMoveOptions
     * @property {boolean} [triggerEvent=true] - Whether to trigger the 'change' event.
     * @property {number} [duration] - The duration of the page transition in milliseconds.
     * @property {number} [direction] - The direction of the page turn. 
     *                                   1: forward
     *                                  -1: backward
     *                                  null: automatic
     * @property {boolean} [force=false] - Whether to force the page turn even if the
     *                                     target page set is the current one.
     */

    /**
     * Moves the current page set by a specified delta.
     * @param {number} delta - The number of page sets to move. Positive values
     * move forward, negative values move backward.
     * @param {PageSetMoveOptions} [options] - Options for the page transition.
     * @returns {Promise<void>} A promise that resolves when the page transition is complete.
     */
    async move(delta, options = {triggerEvent: true}) {
        let nextI = this.pageSetIndex + delta;
        this.setPageSet(nextI, options);
    }

    /**
     * Sets the current page set to the specified index.
     * @param {number} i - The index of the page set to display.
     * @param {PageSetMoveOptions} [options] - Options for the page transition.
     * @returns {Promise<void>} A promise that resolves when the page transition is complete.
     */
    async setPageSet(i, options = {}) {
        let {duration, triggerEvent, direction, force} = (typeof options === 'object' ? options : null) || {};
        let curI = this.pageSetIndex;
        duration = duration ?? this.transitionDuration;
        triggerEvent = triggerEvent ?? false;
        direction = direction ?? (i > curI ? 1 : -1);

        // If the loader is currently processing, (i.e. a new pdf 
        // is being loaded) update the next page set index and wait 
        // for the loader to finish.
        if (this.#loaderPR.processing) {
            this.#pagePR.currentValue = i;
            await this.#loaderPR.wait();

        // Otherwise if the a PDF is loaded, the index is within range
        // and is different from the current index or if the force option is set.
        } else if (this.#pdf && i >= 0 && i < this.numPageSets && (curI !== i || force))  {
            await this.#pagePR.add(
                async () => {
                    if (triggerEvent) this.dispatchEvent(new CustomEvent('change'));
                    this.#clearOverlayContents();
                    let pages = await this.#getPages(this.#pageSets[i])
                    await this.book.turnPage(...pages, direction, duration, this.#render.bind(this));
                    this.#render(true);
                }, i
            )
        }
    }

    onresize() {
        const width = this.clientWidth;
        const height = this.clientHeight;
        this.camera.aspect = width / height;

        const sidePaddingPx = Math.max(0, this.sidePadding);
        const usableWidth = Math.max(1, width - 2 * sidePaddingPx); 

        // Page dimensions
        const pageWidth = this.book?.width ?? 800;
        const pageHeight = this.book?.height ?? 600;
        const boundsWidth = pageWidth * 2;
        const boundsHeight = pageHeight;
        const maxZ = pageWidth;

        const fov = MathUtils.degToRad(this.camera.fov)
        const horizontalFov = 2 * Math.atan(
            Math.tan(fov / 2) * width / height
        );

        const distanceForWidth = (boundsWidth/2) / Math.tan(horizontalFov / 2) * (width / usableWidth);
        const distanceForHeight = (boundsHeight/2) /  Math.tan(fov / 2) + maxZ;

        /*
        * The folded page can move toward the camera by roughly
        * pageWidth, so add that depth to the required distance.
        */
        const distance = Math.max(
            distanceForWidth,
            distanceForHeight
        );


        const keyLight = this.keyLight;

        const shadowCamera = keyLight.shadow.camera;
        
        keyLight.position.set(-boundsWidth, boundsHeight, distance);
        shadowCamera.left =   -boundsWidth  * 0.8;
        shadowCamera.right =   boundsWidth  * 0.8;
        shadowCamera.top =     boundsHeight * 0.8; //boundsHeight;
        shadowCamera.bottom = -boundsHeight * 0.8;
        shadowCamera.near = distance - maxZ + 10;
        shadowCamera.far = distance + maxZ + 10;
        keyLight.shadow.mapSize.set(2048, 2048);
        keyLight.updateMatrixWorld();
        shadowCamera.updateProjectionMatrix();


        this.camera.position.set(0, 0, distance);
        this.camera.near = distance + 10 - maxZ;
        this.camera.far = distance + 10;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(
            width,
            height
        );

        this.#render(true);
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === "src" && oldValue !== newValue) {
            this.load(newValue);
        } else if (name === "transition-duration" && oldValue !== newValue) {
            this.transitionDuration = parseInt(newValue, 10);
        }
    }


    set src(value) {
        this.setAttribute("src", value);
    }



    static get observedAttributes() {
        return ["src", "transition-duration"];
    }
}

export {PDFViewer3D}

