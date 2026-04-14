import { renderStructogramSVG, setInsertNodeHeight } from "../common/svg-renderer.js";
import {
  parsePseudocode,
  KEYWORDS_DE,
  KEYWORDS_EN,
} from "../common/pseudocode-parser.js";
import { generateCode } from "../common/code-generator.js";
import { treeToPseudocode } from "../common/tree-to-pseudocode.js";
import {
  ensureIds,
  insertAt,
  removeNode,
  editText,
  moveNode,
  findNode,
  cloneTree,
  wrapWithInsertNodes,
  stripInsertNodes,
  addCase,
  removeCase,
} from "../common/tree-ops.js";

/* ── Constants ─────────────────────────────────────────────── */

const INSERT_COLOR = "rgba(1, 116, 96, 0.2)";
const INSERT_HOVER_COLOR = "rgba(1, 116, 96, 0.45)";
const INSERT_HEIGHT = 20;
const DELETE_HOVER_COLOR = "rgba(192, 57, 43, 0.25)";

/* ── Toolbar definitions ───────────────────────────────────── */

const TOOLBAR_ITEMS = [
  { type: "TaskNode", label: "Task", icon: "▭" },
  { type: "InputNode", label: "Input", icon: "▶" },
  { type: "OutputNode", label: "Output", icon: "◀" },
  { type: "BranchNode", label: "If/Else", icon: "◇" },
  { type: "CaseNode", label: "Switch", icon: "⊞" },
  { type: "HeadLoopNode", label: "While", icon: "↻" },
  { type: "FootLoopNode", label: "Do-While", icon: "↺" },
  { type: "CountLoopNode", label: "For", icon: "#" },
  { type: "FunctionNode", label: "Function", icon: "ƒ" },
  { type: "TryCatchNode", label: "Try/Catch", icon: "⚡" },
];

/* ── CSS ───────────────────────────────────────────────────── */

const STYLES = `
:host {
  display: block;
  width: 100%;
  font-family: sans-serif;
  --toolbar-bg: #f5f5f5;
  --toolbar-border: #d6d6d6;
  --btn-bg: #fff;
  --btn-hover: #b5e3d9;
  --btn-active: #b5e3d9;
  --danger: #c0392b;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 8px;
  background: var(--toolbar-bg);
  border: 1px solid var(--toolbar-border);
  border-radius: 4px 4px 0 0;
  align-items: center;
}

.toolbar button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--toolbar-border);
  border-radius: 3px;
  background: var(--btn-bg);
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  white-space: nowrap;
  user-select: none;
}
.toolbar button:hover { background: var(--btn-hover); }
.toolbar button.active { background: var(--btn-active); border-color: #017460; }
.toolbar button.danger { color: var(--danger); border-color: var(--danger); }
.toolbar button.danger:hover { background: #fde; }
.toolbar button.danger.active { background: #fcc; }

.toolbar .sep {
  width: 1px;
  height: 24px;
  background: var(--toolbar-border);
  margin: 0 4px;
}

.toolbar select, .toolbar input[type="number"] {
  padding: 3px 6px;
  border: 1px solid var(--toolbar-border);
  border-radius: 3px;
  background: var(--btn-bg);
  font-size: 13px;
  font-family: inherit;
}
.toolbar label {
  font-size: 12px;
  color: #3c3c3c;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.toolbar input[type="number"] {
  width: 52px;
}

.editor-area {
  position: relative;
  border-left: 1px solid var(--toolbar-border);
  border-right: 1px solid var(--toolbar-border);
  min-height: 60px;
  overflow: hidden;
}

.editor-area svg { cursor: default; }
.editor-area.mode-insert svg { cursor: crosshair; }
.editor-area.mode-delete svg { cursor: not-allowed; }
.editor-area.resizing, .editor-area.resizing svg { cursor: col-resize !important; }

.text-overlay {
  position: absolute;
  display: flex;
  gap: 4px;
  padding: 2px;
  z-index: 10;
}
.text-overlay textarea {
  flex: 1;
  font-size: 14px;
  font-family: inherit;
  padding: 2px 6px;
  border: 2px solid #017460;
  border-radius: 3px;
  outline: none;
  min-width: 60px;
  resize: none;
  line-height: 1.4;
}
.text-overlay button {
  padding: 2px 8px;
  border: 1px solid #d6d6d6;
  border-radius: 3px;
  cursor: pointer;
  font-size: 14px;
}
.text-overlay .ok { background: #b5e3d9; }
.text-overlay .cancel { background: #f8d7da; }

.pseudocode-area {
  border: 1px solid var(--toolbar-border);
  border-radius: 0 0 4px 4px;
}
.pseudocode-area textarea {
  display: block;
  width: 100%;
  min-height: 120px;
  max-height: 400px;
  padding: 8px;
  border: none;
  font-family: "Fira Code", "Consolas", monospace;
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
  box-sizing: border-box;
  outline: none;
  tab-size: 4;
}
.pseudocode-area textarea:focus {
  box-shadow: inset 0 0 0 2px rgba(1, 116, 96, 0.3);
}
.pseudocode-area .error {
  color: var(--danger);
  font-size: 12px;
  padding: 2px 8px;
}
`;

/* ── Web Component ─────────────────────────────────────────── */

/**
 * <struktolab-editor> — Visual structogram editor with pseudocode sync.
 *
 * Attributes:
 *   scale, font-size, src, lang, color-mode (same as <struktolab-renderer>)
 *
 * Properties:
 *   tree, pseudocode, keywords (same as <struktolab-renderer>)
 *
 * Methods:
 *   toCode(lang)         — export to Python/Java/JavaScript
 *   saveJSON()           — return clean JSON string of the tree
 *   loadJSON(json)       — load from JSON string or object
 *   exportImage(format)  — export as PNG or SVG Blob (async)
 *   change(tree)         — set a new tree programmatically
 *
 * Events:
 *   "change" — fired when the tree changes (detail: { tree })
 */
class StruktolabEditor extends HTMLElement {
  static get observedAttributes() {
    return ["scale", "font-size", "src", "lang", "color-mode"];
  }

