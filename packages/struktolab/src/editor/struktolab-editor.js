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
  collectMovedIds,
} from "../common/tree-ops.js";

/* ── Constants ─────────────────────────────────────────────── */

const INSERT_COLOR = "rgba(1, 116, 96, 0.28)";
/** The seam marker has to read as a control, so it is solid rather than a tint. */
const INSERT_LINE_COLOR = "rgb(1, 116, 96)";
const INSERT_HEIGHT = 20;

/** Deep enough to undo a session's worth of mistakes, bounded so it can't grow forever. */
const HISTORY_LIMIT = 100;

/** How each node type is named to a screen reader. */
const NODE_LABELS = {
  TaskNode: "Task",
  InputNode: "Input",
  OutputNode: "Output",
  BranchNode: "If/Else",
  CaseNode: "Switch",
  InsertCase: "Case",
  HeadLoopNode: "While loop",
  FootLoopNode: "Do-While loop",
  CountLoopNode: "For loop",
  FunctionNode: "Function",
  TryCatchNode: "Try/Catch",
};

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
  /* The insert menu hangs off the host, not off the clipped editor area. */
  position: relative;
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
  gap: 4px 10px;
  padding: 6px 8px;
  background: var(--toolbar-bg);
  border: 1px solid var(--toolbar-border);
  border-radius: 4px 4px 0 0;
  align-items: center;
}

/* Each group is one job: history, view settings, files. Inserting and deleting
   are not here at all — they belong to the nodes themselves. */
.toolbar .group {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  position: relative;
}
.toolbar .group.file { margin-left: auto; }

button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--toolbar-border);
  border-radius: 3px;
  background: var(--btn-bg);
  cursor: pointer;
  font-size: 13px;
  line-height: 1.4;
  font-family: inherit;
  white-space: nowrap;
  user-select: none;
  color: inherit;
}

/* Every icon gets the same box.
   Left to itself each glyph contributes its own line box — ⚙ is 16px tall, 💾
   17, ↶ 20, 🖼 22 — so the buttons came out five different heights, with PNG
   the odd one out. A fixed box means the glyph no longer sets the height. */
