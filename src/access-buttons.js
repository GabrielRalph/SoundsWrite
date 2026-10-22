import { SvgPlus, Vector } from "./SvgPlus/4.js";
// import { loadUtterances, speak } from "../text2speach-proxy.js";

const DEBUG = () => void(0);
// (...args) => {
//     console.log("%c[Access Buttons]", "background: #cc3300 ; padding: 3px; color: white;", ...args);
// }

async function getPromiseState(promise) {
    const token = {};
    // Race your promise against a pending token. 
    // If the token wins, the targeted promise is definitely still pending.
    let value = await Promise.race([promise, Promise.resolve(token)])
    return value === token ? "pending" : "fulfilled";
}


function isAccessEvent(event) {
    return event != null 
            && typeof event === "object" 
            && Array.isArray(event.eventPromises) 
            && "initialEvent" in event
}

export class AccessEvent extends Event {
    /** @type {?("click"|"dwell"|"switch")} */
    clickMode = null;

    /** @type {?AccessEvent} oldEvent  */ 
    initialEvent = null

    /** @type {Promise[]} */
    eventPromises = [];

     /** 
     * @param {?("click"|"dwell"|"switch"|AccessEvent)} mode
     * @param {Event} oldEvent
     * */
    constructor(eventName, mode, config) {
        const Config = {cancelable: true}
        if (typeof config === "object" && config !== null) {
            for (let key in config) {
                Config[key] = config[key]
            }
        }
        super(eventName, Config);
        let oldEvent = this;
        if (isAccessEvent(mode)) {
            if (mode.initialEvent != null && Array.isArray(mode.initialEvent.eventPromises)) {
                mode = mode.initialEvent;
            }
            oldEvent = mode;
            mode = mode.clickMode;
        }
        this.clickMode = mode;
        this.initialEvent = oldEvent;
    }

    async waitFor(promise, stopImmediatePropagation = false) {
        DEBUG("add promise");
        if (stopImmediatePropagation) {
            this.stopImmediatePropagation()
        }
        
        let e = this.initialEvent;

        e.eventPromises.push(promise);

        return await promise;
    }

    async _waitForAll() {
        DEBUG("start waiting");
        let i = 0;
        while (i < this.initialEvent.eventPromises.length) {
            let promise = this.initialEvent.eventPromises[i];
            await promise;
            i++;
        }
        DEBUG("end waiting");
    }

    async waitAll(timeout){
        
        let res = null;
        if (typeof timeout === "number") {
            res = await Promise.race([
                this._waitForAll(),
                new Promise(r => setTimeout(r, timeout))
            ]);
        } else {
            res = await this._waitForAll();
        }
        return res;
    }
}

export class AccessClickEvent extends AccessEvent {
    constructor(mode) {
        super("access-click", mode)
    }
}

class AccessButtonsLookupTable {
    /** @type {Object.<string, AccessButtonRoot[]>} */
    lookup = {}

    /** Add access button element to button groups lookup table.
     * @param {AccessButtonRoot} element
     * @param {string} group
     */ 
    add(element, group) {
        let {lookup} = this;
        if (typeof group === "undefined") group = element.group;
        if (!(group in lookup)) lookup[group] = [];
        if (lookup[group].indexOf(element) == -1) lookup[group].push(element);
    }

    /** Remove access button from button groups lookup table.
     * @param {AccessButtonRoot} element
     * @param {string} group
     */ 
    remove(element, group){
        let {lookup} = this;
        if (typeof group === "undefined") group = element.group;
        if (group in lookup) {
            lookup[group] = lookup[group].filter(el => el !== this);
        }
    }

