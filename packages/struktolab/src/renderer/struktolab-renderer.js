import { renderStructogramSVG } from "../common/svg-renderer.js";
import { parsePseudocode, KEYWORDS_DE, KEYWORDS_EN } from "../common/pseudocode-parser.js";
import { generateCode } from "../common/code-generator.js";
import { parseJava, parseJavaScript } from "../common/brace-parser.js";
import { parsePython } from "../common/python-parser.js";
import { inlineSource } from "../common/parse-common.js";

/** Source-code parsers by code mode; pseudocode has its own keywords. */
const CODE_PARSERS = { java: parseJava, python: parsePython, javascript: parseJavaScript };

/**
 * <struktolab-renderer> web component
 *
 * Attributes:
 *   width      — SVG width in px (default: 600)
 *   font-size  — font size in px (default: 14)
 *   src        — URL of a JSON tree or a saved .struktolab document
 *   lang       — pseudocode language: "de" (default) or "en"
 *   scale      — (optional) scale factor for the SVG (e.g. "0.5" for 50% size)
 *   color-mode — (optional) "color" (default), "greyscale" or "bw"
 *   code-mode  — (optional) the language the structogram is written in:
 *                "pseudocode" (default), "java", "python" or "javascript".
 *                Function headers read like that language: `int max(int a)`
 *                in Java, `max(a: int) -> int` otherwise. Taken from inline
 *                code's data-code when not set.
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
 *   5. Inline Java, Python or JavaScript:
 *                      <struktolab-renderer>
 *                        <script type="text/plain" data-code="java">
 *                          void main() {
 *                              int n = Integer.parseInt(IO.readln());
 *                              IO.println(n * 2);
 *                          }
 *                        </script>
 *                      </struktolab-renderer>
 *   6. JS: element.pseudocode = "eingabe(\"n\")\n..."
 *          element.loadCode("for i in range(3):\n    print(i)", "python")
 *
 * Code that cannot be read shows its error, with the line, in place of the
 * diagram — so an author sees the mistake on the page.
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
    return ["width", "font-size", "src", "lang", "scale", "color-mode", "code-mode"];
  }

  constructor() {
    super();
    this._tree = null;
    this._keywords = null;
    this._error = null;
    /** The language the tree came in, when it came as code: inline or loadCode. */
    this._sourceMode = null;
    this._shadow = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
