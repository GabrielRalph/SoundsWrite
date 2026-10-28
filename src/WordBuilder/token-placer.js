import { SvgPlus } from "../SvgPlus/4.js";
import { AccessButton } from "../access-buttons.js";
import "../BGImage/index.js"

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
 *
 * Maps each movable token's ID (its default top slot, e.g. "T0") to the ID
 * of the slot it currently sits in (e.g. "T0" when at home, "S2" when placed).
 * @typedef {Object.<string, string>} TokenPlacerState
 */

const DRAG_TYPE = "text/plain";

class Token extends SvgPlus {
    #value = "";
    #tokenID = null;

    /** @type {?TokenSlot} */
    slot = null;

    constructor(value, tokenID) {
        super("div");
        this.class = "token";
        this.#value = value;
        this.#tokenID = tokenID;
        this.createChild("span", {content: this.#value});
    }

    get value() {
        return this.#value;
    }

    get tokenID() {
        return this.#tokenID;
    }

    /** The ID of the top slot this token returns to. */
    get defaultSlot() {
        return this.#tokenID;
    }

    get slotID() {
        return this.slot ? this.slot.slotID : null;
    }

    addDragEventListeners() {
        this.setAttribute("draggable", "true");
        this.addEventListener("dragstart", (e) => {
            e.dataTransfer.setData(DRAG_TYPE, this.#tokenID);
            e.dataTransfer.effectAllowed = "move";
            this.toggleAttribute("dragging", true);
        });

        this.addEventListener("dragend", () => {
            this.toggleAttribute("dragging", false);
        });
    }
}

class TokenSlot extends AccessButton {
    #token = null;
    #slotID = null;

    /** Locked slots hold a given token and can not be changed. */
    locked = false;

    constructor(slotID) {
        super("token-slot");
        this.class = "token-slot";
        this.#slotID = slotID;
    }

    /**
     * @param {(tokenID: string) => void} onDrop
     */
    addDropEventListeners(onDrop) {
        this.addEventListener("dragover", (e) => {
            if (this.locked) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            this.toggleAttribute("dragover", true);
        });

        this.addEventListener("dragleave", () => {
            this.toggleAttribute("dragover", false);
        });

        this.addEventListener("drop", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!this.locked) {
                onDrop(e.dataTransfer.getData(DRAG_TYPE));
            }
            this.toggleAttribute("dragover", false);
        });
    }

    clear() {
        this.innerHTML = "";
    }

    /**
     * @param {?Token} token
     */
    set token(token) {
        this.clear();
        this.#token = null;
        if (SvgPlus.is(token, Token)) {
            this.#token = token;
            token.slot = this;
            this.appendChild(token);
        }
    }

    /** @return {?Token} */
    get token() {
        return this.#token;
    }

    get slotID() {
        return this.#slotID;
    }

    get filled() {
        return this.#token !== null;
    }

    set selected(bool) {
        this.toggleAttribute("selected", bool);
    }
    get selected() {
        return this.hasAttribute("selected");
    }
}

class TokenPlacer extends SvgPlus {
    /** @type {Object.<string, Token>} */
    #tokens = {};

    /** @type {Object.<string, TokenSlot>} */
    #topSlots = {};

    /** @type {Object.<string, TokenSlot>} */
    #placedSlots = {};

    #selectedTokenID = null;
    #value = null;

    constructor() {
        super("token-placer")
        this.tokenList = this.createChild("div", {
            class: "list",
            events: {
                "dragover": (e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                },
                "drop": (e) => {
                    e.preventDefault();
                    this.#userMove(e.dataTransfer.getData(DRAG_TYPE), null);
                }
            }
        })
        this.placeArea = this.createChild("div", {class: "place-area"})
        this.imageArea = this.placeArea.createChild("div", {class: "image-area"})
        this.slotArea = this.placeArea.createChild("div", {class: "slot-area"})
        this.placeArea.createChild("div", {class: "control-area"})
    }

