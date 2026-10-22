import { SoundsWriteFourInARow } from '../src/FourInARow/four-in-a-row.js';
SoundsWriteFourInARow.defineHTMLElement(SoundsWriteFourInARow, "four-in-a-row");

const el = document.querySelector("four-in-a-row");

if (window.SquidlyAPI) {
    const api = window.SquidlyAPI;

    api.firebaseOnValue("four-in-a-row", (state) => {
        el.state = state || "~";
    });
    el.addEventListener("update", e => {
        api.firebaseSet("four-in-a-row", el.state);
    });
}

SoundsWriteFourInARow.loadStyleSheets().then(() => {
    document.body.toggleAttribute("loaded", true);
});