button .icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  line-height: 1;
}
button:hover:not(:disabled) { background: var(--btn-hover); }
button:disabled { opacity: 0.4; cursor: default; }
button.active { background: var(--btn-active); border-color: #017460; }
button.danger { color: var(--danger); border-color: var(--danger); }
button.danger:hover:not(:disabled) { background: #fde; }
button.danger.active { background: #fcc; }
button:focus-visible { outline: 2px solid #017460; outline-offset: 1px; }

.toolbar .sep {
  width: 1px;
  height: 24px;
  background: var(--toolbar-border);
}

select, input[type="number"] {
  padding: 3px 6px;
  border: 1px solid var(--toolbar-border);
  border-radius: 3px;
  background: var(--btn-bg);
  font-size: 13px;
  font-family: inherit;
  color: inherit;
}
label {
  font-size: 12px;
  color: #3c3c3c;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
input[type="number"] { width: 60px; }

/* View settings live behind one button instead of spending four slots. */
.popover {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 20;
  display: grid;
  grid-template-columns: auto auto;
  gap: 8px 10px;
  align-items: center;
  padding: 10px 12px;
  background: var(--btn-bg);
  border: 1px solid var(--toolbar-border);
  border-radius: 4px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);
}
.popover label { justify-content: flex-end; }

/* Narrow viewports: the icons carry the meaning, the titles carry the words. */
@media (max-width: 760px) {
  .toolbar button .label { display: none; }
  .toolbar button { padding: 4px 8px; }
}

.editor-area {
  position: relative;
  border-left: 1px solid var(--toolbar-border);
  border-right: 1px solid var(--toolbar-border);
  min-height: 60px;
  overflow: hidden;
}

.editor-area svg { cursor: default; }
.editor-area.mode-move svg { cursor: crosshair; }
.editor-area.resizing, .editor-area.resizing svg { cursor: col-resize !important; }
.editor-area:focus { outline: none; }

/* Dragging a divider or a node must not also pan the page on a touch screen. */
.editor-area svg [data-grab] { touch-action: none; }

/* The keyboard needs to see where it is; SVG outlines are unreliable, so the
   focus ring is drawn as a stroke on the node's own hit rect. */
.editor-area svg [tabindex]:focus { outline: none; }
.editor-area svg [tabindex]:focus-visible {
  stroke: #017460;
  stroke-width: 2.5;
  stroke-dasharray: none;
}

/* What is being carried, following the pointer. */
.drag-ghost {
  position: fixed;
  z-index: 40;
  display: none;
  padding: 4px 10px;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: #fff;
  background: rgb(1, 116, 96);
  border-radius: 3px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  pointer-events: none;
}

/* The insert menu, opened from a slot or from a focused node. */
.type-menu {
  position: absolute;
  z-index: 30;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 6px;
  background: var(--btn-bg);
  border: 1px solid var(--toolbar-border);
  border-radius: 4px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
  width: max-content;
  max-width: min(280px, 100%);
}
.type-menu button { justify-content: flex-start; width: 100%; }
.type-menu .label { display: inline !important; }

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
 *   embedded — the host owns the file. Hides the Save/Load buttons and turns the
 *              PNG/SVG buttons into an "export-image" event instead of a download.
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
 *   "change"       — fired when the tree changes (detail: { tree })
 *   "export-image" — embedded only: an image is ready (detail: { format, blob })
 */
class StruktolabEditor extends HTMLElement {
  static get observedAttributes() {
    return ["scale", "font-size", "src", "lang", "color-mode", "embedded"];
  }

  constructor() {
    super();
    this._tree = null;
    this._keywords = null;
    this._mode = null; // null | "insert:TYPE" | "delete" | "move:ID"
    this._syncing = false; // guard against circular updates
    this._debounceTimer = null;

    // Undo history: snapshots of the tree, oldest first.
    this._undoStack = [];
    this._redoStack = [];

    /** The node the keyboard is on, so a re-render can put focus back. */
    this._focusedId = null;
    this._typeMenu = null;

    // Fingers need bigger targets than a mouse pointer does.
    this._coarsePointer =
      typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

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
    this._editorArea.setAttribute("role", "application");
    this._editorArea.setAttribute(
      "aria-label",
      "Structogram editor. Arrow keys move between nodes, Enter edits, Plus inserts, Delete removes.",
    );
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

    this._shadow.addEventListener("keydown", (e) => this._onShortcut(e));
    // A click anywhere that is not the popover or the menu dismisses them.
    this._shadow.addEventListener("pointerdown", (e) => {
      const path = e.composedPath();
      if (this._typeMenu && !path.includes(this._typeMenu)) this._hideTypeMenu();
      if (
        this._viewPopover.style.display !== "none" &&
        !path.includes(this._viewPopover) &&
        !path.includes(this._viewBtn)
      ) {
        this._toggleViewPopover(false);
      }
    });
  }

  /**
   * Shortcuts for the diagram.
   *
   * The pseudocode textarea and the node text editor keep their own Ctrl+Z —
   * text undo there is what anyone would expect, and it is not ours to take.
   */
  _onShortcut(e) {
    const target = e.composedPath()[0];
    const inTextField =
      target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement;

    if (e.key === "Escape") {
      if (this._typeMenu) {
        this._hideTypeMenu(true);
        e.preventDefault();
      } else if (this._viewPopover.style.display !== "none") {
        this._toggleViewPopover(false);
        this._viewBtn.focus();
        e.preventDefault();
      } else if (this._mode) {
        this._setMode(null);
        e.preventDefault();
      }
      return;
    }

    if (inTextField || this._embedded) return;

    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && key === "z") {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
    } else if ((e.ctrlKey || e.metaKey) && key === "y") {
      e.preventDefault();
      this.redo();
    }
  }

  connectedCallback() {
    this._applyEmbedded();
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
    } else if (name === "embedded") {
      this._applyEmbedded();
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
    this._resetHistory();
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
    this._resetHistory();
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

  /** A toolbar button whose label collapses away on a narrow toolbar. */
  _button(icon, label, title, onClick, className) {
    const btn = document.createElement("button");
    const iconEl = document.createElement("span");
    iconEl.className = "icon";
    iconEl.setAttribute("aria-hidden", "true");
    iconEl.textContent = icon;
    const labelEl = document.createElement("span");
    labelEl.className = "label";
    labelEl.textContent = label;
    btn.append(iconEl, labelEl);
    btn.title = title;
    btn.setAttribute("aria-label", label);
    if (className) btn.className = className;
    if (onClick) btn.addEventListener("click", onClick);
    return btn;
  }

  _group(name) {
    const g = document.createElement("div");
    g.className = "group " + name;
    this._toolbar.appendChild(g);
    return g;
  }

  _separator() {
    const sep = document.createElement("span");
    sep.className = "sep";
    this._toolbar.appendChild(sep);
    return sep;
  }

  _buildToolbar() {
    /* History */
    const history = this._group("history");
    this._undoBtn = this._button("↶", "Undo", "Undo (Ctrl+Z)", () => this.undo());
    this._redoBtn = this._button("↷", "Redo", "Redo (Ctrl+Shift+Z)", () => this.redo());
    history.append(this._undoBtn, this._redoBtn);
    this._historyGroup = history;
    this._historySep = this._separator();

    /* View settings, behind one button */
    const view = this._group("view");
    const viewBtn = this._button("⚙", "View", "Language, size, scale and colours");
    viewBtn.setAttribute("aria-haspopup", "true");
    viewBtn.setAttribute("aria-expanded", "false");
    viewBtn.addEventListener("click", () => this._toggleViewPopover());
    view.appendChild(viewBtn);
    this._viewBtn = viewBtn;
    this._viewPopover = this._buildViewPopover();
    view.appendChild(this._viewPopover);

    /* Files and export */
    const file = this._group("file");

    this._saveBtn = this._button("💾", "Save", "Save structogram as JSON", () =>
      this._downloadJSON(),
    );
    this._loadBtn = this._button("📂", "Load", "Load structogram from JSON file", () =>
      this._triggerLoadJSON(),
    );
    file.append(this._saveBtn, this._loadBtn);

    this._fileInput = document.createElement("input");
    this._fileInput.type = "file";
    this._fileInput.accept = ".json,application/json";
    this._fileInput.style.display = "none";
    this._fileInput.addEventListener("change", (e) => this._handleFileLoad(e));
    file.appendChild(this._fileInput);

    file.append(
      this._button("🖼", "PNG", "Export as PNG image", () => this._downloadImage("png")),
      this._button("📐", "SVG", "Export as SVG image", () => this._downloadImage("svg")),
    );

    this._updateHistoryButtons();
  }

  _buildViewPopover() {
    const pop = document.createElement("div");
    pop.className = "popover";
    pop.style.display = "none";

    const row = (text, control) => {
      const label = document.createElement("label");
      label.textContent = text;
      const id = "v" + Math.random().toString(36).slice(2, 8);
      control.id = id;
      label.htmlFor = id;
      pop.append(label, control);
    };

    const langSelect = document.createElement("select");
    langSelect.innerHTML =
      '<option value="de">Deutsch</option><option value="en">English</option>';
    langSelect.value = (this.getAttribute("lang") || "de").toLowerCase();
    langSelect.addEventListener("change", () => {
      this.setAttribute("lang", langSelect.value);
      this._keywords = null;
      this._onTreeChange();
    });
    row("Language", langSelect);
    this._langSelect = langSelect;

    const fsInput = document.createElement("input");
    fsInput.type = "number";
    fsInput.min = "8";
    fsInput.max = "32";
    fsInput.value = this.getAttribute("font-size") || "14";
    fsInput.addEventListener("change", () => {
      this.setAttribute("font-size", fsInput.value);
      this._onTreeChange();
    });
    row("Font size", fsInput);
    this._fsInput = fsInput;

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
    row("Scale", scaleInput);
    this._scaleInput = scaleInput;

    const colorModeSelect = document.createElement("select");
    colorModeSelect.innerHTML =
      '<option value="color">Color</option><option value="greyscale">Greyscale</option><option value="bw">Black & White</option>';
    colorModeSelect.value = this.getAttribute("color-mode") || "color";
    colorModeSelect.addEventListener("change", () => {
      this.setAttribute("color-mode", colorModeSelect.value);
      this._onTreeChange();
    });
    row("Colours", colorModeSelect);
    this._colorModeSelect = colorModeSelect;

    return pop;
  }

  _toggleViewPopover(force) {
    const open = force ?? this._viewPopover.style.display === "none";
    this._viewPopover.style.display = open ? "grid" : "none";
    this._viewBtn.classList.toggle("active", open);
    this._viewBtn.setAttribute("aria-expanded", String(open));
  }

  /**
   * Save/Load move a file around, which is the host's job when embedded — in
   * VS Code the document is the file and Ctrl+S owns saving it. Undo goes the
   * same way: the host has its own stack over the document, and two stacks
   * fighting over Ctrl+Z is worse than either alone.
   *
   * This runs from connectedCallback rather than _buildToolbar, because the
   * toolbar is built in the constructor, before attributes set with
   * createElement() + setAttribute() exist.
   */
  _applyEmbedded() {
    if (!this._saveBtn) return;
    const hidden = this.hasAttribute("embedded") ? "none" : "";
    this._saveBtn.style.display = hidden;
    this._loadBtn.style.display = hidden;
    this._historyGroup.style.display = hidden;
    this._historySep.style.display = hidden;
  }

  /** True when the host, not this component, owns files and undo. */
  get _embedded() {
    return this.hasAttribute("embedded");
  }

  /* ── Undo history ───────────────────────────────────────── */

  /**
   * Replace the tree, remembering the one being replaced.
   *
   * Every structural edit goes through here, which is the whole of the undo
   * implementation: the trees are already deep-cloned on each operation, so a
   * snapshot costs one more clone.
   */
  _commit(newTree) {
    this._pushHistory();
    this._tree = this._prepTree(newTree);
    this._onTreeChange();
  }

  /** Remember the current tree as an undo step. */
  _pushHistory(snapshot) {
    const state = snapshot ?? this._tree;
    if (!state) return;
    this._undoStack.push(cloneTree(state));
    if (this._undoStack.length > HISTORY_LIMIT) this._undoStack.shift();
    this._redoStack.length = 0;
    this._updateHistoryButtons();
  }

  get canUndo() {
    return this._undoStack.length > 0;
  }
  get canRedo() {
    return this._redoStack.length > 0;
  }

  /** Step back one edit. */
  undo() {
    if (!this._undoStack.length) return false;
    this._redoStack.push(cloneTree(this._tree));
    this._tree = this._undoStack.pop();
    this._afterHistoryMove();
    return true;
  }

  /** Step forward again. */
  redo() {
    if (!this._redoStack.length) return false;
    this._undoStack.push(cloneTree(this._tree));
    this._tree = this._redoStack.pop();
    this._afterHistoryMove();
    return true;
  }

  _afterHistoryMove() {
    this._hideEditOverlay();
    this._hideTypeMenu();
    this._setMode(null); // _setMode re-renders
    this._syncTreeToPseudocode();
    this._updateHistoryButtons();
    this._emitChange();
  }

  _updateHistoryButtons() {
    if (!this._undoBtn) return;
    this._undoBtn.disabled = !this.canUndo;
    this._redoBtn.disabled = !this.canRedo;
  }

  /**
   * Modes left after the palette went away.
   *
   * Inserting and deleting are node-local now — the seam menu and the node's
   * own delete button — so the only mode remaining is "move:ID", armed by
   * picking up a drag handle and ended by dropping on a slot.
   */
  _setMode(mode) {
    this._mode = mode;
    this._editorArea.classList.toggle("mode-move", Boolean(mode));
    if (!mode) {
      // Putting the node down — drop the slot bookkeeping, and the ghost with
      // it if this was an Escape in the middle of a drag.
      this._moveSlots = [];
      this._activeSlot = null;
      if (this._drag) {
        this._drag.ghost.remove();
        this._drag = null;
      }
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
    // The menu points at a slot in the SVG about to be replaced.
    this._hideTypeMenu();
    const fontSize = parseInt(this.getAttribute("font-size"), 10) || 14;
    const width = this._resolveWidth();
    const colorMode = this.getAttribute("color-mode");

    // Remove old SVG (keep overlay). If the keyboard was on a node, it has to
    // land on the same node again once the new SVG is in — a re-render is not
    // a reason to lose your place.
    const oldSvg = this._editorArea.querySelector("svg");
    const hadFocus = oldSvg ? oldSvg.contains(this._shadow.activeElement) : false;
    if (oldSvg) oldSvg.remove();

    // Slots never take up space of their own. Reserving room for them the
    // moment a move starts used to grow the diagram and slide the node out
    // from under the pointer, which is the one thing a drag must not do.
    setInsertNodeHeight(0);
    const svg = renderStructogramSVG(this._tree, { width, fontSize, colorMode });

    svg.setAttribute("role", "group");
    svg.setAttribute("aria-label", "Structogram");

    // Add interactive overlays
    this._addInteractivity(svg, width, fontSize);

    this._editorArea.insertBefore(svg, this._overlay);

    if (hadFocus && this._focusedId) {
      const rect = svg.querySelector(`[data-node-id="${this._focusedId}"]`);
      if (rect) rect.focus({ preventScroll: true });
    }

    // Picked up from the keyboard: there is no pointer to aim with, so the
    // focus goes to the first slot and the arrows do the aiming. This has to
    // happen here rather than while building the slots, because until the SVG
    // is in the document nothing inside it can take focus.
    if (this._keyboardMove) {
      this._keyboardMove = false;
      this._moveSlots?.[0]?.element.focus({ preventScroll: true });
    }
  }

  _addInteractivity(svg, width, fontSize) {
    const isMove = this._mode && this._mode.startsWith("move:");

    if (isMove) {
      this._addMoveTargets(svg, width, fontSize, this._mode.replace("move:", ""));
      // Pressing anywhere that is not a slot puts the node back down.
      //
      // This listens for pointerdown, not click: arming the move re-renders,
      // which removes the grip mid-gesture, and the click that gesture goes on
      // to produce is retargeted onto this very SVG — cancelling the move the
      // instant it began. A pointerdown can only belong to a later gesture.
      svg.addEventListener("pointerdown", (e) => {
        const onSlot = (this._moveSlots || []).some((slot) =>
          e.composedPath().includes(slot.element),
        );
        if (!onSlot) this._setMode(null);
      });
      return;
    }

    // Order is hit-testing order: the node layer covers whole nodes and goes in
    // first, then the thin insert strips over the seams between them, then the
    // small handles and buttons last so they always win the click.
    this._addNodeTargets(svg, width, fontSize);
    this._addQuickInsertTargets(svg, width, fontSize);
    this._addResizeHandles(svg, width, fontSize);
    this._addCaseButtons(svg, width, fontSize);
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


  /* ── Quick insert (no mode required) ────────────────────── */

  /**
   * A thin strip on every seam between two nodes.
   *
   * Picking a type from the toolbar first and then aiming at a slot works, but
   * it makes the slots invisible until you have already committed to a type.
   * These strips run the other way round: point at the place, then choose.
   */
  _addQuickInsertTargets(svg, width, fontSize) {
    const layout = this._computeLayout(this._tree, 0, 0, width, fontSize, false);
    const svgNS = "http://www.w3.org/2000/svg";
    const BAND = this._coarsePointer ? 22 : 12;
    const LINE = 5;
    const BADGE_R = 11;

    const entries = [...layout.entries()].filter(
      ([, box]) => box.type === "InsertNode",
    );
    const empty = !this._focusOrder || this._focusOrder.length === 0;

    for (const [id, box] of entries) {
      const y = box.y + box.h / 2 - BAND / 2;

      const group = document.createElementNS(svgNS, "g");
      group.style.cursor = "pointer";

      const hit = document.createElementNS(svgNS, "rect");
      hit.setAttribute("x", box.x + 2);
      hit.setAttribute("y", y);
      hit.setAttribute("width", Math.max(box.w - 4, 1));
      hit.setAttribute("height", BAND);
      hit.setAttribute("fill", "transparent");

      // The visible half: a solid bar with a round "+" badge on it, drawn only
      // while the pointer is over the seam.
      const centreY = box.y + box.h / 2;

      const line = document.createElementNS(svgNS, "rect");
      line.setAttribute("x", box.x + 2);
      line.setAttribute("y", centreY - LINE / 2);
      line.setAttribute("width", Math.max(box.w - 4, 1));
      line.setAttribute("height", LINE);
      line.setAttribute("rx", LINE / 2);
      line.setAttribute("fill", "transparent");
      line.setAttribute("pointer-events", "none");
      line.style.transition = "fill 0.12s";

      const badge = document.createElementNS(svgNS, "circle");
      badge.setAttribute("cx", box.x + box.w / 2);
      badge.setAttribute("cy", centreY);
      badge.setAttribute("r", BADGE_R);
      badge.setAttribute("fill", "transparent");
      badge.setAttribute("pointer-events", "none");
      badge.style.transition = "fill 0.12s";

      const plus = document.createElementNS(svgNS, "text");
      plus.setAttribute("x", box.x + box.w / 2);
      plus.setAttribute("y", centreY);
      plus.setAttribute("text-anchor", "middle");
      plus.setAttribute("dominant-baseline", "central");
      plus.setAttribute("font-size", "17");
      plus.setAttribute("font-weight", "bold");
      plus.setAttribute("fill", "transparent");
      plus.setAttribute("pointer-events", "none");
      plus.style.transition = "fill 0.12s";
      plus.textContent = "+";

      const show = (on) => {
        line.setAttribute("fill", on ? INSERT_LINE_COLOR : "transparent");
        badge.setAttribute("fill", on ? INSERT_LINE_COLOR : "transparent");
        plus.setAttribute("fill", on ? "#fff" : "transparent");
      };
      // An empty structogram has nothing to hover over, so its one slot has to
      // announce itself — otherwise there is no way in at all.
      if (empty) {
        show(true);
      } else {
        group.addEventListener("mouseenter", () => show(true));
        group.addEventListener("mouseleave", () => show(false));
      }
      group.addEventListener("click", (e) => {
        e.stopPropagation();
        this._showTypeMenu(id, box);
      });

      group.append(hit, line, badge, plus);
      svg.appendChild(group);
    }
  }

  /**
   * Where a node's SVG box lands, in CSS pixels.
   *
   * @param {Element} relativeTo the element the coordinates are measured from
   */
  _svgToScreen(box, relativeTo) {
    const svgEl = this._editorArea.querySelector("svg");
    if (!svgEl) return null;
    const svgRect = svgEl.getBoundingClientRect();
    const originRect = relativeTo.getBoundingClientRect();
    const viewBox = svgEl.viewBox.baseVal;
    const scale = Math.min(
      svgRect.width / viewBox.width,
      svgRect.height / viewBox.height,
    );
    return {
      left: (box.x - viewBox.x) * scale + svgRect.left - originRect.left,
      top: (box.y - viewBox.y) * scale + svgRect.top - originRect.top,
      width: box.w * scale,
      height: box.h * scale,
      scale,
    };
  }

  _showTypeMenu(slotId, box) {
    this._hideTypeMenu();
    // Measured against the host, because the editor area clips its overflow
    // and a menu opened near the bottom would be cut in half by it.
    const pos = this._svgToScreen(box, this);
    if (!pos) return;

    const menu = document.createElement("div");
    menu.className = "type-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Insert a node here");

    for (const item of TOOLBAR_ITEMS) {
      const btn = this._button(item.icon, item.label, `Insert ${item.label}`, () => {
        this._hideTypeMenu();
        this._insertType(slotId, item.type);
      });
      btn.setAttribute("role", "menuitem");
      menu.appendChild(btn);
    }

    menu.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        this._hideTypeMenu(true);
      }
    });

    this._shadow.appendChild(menu);
    this._typeMenu = menu;

    // Under the slot by default, nudged back inside on the right, and flipped
    // above when there is more room up there than down.
    const hostW = this.clientWidth;
    const hostH = this.clientHeight;
    const menuW = menu.offsetWidth;
    const menuH = menu.offsetHeight;

    const left = Math.max(4, Math.min(pos.left + 8, hostW - menuW - 4));
    let top = pos.top + pos.height + 6;
    if (top + menuH > hostH - 4 && pos.top - menuH - 6 > 0) {
      top = pos.top - menuH - 6;
    }
    top = Math.max(4, Math.min(top, hostH - menuH - 4));

    menu.style.left = left + "px";
    menu.style.top = top + "px";

    menu.querySelector("button")?.focus();
  }

  _hideTypeMenu(restoreFocus) {
    if (!this._typeMenu) return;
    this._typeMenu.remove();
    this._typeMenu = null;
    if (restoreFocus && this._focusedId) this._setFocusedNode(this._focusedId);
  }


  /** Put a new node of `type` into the slot `targetId` and select it. */
  _insertType(targetId, type) {
    this._pushHistory();
    this._tree = this._prepTree(insertAt(this._tree, targetId, type));
    this._setMode(null);
    this._onTreeChange();
  }

  /* ── Delete targets ─────────────────────────────────────── */


  /* ── Edit targets (click-to-edit) ───────────────────────── */

  _addNodeTargets(svg, width, fontSize) {
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

    // Reading order, not paint order and not the order the layout recursion
    // happens to visit: top to bottom, then left to right, which is how the
    // diagram is read and so how the arrow keys should walk it.
    this._focusOrder = [...layout.entries()]
      .filter(([, box]) => box.type !== "InsertNode" && box.type !== "Placeholder")
      .sort(([, a], [, b]) => a.y - b.y || a.x - b.x)
      .map(([id]) => id);
    this._boxes = layout;

    if (this._focusedId && !layout.has(this._focusedId)) this._focusedId = null;
    if (!this._focusedId) this._focusedId = this._focusOrder[0] ?? null;

    for (const [id, box] of entries) {
      // The hit rect and the node's own buttons share one group, so moving the
      // pointer from the node onto its buttons is not "leaving the node".
      const group = document.createElementNS(svgNS, "g");

      const rect = document.createElementNS(svgNS, "rect");
      rect.setAttribute("x", box.x);
      rect.setAttribute("y", box.y);
      rect.setAttribute("width", box.w);
      rect.setAttribute("height", box.h);
      rect.setAttribute("fill", "transparent");
      rect.setAttribute("stroke", "none");
      rect.style.cursor = "pointer";

      // Screen readers get the node as a button whose name says what it is.
      rect.setAttribute("role", "button");
      rect.setAttribute("aria-label", this._nodeLabel(box));
      rect.setAttribute("data-node-id", id);
      // Roving tabindex: one stop for the whole diagram, arrows move within it.
      rect.setAttribute("tabindex", id === this._focusedId ? "0" : "-1");

      rect.addEventListener("click", (e) => {
        e.stopPropagation();
        rect.focus();
      });
      rect.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        this._showEditOverlay(id, box);
      });
      rect.addEventListener("keydown", (e) => this._onNodeKeyDown(e, id, box));

      group.appendChild(rect);

      const actions = this._nodeActions(svgNS, id, box);
      group.appendChild(actions);

      const reveal = (on) => {
        actions.style.opacity = on ? "1" : "0";
        actions.style.pointerEvents = on ? "auto" : "none";
      };
      reveal(false);
      group.addEventListener("mouseenter", () => reveal(true));
      group.addEventListener("mouseleave", () => reveal(false));
      // The keyboard has no hover, so focus reveals them too.
      rect.addEventListener("focus", () => {
        this._setFocusedNode(id, false);
        reveal(true);
      });
      rect.addEventListener("blur", () => reveal(false));

      svg.appendChild(group);
    }
  }

  /**
   * The buttons that belong to one node: pick it up, or throw it away.
   *
   * They live at the node's top-right corner and only appear while the pointer
   * or the keyboard is on the node, so a diagram at rest stays a diagram.
   */
  _nodeActions(svgNS, id, box) {
    const size = this._coarsePointer ? 26 : 16;
    const gap = 3;
    const top = box.y + 3;
    const right = box.x + box.w - 3;

    const actions = document.createElementNS(svgNS, "g");
    actions.style.transition = "opacity 0.12s";

    const button = (x, glyph, colour, label, onActivate) => {
      const g = document.createElementNS(svgNS, "g");
      g.style.cursor = "pointer";

      const bg = document.createElementNS(svgNS, "rect");
      bg.setAttribute("x", x);
      bg.setAttribute("y", top);
      bg.setAttribute("width", size);
      bg.setAttribute("height", size);
      bg.setAttribute("rx", 3);
      bg.setAttribute("fill", "rgba(255,255,255,0.85)");
      bg.setAttribute("stroke", colour);
      bg.setAttribute("stroke-width", "1");

      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("x", x + size / 2);
      text.setAttribute("y", top + size / 2);
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "central");
      text.setAttribute("font-size", String(Math.round(size * 0.7)));
      text.setAttribute("fill", colour);
      text.setAttribute("pointer-events", "none");
      text.style.userSelect = "none";
      text.textContent = glyph;

      g.append(bg, text);
      g.setAttribute("role", "button");
      g.setAttribute("aria-label", label);
      g.addEventListener("mouseenter", () => bg.setAttribute("fill", colour));
      g.addEventListener("mouseleave", () =>
        bg.setAttribute("fill", "rgba(255,255,255,0.85)"),
      );
      g.addEventListener("mouseenter", () => text.setAttribute("fill", "#fff"));
      g.addEventListener("mouseleave", () => text.setAttribute("fill", colour));
      onActivate(g);
      return g;
    };

    // Delete on the right, where a close button belongs; drag to its left.
    const del = button(
      right - size,
      "✕",
      "rgb(192, 57, 43)",
      "Delete this node",
      (g) =>
        g.addEventListener("click", (e) => {
          e.stopPropagation();
          this._deleteNode(id);
        }),
    );

    const drag = button(
      right - size * 2 - gap,
      "⠿",
      "rgb(1, 116, 96)",
      "Move this node",
      (g) => {
        g.setAttribute("data-grab", "move");
        g.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          e.preventDefault();
          this._startDrag(id, e);
        });
      },
    );

    actions.append(drag, del);
    return actions;
  }

  /** "If/Else: a[i] > max" — what a screen reader should read out. */
  _nodeLabel(box) {
    const name = NODE_LABELS[box.type] || box.type;
    const text = (box.text || "").trim();
    return text ? `${name}: ${text}` : name;
  }

  _setFocusedNode(id, moveFocus = true) {
    this._focusedId = id;
    if (!moveFocus) return;
    const rect = this._editorArea.querySelector(`[data-node-id="${id}"]`);
    if (rect) {
      for (const other of this._editorArea.querySelectorAll("[data-node-id]")) {
        other.setAttribute("tabindex", other === rect ? "0" : "-1");
      }
      rect.focus();
    }
  }

  _moveFocus(delta) {
    if (!this._focusOrder || !this._focusOrder.length) return;
    const at = this._focusOrder.indexOf(this._focusedId);
    const next = Math.min(
      this._focusOrder.length - 1,
      Math.max(0, (at === -1 ? 0 : at) + delta),
    );
    this._setFocusedNode(this._focusOrder[next]);
  }

  _onNodeKeyDown(e, id, box) {
    switch (e.key) {
      case "Enter":
      case "F2":
        e.preventDefault();
        this._showEditOverlay(id, box);
        return;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        this._deleteNode(id);
        return;
      case "ArrowDown":
      case "ArrowRight":
        e.preventDefault();
        this._moveFocus(1);
        return;
      case "ArrowUp":
      case "ArrowLeft":
        e.preventDefault();
        this._moveFocus(-1);
        return;
      case "Home":
        e.preventDefault();
        this._setFocusedNode(this._focusOrder[0]);
        return;
      case "End":
        e.preventDefault();
        this._setFocusedNode(this._focusOrder[this._focusOrder.length - 1]);
        return;
      case "+":
      case "Insert":
        e.preventDefault();
        this._openInsertAfter(id, box);
        return;
      case "m":
      case "M":
        e.preventDefault();
        this._keyboardMove = true;
        this._startDrag(id);
        return;
    }
  }

  /** Open the insert menu on the slot that follows this node. */
  _openInsertAfter(id, box) {
    const node = findNode(this._tree, id);
    const slot = node && node.followElement;
    if (!slot || slot.type !== "InsertNode" || !slot.id) return;
    this._showTypeMenu(slot.id, { ...box, y: box.y + box.h });
  }

  /** Remove a node, keeping the keyboard somewhere sensible afterwards. */
  _deleteNode(id) {
    const at = this._focusOrder ? this._focusOrder.indexOf(id) : -1;
    const nextFocus =
      at > 0 ? this._focusOrder[at - 1] : (this._focusOrder || [])[at + 1] ?? null;
    this._focusedId = nextFocus;
    this._pushHistory();
    this._tree = this._prepTree(removeNode(this._tree, id));
    this._setMode(null);
    this._onTreeChange();
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
      this._hideEditOverlay();
      if (input.value === (node.text || "")) return;
      this._commit(editText(this._tree, nodeId, input.value));
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


  /* ── Moving a node ──────────────────────────────────────── */

  /**
   * Pick a node up.
   *
   * With a pointer this becomes a real drag: a ghost follows the finger and the
   * slot it would land in lights up. Press and release without moving and it
   * stays picked up instead, so tapping the grip and then tapping a slot works
   * too — which is the only thing that works from a keyboard.
   */
  _startDrag(nodeId, event) {
    this._setMode("move:" + nodeId);
    if (!event || event.pointerId === undefined) return;

    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    ghost.textContent = this._nodeLabel(findNode(this._tree, nodeId) ?? { type: "" });
    this._shadow.appendChild(ghost);

    const drag = { nodeId, ghost, moved: false, startX: event.clientX, startY: event.clientY };
    this._drag = drag;
    this._positionGhost(event.clientX, event.clientY);

    const onMove = (e) => {
      if (
        !drag.moved &&
        Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 4
      ) {
        return;
      }
      drag.moved = true;
      ghost.style.display = "block";
      this._positionGhost(e.clientX, e.clientY);
      this._highlightSlot(this._nearestSlot(e.clientX, e.clientY));
    };

    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      ghost.remove();
      this._drag = null;

      if (!drag.moved) return; // A tap: stay picked up, wait for the second tap.
      const slot = this._activeSlot;
      this._activeSlot = null;
      if (slot) this._dropAt(slot.id);
      else this._setMode(null);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }

  _positionGhost(clientX, clientY) {
    if (!this._drag) return;
    this._drag.ghost.style.left = clientX + 12 + "px";
    this._drag.ghost.style.top = clientY + 12 + "px";
  }

  /** The slot the pointer is closest to, or null if it is nowhere near one. */
  _nearestSlot(clientX, clientY) {
    const svg = this._editorArea.querySelector("svg");
    if (!svg || !this._moveSlots || !this._moveSlots.length) return null;

    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const { x, y } = point.matrixTransform(ctm.inverse());

    let best = null;
    let bestScore = Infinity;
    for (const slot of this._moveSlots) {
      const { box } = slot;
      const centreY = box.y + box.h / 2;
      // Vertical distance decides; being in the wrong column is a tie-breaker,
      // so a nested slot wins over the outer one at the same height.
      const outside = x < box.x || x > box.x + box.w;
      const score = Math.abs(y - centreY) + (outside ? 1000 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = slot;
      }
    }
    return best;
  }

  _highlightSlot(slot) {
    if (this._activeSlot === slot) return;
    this._activeSlot = slot;
    for (const candidate of this._moveSlots || []) {
      candidate.setActive(candidate === slot);
    }
  }

  _dropAt(slotId) {
    const nodeId = this._mode && this._mode.replace("move:", "");
    this._activeSlot = null;
    this._moveSlots = [];
    if (!nodeId) return;
    this._pushHistory();
    this._tree = this._prepTree(moveNode(this._tree, nodeId, slotId));
    this._focusedId = null;
    this._setMode(null);
    this._onTreeChange();
  }

  /**
   * The slots a node can land in, drawn over the diagram rather than carved
   * into it. Slots inside the node itself are left out — dropping a loop into
   * its own body is not a move, and used to lose the loop.
   */
  _addMoveTargets(svg, width, fontSize, movingId) {
    const layout = this._computeLayout(this._tree, 0, 0, width, fontSize, false);
    const svgNS = "http://www.w3.org/2000/svg";
    const BAND = this._coarsePointer ? 26 : 16;

    const moving = findNode(this._tree, movingId);
    const excluded = moving ? collectMovedIds(moving) : new Set();
    const currentSlot = this._slotHolding(this._tree, movingId);

    this._moveSlots = [];
    this._activeSlot = null;

    // Show what is being carried, so it is never a mystery.
    const movingBox = layout.get(movingId);
    if (movingBox) {
      const marker = document.createElementNS(svgNS, "rect");
      marker.setAttribute("x", movingBox.x + 1);
      marker.setAttribute("y", movingBox.y + 1);
      marker.setAttribute("width", Math.max(movingBox.w - 2, 1));
      marker.setAttribute("height", Math.max(movingBox.h - 2, 1));
      marker.setAttribute("fill", "rgba(1, 116, 96, 0.10)");
      marker.setAttribute("stroke", INSERT_LINE_COLOR);
      marker.setAttribute("stroke-width", "2");
      marker.setAttribute("stroke-dasharray", "6 4");
      marker.setAttribute("rx", "3");
      marker.setAttribute("pointer-events", "none");
      svg.appendChild(marker);
    }

    for (const [id, box] of layout) {
      if (box.type !== "InsertNode") continue;
      if (excluded.has(id) || id === currentSlot) continue;

      const centreY = box.y + box.h / 2;
      const group = document.createElementNS(svgNS, "g");
      group.style.cursor = "pointer";

      const hit = document.createElementNS(svgNS, "rect");
      hit.setAttribute("x", box.x + 2);
      hit.setAttribute("y", centreY - BAND / 2);
      hit.setAttribute("width", Math.max(box.w - 4, 1));
      hit.setAttribute("height", BAND);
      hit.setAttribute("fill", "transparent");

      const bar = document.createElementNS(svgNS, "rect");
      bar.setAttribute("x", box.x + 2);
      bar.setAttribute("width", Math.max(box.w - 4, 1));
      bar.setAttribute("pointer-events", "none");
      bar.style.transition = "fill 0.1s, height 0.1s, y 0.1s";

      const setActive = (on) => {
        bar.setAttribute("y", centreY - (on ? 4 : 1.5));
        bar.setAttribute("height", on ? 8 : 3);
        bar.setAttribute("rx", on ? 4 : 1.5);
        bar.setAttribute("fill", on ? INSERT_LINE_COLOR : INSERT_COLOR);
      };
      setActive(false);

      // The attributes go on the rect, not the group: a <g> is a container and
      // does not take focus, so a tabindex on it would be ignored.
      hit.setAttribute("role", "button");
      hit.setAttribute("aria-label", "Move here");
      hit.setAttribute("tabindex", this._moveSlots.length === 0 ? "0" : "-1");
      hit.addEventListener("focus", () => this._highlightSlot(slot));
      hit.addEventListener("mouseenter", () => this._highlightSlot(slot));
      hit.addEventListener("click", (e) => {
        e.stopPropagation();
        this._dropAt(id);
      });
      hit.addEventListener("keydown", (e) => this._onSlotKeyDown(e, id));

      group.append(hit, bar);
      svg.appendChild(group);

      const slot = { id, box, setActive, element: hit };
      this._moveSlots.push(slot);
    }

  }

  /** The id of the InsertNode that currently holds `nodeId`, if any. */
  _slotHolding(node, nodeId) {
    if (!node || typeof node !== "object") return null;
    if (node.type === "InsertNode" && node.followElement?.id === nodeId) return node.id;
    for (const key of ["followElement", "trueChild", "falseChild", "child", "tryChild", "catchChild", "defaultNode"]) {
      const found = this._slotHolding(node[key], nodeId);
      if (found) return found;
    }
    if (node.cases) {
      for (const c of node.cases) {
        const found = this._slotHolding(c, nodeId);
        if (found) return found;
      }
    }
    return null;
  }

  _onSlotKeyDown(e, id) {
    const at = this._moveSlots.findIndex((s) => s.id === id);
    const focusSlot = (index) => {
      const slot = this._moveSlots[Math.max(0, Math.min(this._moveSlots.length - 1, index))];
      if (!slot) return;
      for (const other of this._moveSlots) {
        other.element.setAttribute("tabindex", other === slot ? "0" : "-1");
      }
      slot.element.focus();
    };

    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        e.preventDefault();
        focusSlot(at + 1);
        return;
      case "ArrowUp":
      case "ArrowLeft":
        e.preventDefault();
        focusSlot(at - 1);
        return;
      case "Enter":
      case " ":
        e.preventDefault();
        this._dropAt(id);
        return;
    }
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

      // "+" button: add a new case. Sits left of the node's own hover buttons,
      // which occupy the top-right corner.
      const actionsW = (this._coarsePointer ? 26 : 16) * 2 + 3 + 3;
      const addX = box.x + box.w - BTN_SIZE - 4 - actionsW;
      const addY = box.y + 3;
      this._createSvgButton(svg, svgNS, addX, addY, BTN_SIZE, BTN_R, "+",
        "rgba(1,116,96,0.75)", "rgba(1,116,96,1)", () => {
          this._commit(addCase(this._tree, id));
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
              this._commit(removeCase(this._tree, caseId));
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
    const HANDLE_WIDTH = this._coarsePointer ? 22 : 6;

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
        handle.setAttribute("data-grab", "resize");
        handle.style.cursor = "col-resize";

        const dividerIndex = i;
        handle.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._startColumnResize(svg, node, id, dividerIndex, numCols, fractions, box, e);
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

  _startColumnResize(svg, node, nodeId, dividerIndex, numCols, fractions, box, pointerEvent) {
    this._editorArea.classList.add("resizing");

    // The drag mutates node.columnWidths in place for a live preview, so the
    // undo snapshot has to be taken before the first move, not at the end.
    const before = cloneTree(this._tree);

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

    const onPointerMove = (e) => {
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

    const onPointerUp = () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerUp);
      if (rafId != null) cancelAnimationFrame(rafId);
      this._editorArea.classList.remove("resizing");

      node.columnWidths = [...currentFractions];
      this._pushHistory(before);
      this._onTreeChange();
    };

    // Pointer events cover mouse, pen and touch with one code path; capture
    // keeps the drag alive when the finger leaves the 6px divider.
    if (pointerEvent && pointerEvent.target.setPointerCapture) {
      try {
        pointerEvent.target.setPointerCapture(pointerEvent.pointerId);
      } catch {
        // Capture is a nicety; the document listeners work without it.
      }
    }
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerUp);
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
      this._pushHistory();
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
    // A different document, not an edit to this one — undoing back across it
    // would put the user in a structogram they never opened.
    this._resetHistory();
    this._render();
    this._syncTreeToPseudocode();
    this._emitChange();
  }

  _resetHistory() {
    this._undoStack.length = 0;
    this._redoStack.length = 0;
    this._updateHistoryButtons();
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
      // Embedded, a browser download is the wrong move — hand the image to the
      // host, which knows where the document lives and can ask where to put it.
      if (this.hasAttribute("embedded")) {
        this.dispatchEvent(
          new CustomEvent("export-image", {
            detail: { format: ext, blob },
            bubbles: true,
          }),
        );
        return;
      }
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