    /**
     * @param {[number, WordGroup]} val
     */
    set value([index, group]) {
        this.#value = [index, group];
        this.#selectedTokenID = null;
        this.tokenList.innerHTML = "";
        this.slotArea.innerHTML = "";

        this.#tokens = {};
        this.#topSlots = Object.fromEntries(group.tokens.map((value, i) => {
            const slotID = "T" + i;
            const tokenSlot = this.tokenList.createChild(TokenSlot, {
                events: {
                    "access-click": () => this.selectSlot(slotID)
                }
            }, slotID)
            tokenSlot.group = "aaa";
            const token = new Token(value, slotID)
            token.addDragEventListeners();
            tokenSlot.token = token;
            this.#tokens[slotID] = token;
            return [slotID, tokenSlot];
        }));

        const word = group.words[index];
        this.imageArea.innerHTML = `<bg-img src="${import.meta.resolve("../../Assets/WordBuilder/" + word.icon)}"></bg-img>`
        this.#placedSlots = Object.fromEntries(word.slots.map((s, i) => {
            const slotID = "S" + i;
            const tokenSlot = this.slotArea.createChild(TokenSlot, {
                events: {
                    "access-click": () => this.selectSlot(slotID)
                }
            }, slotID)
            tokenSlot.toggleAttribute("underline", s.underline ?? true)
            if (s.underline === false) tokenSlot.toggleAttribute("small", true)
            tokenSlot.group = "aab";
            tokenSlot.addDropEventListeners((tokenID) => this.#userMove(tokenID, slotID));

            if (s.given) {
                tokenSlot.token = new Token(s.value, "G" + i);
                tokenSlot.locked = true;
            }
            return [slotID, tokenSlot];
        }))
    }

    /**
     * @returns {[number, WordGroup]}
     */
    get value() {
        return this.#value;
    }

    /**
     * Moves a token to the given slot. Moving to a top slot (or null) returns
     * the token to its default slot. If the target placed slot already holds a
     * token, that token is swapped into the moving token's previous placed slot,
     * or otherwise returned to its default slot.
     * @param {string} tokenID
     * @param {?string} slotID
     * @return {boolean} true if any token moved
     */
    moveToken(tokenID, slotID) {
        const token = this.#tokens[tokenID];
        if (!token) return false;

        let target = this.#placedSlots[slotID];
        if (!target) target = this.#topSlots[token.defaultSlot];
        if (target.locked || target.token === token) {
            this.#setSelected(null);
            return false;
        }

        const source = token.slot;
        const displaced = target.token;
        source.token = null;
        target.token = token;
        if (displaced) {
            const swapTarget = source.slotID in this.#placedSlots ? source : this.#topSlots[displaced.defaultSlot];
            swapTarget.token = displaced;
        }

        this.#setSelected(null);
        return true;
    }

    /**
     * Handles an access click on a slot. Clicking a filled top slot selects its
     * token, clicking a placed slot then places the selected token there.
     * Clicking a placed token (or the empty home of a placed token) with
     * nothing selected returns that token to its default slot.
     * @param {string} slotID
     */
    selectSlot(slotID) {
        if (slotID in this.#topSlots) {
            const slot = this.#topSlots[slotID];
            if (slot.filled) {
                this.#setSelected(this.#selectedTokenID === slotID ? null : slotID);
            } else {
                this.#userMove(slotID, null);
            }
        } else if (slotID in this.#placedSlots) {
            const slot = this.#placedSlots[slotID];
            if (this.#selectedTokenID) {
                this.#userMove(this.#selectedTokenID, slotID);
            } else if (slot.filled && !slot.locked) {
                this.#userMove(slot.token.tokenID, null);
            }
        }
    }

    #setSelected(tokenID) {
        this.#selectedTokenID = tokenID in this.#tokens ? tokenID : null;
        for (let sid in this.#topSlots) {
            this.#topSlots[sid].selected = sid === this.#selectedTokenID;
        }
    }

    #userMove(tokenID, slotID) {
        if (this.moveToken(tokenID, slotID)) {
            this.dispatchEvent(new Event("change", {bubbles: true}));
        }
    }

    /**
     * @return {TokenPlacerState}
     */
    get state() {
        return Object.fromEntries(Object.values(this.#tokens).map(t => [t.tokenID, t.slotID]));
    }

    /**
     * @param {TokenPlacerState} state
     */
    set state(state) {
        if (typeof state !== "object" || state === null) return;

        // Return every token home, then place those listed in the state.
        for (let tokenID in this.#tokens) {
            this.moveToken(tokenID, null);
        }
        for (let tokenID in state) {
            const slot = this.#placedSlots[state[tokenID]];
            if (slot && !slot.filled) {
                this.moveToken(tokenID, slot.slotID);
            }
        }
        this.#setSelected(null);
    }
}

export { TokenPlacer }