    /** Get all groups of vissibl
     * @return {Object.<string,AccessButtonRoot[]>}
     */
    getVisibleGroups(){
        let newGroups = {};
        let {lookup} = this;
        for (let name in lookup) {
            let group = lookup[name].filter(button => button.isConnected && button.isVisible);
            if (group.length > 0) {
                group.sort((a, b) => {
                    if (a.order != null && b.order == null) return -1;
                    if (a.order == null && b.order != null) return 1;
                    if (a.order == null && b.order == null) return 0;
                    if (a.order != null && b.order != null) {
                        return a.order - b.order;
                    }
                });
                newGroups[name] = [...group];
            }
        }

        let newGroupsSorted = {};
        //Sort keys alphabetically, but keep the order of buttons in each group.
        Object.keys(newGroups).sort((a, b) => {
            if (a < b) return -1;
            if (a > b) return 1;
            return 0;
        }).forEach(key => {
            newGroupsSorted[key] = newGroups[key];
        });
            
        return newGroupsSorted;
    }

    getVisibleButtonsInGroup(group) {
        let {lookup} = this;
        if (group in lookup) {
            let buttons = lookup[group].filter(button => button.isConnected && button.isVisible);
             buttons.sort((a, b) => {
                    if (a.order != null && b.order == null) return -1;
                    if (a.order == null && b.order != null) return 1;
                    if (a.order == null && b.order == null) return 0;
                    if (a.order != null && b.order != null) {
                        return a.order - b.order;
                    }
            });
            return buttons;
        } else {
            return [];
        }
    }

}

function checkClickable(root, element, center){
    let clickable = false;
    try {
        let els = root.elementsFromPoint(center.x, center.y);
        while (els[0].hasAttribute("access-transparent")) els.shift();
        let el = els[0]
        do {
            if (el === element) {
                clickable = true;
                break;
            }
        } while (el = (el.parentNode || el.host));
    } catch (e) {
        clickable = false;
    }
    return clickable
}

function getElementFromPoint(x, y) {
  let root = document.elementFromPoint(x, y);
  const seen = new Set();

  while (root) {
    if (seen.has(root)) break;
    seen.add(root);

    if (root.shadowRoot != null) {
      const next = root.shadowRoot.elementFromPoint(x, y);
      if (!next || next === root) break;
      root = next;
    } else if (root.tagName === "IFRAME" && root.contentDocument) {
      const rect = root.getBoundingClientRect();
      x -= rect.x;
      y -= rect.y;
      root = root.contentDocument.elementFromPoint(x, y);
    } else {
      break;
    }
  }

  return root;
}

// Private variables
const $ = new WeakMap();
const ButtonsLookup = new AccessButtonsLookupTable();
class AccessButtonRoot extends HTMLElement {
    constructor(){
        super();
        $.set(this, {group: "default", order: null, highlighted: false, clickBoxElement: null});
        this.addEventListener("click", (e) => {
            this.accessClick("click", e);
        })
    }

    static get observedAttributes() {return  ["access-group", "access-order"]};

    /** @return {string} */
    get group(){ return $.get(this).group; }

    /** @param {string} group */
    set group(group){ 
        this.setAttribute("access-group", group); 
        $.get(this).group = group;
    }

    /** @return {?number} */
    get order(){ return $.get(this).order; }

    /** @param {number|string} order */
    set order(order){ 
        this.setAttribute("access-order", order); 
        $.get(this).order = order;
    }

    /** @return {boolean} */
    get isVisible() {return this.getIsVisible()}

    /** @return {Vector} */
    get center(){ return this.getCenter(); }

    /** @return {?(ShadowRoot|Document)} */
    get hostedRoot() {
        let root = this.clickBoxElement;
        while (!(root instanceof ShadowRoot) && !(root instanceof Document)) {
            let nroot = root.parentNode;
            if (nroot == null) {
                return root;
            } else {
                root = nroot;
            }
        }
        return root;
    }

    /** @return {?number} */
    get size() {
        return this.getSize();
    }

    /** @returns {boolean} */
    get highlight(){ return $.get(this).highlighted; }

    /** @param {boolean}  */
    set highlight(isHighlighted) {
        $.get(this).highlighted = isHighlighted;
        this.setHighlight(isHighlighted);
    }
    

    /** @return {Element} */
    get clickBoxElement(){ return ($.get(this).clickBoxElement || this); }

    /** @param {Element} element */
    set clickBoxElement(element) {
        if (element instanceof Element) {
            Object.defineProperty(element, "linkedAccessButton", {get: () => this});
            $.get(this).clickBoxElement = element;
        }
    }
    
