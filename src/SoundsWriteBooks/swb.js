import { SvgPlus, Vector } from "../SvgPlus/4.js";
import { ShadowElement } from "../SvgPlus/shadow-element.js";
import "../access-buttons.js"
import "../BGImage/index.js"
import "../../libraries/PDF3DViewer/build/index.js"
import { AccessEvent } from "../access-buttons.js";


class CustomSelection extends SvgPlus {
    constructor(options, placeholder = "") {
        super("select");
        this.createChild("option", { value: "", content: placeholder });
        for (const option of options) {
            this.createChild("option", {  content: option });
        }
    }
}

class BookIcon extends SvgPlus {
    constructor(book, catID, index) {
        super("access-button");
        this.class = "book-icon";

        const coverURL = import.meta.resolve("../../Assets/" + (book?.cover || ""));
        this.createChild("bg-img", { src: coverURL });
        const i = this.createChild("div", { class: "info" });
        i.createChild("div", { class: "title", content: book?.title || "" });
        i.createChild("div", { class: "category", content: book?.category || "" });
        const u = i.createChild("div", { class: "unit"});
        u.createChild("span", { content: "Unit " + (book?.unit || "") });
        if (book?.detail) {
            u.createChild("span", { class: "detail", content: " " + (book?.detail || "") });
        }

        this.addEventListener("access-click", (oldE) => {
            const e = new AccessEvent("book-click", oldE, {bubbles: true});
            e.book = book;
            e.catID = catID;
            e.index = index;
            this.dispatchEvent(e);
        });
    }
}

class SearchWindow extends SvgPlus {
    constructor() {
        super("search-window")
        const topBar = this.createChild("div", { class: "top-bar" });
        let searchArea = topBar.createChild("div", { class: "search-area" });
        this.searchInput = searchArea.createChild("input", { type: "text", placeholder: "Search by name or sound" });
        searchArea.createChild("i-bw", { "i": "search" });

        this.unitSelection = topBar.createChild(
            CustomSelection,
            {},
            new Array(14).fill(0).map((_,i) => i)
                .filter(i => !(i==2 || i==12))
                .map(i => `Unit ${i+1}`),
            "All Units"
        );
        this.unitSelection.value = "";

        this.searchInput.addEventListener("input", () => this.filter());
        this.unitSelection.addEventListener("change", () => this.filter());

        this.mainArea = this.createChild("div", { class: "main-area" });
        this.bookIcons = [];
    }

    set database(value) {
        this._database = value;
        this.mainArea.innerHTML = "";
        this.bookIcons = [];
        for (const catID in this._database.categories) {
            const books = value.categories[catID];
            for (let i = 0; i < books.length; i++) {
                const book = books[i];
                const icon = this.mainArea.createChild(BookIcon, {}, book, catID, i);
                this.bookIcons.push({ icon, book });
            }
        }
        this.filter();
    }

    /**
     * Shows only the books whose title or sound detail contains the search
     * text and, if a unit is selected, that belong to that unit.
     */
    filter() {
        const query = this.searchInput.value.trim().toLowerCase();
        const unit = this.unitSelection.value;
        for (const { icon, book } of this.bookIcons) {
            const searchText = `${book?.title || ""} ${book?.detail || ""}`.toLowerCase();
            const matchesQuery = !query || searchText.includes(query);
            const matchesUnit = !unit || `Unit ${book?.unit}` === unit;
            icon.toggleAttribute("hidden", !(matchesQuery && matchesUnit));
        }
    }
}


function textMask(textContent, bbox, padding = 10, borderRadius = 10) {
    const svgText =`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${bbox.width.toFixed(1)} ${bbox.height.toFixed(1)}">
        <rect width = "100%" height="100%" fill = "white"></rect>
        ${
            textContent.items.map(item => `
                <rect 
                    x="${item.transform[4] - padding}" 
                    y="${item.transform[5] - item.height - padding}" 
                    width="${item.width + 2 * padding}" 
                    height="${item.height + 2 * padding}" 
                    rx="${borderRadius}"
                    ry="${borderRadius}"
                    fill="black"
                ></rect>
            `).join("")
        }
    </svg>`
    const cssURL = `url('data:image/svg+xml;,${encodeURIComponent(svgText)}')`;
    return cssURL;
}

