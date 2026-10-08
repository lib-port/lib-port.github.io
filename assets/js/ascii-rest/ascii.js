/*! ascii.rest © 2026 bas3line (https://github.com/bas3line). MIT licence; see LICENSE. */
import { isPiece, load } from "./library.js";
import { mount } from "./mount.js";
const STYLE = '@font-face{font-family:"ascii.rest mono";src:url(' + new URL("./fonts/ascii-rest-mono.woff2", import.meta.url).href + ') format("woff2");unicode-range:U+00B0,U+00B7,U+2022,U+2500-259F,U+25CF;font-display:swap}' + ':where(ascii-art){display:block}:where(ascii-art>pre){margin:0;font:inherit;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono","ascii.rest mono",monospace;line-height:1.2;letter-spacing:0;white-space:pre;font-variant-ligatures:none}';
const Base = typeof HTMLElement === "undefined" ? class {
} : HTMLElement;
export class AsciiArt extends Base {
    static observedAttributes = [
        "piece",
        "src",
        "fps",
        "options",
        "label",
        "mono"
    ];
    #stop = null;
    #run = 0;
    connectedCallback() {
        this.#start();
    }
    disconnectedCallback() {
        this.#run++;
        this.#stop?.();
        this.#stop = null;
    }
    attributeChangedCallback() {
        if (this.isConnected) this.#start();
    }
    async #start() {
        this.removeAttribute("data-ascii-ready");
        try {
            await this.#render();
        } catch (error) {
            this.dispatchEvent(new CustomEvent("ascii-art-error", {
                bubbles: true
            }));
            console.warn("<ascii-art> could not render its local scene:", error);
        }
    }
    async #render() {
        const run = ++this.#run;
        const name = this.getAttribute("piece") ?? "";
        const src = this.getAttribute("src");
        let piece;
        let options;
        try {
            if (src) piece = await import(new URL(src, document.baseURI).href);
            else if (isPiece(name)) piece = await load[name]();
            else {
                this.dispatchEvent(new CustomEvent("ascii-art-error", {
                    bubbles: true
                }));
                return;
            }
            options = JSON.parse(this.getAttribute("options") || "{}");
        } catch (error) {
            if (run === this.#run) this.dispatchEvent(new CustomEvent("ascii-art-error", {
                bubbles: true
            }));
            console.warn(`<ascii-art> could not load ${src || name}:`, error);
            return;
        }
        if (run !== this.#run) return;
        const fps = this.getAttribute("fps");
        if (fps !== null && fps !== "" && !Number.isNaN(+fps)) options.fps = +fps;
        const el = document.createElement(piece.meta.palette && !this.hasAttribute("mono") ? "canvas" : "pre");
        el.setAttribute("role", "img");
        el.setAttribute("aria-label", this.getAttribute("label") || piece.meta.name);
        this.#stop?.();
        this.replaceChildren(el);
        this.#stop = mount(el, piece, options);
        this.setAttribute("data-ascii-ready", "true");
        this.dispatchEvent(new CustomEvent("ascii-art-ready", {
            bubbles: true
        }));
    }
}
export function define(tag = "ascii-art") {
    if (typeof customElements === "undefined" || customElements.get(tag)) return;
    const style = document.createElement("style");
    style.textContent = tag === "ascii-art" ? STYLE : STYLE.replaceAll("ascii-art", tag);
    document.head.append(style);
    customElements.define(tag, tag === "ascii-art" ? AsciiArt : class extends AsciiArt {
    });
}
define();
