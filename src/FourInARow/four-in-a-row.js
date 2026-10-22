import { GridIcon, GridLayout, ShadowElement } from "https://session.squidly.com.au/main/utilities.js";
import { SoundsWritreDB } from "../../Assets/FourInARow/data.js";
const SIZE = 5;
const WINNING_PATTERNS = [
    /(0)(0)(0)(0)/gd,
    /(1)(1)(1)(1)/gd,

    /(0).{5}(0).{5}(0).{5}(0)/gd,
    /(1).{5}(1).{5}(1).{5}(1)/gd,

    /(0).{4}(0).{4}(0).{4}(0)/gd,
    /(1).{4}(1).{4}(1).{4}(1)/gd,

    /(0).{6}(0).{6}(0).{6}(0)/gd,
    /(1).{6}(1).{6}(1).{6}(1)/gd,
]

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


class WordIcon extends GridIcon {
    #state = "-";
    constructor(wordState) {
        const [word, state] = wordState.split(":");
        super( {
            displayValue: word,
            type: state == "-" ? "white" : state,
        })
        this.word = word;
        this.state = state;
    }

    set state(state) {
        this.#state = state;
        this.type = {theme: state == "-" ? "white" : state};
        this.highlight = state == "-" ? false : true;

    }
    get state() {
        return this.#state;
    }

    set winning(bool) {
        this.toggleAttribute("winning", bool);
    }
}

class Board extends GridLayout {
    #nextPlayer = 0;
    #rows = [];
    #winInfo = null;
    constructor(){
        super(SIZE, SIZE);
        this.classList.add("board");
    }


    checkWinner() {
        const state = this.winState;
        let match = null;
        for (const pattern of WINNING_PATTERNS) {
            const m = [...state.matchAll(pattern)];
            if (m.length > 0) {
                match = m[0];
                break;
            }
        }
        if (match) {
            this.toggleAttribute("won", true);
            let charIndex2RowCol = []
            for (let i = 0; i < SIZE; i++) {
                for (let j = 0; j < SIZE; j++) {
                    charIndex2RowCol.push([i, j])
                }
                charIndex2RowCol.push(null); // for the "|" separator
            }

            const winner = match[1];
            const winningPositions = match.indices.slice(1).map(([start]) => charIndex2RowCol[start]);
            this.#winInfo = {winner, winningPositions};

            for (let child of this.children) {
                child.disabled = true;
            }
            for (const [row, col] of winningPositions) {
                this.#rows[row][col].disabled = false;
                this.#rows[row][col].winning = true;
            }
        } else {
            this.#winInfo = null;
            return null;
        }
    }
    _onUpdate(runEvent = true) {
        this.checkWinner();
        if (runEvent) {
            if (this.onUpdate instanceof Function)
                this.onUpdate(this.state);
            this.dispatchEvent(new CustomEvent("update", {detail: {state: this.state}}));
        }
    }

    set state(state) {
        let currentState = this.state;
        if (currentState == state) {
            return;
        }
        this.innerHTML = "";
        this.toggleAttribute("won", false);

        const [np, data] = state.split("||");
        const words = data.split("|");
        this.#nextPlayer = parseInt(np);

        const rows = []
        for (let i = 0; i < SIZE; i++) {
            const row = [];
            for (let j = 0; j < SIZE; j++) {
                const index = i * SIZE + j;
                const word = new WordIcon(words[index]);
                word.addEventListener("access-click", e => {
                    if (word.state == "-") {
                        word.state = this.#nextPlayer+"";
                        this.#nextPlayer = (this.#nextPlayer + 1) % 2;
                        this._onUpdate();
                        e.waitFor(delay(500));
                    }
                })
                this.add(word, i, j);
                row.push(word);
            }
            rows.push(row);
        }
        this.#rows = rows;
        this._onUpdate(false);
    }

    get nextPlayer() {
        return this.#nextPlayer;
    }

    get winState() {
        return this.#rows.map(row => row.map(word => word.state).join("")).join("|");
    }

    get state() {
        return this.#nextPlayer + "||" + [...this.children].map(c => c.word + ":" + c.state).join("|");  
    }
}

class SoundsWriteFourInARow extends ShadowElement {
    #mode = "home";
    constructor(el) {
        super(el, "div");

        this.home = this.createChild("div", {class: "home"});

        this.home.createChild("img", {class: 'head', src: import.meta.resolve("../FourInARow/header.png")});
        this.home.createChild("img", {class: 'logo', src: import.meta.resolve("../Assets/logo-banner.png")});
        this.home.createChild(GridLayout, {}, 2,2).addGridIcons([
            [
                { 
                    displayValue: "Initial Code</br><b>Unit 2</b>", 
                    events: {"access-click": this.startGame.bind(this, "Initial Code Unit 2")}
                },
                { 
                    displayValue: "Initial Code</br><b>Unit 3</b>",
                    events: {"access-click": this.startGame.bind(this, "Initial Code Unit 3")}
                 },
            ],
            [
                { 
                    displayValue: "Initial Code</br><b>Unit 4</b>",
                    events: {"access-click": this.startGame.bind(this, "Initial Code Unit 4")}
                },
                { 
                    displayValue: "Initial Code</br><b>Unit 5</b>",
                    events: {"access-click": this.startGame.bind(this, "Initial Code Unit 5")}
                }
            ]
        ])
        
        this.game = this.createChild(GridLayout, {class: "game"}, 8, 5);
        this.board = this.game.add(this.game.createChild("div", {class: "board-cont"}), [0,7], [1,4]).createChild(Board);
        [[this.p1], [this.p2]] = this.game.addGridIcons([
            [{displayValue: "Player 1", type: {theme: "0"}}],
            [{displayValue: "Player 2", type: {theme: "1"}}]
        ], 2, 0);
        this.game.addGridIcon({
            displayValue: "Back to Home",
            symbol: "home",
            type: "lightOrange",
            events: {"access-click": this.goHome.bind(this)}
        }, [6,7], 0)

        this.board.onUpdate = (state) => {
            this.p1.highlight = this.board.nextPlayer == 0;
            this.p2.highlight = this.board.nextPlayer == 1;
            this.dispatchEvent(new CustomEvent("update", {detail: {state: state}}));
        }

        this.game.createChild

        this.mode = "home";
    }

    set mode(mode) {
        this.#mode = mode;
        this.root.setAttribute("mode", mode);
    }

    get state(){
        if (this.#mode == "home") {
            return "~";
        } else {
            return this.board.state;
        }
    }

    set state(state) {
        if (state == "~") {
            this.mode = "home";
        } else {
            this.mode = "game";
            this.board.state = state;
        }
    }


    goHome(event) {
        this.mode = "home";
        this.dispatchEvent(new CustomEvent("update", {detail: {state: this.board.state}}));
        event.waitFor(delay(500))
    }

    startGame(unitName, event) {
        this.createGame(unitName);
        this.mode = "game";
        this.p1.highlight = this.board.nextPlayer == 0;
        this.p2.highlight = this.board.nextPlayer == 1;
        this.dispatchEvent(new CustomEvent("update", {detail: {state: this.board.state}}));
        event.waitFor(delay(500))
    }

    createGame(unitName) {
        const words = SoundsWritreDB.filter(word => word.unit == unitName)
        words.sort(() => Math.random() - 0.5);
        this.board.state = 0 + "||" + words.map(w => w.word + ":" + "-").join("|");
    }


    static get usedStyleSheets() {
        return [
            GridIcon.styleSheet,
            import.meta.resolve("./styles.css"),
        ]
    }
}

export {SoundsWriteFourInARow, WordIcon}