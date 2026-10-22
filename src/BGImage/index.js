const LOAD_CACHE = new Map();

async function waitForImageLoad(src) {
    if (!LOAD_CACHE.has(src)) {
        const img = new Image();
        LOAD_CACHE.set(src, {
            promise: new Promise((resolve) => {
                    img.onload = async () => {
                        try { await img.decode() }
                        catch(e) {
                        }
                        resolve(true);
                    }
                    img.onerror = () => resolve(false);
                    img.src = src;
                }),
            image: img
        })
    }

    return await LOAD_CACHE.get(src).promise;
}

class BackgroundImage extends HTMLElement {
    #src = "";
    constructor(el) {
        super(el);
    }

    attributeChangedCallback(name, oldv, newv){
        this[name] = newv;
    }

    set src(value) {
        if (typeof value !== "string") {
            value = "";
        }

        if (value !== this.#src) {
            this.#src = value;
            this.toggleAttribute("loaded", false);
            const url = value.replace(/"/g, "%22");
            this.style.backgroundImage = `url("${url}")`;

            waitForImageLoad(value).then(r => {
                if (value == this.#src) {
                    this.toggleAttribute("loaded", r)
                }
            })
        } else {
            this.#src = "";
            this.style.backgroundImage = "";
            this.toggleAttribute("loaded", false);
        }
    }

    static get observedAttributes() {
        return ["src"];
    }
}

customElements.define("bg-img", BackgroundImage);