  constructor() {
    super();
    this._tree = null;
    this._keywords = null;
    this._mode = null; // null | "insert:TYPE" | "delete" | "move:ID"
    this._syncing = false; // guard against circular updates
    this._debounceTimer = null;

    this._shadow = this.attachShadow({ mode: "open" });

    // Style
    const style = document.createElement("style");
    style.textContent = STYLES;
    this._shadow.appendChild(style);

    // Toolbar
    this._toolbar = document.createElement("div");
    this._toolbar.className = "toolbar";
    this._buildToolbar();
    this._shadow.appendChild(this._toolbar);

    // Editor area
    this._editorArea = document.createElement("div");
    this._editorArea.className = "editor-area";
    this._shadow.appendChild(this._editorArea);

    // Pseudocode area
    this._pseudoArea = document.createElement("div");
    this._pseudoArea.className = "pseudocode-area";
    this._textarea = document.createElement("textarea");
    this._textarea.spellcheck = false;
    this._textarea.placeholder = "Pseudocode...";
    this._pseudoArea.appendChild(this._textarea);
    this._errorEl = document.createElement("div");
    this._errorEl.className = "error";
    this._errorEl.style.display = "none";
    this._pseudoArea.appendChild(this._errorEl);
    this._shadow.appendChild(this._pseudoArea);

    // Text overlay (hidden)
    this._overlay = document.createElement("div");
    this._overlay.className = "text-overlay";
    this._overlay.style.display = "none";
    this._editorArea.appendChild(this._overlay);

    // Events
    this._textarea.addEventListener("input", () => this._onPseudocodeInput());
    this._textarea.addEventListener("blur", () => this._syncPseudocodeToTree());
    this._textarea.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const ta = this._textarea;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        if (e.shiftKey) {
          // Outdent: remove leading 4 spaces or tab on current line
          const before = ta.value.substring(0, start);
          const lineStart = before.lastIndexOf("\n") + 1;
          const line = ta.value.substring(lineStart);
          if (line.startsWith("    ")) {
            ta.value =
              ta.value.substring(0, lineStart) +
              ta.value.substring(lineStart + 4);
            ta.selectionStart = ta.selectionEnd = Math.max(
              lineStart,
              start - 4,
            );
          } else if (line.startsWith("\t")) {
            ta.value =
              ta.value.substring(0, lineStart) +
              ta.value.substring(lineStart + 1);
            ta.selectionStart = ta.selectionEnd = Math.max(
              lineStart,
              start - 1,
            );
          }
        } else {
          ta.value =
            ta.value.substring(0, start) + "    " + ta.value.substring(end);
          ta.selectionStart = ta.selectionEnd = start + 4;
        }
        ta.dispatchEvent(new Event("input"));
      }
    });
  }

  connectedCallback() {
    requestAnimationFrame(() => this._initialize());
  }

  _getKeywords() {
    if (this._keywords) return this._keywords;
    const lang = (this.getAttribute("lang") || "de").toLowerCase();
    return lang === "en" ? KEYWORDS_EN : KEYWORDS_DE;
  }

  _prepTree(tree) {
    return ensureIds(wrapWithInsertNodes(tree));
  }

  _initialize() {
    if (!this._tree) {
      const pseudoScript = this.querySelector('script[type="text/pseudocode"]');
      if (pseudoScript) {
        try {
          this._tree = this._prepTree(
            parsePseudocode(pseudoScript.textContent, this._getKeywords()),
          );
          this._emitChange();
        } catch (e) {
          console.error("struktolab-editor: failed to parse pseudocode", e);
        }
      }
    }
    if (!this._tree) {
      const script = this.querySelector('script[type="application/json"]');
      if (script) {
        try {
          this._tree = this._prepTree(JSON.parse(script.textContent));
          this._emitChange();
        } catch (e) {
          console.error("struktolab-editor: invalid inline JSON", e);
        }
      }
    }
    if (!this._tree && this.hasAttribute("src")) {
      this._fetchTree(this.getAttribute("src"));
      return;
    }
    if (!this._tree) {
      this._tree = ensureIds({
        id: "__root",
        type: "InsertNode",
        followElement: { type: "Placeholder" },
      });
    }
    this._render();
    this._syncTreeToPseudocode();
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (name === "src" && newVal && newVal !== oldVal) {
      this._fetchTree(newVal);
    } else {
      if (name === "lang" && this._langSelect)
        this._langSelect.value = newVal || "de";
      if (name === "font-size" && this._fsInput)
        this._fsInput.value = newVal || "14";
      if (name === "scale" && this._scaleInput)
        this._scaleInput.value = newVal || "1";
      if (name === "color-mode" && this._colorModeSelect)
        this._colorModeSelect.value = newVal || "color";
      this._render();

    }
  }

  set tree(t) {
    this._tree = this._prepTree(t);
    this._render();
    this._syncTreeToPseudocode();
  }
  get tree() {
    return this._tree;
  }

  set keywords(kw) {
    this._keywords = kw;
  }
  get keywords() {
    return this._getKeywords();
  }

  set pseudocode(code) {
    this._tree = this._prepTree(parsePseudocode(code, this._getKeywords()));
    this._render();
    this._syncTreeToPseudocode();
  }

  toCode(lang) {
    if (!this._tree) return "";
    return generateCode(this._tree, lang);
  }

  async _fetchTree(url) {
    try {
      const res = await fetch(url);
      this._tree = this._prepTree(await res.json());
      this._render();
      this._syncTreeToPseudocode();
    } catch (e) {
      console.error("struktolab-editor: failed to fetch tree from", url, e);
    }
  }

  /* ── Toolbar ────────────────────────────────────────────── */

  _buildToolbar() {
    for (const item of TOOLBAR_ITEMS) {
      const btn = document.createElement("button");
      btn.textContent = item.icon + " " + item.label;
      btn.dataset.type = item.type;
      btn.title = `Insert ${item.label}`;
      btn.draggable = true;
      btn.addEventListener("click", () => this._toggleInsertMode(item.type));
      btn.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", item.type);
        e.dataTransfer.effectAllowed = "copy";
        this._setMode("insert:" + item.type);
      });
      btn.addEventListener("dragend", () => {
        if (this._mode && this._mode.startsWith("insert:")) this._setMode(null);
      });
      this._toolbar.appendChild(btn);
    }

    // Separator
    const sep = document.createElement("span");
    sep.className = "sep";
    this._toolbar.appendChild(sep);

    // Delete button
    const delBtn = document.createElement("button");
    delBtn.textContent = "🗑 Delete";
    delBtn.className = "danger";
    delBtn.title = "Delete mode — click a node to remove it";
    delBtn.addEventListener("click", () => this._toggleDeleteMode());
    this._toolbar.appendChild(delBtn);
    this._deleteBtn = delBtn;

    // Separator
    const sep2 = document.createElement("span");
    sep2.className = "sep";
    this._toolbar.appendChild(sep2);

    // Language select
    const langLabel = document.createElement("label");
    langLabel.textContent = "Lang ";
    const langSelect = document.createElement("select");
    langSelect.innerHTML =
      '<option value="de">Deutsch</option><option value="en">English</option>';
    langSelect.value = (this.getAttribute("lang") || "de").toLowerCase();
    langSelect.addEventListener("change", () => {
      this.setAttribute("lang", langSelect.value);
      this._keywords = null;
      this._onTreeChange();
    });
    langLabel.appendChild(langSelect);
    this._toolbar.appendChild(langLabel);
    this._langSelect = langSelect;

    // Font-size input
    const fsLabel = document.createElement("label");
    fsLabel.textContent = "Size ";
    const fsInput = document.createElement("input");
    fsInput.type = "number";
    fsInput.min = "8";
    fsInput.max = "32";
    fsInput.value = this.getAttribute("font-size") || "14";
    fsInput.addEventListener("change", () => {
      this.setAttribute("font-size", fsInput.value);
      this._onTreeChange();
    });
    fsLabel.appendChild(fsInput);
    this._toolbar.appendChild(fsLabel);
    this._fsInput = fsInput;

    // Scale input
    const scaleLabel = document.createElement("label");
    scaleLabel.textContent = "Scale ";
    const scaleInput = document.createElement("input");
    scaleInput.type = "number";
    scaleInput.min = "0.25";
    scaleInput.max = "3";
    scaleInput.step = "0.25";
    scaleInput.value = this.getAttribute("scale") || "1";
    scaleInput.addEventListener("change", () => {
      const v = parseFloat(scaleInput.value);
      if (v > 0) {
        this.setAttribute("scale", String(v));
      } else {
        scaleInput.value = this.getAttribute("scale") || "1";
      }
      this._onTreeChange();
    });
    scaleLabel.appendChild(scaleInput);
    this._toolbar.appendChild(scaleLabel);
    this._scaleInput = scaleInput;

    const colorModeLabel = document.createElement("label");
    colorModeLabel.textContent = "Color Mode ";
    const colorModeSelect = document.createElement("select");
    colorModeSelect.innerHTML =
      '<option value="color">Color</option><option value="greyscale">Greyscale</option><option value="bw">Black & White</option>';
    colorModeSelect.value = this.getAttribute("color-mode") || "color";
    colorModeSelect.addEventListener("change", () => {
      this.setAttribute("color-mode", colorModeSelect.value);
      this._onTreeChange();
    });
    colorModeLabel.appendChild(colorModeSelect);
    this._toolbar.appendChild(colorModeLabel);
    this._colorModeSelect = colorModeSelect;
    

    // Separator
    const sep3 = document.createElement("span");
    sep3.className = "sep";
    this._toolbar.appendChild(sep3);

    // Save JSON
    const saveBtn = document.createElement("button");
    saveBtn.textContent = "💾 Save";
    saveBtn.title = "Save structogram as JSON";
    saveBtn.addEventListener("click", () => this._downloadJSON());
    this._toolbar.appendChild(saveBtn);

    // Load JSON
    const loadBtn = document.createElement("button");
    loadBtn.textContent = "📂 Load";
    loadBtn.title = "Load structogram from JSON file";
    loadBtn.addEventListener("click", () => this._triggerLoadJSON());
    this._toolbar.appendChild(loadBtn);

    // Hidden file input for load
    this._fileInput = document.createElement("input");
    this._fileInput.type = "file";
    this._fileInput.accept = ".json,application/json";
    this._fileInput.style.display = "none";
    this._fileInput.addEventListener("change", (e) => this._handleFileLoad(e));
    this._toolbar.appendChild(this._fileInput);

    // Export PNG
    const pngBtn = document.createElement("button");
    pngBtn.textContent = "🖼 PNG";
    pngBtn.title = "Export as PNG image";
    pngBtn.addEventListener("click", () => this._downloadImage("png"));
    this._toolbar.appendChild(pngBtn);

    // Export SVG
    const svgBtn = document.createElement("button");
    svgBtn.textContent = "📐 SVG";
    svgBtn.title = "Export as SVG image";
    svgBtn.addEventListener("click", () => this._downloadImage("svg"));
    this._toolbar.appendChild(svgBtn);
  }

  _toggleInsertMode(type) {
    const modeStr = "insert:" + type;
    this._setMode(this._mode === modeStr ? null : modeStr);
  }

  _toggleDeleteMode() {
    this._setMode(this._mode === "delete" ? null : "delete");
  }

  _setMode(mode) {
    this._mode = mode;
    // Update toolbar button states
    for (const btn of this._toolbar.querySelectorAll("button[data-type]")) {
      btn.classList.toggle("active", mode === "insert:" + btn.dataset.type);
    }
    this._deleteBtn.classList.toggle("active", mode === "delete");

    // Update editor area class
    this._editorArea.classList.remove("mode-insert", "mode-delete");
    if (mode && mode.startsWith("insert:")) {
      this._editorArea.classList.add("mode-insert");
    } else if (mode === "delete") {
      this._editorArea.classList.add("mode-delete");
    }

    this._render();
  }

  /* ── Rendering ──────────────────────────────────────────── */

  _resolveWidth() {
    const scale = parseFloat(this.getAttribute("scale")) || 1;
    const container =
      this._editorArea.clientWidth ||
      this.clientWidth ||
      this.getBoundingClientRect().width ||
      600;
    return Math.round(container / scale);
  }

  _render() {
    if (!this._tree) return;
    const fontSize = parseInt(this.getAttribute("font-size"), 10) || 14;
    const width = this._resolveWidth();
    const colorMode = this.getAttribute("color-mode");

    // Remove old SVG (keep overlay)
    const oldSvg = this._editorArea.querySelector("svg");
    if (oldSvg) oldSvg.remove();

    // Only allocate space for InsertNodes when in insert or move mode
    const showTargets =
      (this._mode && this._mode.startsWith("insert:")) ||
      (this._mode && this._mode.startsWith("move:"));
    setInsertNodeHeight(showTargets ? INSERT_HEIGHT : 0);
    const svg = renderStructogramSVG(this._tree, { width, fontSize, colorMode });
    setInsertNodeHeight(0);

    // Add interactive overlays
    this._addInteractivity(svg, width, fontSize);

    this._editorArea.insertBefore(svg, this._overlay);
  }

  _addInteractivity(svg, width, fontSize) {
    const isInsert = this._mode && this._mode.startsWith("insert:");
    const isDelete = this._mode === "delete";
    const isMove = this._mode && this._mode.startsWith("move:");

    if (isInsert || isMove) {
      this._addInsertTargets(
        svg,
        width,
        fontSize,
        isMove ? this._mode.replace("move:", "") : null,
      );
    }
    if (isDelete) {
      this._addDeleteTargets(svg, width, fontSize);
    }

    // Click-to-edit on text nodes
    if (!isInsert && !isDelete && !isMove) {
      this._addEditTargets(svg, width, fontSize);
      this._addDragTargets(svg, width, fontSize);
      this._addResizeHandles(svg, width, fontSize);
      this._addCaseButtons(svg, width, fontSize);
    }

    // Cancel mode on click outside
    if (isMove) {
      svg.addEventListener("click", () => this._setMode(null));
    }
  }

  /**
   * Walk the tree and compute bounding boxes for each node.
   * Returns a Map of nodeId → { x, y, w, h, type, text }.
   * @param {boolean} withInsertSpace - if true, InsertNodes occupy INSERT_HEIGHT
   */
  _computeLayout(tree, x, y, width, fontSize, withInsertSpace) {
    const layout = new Map();
    this._layoutNode(tree, x, y, width, fontSize, layout, withInsertSpace);
    return layout;
  }

  _layoutNode(node, x, y, width, fontSize, layout, withInsertSpace) {
    if (!node) return 0;
    const textW = width - 16; // PADDING_X * 2
    const PADDING_Y = 6;
    const LOOP_INDENT = 20;
    const DEFAULT_ROW_HEIGHT = 40;
    const inh = withInsertSpace ? INSERT_HEIGHT : 0;

    const wrappedH = (str) => {
      const lines = this._wrapText(str || "", textW, fontSize);
      const lineH = fontSize * 1.3;
      return Math.max(DEFAULT_ROW_HEIGHT, lines.length * lineH + PADDING_Y * 2);
    };

    switch (node.type) {
      case "InsertNode": {
        if (node.id) {
          layout.set(node.id, {
            x,
            y,
            w: width,
            h: Math.max(inh, 4),
            type: "InsertNode",
          });
        }
        const followH = this._layoutNode(
          node.followElement,
          x,
          y + inh,
          width,
          fontSize,
          layout,
          withInsertSpace,
        );
        return inh + followH;
      }
      case "Placeholder": {
        // Placeholder takes no space; the preceding InsertNode already provides the gap
        return 0;
      }
      case "TaskNode":
      case "InputNode":
      case "OutputNode": {
        let label = node.text || "";
        if (node.type === "InputNode") label = "▶ " + label;
        if (node.type === "OutputNode") label = "◀ " + label;
        const rowH = wrappedH(label);
        if (node.id)
          layout.set(node.id, {
            x,
            y,
            w: width,
            h: rowH,
            type: node.type,
            text: node.text,
          });
        const followH = this._layoutNode(
          node.followElement,
          x,
          y + rowH,
          width,
          fontSize,
          layout,
          withInsertSpace,
        );
        return rowH + followH;
      }
      case "InsertCase": {
        const rowH = wrappedH(node.text || "");
        if (node.id)
          layout.set(node.id, {
            x,
            y,
            w: width,
            h: rowH,
            type: "InsertCase",
            text: node.text,
          });
        const followH = this._layoutNode(
          node.followElement,
          x,
          y + rowH,
          width,
          fontSize,
          layout,
          withInsertSpace,
        );
        return rowH + followH;
      }
      case "BranchNode": {
        const condH = wrappedH(node.text || "");
        const slopeH = fontSize * 1.3 + PADDING_Y;
        const labelRowH = fontSize * 1.3 + PADDING_Y;
        const headerH = condH + slopeH + labelRowH;
        const numCols = 2;
        const colW =
          node.columnWidths && node.columnWidths.length === numCols
            ? node.columnWidths.map((f) => width * f)
            : [width / numCols, width / numCols];
        const trueH = this._layoutNode(
          node.trueChild,
          x,
          y + headerH,
          colW[0],
          fontSize,
          layout,
          withInsertSpace,
        );
        const falseH = this._layoutNode(
          node.falseChild,
          x + colW[0],
          y + headerH,
          colW[1],
          fontSize,
          layout,
          withInsertSpace,
        );
        const maxChildH = Math.max(trueH, falseH);
        const totalH = headerH + maxChildH;
        if (node.id)
          layout.set(node.id, {
            x,
            y,
            w: width,
            h: totalH,
            type: "BranchNode",
            text: node.text,
          });
        const followH = this._layoutNode(
          node.followElement,
          x,
          y + totalH,
          width,
          fontSize,
          layout,
          withInsertSpace,
        );
        return totalH + followH;
      }
      case "CaseNode": {
        const numCols =
          (node.cases ? node.cases.length : 0) + (node.defaultOn ? 1 : 0);
        const colW =
          node.columnWidths && node.columnWidths.length === numCols
            ? node.columnWidths.map((f) => width * f)
            : Array(numCols).fill(width / numCols);
        const condH = wrappedH(node.text || "");
        const slopeH = fontSize * 1.3 + PADDING_Y;
        const headerH = condH + slopeH;
        let maxChildH = 0;
        let curX = x;
        for (let i = 0; i < (node.cases || []).length; i++) {
          const ch = this._layoutNode(
            node.cases[i],
            curX,
            y + headerH,
            colW[i],
            fontSize,
            layout,
            withInsertSpace,
          );
          maxChildH = Math.max(maxChildH, ch);
          curX += colW[i];
        }
        if (node.defaultOn && node.defaultNode) {
          const ch = this._layoutNode(
            node.defaultNode,
            curX,
            y + headerH,
            colW[numCols - 1],
            fontSize,
            layout,
            withInsertSpace,
          );
          maxChildH = Math.max(maxChildH, ch);
        }
        const totalH = headerH + maxChildH;
        if (node.id)
          layout.set(node.id, {
            x,
            y,
            w: width,
            h: totalH,
            type: "CaseNode",
            text: node.text,
          });
        const followH = this._layoutNode(
          node.followElement,
          x,
          y + totalH,
          width,
          fontSize,
          layout,
          withInsertSpace,
        );
        return totalH + followH;
      }
      case "HeadLoopNode":
      case "CountLoopNode": {
        const rowH = wrappedH(node.text || "");
        const innerW = width - LOOP_INDENT;
        const childH = this._layoutNode(
          node.child,
          x + LOOP_INDENT,
          y + rowH,
          innerW,
          fontSize,
          layout,
          withInsertSpace,
        );
        const bodyH = Math.max(childH, rowH * 0.5);
        const totalH = rowH + bodyH;
        if (node.id)
          layout.set(node.id, {
            x,
            y,
            w: width,
            h: totalH,
            type: node.type,
            text: node.text,
          });
        const followH = this._layoutNode(
          node.followElement,
          x,
          y + totalH,
          width,
          fontSize,
          layout,
          withInsertSpace,
        );
        return totalH + followH;
      }
      case "FootLoopNode": {
        const innerW = width - LOOP_INDENT;
        const rowH = wrappedH(node.text || "");
        const childH = this._layoutNode(
          node.child,
          x + LOOP_INDENT,
          y,
          innerW,
          fontSize,
          layout,
          withInsertSpace,
        );
        const bodyH = Math.max(childH, rowH * 0.5);
        const totalH = bodyH + rowH;
        if (node.id)
          layout.set(node.id, {
            x,
            y,
            w: width,
            h: totalH,
            type: "FootLoopNode",
            text: node.text,
          });
        const followH = this._layoutNode(
          node.followElement,
          x,
          y + totalH,
          width,
          fontSize,
          layout,
          withInsertSpace,
        );
        return totalH + followH;
      }
      case "FunctionNode": {
        let headerText = node.text || "";
        if (node.parameters && node.parameters.length) {
          headerText +=
            "(" + node.parameters.map((p) => p.parName || "").join(", ") + ")";
        } else headerText += "()";
        headerText += " {";
        const rowH = wrappedH(headerText);
        const innerW = width - LOOP_INDENT;
        const childH = this._layoutNode(
          node.child,
          x + LOOP_INDENT,
          y + rowH,
          innerW,
          fontSize,
          layout,
          withInsertSpace,
        );
        const bodyH = Math.max(childH, rowH * 0.5);
        const footH = DEFAULT_ROW_HEIGHT * 0.6;
        const totalH = rowH + bodyH + footH;
        if (node.id)
          layout.set(node.id, {
            x,
            y,
            w: width,
            h: totalH,
            type: "FunctionNode",
            text: node.text,
          });
        const followH = this._layoutNode(
          node.followElement,
          x,
          y + totalH,
          width,
          fontSize,
          layout,
          withInsertSpace,
        );
        return totalH + followH;
      }
      case "TryCatchNode": {
        const innerW = width - LOOP_INDENT;
        const tryRowH = wrappedH("Try");
        const tryH = this._layoutNode(
          node.tryChild,
          x + LOOP_INDENT,
          y + tryRowH,
          innerW,
          fontSize,
          layout,
          withInsertSpace,
        );
        const tryBodyH = Math.max(tryH, tryRowH * 0.5);
        let catchLabel = "Catch";
        if (node.text) catchLabel += " (" + node.text + ")";
        const catchRowH = wrappedH(catchLabel);
        const catchY = y + tryRowH + tryBodyH;
        const catchH = this._layoutNode(
          node.catchChild,
          x + LOOP_INDENT,
          catchY + catchRowH,
          innerW,
          fontSize,
          layout,
          withInsertSpace,
        );
        const catchBodyH = Math.max(catchH, catchRowH * 0.5);
        const totalH = tryRowH + tryBodyH + catchRowH + catchBodyH;
        if (node.id)
          layout.set(node.id, {
            x,
            y,
            w: width,
            h: totalH,
            type: "TryCatchNode",
            text: node.text,
          });
        const followH = this._layoutNode(
          node.followElement,
          x,
          y + totalH,
          width,
          fontSize,
          layout,
          withInsertSpace,
        );
        return totalH + followH;
      }
      default:
        return 0;
    }
  }

  _wrapText(str, maxWidth, fontSize) {
    if (!str) return [""];
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = `${fontSize}px sans-serif`;
    const paragraphs = str.split("\n");
    const allLines = [];
    for (const para of paragraphs) {
      if (!para || ctx.measureText(para).width <= maxWidth) {
        allLines.push(para || "");
        continue;
      }
      const words = para.split(/\s+/);
      let current = "";
      for (const word of words) {
        const test = current ? current + " " + word : word;
        if (ctx.measureText(test).width <= maxWidth) {
          current = test;
        } else {
          if (current) allLines.push(current);
          current = word;
        }
      }
      if (current) allLines.push(current);
    }
    return allLines.length ? allLines : [""];
  }

  _annotatePositions(svg, tree, x, y, width, fontSize) {
    // No-op for now — positions come from _computeLayout
  }

  /* ── Insert targets ─────────────────────────────────────── */

  _addInsertTargets(svg, width, fontSize, moveNodeId) {
    const layout = this._computeLayout(this._tree, 0, 0, width, fontSize, true);
    const svgNS = "http://www.w3.org/2000/svg";

    // Sort by area descending so narrower column targets are appended last (on top)
    const entries = [...layout.entries()]
      .filter(([, box]) => box.type === "InsertNode")
      .sort(([, a], [, b]) => b.w * b.h - a.w * a.h);

    for (const [id, box] of entries) {
      const rect = document.createElementNS(svgNS, "rect");
      rect.setAttribute("x", box.x + 2);
      rect.setAttribute("y", box.y);
      rect.setAttribute("width", box.w - 4);
      rect.setAttribute("height", box.h);
      rect.setAttribute("fill", INSERT_COLOR);
      rect.setAttribute("stroke", "none");
      rect.setAttribute("rx", "3");
      rect.style.cursor = "pointer";
      rect.style.transition = "fill 0.15s";
      rect.addEventListener("mouseenter", () =>
        rect.setAttribute("fill", INSERT_HOVER_COLOR),
      );
      rect.addEventListener("mouseleave", () =>
        rect.setAttribute("fill", INSERT_COLOR),
      );
      rect.addEventListener("click", (e) => {
        e.stopPropagation();
        if (moveNodeId) {
          this._tree = this._prepTree(moveNode(this._tree, moveNodeId, id));
          this._setMode(null);
          this._onTreeChange();
        } else {
          this._handleInsert(id);
        }
      });

      // Drag-and-drop target
      rect.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        rect.setAttribute("fill", INSERT_HOVER_COLOR);
      });
      rect.addEventListener("dragleave", () =>
        rect.setAttribute("fill", INSERT_COLOR),
      );
      rect.addEventListener("drop", (e) => {
        e.preventDefault();
        const type = e.dataTransfer.getData("text/plain");
        if (type) {
          this._tree = this._prepTree(insertAt(this._tree, id, type));
          this._setMode(null);
          this._onTreeChange();
        }
      });

      // "+" label
      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("x", box.x + box.w / 2);
      text.setAttribute("y", box.y + box.h / 2);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "central");
      text.setAttribute("fill", "rgba(1, 116, 96, 0.8)");
      text.setAttribute("font-size", "16");
      text.setAttribute("font-weight", "bold");
      text.setAttribute("pointer-events", "none");
      text.textContent = "+";

      svg.appendChild(rect);
      svg.appendChild(text);
    }
  }

  _handleInsert(targetId) {
    if (!this._mode || !this._mode.startsWith("insert:")) return;
    const type = this._mode.replace("insert:", "");
    this._tree = this._prepTree(insertAt(this._tree, targetId, type));
    this._setMode(null);
    this._onTreeChange();
  }

  /* ── Delete targets ─────────────────────────────────────── */

  _addDeleteTargets(svg, width, fontSize) {
    const layout = this._computeLayout(
      this._tree,
      0,
      0,
      width,
      fontSize,
      false,
    );
    const svgNS = "http://www.w3.org/2000/svg";

    // Sort by area descending so smaller child rects are appended last (on top in SVG)
    const entries = [...layout.entries()]
      .filter(
        ([, box]) =>
          box.type !== "InsertNode" &&
          box.type !== "Placeholder" &&
          box.type !== "InsertCase",
      )
      .sort(([, a], [, b]) => b.w * b.h - a.w * a.h);

    for (const [id, box] of entries) {
      const rect = document.createElementNS(svgNS, "rect");
      rect.setAttribute("x", box.x);
      rect.setAttribute("y", box.y);
      rect.setAttribute("width", box.w);
      rect.setAttribute("height", box.h);
      rect.setAttribute("fill", "transparent");
      rect.setAttribute("stroke", "none");
      rect.style.cursor = "pointer";
      rect.style.transition = "fill 0.15s";
      rect.addEventListener("mouseenter", () =>
        rect.setAttribute("fill", DELETE_HOVER_COLOR),
      );
      rect.addEventListener("mouseleave", () =>
        rect.setAttribute("fill", "transparent"),
      );
      rect.addEventListener("click", (e) => {
        e.stopPropagation();
        this._tree = this._prepTree(removeNode(this._tree, id));
        this._setMode(null);
        this._onTreeChange();
      });
      svg.appendChild(rect);
    }
  }

  /* ── Edit targets (click-to-edit) ───────────────────────── */

  _addEditTargets(svg, width, fontSize) {
    const layout = this._computeLayout(
      this._tree,
      0,
      0,
      width,
      fontSize,
      false,
    );
    const svgNS = "http://www.w3.org/2000/svg";

    // Sort by area descending so smaller child rects are on top
    const entries = [...layout.entries()]
      .filter(
        ([, box]) => box.type !== "InsertNode" && box.type !== "Placeholder",
      )
      .sort(([, a], [, b]) => b.w * b.h - a.w * a.h);

    for (const [id, box] of entries) {
      const rect = document.createElementNS(svgNS, "rect");
      rect.setAttribute("x", box.x);
      rect.setAttribute("y", box.y);
      rect.setAttribute("width", box.w);
      rect.setAttribute("height", box.h);
      rect.setAttribute("fill", "transparent");
      rect.setAttribute("stroke", "none");
      rect.style.cursor = "pointer";
      rect.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        this._showEditOverlay(id, box);
      });
      svg.appendChild(rect);
    }
  }

  _showEditOverlay(nodeId, box) {
    const node = findNode(this._tree, nodeId);
    if (!node) return;

    this._hideEditOverlay();

    // Position overlay over the SVG node
    const svgEl = this._editorArea.querySelector("svg");
    if (!svgEl) return;
    const svgRect = svgEl.getBoundingClientRect();
    const areaRect = this._editorArea.getBoundingClientRect();

    // Convert SVG coordinates to screen coordinates
    const viewBox = svgEl.viewBox.baseVal;
    const scaleX = svgRect.width / viewBox.width;
    const scaleY = svgRect.height / viewBox.height;
    const scale = Math.min(scaleX, scaleY);

    // Use only the text/header height, not the full compound node height
    const fontSize = parseInt(this.getAttribute("font-size"), 10) || 14;
    const textH = this._nodeTextHeight(node, box.w, fontSize);

    const left = (box.x - viewBox.x) * scale + svgRect.left - areaRect.left;
    const top = (box.y - viewBox.y) * scale + svgRect.top - areaRect.top;
    const w = box.w * scale;
    const h = textH * scale;

    this._overlay.style.display = "flex";
    this._overlay.style.left = left + "px";
    this._overlay.style.top = top + "px";
    this._overlay.style.width = w + "px";
    this._overlay.style.height = h + "px";
    this._overlay.innerHTML = "";

    const input = document.createElement("textarea");
    input.value = node.text || "";
    input.rows = Math.max(2, (node.text || "").split("\n").length);
    input.style.height = "100%";
    input.style.resize = "none";

    const okBtn = document.createElement("button");
    okBtn.className = "ok";
    okBtn.textContent = "✓";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "cancel";
    cancelBtn.textContent = "✗";

    const commit = () => {
      this._tree = this._prepTree(editText(this._tree, nodeId, input.value));
      this._hideEditOverlay();
      this._onTreeChange();
    };
    const cancel = () => this._hideEditOverlay();

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        commit();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    });
    okBtn.addEventListener("click", commit);
    cancelBtn.addEventListener("click", cancel);

    this._overlay.appendChild(input);
    this._overlay.appendChild(okBtn);
    this._overlay.appendChild(cancelBtn);

    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  _hideEditOverlay() {
    this._overlay.style.display = "none";
    this._overlay.innerHTML = "";
  }

  /** Return the height of just the text/header area for a node. */
  _nodeTextHeight(node, width, fontSize) {
    const textW = width - 16;
    const PADDING_Y = 6;
    const DEFAULT_ROW_HEIGHT = 40;
    const wrappedH = (str) => {
      const lines = this._wrapText(str || "", textW, fontSize);
      const lineH = fontSize * 1.3;
      return Math.max(DEFAULT_ROW_HEIGHT, lines.length * lineH + PADDING_Y * 2);
    };
    switch (node.type) {
      case "BranchNode":
        return wrappedH(node.text || "");
      case "CaseNode":
        return wrappedH(node.text || "");
      case "HeadLoopNode":
      case "CountLoopNode":
        return wrappedH(node.text || "");
      case "FootLoopNode":
        return wrappedH(node.text || "");
      case "FunctionNode": {
        let t = node.text || "";
        if (node.parameters && node.parameters.length)
          t +=
            "(" + node.parameters.map((p) => p.parName || "").join(", ") + ")";
        else t += "()";
        return wrappedH(t);
      }
      case "TryCatchNode":
        return wrappedH(node.text || "");
      default:
        return wrappedH(node.text || "");
    }
  }

  /* ── Drag-to-reorder ────────────────────────────────────── */

  _addDragTargets(svg, width, fontSize) {
    const layout = this._computeLayout(
      this._tree,
      0,
      0,
      width,
      fontSize,
      false,
    );
    const svgNS = "http://www.w3.org/2000/svg";

    // Make content nodes draggable via a drag handle
    for (const [id, box] of layout) {
      if (
        box.type === "InsertNode" ||
        box.type === "Placeholder" ||
        box.type === "InsertCase"
      )
        continue;

      const handleSize = 14;
      const handleX = box.x + box.w - handleSize - 4;
      const handleY = box.y + 4;

      const handle = document.createElementNS(svgNS, "text");
      handle.setAttribute("x", handleX + handleSize / 2);
      handle.setAttribute("y", handleY + handleSize / 2);
      handle.setAttribute("text-anchor", "middle");
      handle.setAttribute("dominant-baseline", "central");
      handle.setAttribute("font-size", "12");
      handle.setAttribute("fill", "rgba(0,0,0,0.3)");
      handle.textContent = "⠿";
      handle.style.cursor = "grab";
      handle.style.userSelect = "none";

      // We need a transparent rect behind the handle for the drag
      const dragRect = document.createElementNS(svgNS, "rect");
      dragRect.setAttribute("x", handleX);
      dragRect.setAttribute("y", handleY);
      dragRect.setAttribute("width", handleSize);
      dragRect.setAttribute("height", handleSize);
      dragRect.setAttribute("fill", "transparent");
      dragRect.style.cursor = "grab";

      // Use a foreignObject wrapper to make drag work
      const wrapper = document.createElementNS(svgNS, "g");
      wrapper.appendChild(dragRect);
      wrapper.appendChild(handle);

      // Make the whole node area draggable
      const dragOverlay = document.createElementNS(svgNS, "rect");
      dragOverlay.setAttribute("x", box.x);
      dragOverlay.setAttribute("y", box.y);
      dragOverlay.setAttribute("width", box.w);
      dragOverlay.setAttribute("height", box.h);
      dragOverlay.setAttribute("fill", "transparent");
      dragOverlay.setAttribute("stroke", "none");

      // We'll track drag via the native drag system on a foreignObject
      // Since SVG drag is tricky, we use mousedown → mode change approach
      wrapper.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        this._startDrag(id);
      });

      svg.appendChild(wrapper);
    }
  }

  _startDrag(nodeId) {
    this._setMode("move:" + nodeId);
  }

  /* ── Move mode targets (shown during drag/move) ─────────── */

  // Move mode uses the same insert target rendering with a different action
  // When mode is "move:ID", re-render shows insert targets that accept the node

  /* ── Case add/delete buttons ────────────────────────────── */

  _addCaseButtons(svg, width, fontSize) {
    const layout = this._computeLayout(this._tree, 0, 0, width, fontSize, false);
    const svgNS = "http://www.w3.org/2000/svg";
    const BTN_SIZE = 18;
    const BTN_R = 3;

    for (const [id, box] of layout) {
      if (box.type !== "CaseNode") continue;

      const node = findNode(this._tree, id);
      if (!node || !node.cases) continue;

      const numCols = node.cases.length + (node.defaultOn ? 1 : 0);
      const colW = node.columnWidths && node.columnWidths.length === numCols
        ? node.columnWidths.map(f => box.w * f)
        : Array(numCols).fill(box.w / numCols);

      const textW = box.w - 16;
      const condH = this._wrappedTextHeight(node.text || "", textW, fontSize);
      const slopeH = fontSize * 1.3 + 6;
      const headerH = condH + slopeH;

      // "+" button: add a new case — placed in top-right of the header
      const addX = box.x + box.w - BTN_SIZE - 4;
      const addY = box.y + 3;
      this._createSvgButton(svg, svgNS, addX, addY, BTN_SIZE, BTN_R, "+",
        "rgba(1,116,96,0.75)", "rgba(1,116,96,1)", () => {
          this._tree = this._prepTree(addCase(this._tree, id));
          this._onTreeChange();
        });

      // "×" buttons on each case column (only if more than 1 case)
      if (node.cases.length > 1) {
        let curX = box.x;
        for (let i = 0; i < node.cases.length; i++) {
          const caseId = node.cases[i].id;
          const delX = curX + colW[i] - BTN_SIZE - 2;
          const delY = box.y + headerH + 2;
          this._createSvgButton(svg, svgNS, delX, delY, BTN_SIZE, BTN_R, "×",
            "rgba(192,57,43,0.65)", "rgba(192,57,43,1)", () => {
              this._tree = this._prepTree(removeCase(this._tree, caseId));
              this._onTreeChange();
            });
          curX += colW[i];
        }
      }
    }
  }

  _createSvgButton(svg, svgNS, x, y, size, r, label, fill, hoverFill, onClick) {
    const g = document.createElementNS(svgNS, "g");
    g.style.cursor = "pointer";

    const rect = document.createElementNS(svgNS, "rect");
    rect.setAttribute("x", x);
    rect.setAttribute("y", y);
    rect.setAttribute("width", size);
    rect.setAttribute("height", size);
    rect.setAttribute("rx", r);
    rect.setAttribute("ry", r);
    rect.setAttribute("fill", fill);
    rect.style.transition = "fill 0.15s";

    const text = document.createElementNS(svgNS, "text");
    text.setAttribute("x", x + size / 2);
    text.setAttribute("y", y + size / 2);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "central");
    text.setAttribute("font-size", "13");
    text.setAttribute("font-weight", "bold");
    text.setAttribute("fill", "#fff");
    text.style.pointerEvents = "none";
    text.style.userSelect = "none";
    text.textContent = label;

    g.appendChild(rect);
    g.appendChild(text);

    g.addEventListener("mouseenter", () => rect.setAttribute("fill", hoverFill));
    g.addEventListener("mouseleave", () => rect.setAttribute("fill", fill));
    g.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });

    svg.appendChild(g);
  }

  /* ── Column resize handles ──────────────────────────────── */

  _addResizeHandles(svg, width, fontSize) {
    const layout = this._computeLayout(this._tree, 0, 0, width, fontSize, false);
    const svgNS = "http://www.w3.org/2000/svg";
    const HANDLE_WIDTH = 6;

    for (const [id, box] of layout) {
      if (box.type !== "BranchNode" && box.type !== "CaseNode") continue;

      const node = findNode(this._tree, id);
      if (!node) continue;

      // Compute column info and per-divider handle regions
      let numCols;
      const dividers = []; // { x, y, h } for each divider

      if (node.type === "BranchNode") {
        numCols = 2;
        const textW = box.w - 16;
        const condH = this._wrappedTextHeight(node.text || "", textW, fontSize);
        const slopeH = fontSize * 1.3 + 6;
        // The single divider starts where the diagonals meet (slopeBottom)
        const slopeBottom = box.y + condH + slopeH;
        const handleH = box.h - (condH + slopeH);

        const fracs = node.columnWidths && node.columnWidths.length === 2
          ? [...node.columnWidths]
          : [0.5, 0.5];
        const divX = box.x + fracs[0] * box.w;
        dividers.push({ x: divX, y: slopeBottom, h: handleH });
      } else {
        numCols = (node.cases ? node.cases.length : 0) + (node.defaultOn ? 1 : 0);
        const textW = box.w - 16;
        const condH = this._wrappedTextHeight(node.text || "", textW, fontSize);
        const slopeH = fontSize * 1.3 + 6;
        const headerH = condH + slopeH;
        const bodyH = box.h - headerH;

        const fracs = node.columnWidths && node.columnWidths.length === numCols
          ? [...node.columnWidths]
          : Array(numCols).fill(1 / numCols);

        // Compute cumulative pixel positions (same as SVG renderer)
        const colXPositions = [0];
        for (let ci = 0; ci < numCols; ci++) {
          colXPositions.push(colXPositions[ci] + fracs[ci] * box.w);
        }

        // Each intermediate divider starts at its own diagY on the diagonal
        for (let i = 1; i < numCols; i++) {
          const dividerX = box.x + colXPositions[i];
          let diagY;
          if (node.defaultOn) {
            if (i < numCols - 1) {
              // Left diagonal: (box.x, y+condH) → (lastDivX, y+headerH)
              const lastDivXRel = colXPositions[numCols - 1];
              const frac = colXPositions[i] / lastDivXRel;
              diagY = box.y + condH + slopeH * frac;
            } else {
              // Last divider (between last case and default) starts at headerH
              diagY = box.y + headerH;
            }
          } else {
            const frac = colXPositions[i] / box.w;
            diagY = box.y + condH + slopeH * frac;
          }
          const handleH = box.y + headerH + bodyH - diagY;
          dividers.push({ x: dividerX, y: diagY, h: handleH });
        }
      }

      if (dividers.length === 0) continue;

      // Current fractions (for drag logic)
      const fractions = node.columnWidths && node.columnWidths.length === (node.type === "BranchNode" ? 2 : numCols)
        ? [...node.columnWidths]
        : Array(node.type === "BranchNode" ? 2 : numCols).fill(1 / (node.type === "BranchNode" ? 2 : numCols));

      for (let i = 0; i < dividers.length; i++) {
        const div = dividers[i];

        const handle = document.createElementNS(svgNS, "rect");
        handle.setAttribute("x", div.x - HANDLE_WIDTH / 2);
        handle.setAttribute("y", div.y);
        handle.setAttribute("width", HANDLE_WIDTH);
        handle.setAttribute("height", Math.max(div.h, 20));
        handle.setAttribute("fill", "transparent");
        handle.style.cursor = "col-resize";

        const dividerIndex = i;
        handle.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._startColumnResize(svg, node, id, dividerIndex, numCols, fractions, box);
        });

        svg.appendChild(handle);
      }
    }
  }

  _wrappedTextHeight(str, maxWidth, fontSize) {
    const lines = this._wrapText(str || "", maxWidth, fontSize);
    const lineH = fontSize * 1.3;
    const PADDING_Y = 6;
    return Math.max(40, lines.length * lineH + PADDING_Y * 2);
  }

  _startColumnResize(svg, node, nodeId, dividerIndex, numCols, fractions, box) {
    this._editorArea.classList.add("resizing");

    const svgEl = svg;
    const svgRect = svgEl.getBoundingClientRect();
    const viewBox = svgEl.viewBox.baseVal;
    const scaleX = svgRect.width / viewBox.width;

    // Convert SVG box.x to screen space for reference
    const boxLeftScreen = (box.x - viewBox.x) * scaleX + svgRect.left;
    const boxWidth = box.w * scaleX;

    const currentFractions = [...fractions];
    const MIN_FRACTION = 0.1;
    let rafId = null;

    const onMouseMove = (e) => {
      const mouseX = e.clientX;
      const relX = mouseX - boxLeftScreen;
      const rawFraction = relX / boxWidth;

      let sumBefore = 0;
      for (let i = 0; i < dividerIndex; i++) sumBefore += currentFractions[i];

      let sumAfter = 0;
      for (let i = dividerIndex + 2; i < numCols; i++) sumAfter += currentFractions[i];

      const available = 1 - sumBefore - sumAfter;
      let leftFrac = rawFraction - sumBefore;
      let rightFrac = available - leftFrac;

      if (leftFrac < MIN_FRACTION) {
        leftFrac = MIN_FRACTION;
        rightFrac = available - leftFrac;
      }
      if (rightFrac < MIN_FRACTION) {
        rightFrac = MIN_FRACTION;
        leftFrac = available - rightFrac;
      }

      currentFractions[dividerIndex] = Math.round(leftFrac * 100) / 100;
      currentFractions[dividerIndex + 1] = Math.round(rightFrac * 100) / 100;

      const sum = currentFractions.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1) > 0.001) {
        currentFractions[numCols - 1] += 1 - sum;
        currentFractions[numCols - 1] = Math.round(currentFractions[numCols - 1] * 100) / 100;
      }

      // Live preview: update tree and re-render (throttled via rAF)
      if (rafId == null) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          node.columnWidths = [...currentFractions];
          this._render();
          this._editorArea.classList.add("resizing");
        });
      }
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      if (rafId != null) cancelAnimationFrame(rafId);
      this._editorArea.classList.remove("resizing");

      node.columnWidths = [...currentFractions];
      this._onTreeChange();
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  /* ── Pseudocode sync ────────────────────────────────────── */

  _syncTreeToPseudocode() {
    if (this._syncing) return;
    this._syncing = true;
    try {
      const code = treeToPseudocode(this._tree, this._getKeywords());
      this._textarea.value = code;
      this._errorEl.style.display = "none";
    } catch (e) {
      // ignore serialization errors
    }
    this._syncing = false;
  }

  _onPseudocodeInput() {
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._syncPseudocodeToTree(), 600);
  }

  _syncPseudocodeToTree() {
    if (this._syncing) return;
    this._syncing = true;
    clearTimeout(this._debounceTimer);
    try {
      const code = this._textarea.value;
      if (!code.trim()) {
        this._syncing = false;
        return;
      }
      const newTree = this._prepTree(
        parsePseudocode(code, this._getKeywords()),
      );
      this._tree = newTree;
      this._errorEl.style.display = "none";
      this._render();
      this._emitChange();
    } catch (e) {
      this._errorEl.textContent = "Parse error: " + e.message;
      this._errorEl.style.display = "block";
    }
    this._syncing = false;
  }

  /* ── Change handling ────────────────────────────────────── */

  _onTreeChange() {
    this._render();
    this._syncTreeToPseudocode();
    this._emitChange();
  }

  _emitChange() {
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { tree: cloneTree(this._tree) },
        bubbles: true,
      }),
    );
  }

  /* ── Public API: save / load / export / change ─────────── */

  /** Return clean JSON (no InsertNode/Placeholder wrappers). */
  saveJSON() {
    if (!this._tree) return "{}";
    return JSON.stringify(stripInsertNodes(this._tree), null, 2);
  }

  /** Load tree from a JSON string or object. */
  loadJSON(json) {
    const data = typeof json === "string" ? JSON.parse(json) : json;
    this._tree = this._prepTree(data);
    this._render();
    this._syncTreeToPseudocode();
    this._emitChange();
  }

  /**
   * Export the structogram as an image.
   * @param {"png"|"svg"} format
   * @returns {Promise<Blob>} image blob
   */
  async exportImage(format = "png") {
    const fontSize = parseInt(this.getAttribute("font-size"), 10) || 14;
    const width = this._resolveWidth();
    const colorMode = this.getAttribute("color-mode");

    // Render a clean SVG (no insert-node space, no overlays)
    setInsertNodeHeight(0);
    const svg = renderStructogramSVG(this._tree, { width, fontSize, colorMode });
    setInsertNodeHeight(0);

    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svg);

    if (format === "svg") {
      return new Blob([svgStr], { type: "image/svg+xml" });
    }

    // PNG via canvas
    return new Promise((resolve, reject) => {
      const img = new Image();
      const blob = new Blob([svgStr], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = 8; // high-DPI export
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;

        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, img.width, img.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("canvas.toBlob failed"))),
          "image/png",
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("SVG load failed"));
      };
      img.src = url;
    });
  }

  /**
   * Programmatically update the tree. Accepts a tree object.
   * Re-renders and emits a "change" event.
   */
  change(tree) {
    this._tree = this._prepTree(tree);
    this._render();
    this._syncTreeToPseudocode();
    this._emitChange();
  }

  /* ── Internal: file download helpers ───────────────────── */

  _downloadJSON() {
    const json = this.saveJSON();
    const blob = new Blob([json], { type: "application/json" });
    this._downloadBlob(blob, "structogram.json");
  }

  _triggerLoadJSON() {
    this._fileInput.value = "";
    this._fileInput.click();
  }

  _handleFileLoad(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        this.loadJSON(reader.result);
      } catch (err) {
        console.error("struktolab-editor: invalid JSON file", err);
      }
    };
    reader.readAsText(file);
  }

  async _downloadImage(format) {
    try {
      const blob = await this.exportImage(format);
      const ext = format === "svg" ? "svg" : "png";
      this._downloadBlob(blob, `structogram.${ext}`);
    } catch (err) {
      console.error("struktolab-editor: export failed", err);
    }
  }

  _downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }
}

export {
  StruktolabEditor,
  renderStructogramSVG,
  parsePseudocode,
  generateCode,
  treeToPseudocode,
  KEYWORDS_DE,
  KEYWORDS_EN,
};
export default StruktolabEditor;
