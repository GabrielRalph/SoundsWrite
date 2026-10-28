



import { ShadowElement } from "../SvgPlus/shadow-element.js";
import WordData from "../../Assets/WordBuilder/data_updated.js";
import { TokenPlacer } from "./token-placer.js";
import { SvgPlus } from "../SvgPlus/4.js";


/**
 * @typedef {Object} WordSlot
 * @property {string} value
 * @property {boolean} [given]
 *
 * @typedef {Object} Word
 * @property {string} word
 * @property {string} icon
 * @property {WordSlot[]} slots
 *
 * @typedef {Object} WordGroup
 * @property {string} code
 * @property {string} name
 * @property {string[]} tokens
 * @property {Word[]} words
 */

class ResultsPage extends SvgPlus {

    /**
     * @param {Object} state the WordBuilderGroup state ({index, placers})
     * @param {WordGroup} group
     */
    constructor(state, group) {
        super("results-page");
        const placers = state?.placers || [];

        this.createChild("div", {class: "header", content: "Results"});
        const list = this.createChild("div", {class: "results-list"});

        let correctCount = 0;
        group.words.forEach((word, i) => {
            const spelt = ResultsPage.getSpelling(word, group, placers[i]);
            const correct = spelt.every((v, j) => v === word.slots[j].value);
            if (correct) correctCount++;

            // const row = list.createChild("div", {class: "result-row"});
            list.createChild("bg-img", {src: import.meta.resolve("../../Assets/WordBuilder/" + word.icon)});
            list.createChild("span", {class: "actual", content: word.word});
            const sp = list.createChild("span", {class: "spelt"});
            spelt.forEach(v => sp.createChild("span", {class: v ? "" : "empty", content: v || "_"}));
            list.createChild("span", {class: "mark", content: correct ? "✓" : "✗"})
                .toggleAttribute("correct", correct);
        });
    }

    /**
     * Returns the value in each slot of a word given a TokenPlacer state,
     * using null for empty slots.
     * @param {Word} word
     * @param {WordGroup} group
     * @param {Object.<string, string>} [placerState]
     * @return {(string|null)[]}
     */
    static getSpelling(word, group, placerState = {}) {
        const spelt = word.slots.map(s => s.given ? s.value : null);
        for (let tokenID in placerState) {
            const slotID = placerState[tokenID];
            if (typeof slotID !== "string" || slotID[0] !== "S") continue;
            const slotIndex = parseInt(slotID.slice(1));
            const tokenValue = group.tokens[parseInt(tokenID.slice(1))];
            if (slotIndex in spelt && spelt[slotIndex] === null) spelt[slotIndex] = tokenValue;
        }
        return spelt;
    }
}



class WordBuilderGroup extends SvgPlus {
    #index = 0;
    #placers = [];
    #group = null;
    constructor() {
        super("word-builder-group");
        this.header = this.createChild("div", {class: "header"});
        this.placerArea = this.createChild("div", {class: "placer"});
        const n = this.createChild("div", {class: "navigation"});
        this.prevButton =n.createChild("access-button", {
            class: "prev tactile",
            events: {
                "access-click": (e) => {
                    this.#setCurrentIndex(this.#index - 1, true)
                    e.waitFor(new Promise(resolve => setTimeout(resolve, 100)));
                }
            }
        })
        this.prevButton.createChild("i-bw", {i: "leftArrow"})

        this.note = n.createChild("div", {class: "current"});
        this.nextButton = n.createChild("access-button", {
            class: "next tactile",
            events: {
                "access-click": (e) => {
                    this.#setCurrentIndex(this.#index + 1, true)
                    e.waitFor(new Promise(resolve => setTimeout(resolve, 100)));
                }
            }
        })
        this.nextButton.createChild("i-bw", {i: "rightArrow"})
    }

    /**
     * Sets the current word group to display.
     * @param {WordGroup} val
     */
    set value(val) {
        this.#group = val;
        this.header.innerHTML = val.name;
        this.#placers = []
        for (let i = 0; i < val.words.length; i++) {
            const placer = new TokenPlacer();
            placer.value = [i, val]
            this.#placers.push(placer);
        }
        this.#setCurrentIndex(0);
    }


