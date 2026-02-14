import { renderStructogramSVG } from "../common/svg-renderer.js";
import { parsePseudocode, KEYWORDS_DE, KEYWORDS_EN } from "../common/pseudocode-parser.js";
import { generateCode } from "../common/code-generator.js";

/**
 * <struktolab-renderer> web component
 *
 * Attributes:
 *   width      — SVG width in px (default: 600)
 *   font-size  — font size in px (default: 14)
 *   src        — URL to fetch JSON tree from
 *   lang       — pseudocode language: "de" (default) or "en"
 *   scale       — (optional) scale factor for the SVG (e.g. "0.5" for 50% size)
 *   color-mode   — (optional) "light" (default) or "dark" for color scheme
 *
 * Setting the tree:
 *   1. JS property:  element.tree = { ... }
 *   2. src attribute: <struktolab-renderer src="tree.json"></struktolab-renderer>
 *   3. Inline JSON:   <struktolab-renderer>
 *                        <script type="application/json">{ ... }</script>
 *                      </struktolab-renderer>
 *   4. Inline pseudocode:
 *                      <struktolab-renderer>
 *                        <script type="text/pseudocode">
 *                          eingabe("Zahl n")
 *                          ergebnis = 1
 *                          ausgabe("ergebnis")
 *                        </script>
 *                      </struktolab-renderer>
 *   5. JS property:  element.pseudocode = "eingabe(\"n\")\n..."
 *
 * Code export:
 *   element.toCode("python")      → Python source code string
 *   element.toCode("java")        → Java source code string
 *   element.toCode("javascript")  → JavaScript source code string
 *
 * Custom keywords:
 *   element.keywords = { if: "si", else: "sinon", ... }
 */
class StruktolabRenderer extends HTMLElement {
  static get observedAttributes() {
    return ["width", "font-size", "src", "lang", "scale", "color-mode"];
  }

  constructor() {
    super();
    this._tree = null;
    this._keywords = null;
    this._shadow = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `:host { display: block; width: 100%; }`;
    this._shadow.appendChild(style);
    this._container = document.createElement("div");
    this._shadow.appendChild(this._container);
  }

  connectedCallback() {
    requestAnimationFrame(() => this._initialize());
  }

  /** Resolve keyword map: custom → lang attribute → default (DE) */
  _getKeywords() {
    if (this._keywords) return this._keywords;
    const lang = (this.getAttribute("lang") || "de").toLowerCase();
    return lang === "en" ? KEYWORDS_EN : KEYWORDS_DE;
  }

  _initialize() {
    if (!this._tree) {
      const pseudoScript = this.querySelector('script[type="text/pseudocode"]');
      if (pseudoScript) {
        try {
          this._tree = parsePseudocode(pseudoScript.textContent, this._getKeywords());
        } catch (e) {
          console.error("struktolab-renderer: failed to parse pseudocode", e);
        }
      }
    }
    if (!this._tree) {
      const script = this.querySelector('script[type="application/json"]');
      if (script) {
        try {
          this._tree = JSON.parse(script.textContent);
        } catch (e) {
          console.error("struktolab-renderer: invalid inline JSON", e);
        }
      }
    }
    if (!this._tree && this.hasAttribute("src")) {
      this._fetchTree(this.getAttribute("src"));
      return;
    }
    this._render();
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (name === "src" && newVal && newVal !== oldVal) {
      this._fetchTree(newVal);
    } else if (name === "lang") {
      // Re-parse pseudocode with new keywords if pseudocode is present
      const pseudoScript = this.querySelector('script[type="text/pseudocode"]');
      if (pseudoScript) {
        try {
          this._tree = parsePseudocode(pseudoScript.textContent, this._getKeywords());
        } catch (e) { /* ignore */ }
      }
      this._render();
    } else {
      this._render();
    }
  }

  /** @param {Object} tree */
  set tree(tree) {
    this._tree = tree;
    this._render();
  }

  get tree() {
    return this._tree;
  }

  /** @param {Object} kw - Custom keyword map (same shape as KEYWORDS_DE/KEYWORDS_EN) */
  set keywords(kw) {
    this._keywords = kw;
  }

  get keywords() {
    return this._getKeywords();
  }

  /** @param {string} code */
  set pseudocode(code) {
    this._tree = parsePseudocode(code, this._getKeywords());
    this._render();
  }

  /**
   * Export the current structogram as source code.
   * @param {string} lang - Target language: "python", "java", or "javascript"
   * @returns {string} Generated source code
   */
  toCode(lang) {
    if (!this._tree) return "";
    return generateCode(this._tree, lang);
  }

  async _fetchTree(url) {
    try {
      const res = await fetch(url);
      this._tree = await res.json();
      this._render();
    } catch (e) {
      console.error("struktolab-renderer: failed to fetch tree from", url, e);
    }
  }

  _render() {
    if (!this._tree) return;
    const fontSize = parseInt(this.getAttribute("font-size"), 10) || 14;
    // Use explicit width attribute or measure from container
    const attrWidth = this.getAttribute("width");
    const scale = parseFloat(this.getAttribute("scale")) || "1";
    const colorMode = this.getAttribute("color-mode") || "color";
    const width = attrWidth
      ? parseInt(attrWidth, 10)
      : (this.clientWidth || this.getBoundingClientRect().width || 600);

    // Clear previous content
    while (this._container.firstChild) {
      this._container.removeChild(this._container.firstChild);
    }

    const svg = renderStructogramSVG(this._tree, { width, fontSize, colorMode });
    this._container.appendChild(svg);
  }
}

export { StruktolabRenderer, renderStructogramSVG, parsePseudocode, generateCode, KEYWORDS_DE, KEYWORDS_EN };
export default StruktolabRenderer;