:host { display: block; width: 100%; }
.error {
  padding: 8px 10px;
  border: 1px solid #c0392b;
  border-radius: 4px;
  background: #fdecea;
  color: #8e2a1f;
  font: 13px/1.4 sans-serif;
  white-space: pre-wrap;
}`;
    this._shadow.appendChild(style);
    this._container = document.createElement("div");
    this._shadow.appendChild(this._container);
  }

  connectedCallback() {
    // While the page is still being parsed, the inline <script> children may
    // not exist yet when the element is connected.
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this._initialize(), { once: true });
    } else {
      requestAnimationFrame(() => this._initialize());
    }
  }

  _uiLang() {
    return (this.getAttribute("lang") || "de").toLowerCase() === "en" ? "en" : "de";
  }

  /** Resolve keyword map: custom → lang attribute → default (DE) */
  _getKeywords() {
    if (this._keywords) return this._keywords;
    return this._uiLang() === "en" ? KEYWORDS_EN : KEYWORDS_DE;
  }

  /** "pseudocode", "java", "python" or "javascript": the attribute, else what the code came in. */
  get codeMode() {
    const attr = this.getAttribute("code-mode");
    if (attr === "pseudocode" || CODE_PARSERS[attr]) return attr;
    return this._sourceMode || "pseudocode";
  }

  set codeMode(mode) {
    this.setAttribute("code-mode", mode);
  }

  /** Parse code in `mode`; a failure is kept to be shown instead of the diagram. */
  _parse(code, mode) {
    try {
      const tree =
        mode === "pseudocode"
          ? parsePseudocode(code, this._getKeywords())
          : CODE_PARSERS[mode](code, { lang: this._uiLang() });
      this._error = null;
      return tree;
    } catch (e) {
      this._error = e.message;
      return null;
    }
  }

  /** Whatever inline source the element holds, parsed — or false when there is none. */
  _parseInline() {
    const codeScript = this.querySelector("script[data-code]");
    const mode = codeScript?.dataset.code;
    if (codeScript && CODE_PARSERS[mode]) {
      this._sourceMode = mode;
      return this._parse(inlineSource(codeScript.textContent), mode);
    }
    const pseudoScript = this.querySelector('script[type="text/pseudocode"]');
    if (pseudoScript) {
      this._sourceMode = "pseudocode";
      return this._parse(pseudoScript.textContent, "pseudocode");
    }
    return false;
  }

  _initialize() {
    if (!this._tree) {
      const parsed = this._parseInline();
      if (parsed) this._tree = parsed;
    }
    if (!this._tree && !this._error) {
      const script = this.querySelector('script[type="application/json"]');
      if (script) {
        try {
          this._useData(JSON.parse(script.textContent));
        } catch (e) {
          console.error("struktolab-renderer: invalid inline JSON", e);
        }
      }
    }
    if (!this._tree && !this._error && this.hasAttribute("src")) {
      this._fetchTree(this.getAttribute("src"));
      return;
    }
    this._render();
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (name === "src" && newVal && newVal !== oldVal) {
      this._fetchTree(newVal);
    } else if (name === "lang") {
      // Pseudocode keywords and error messages follow the language: read inline code again.
      if (this._sourceMode) {
        const parsed = this._parseInline();
        if (parsed !== false) this._tree = parsed;
      }
      this._render();
    } else {
      this._render();
    }
  }

  /** @param {Object} tree */
  set tree(tree) {
    this._tree = tree;
    this._error = null;
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
    this.loadCode(code, "pseudocode");
  }

  /**
   * Show the structogram of source code.
   * @param {string} code
   * @param {"pseudocode"|"java"|"python"|"javascript"} mode
   */
  loadCode(code, mode) {
    if (mode !== "pseudocode" && !CODE_PARSERS[mode]) {
      throw new Error(`struktolab-renderer: cannot read code as "${mode}"`);
    }
    this._sourceMode = mode;
    this._tree = this._parse(code, mode);
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

  /**
   * A bare tree, or a saved .struktolab document — then its model, and its
   * code mode unless the element sets one.
   */
  _useData(data) {
    const isDocument = data && typeof data === "object" && ("model" in data || "settings" in data);
    if (!isDocument) {
      this._tree = data;
      return;
    }
    this._tree = data.model || null;
    const mode = data.settings?.codeMode;
    if (mode === "pseudocode" || CODE_PARSERS[mode]) this._sourceMode = mode;
  }

  async _fetchTree(url) {
    try {
      const res = await fetch(url);
      this._error = null;
      this._useData(await res.json());
      this._render();
    } catch (e) {
      console.error("struktolab-renderer: failed to fetch tree from", url, e);
    }
  }

  _resolveWidth() {
    const scale = parseFloat(this.getAttribute("scale")) || 1;
    const container =
      this.clientWidth ||
      this.getBoundingClientRect().width ||
      600;
    return Math.round(container / scale);
  }

  _render() {
    // Clear previous content
    while (this._container.firstChild) {
      this._container.removeChild(this._container.firstChild);
    }

    if (this._error) {
      const error = document.createElement("div");
      error.className = "error";
      error.setAttribute("role", "alert");
      error.textContent = this._error;
      this._container.appendChild(error);
      return;
    }
    if (!this._tree) return;

    const fontSize = parseInt(this.getAttribute("font-size"), 10) || 14;
    const colorMode = this.getAttribute("color-mode") || "color";
    const width = this._resolveWidth();

    const svg = renderStructogramSVG(this._tree, {
      width,
      fontSize,
      colorMode,
      keywords: this._getKeywords(),
      functionStyle: this.codeMode === "java" ? "java" : "arrow",
    });
    this._container.appendChild(svg);
  }
}

export { StruktolabRenderer, renderStructogramSVG, parsePseudocode, generateCode, KEYWORDS_DE, KEYWORDS_EN };
export default StruktolabRenderer;