    /** The last page (index === number of words) shows the results. */
    get #pageCount() {
        return this.#placers.length + 1;
    }

    #setCurrentIndex(index, triggerEvent = false) {
        if (index >= 0 && index < this.#pageCount) {
            let change = this.#index !== index;
            this.#index = index;
            const isResults = this.#index === this.#placers.length;
            this.placerArea.innerHTML = "";
            this.placerArea.append(isResults ? new ResultsPage(this.state, this.#group) : this.#placers[this.#index]);
            this.prevButton.toggleAttribute("disabled", this.#index === 0);
            this.nextButton.toggleAttribute("disabled", isResults);
            this.note.innerText = isResults ? "Results" : `${this.#index + 1} / ${this.#placers.length}`;
            if (triggerEvent && change) this.dispatchEvent(new Event("change", {bubbles: true}));
        }
    }


    get state() {
        return {
            index: this.#index,
            placers: this.#placers.map(p => p.state)
        };
    }

    set state(value) {
        if (typeof value !== "object" || value === null) return;
        if (typeof value.index !== "number") return;
        if (value.index < 0 || value.index >= this.#pageCount) value.index = 0;
        if ("placers" in value && Array.isArray(value.placers)) {
                this.#placers.forEach((placer, i) => {
                if (i < value.placers.length) {
                    placer.state = value.placers[i];
                }
            });
        }
        this.#setCurrentIndex(value.index);
    }
}
console.log(WordData.groups)

class WordBuilder extends ShadowElement {
    #groupIndex = null;
    constructor(el) {
        super(el, "word-builder-root");

        const us = this.createChild("div", {class: "unit-searcher"})
        us.createChild("div", {class: "header"})
        .createChild("bg-img", {src: import.meta.resolve("../../Assets/WordBuilder/icon.png")})
    
        const ul = us.createChild("div", {class: "unit-list"});
        for (let i = 0; i < WordData.groups.length; i++) {
            const uicon = ul.createChild("access-button", {
                class: "unit-item",
                events: {
                    "access-click": (e) => {
                        this.root.toggleAttribute("view", true);
                        this.state = { groupIndex: i }
                        this.root.dispatchEvent(new Event("change", {bubbles: true}));
                        e.waitFor(new Promise(resolve => setTimeout(resolve, 100)));
                    }
                }
            });
            uicon.group = "aaa" + Math.floor(i / 4)
            uicon.createChild("span", {innerHTML: WordData.groups[i].name});
            uicon.createChild("span", {innerHTML: "<i>Worksheet: </i>" + WordData.groups[i].code});
            uicon.createChild("span", {innerHTML: "<i>Teaching Focus: </i>" + WordData.groups[i].teachingFocus});
        }
        this.wordBuilderGroup = this.createChild(WordBuilderGroup);

        this.root.addEventListener("change", () => {
            this.dispatchEvent(new Event("change", {bubbles: true}));
        });
    }


    goHome() {
        this.#groupIndex = null;
        this.root.toggleAttribute("view", false);
        this.root.dispatchEvent(new Event("change", {bubbles: true}));
    }


    set state(value) {
        if (typeof value !== "object" || value === null) value = {groupIndex: null}
        const { groupIndex = null, groupState = null } = value;

        if (groupIndex in WordData.groups) {
            this.root.toggleAttribute("view", true);
            this.#groupIndex = groupIndex;
            this.wordBuilderGroup.value = WordData.groups[groupIndex];
            this.wordBuilderGroup.state = groupState;
        } else {
            this.root.toggleAttribute("view", false);
        }
    }


    get state() {
        return {
            groupIndex: this.#groupIndex,
            groupState: this.wordBuilderGroup?.state
        }
    }


    static get usedStyleSheets() {
        return [
            import.meta.resolve("./style.css"),
            import.meta.resolve("../BGImage/styles.css"),
            import.meta.resolve("../../Assets/icons.css")
        ];
    }
}

WordBuilder.defineHTMLElement(WordBuilder)

export {WordBuilder}