    /** @return {string} */
    get utteranceText() { return $.get(this).utteranceText; }

    /** @param {string} text */
    set utteranceText(text) {
        $.get(this).utteranceText = text;
        // loadUtterances([text]);
    }


    /**
     * Speak the button's utterance text.
     * @return {Promise<void>}
     */
    async speakUtterance() {
        if (this._speaking) return;
        this._speaking = true;
        // await speak(this.utteranceText);
        this._speaking = false;
    }

    /** 
     * @param {?("click"|"dwell"|"switch")} mode
     * @param {Event} oldEvent
     * */
    async accessClick(mode, timeout) {
        const event = new AccessClickEvent(mode)
        this.dispatchEvent(event);
        this.activeAnimation();
        await event.waitAll(timeout);
    }

    /** 
     * @override
     * @return {boolean} 
     * */
    getIsVisible(){return this.isPointInElement(this.center);}

    /**
     * @override
     * @return {Vector} 
     * */
    getCenter(){ 
        let brect = this.getBoundingClientRect();
        let center = new Vector(brect.x + brect.width/2, brect.y + brect.height/2)
        return center;
    }

    /**
     * @override
     * @param {boolean} isHighlighted whether the element is being highlighted
     */
    setHighlight(isHighlighted){
        this.toggleAttribute("hover", isHighlighted)
    }

    /**
     * @override
     * @param {Vector} p point to check
     * 
     * @return {boolean} whether the point is in the element.
     */
    isPointInElement(p) {
        let root = this.hostedRoot;
        let proxy = this.clickBoxElement;
        return checkClickable(root, proxy, p)
    }

    getSize() {
        return null;
    }

    activeAnimation(){
        this.toggleAttribute("active", true);
        setTimeout(() => {
            this.toggleAttribute("active", false);
        }, 200);
    }

    connectedCallback() {
        ButtonsLookup.add(this);
    }
    
    disconnectedCallback() {
        ButtonsLookup.remove(this);
        if (this.ondisconnect instanceof Function) this.ondisconnect();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === "access-group") {
            // Store newValue in private storage.
            $.get(this).group = newValue;

            // Update the lookup table if the icon is already connected.
            if (this.isConnected) {
                ButtonsLookup.remove(this, oldValue);

                ButtonsLookup.add(this, newValue);
            }
        } else if (name === "access-order") {
            let order = parseFloat(newValue);
            if (Number.isNaN(order)) order = null;
            $.get(this).order = order;
        }
    }
}


/**
 * @extends {AccessButtonRoot}
 */
export class AccessButton extends SvgPlus {
    constructor(group) {
        super("access-button");
        this.group = group;
    }

    /** @param {string} text */
    set utterance(text) {
        this.utteranceText = text;
    }

    /** @returns {string} */
    get utterance() {
        return this.utteranceText;
    }

    /**
     * Speak the button's utterance text.
     * @return {Promise<void>}
     */
    async speak() {
        await this.speakUtterance();
    }

}

function isAccessButton(element) {
    if (typeof element !== "object" || element === null) return null;
    if (element instanceof AccessButtonRoot || (element?.tagName || "").toLowerCase() === "access-button") {
        return element;
    } else if (element.linkedAccessButton) {
        return isAccessButton(element.linkedAccessButton);
    }
    return null;
}


export function getButtonGroups(){
   return ButtonsLookup.getVisibleGroups();
}

export function getButtonsInGroup(group) {
    return ButtonsLookup.getVisibleButtonsInGroup(group);
}

export function getButtonAtPoint(x, y) {
    let element = getElementFromPoint(x, y);
    while (element) {
        let accessButton = isAccessButton(element);
        if (accessButton) {
            element = accessButton;
            break;
        } else {
            element = element.parentNode || element.host;
        }
    }
    element = isAccessButton(element);
    return element
}



if (!customElements.get("access-button")) {
    customElements.define("access-button", AccessButtonRoot);
}

window.getButtonGroups = getButtonGroups;