class LineGuide extends SvgPlus {
    /**
     * Creates a visual guide for a line of text within the PDF viewer.
     * @param {import("pdfjs-dist/types/src/display/api").TextItem} item - The text item to create a guide for.
     * @param {import("pdfjs-dist/types/src/display/api").TextStyle} style - The style information for the text item.
     * @param {{x: number, y: number, width: number, height: number}} bbox - The bounding box of the page.
     * @param {CanvasRenderingContext2D} ctx - The canvas context used for measuring text.
     */
    constructor(item, style, bbox, ctx) {
        super("div");
        let {width, height, transform: [a, b, c, d, e, f], fontName, str} = item;

        let rat = style.ascent - style.descent;

        this.createChild("div", {
            class: "underline guide",
            styles: {
                position: "absolute",
                left: e + "px",
                top: (f + 1)+ "px",
                width: width + "px",
                height: "2px",
            }
        })

        ctx.font = `12px "${fontName}"`;
        const mW = ctx.measureText(str).width;
        let fontSize = 12 * width / mW;
        ctx.font = `${fontSize}px "${item.fontName}"`;
        let lengths = []
        let currentText = '';
        let lastWhiteSpace = false;
        for (let char of item.str) {
            let isWhiteSpace = /\s/.test(char);
            if ((isWhiteSpace !== lastWhiteSpace)) {
                lengths.push({
                    width: ctx.measureText(currentText).width,
                    text: currentText
                });
            } 
            currentText += char;
            lastWhiteSpace = isWhiteSpace;
        }
        lengths.push({
            width: ctx.measureText(currentText).width,
            text: currentText
        });

        const deltas = lengths.map(
            ({width, text}, i, arr) => {
                let l = arr[i - 1];
                let offset = 0;
                if (i > 0) {
                    width -= l.width;
                    text = text.replace(l.text, '');
                    offset = l.width;
                }
                // remove trailing punctuation like .!? ...
                let word = text.replace(/[\[\]<>{}().,?:;"'|!]+$/, '');
                return {width, text, word, offset};
            }
        ).filter(d => d.text.trim().length > 0)

        this.wordGuides = deltas.map(delta => ({
            underline:this.createChild("div", {
                class: "word-underline guide",
                styles: {
                    position: "absolute",
                    left: (e + delta.offset) + "px",
                    top: (f + 1)+ "px",
                    width: delta.width + "px",
                    height: "2px",
                }
            }),
            highlight: this.createChild("div", {
                class: "word-highlight guide",
                styles: {
                    position: "absolute",
                    left: (e + delta.offset) + "px",
                    top: (f + 1 - height)+ "px",
                    width: delta.width + "px",
                    height: height + "px",
                }
            })
        }))
        this.deltas = deltas;
        this.hbox = this.createChild("div", {
            class: "hover-box",
            styles: {
                position: "absolute",
                left: e + "px",
                top: (f + height * (-rat*0.3))+ "px",
                width: width + "px",
                height: (height * rat) + "px",
            },
            events: {
                mousemove: (e) => {
                    this.highlightWordGuide(e.clientX);
                },
                mouseleave: () => {
                    this.highlightWordGuide(null);
                },
                click: (e) => {
                    this.toggleWordSelect(e.clientX);
                    this.dispatchEvent(new CustomEvent("change", {
                        bubbles: true,
                    }));
                }
            }
        })
    }

    getGuideIndex(screenX) {
        let index = null;
        if (typeof screenX === "number") {
            if (!this.hboxx || this.hboxx === 0) {
                this.hboxx = this.hbox.bbox[0].x;
            }
            let x = screenX - this.hboxx;
            let minDist = Infinity;
            let minDelta = null;
            this.deltas.forEach((delta, i) => {
                if (x >= delta.offset && x <= delta.offset + delta.width) {
                    minDelta = i;
                    minDist = 0;
                } else {
                    let dist = Math.min(
                        Math.abs(x - delta.offset), 
                        Math.abs(x - (delta.offset + delta.width))
                    );
                    if (dist < minDist) {
                        minDist = dist;
                        minDelta = i;
                    }
                }
            })
            index = minDelta;
        }
        return index;
    }

    highlightWordGuide(screenX) {
        const index = this.getGuideIndex(screenX);
        this.wordGuides.forEach((guide, i) => {
            guide.highlight.toggleAttribute("active", i === index);
            guide.underline.toggleAttribute("active", i === index);
        });
    }

    toggleWordSelect(screenX, state) {
        const index = this.getGuideIndex(screenX);
        if (index !== null) {
            this.wordGuides[index].highlight.toggleAttribute("select", state);
            this.wordGuides[index].underline.toggleAttribute("select", state);
        }
    }

    get value() {
        return this.wordGuides.map((guide, i) => [
            i, guide.highlight.hasAttribute("select")
        ]).filter(([i, selected]) => selected)
          .map(([i]) => [i, this.deltas[i].word]);
    }

    set value(indices) {
        indices.forEach(([i]) => {
            if (this.wordGuides[i]) {
                this.wordGuides[i].highlight.toggleAttribute("select", true);
                this.wordGuides[i].underline.toggleAttribute("select", true);
            }
        });
    }
}

class LineGuides extends SvgPlus {
    constructor(textContent, bbox, ctx) {
        super("div");
        this.lineGuides = textContent.items.map(item => {
            const style = textContent.styles[item.fontName];
            return this.createChild(LineGuide, {}, item, style, bbox, ctx);
        });
    }

    get value() {
        return this.lineGuides.map(guide => guide.value);
    }

    set value(values) {
        values.forEach((value, i) => {
            if (this.lineGuides[i]) {
                this.lineGuides[i].value = value;
            }
        });
    }

}

class PDFViewer extends SvgPlus {
    /** @type {import("../../libraries/PDF3DViewer/pdf-3d.js").PDFViewer3D} */
    viewer3D;
    selectedLineGuides = {};
    lineGuides = {};

    constructor() {
        super("div");
        const padding = 80;
        this.class = "pdf-viewer-container";
        this.styles = { "--side-padding": padding + "px" }
        this.viewer3D = this.createChild("pdf-viewer-3d", {
            events: {
                change: this.updateState.bind(this),
                "padding-change": () => {
                    this.styles = {
                        "--actual-x-padding": this.viewer3D.actualPadding.left + "px",
                        "--actual-y-padding": this.viewer3D.actualPadding.top + "px"
                    }
                }
            }
        });
        this.viewer3D.renderTextLayer = this.renderTextLayer.bind(this);
        this.viewer3D.sidePadding = padding;


        this.createChild("access-button", {
            class: "navigation next",
            events: {
                // click: () => this.viewer3D.move(1),
                "access-click": () => this.viewer3D.move(1)
            }
        }).createChild("i-bw", { "i": "rightArrow" });

        this.createChild("access-button", {
            class: "navigation prev",
            events: {
                "access-click": () => this.viewer3D.move(-1)
            }
        }).createChild("i-bw", { "i": "leftArrow" });

        this.bottomRegion = this.createChild("div", {class: "bottom-region"});
        this.pageNumber = this.bottomRegion.createChild("div", {class: "page-number"});

        this.topRegion = this.createChild("div", {class: "top-region"});

        this.topRegion.createChild("access-button", {
            class: "home-button",
            events: {
                "access-click": () => this.dispatchEvent(new CustomEvent("home-click")),
                // click: () => this.dispatchEvent(new CustomEvent("home-click")),
            }
        }).createChild("i-bw", { "i": "search" });


        this.topRegion.createChild("access-button", {
            class: "hide-images",
            events: {
                "access-click": () => {
                    this.toggleAttribute("hide-images")
                    this.dispatchEvent(new CustomEvent("change", {
                        bubbles: true
                    }))
                },
            }
        }).createChild("i-bw", { "i": "delete-image" });
    }

    updateState(trigger = true) {
        this.toggleAttribute("no-next", this.viewer3D.pageSetIndex >= this.viewer3D.numPageSets - 1);
        this.toggleAttribute("no-prev", this.viewer3D.pageSetIndex <= 0);
        let pages = (this.viewer3D.currentPages || []).filter(i => i !== null);
        this.pageNumber.textContent = `${pages.length > 1 ? "Pages" : "Page"} ${pages.join(' & ')} of ${this.viewer3D.numPages}`
        if (trigger) this.dispatchEvent(new CustomEvent("change"));
    }

    async load(pdfURL) {
        this.toggleAttribute("loading", true);
        await this.viewer3D.load(pdfURL);
        this.toggleAttribute("loading", false);
        this.updateState(false);
    }
    

    /**
     * Renders the text layer for a given overlay.
     * @param {Object} params - The parameters for rendering the text layer.
     * @param {{x: number, y: number, width: number, height: number}} params.bbox - The bounding box of the page.
     * @param {import("pdfjs-dist/types/src/display/api").TextContent} params.textContent - The text content items to render.
     * @param {HTMLElement} params.overlay - The overlay element to render the text layer into.
     * @returns {void} This function does not return a value.
     * 
     * @override
     */
    renderTextLayer({bbox, textContent, overlay, pageNum}) {
        if (!SvgPlus.is(overlay, SvgPlus)) overlay = new SvgPlus(overlay);

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        // Remove items that are empty or only contain numbers.
        textContent.items = textContent.items.filter(
            (i) => i.str && i.str.trim() && !i.str.match(/^\d+$/)
        );

        const maskWash = overlay.createChild("div", {
            class: "text-mask-overlay",
            styles: {
                position: "absolute",
                top: "0",
                left: "0",
                width: "100%",
                height: "100%",
                mask: textMask(textContent, bbox),
                "mask-mode": "luminance",
                "mask-type": "luminance"
            }
        });
        const lineGuides = overlay.createChild(LineGuides, {events: {
            "change": () => {
                this.selectedLineGuides[pageNum] = lineGuides.value;
            }
        }}, textContent, bbox, ctx);
        this.lineGuides[pageNum] = lineGuides;
        if (this.selectedLineGuides[pageNum]) {
            lineGuides.value = this.selectedLineGuides[pageNum];
        }

        setTimeout(() => {
            maskWash.toggleAttribute("ready", true);
            lineGuides.toggleAttribute("ready", true);
        }, 100);

    }

    get pageSetIndex() {
        return this.viewer3D.pageSetIndex;
    }

    setPage(page, trigger = false) {
        this.viewer3D.setPageSet(page, {triggerEvent: trigger});
        if (!trigger) this.updateState(false);
    }

    set state(state) {
        state = typeof state === "object" && state !== null ? state : {};
        const {url, index, selectedWords, hideImages} = state;
        if (typeof url === "string") {
            this.load(url);
        }
        if (typeof index === "number") {
            this.setPage(index);
        }
        if (typeof selectedWords === "object" && selectedWords !== null) {
            this.selectedLineGuides = selectedWords;
        } else {
            this.selectedLineGuides = {};
        }

        for (const pageNum in this.lineGuides) {
            const lineGuides = this.lineGuides[pageNum];
            if (lineGuides) {
                lineGuides.value = this.selectedLineGuides[pageNum] || [];
            }
        }

        this.toggleAttribute("hide-images", hideImages == true);
    }

    get state() {
        return {
            url: this.viewer3D.currentPDFURL,
            index: this.pageSetIndex,
            selectedWords: JSON.parse(JSON.stringify(this.selectedLineGuides)),
            hideImages: this.hasAttribute("hide-images")
        }
    }
}










class SoundsWriteBooks extends ShadowElement {
    
    constructor(el) {
        super(el, "root-element");
        this.root.setAttribute("mode", "search");
        this.searchArea = this.createChild(SearchWindow, {
            events: {
                "book-click": (e) => {
                    e.waitFor(new Promise(resolve => setTimeout(resolve, 700)));
                    this.selectBook(e.catID, e.index);
                },
            }
        });
        this.pdfViewer = this.createChild(PDFViewer, {events: {
            "home-click": () => this.setMode("search"),
            "change": () => this.onStateChange()

        }});
        
        this.load()
    }

    selectBook(catID, index) {
        const book = this.database.categories[catID]?.[index];
        if (book) {
            this.pdfViewer.state = {url: book.url, index: 0};
            this.setMode("view", true);
        }
    }

    onStateChange() {
        // Custom logic to handle state changes can be added here.
        if (window.SquidlyAPI) {
            SquidlyAPI.firebaseSet("sw-main-state", JSON.stringify(this.state));
        }
    }

    setMode(mode, trigger = true) {
        this.root.setAttribute("mode", mode);
        if (trigger) this.onStateChange()
    }


    get state() {
        return {
            mode: this.root.getAttribute("mode"),
            pdf: this.pdfViewer.state,
        };
    }

    set state(newState) {
       if (newState?.mode === "view" && newState?.pdf) {
            this.setMode("view", false);
            this.pdfViewer.state = newState.pdf;
        } else {
            this.setMode("search", false);
        }
    }


    async load() {
        const url = import.meta.resolve("../../Assets/database.json");
        let database = await (await fetch(url)).json();
        this.database = database;
        this.searchArea.database = database;
        this.url2bookPath = {};

        for (const catID in database.categories) {
            for (const index in database.categories[catID]) {
                const book = database.categories[catID][index];
                const url = import.meta.resolve("../../Assets/" + book.file);
                this.url2bookPath[url] = { catID, index };
                book.url = url;
            }
        }

        if (window.SquidlyAPI) {
            SquidlyAPI.firebaseOnValue("sw-main-state", (val) => {
                this.state = JSON.parse(val);
            });
        }
    }

    static get usedStyleSheets() {
        return [
            import.meta.resolve("../../libraries/PDF3DViewer/styles.css"),
            import.meta.resolve("../../Assets/icons.css"),
            import.meta.resolve("../BGImage/styles.css"),
            import.meta.resolve("./styles.css")
        ];
    }
}

SvgPlus.defineHTMLElement(SoundsWriteBooks)



export {SoundsWriteBooks};
