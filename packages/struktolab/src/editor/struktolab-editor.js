import {
  renderStructogramSVG,
  setInsertNodeHeight,
  setEmptyBranchHeight,
} from "../common/svg-renderer.js";
import {
  parsePseudocode,
  KEYWORDS_DE,
  KEYWORDS_EN,
} from "../common/pseudocode-parser.js";
import { generateCode } from "../common/code-generator.js";
import { parseJava, parseJavaScript } from "../common/brace-parser.js";
import { parsePython } from "../common/python-parser.js";
import { wrapInFrame, inlineSource } from "../common/parse-common.js";
import { serializeDocument, applyDocument } from "../common/document.js";
import { functionHeader, parseFunctionHeader } from "../common/function-signature.js";
import {
  EditorView,
  Decoration,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  drawSelection,
  placeholder as cmPlaceholder,
} from "@codemirror/view";
import { EditorState, Compartment, StateEffect, StateField } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  indentUnit,
  indentOnInput,
  bracketMatching,
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
import { java } from "@codemirror/lang-java";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";

/**
 * What the code area under the diagram shows. Every language is two-way:
 * typing in it builds the diagram, editing the diagram rewrites it.
 */
const CODE_MODES = ["none", "pseudocode", "java", "python", "javascript"];

/** Source-code parsers by code mode; pseudocode has its own keywords. */
const CODE_PARSERS = { java: parseJava, python: parsePython, javascript: parseJavaScript };

/** Marks the line a parse error is on; `null` clears it. */
const setErrorLine = StateEffect.define();
const errorLineField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setErrorLine)) continue;
      const n = e.value;
      if (n == null || n < 1 || n > tr.state.doc.lines) return Decoration.none;
      const line = tr.state.doc.line(n);
      return Decoration.set([Decoration.line({ class: "cm-error-line" }).range(line.from)]);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
import { treeToPseudocode } from "../common/tree-to-pseudocode.js";
import {
  ensureIds,
  insertAt,
  removeNode,
  editText,
  editFunctionHeader,
  moveNode,
  findNode,
  cloneTree,
  wrapWithInsertNodes,
  stripInsertNodes,
  addCase,
  removeCase,
  collectMovedIds,
  carryOverColumnWidths,
} from "../common/tree-ops.js";

/* ── Constants ─────────────────────────────────────────────── */

/** The seam marker has to read as a control, so it is solid rather than a tint. */
const INSERT_LINE_COLOR = "rgb(1, 116, 96)";
/**
 * Height of a slot while something is being placed: the diagram opens a real
 * gap at every place it can go, each a block with a "+" in it.
 */
const INSERT_HEIGHT =
  typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? 44 : 30;
/** Body height of an if/else whose branches are both empty. */
const EMPTY_BRANCH_HEIGHT =
  typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? 56 : 40;

/**
 * Run `fn` once the element's children exist. While the page is still being
 * parsed, an element is connected before its inline <script> children are —
 * waiting one frame is not always enough on a long page.
 */
function whenChildrenParsed(fn) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => fn(), { once: true });
  } else {
    requestAnimationFrame(() => fn());
  }
}

/** Deep enough to undo a session's worth of mistakes, bounded so it can't grow forever. */
const HISTORY_LIMIT = 100;

/**
 * Every string the component puts on screen (or into an aria-label).
 * The `lang` attribute picks the table: everything else in it — "en" keys
 * included — is only a fallback for missing keys.
 */
const UI_STRINGS = {
  de: {
    undo: "Rückgängig",
    undoTitle: "Rückgängig (Strg+Z)",
    redo: "Wiederholen",
    redoTitle: "Wiederholen (Strg+Umschalt+Z)",
    reset: "Zurücksetzen",
    resetTitle: "Zurück zum ursprünglichen Struktogramm",
    resetConfirm: "Das Struktogramm auf das Original zurücksetzen? Deine Änderungen gehen verloren.",
    view: "Ansicht",
    viewTitle: "Sprache, Größe, Skalierung und Farben",
    save: "Speichern",
    saveTitle: "Struktogramm als JSON speichern",
    load: "Laden",
    loadTitle: "Struktogramm aus JSON-Datei laden",
    pngTitle: "Als PNG-Bild exportieren",
    svgTitle: "Als SVG-Bild exportieren",
    language: "Sprache",
    fontSize: "Schriftgröße",
    scale: "Skalierung",
    colours: "Farben",
    colour: "Farbe",
    greyscale: "Graustufen",
    blackWhite: "Schwarz-Weiß",
    placeholder: "Pseudocode...",
    javaPlaceholder:
      "Java-Code, z. B.\n\nvoid main() {\n    int n = Integer.parseInt(IO.readln(\"Zahl n: \"));\n    IO.println(n * 2);\n}",
    pythonPlaceholder: "Python-Code, z. B.\n\nn = int(input(\"Zahl n: \"))\nfor i in range(n):\n    print(i)",
    javascriptPlaceholder: "JavaScript-Code, z. B.\n\nconst n = Number(prompt(\"Zahl n\"))\nfor (let i = 0; i < n; i++) {\n    console.log(i)\n}",
    codeMode: "Code",
    showCode: "Code zeigen",
    codeModes: {
      none: "Kein Code",
      pseudocode: "Pseudocode",
      java: "Java",
      python: "Python",
      javascript: "JavaScript",
    },
    editorAria:
      "Struktogramm-Editor. Pfeiltasten bewegen zwischen Knoten, Enter bearbeitet, Plus fügt ein, Entfernen löscht.",
    structogram: "Struktogramm",
    insertHere: "Hier einen Knoten einfügen",
    insertNode: "{label} einfügen",
    deleteNode: "Diesen Knoten löschen",
    moveNode: "Diesen Knoten verschieben",
    insertAfter: "Danach einfügen",
    addCase: "+ Fall",
    addCaseTitle: "Einen Fall hinzufügen",
    moveHere: "Hierher verschieben",
    placeHere: "Hier einfügen",
    paletteLabel: "Blöcke",
    paletteItemTitle: "{label}: ins Struktogramm ziehen, oder auswählen und dann die Stelle wählen",
    paletteHint: "Block ins Struktogramm ziehen – oder auswählen und dann die Stelle wählen.",
    placeHint: "Wähle die Stelle, an die „{label}“ soll.",
    moveHint: "Wähle die neue Stelle für den Block.",
    cancel: "Abbrechen",
    switchLanguage:
      "Mit {lang} beginnt ein neues, leeres Struktogramm – das aktuelle wird nicht übersetzt. Speichere es vorher, wenn du es behalten willst.",
    switchLanguageConfirm: "Neu beginnen",
    parseError: "Syntaxfehler: ",
    nodeLabels: {
      TaskNode: "Anweisung",
      InputNode: "Eingabe",
      OutputNode: "Ausgabe",
      BranchNode: "Verzweigung",
      CaseNode: "Fallauswahl",
      InsertCase: "Fall",
      HeadLoopNode: "Kopfgesteuerte Schleife",
      FootLoopNode: "Fußgesteuerte Schleife",
      CountLoopNode: "Zählschleife",
      FunctionNode: "Funktion",
      TryCatchNode: "Versuche/Fange",
    },
    toolbarLabels: {
      TaskNode: "Anweisung",
      InputNode: "Eingabe",
      OutputNode: "Ausgabe",
      BranchNode: "Verzweigung",
      CaseNode: "Fallauswahl",
      HeadLoopNode: "Kopfgesteuerte Schleife",
      FootLoopNode: "Fußgesteuerte Schleife",
      CountLoopNode: "Zählschleife",
      FunctionNode: "Funktion",
      TryCatchNode: "Versuche/Fange",
    },
  },
  en: {
    undo: "Undo",
    undoTitle: "Undo (Ctrl+Z)",
    redo: "Redo",
    redoTitle: "Redo (Ctrl+Shift+Z)",
    reset: "Reset",
    resetTitle: "Back to the original structogram",
    resetConfirm: "Reset this structogram to the original? Your changes will be lost.",
    view: "View",
    viewTitle: "Language, size, scale and colours",
    save: "Save",
    saveTitle: "Save structogram as JSON",
    load: "Load",
    loadTitle: "Load structogram from JSON file",
    pngTitle: "Export as PNG image",
    svgTitle: "Export as SVG image",
    language: "Language",
    fontSize: "Font size",
    scale: "Scale",
    colours: "Colours",
    colour: "Color",
    greyscale: "Greyscale",
    blackWhite: "Black & White",
    placeholder: "Pseudocode...",
    javaPlaceholder:
      "Java code, e.g.\n\nvoid main() {\n    int n = Integer.parseInt(IO.readln(\"Number n: \"));\n    IO.println(n * 2);\n}",
    pythonPlaceholder: "Python code, e.g.\n\nn = int(input(\"Number n: \"))\nfor i in range(n):\n    print(i)",
    javascriptPlaceholder: "JavaScript code, e.g.\n\nconst n = Number(prompt(\"Number n\"))\nfor (let i = 0; i < n; i++) {\n    console.log(i)\n}",
    codeMode: "Code",
    showCode: "Show code",
    codeModes: {
      none: "No code",
      pseudocode: "Pseudocode",
      java: "Java",
      python: "Python",
      javascript: "JavaScript",
    },
    editorAria:
      "Structogram editor. Arrow keys move between nodes, Enter edits, Plus inserts, Delete removes.",
    structogram: "Structogram",
    insertHere: "Insert a node here",
    insertNode: "Insert {label}",
    deleteNode: "Delete this node",
    moveNode: "Move this node",
    insertAfter: "Insert after this node",
    addCase: "+ Case",
    addCaseTitle: "Add a case",
    moveHere: "Move here",
    placeHere: "Insert here",
    paletteLabel: "Blocks",
    paletteItemTitle: "{label}: drag into the diagram, or pick it and then pick the place",
    paletteHint: "Drag a block into the diagram – or pick it, then pick where it goes.",
    placeHint: "Pick where the {label} should go.",
    moveHint: "Pick the new place for the block.",
    cancel: "Cancel",
    switchLanguage:
      "{lang} starts a new, empty structogram – the current one is not translated. Save it first if you want to keep it.",
    switchLanguageConfirm: "Start new",
    parseError: "Parse error: ",
    nodeLabels: {
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
    },
    toolbarLabels: {
      TaskNode: "Task",
      InputNode: "Input",
      OutputNode: "Output",
      BranchNode: "If/Else",
      CaseNode: "Switch",
      HeadLoopNode: "While",
      FootLoopNode: "Do-While",
      CountLoopNode: "For",
      FunctionNode: "Function",
      TryCatchNode: "Try/Catch",
    },
  },
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

/** Emoji look different on every system and are missing on some, so the toolbar draws its own. */
const ICON_PATHS = {
  undo: "M9 15 4 10l5-5M4 10h11a5 5 0 0 1 0 10h-3",
  redo: "M15 15l5-5-5-5M20 10H9a5 5 0 0 0 0 10h3",
  reset: "M3 4v6h6M5.51 15a9 9 0 1 0 2.13-9.36L3 10",
  view: "M4 6h9M17 6h3M15 4v4M4 12h3M11 12h9M9 10v4M4 18h11M19 18h1M17 16v4",
  save: "M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM7 3v5h8V3M7 21v-7h10v7",
  load: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  png: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM21 15l-5-5L5 21M7.5 9a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0",
  svg: "M4 17C6 9 18 9 20 17M2.5 17h3v3h-3zM18.5 17h3v3h-3zM6 6h12M10.5 4.5h3v3h-3z",
};

function icon(name) {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS(svgNS, "path");
  path.setAttribute("d", ICON_PATHS[name]);
  svg.appendChild(path);
  return svg;
}

/* ── CSS ───────────────────────────────────────────────────── */

const STYLES = `
:host {
  display: block;
  width: 100%;
  font-family: sans-serif;
  /* The insert menu hangs off the host, not off the clipped editor area. */
  position: relative;
  /* The toolbar fits itself to the editor, not the window: in a page's
   * column or a side panel the editor is narrow on a wide screen. */
  container-type: inline-size;
  /* The editor is drawn light: its own text and background, whatever the
   * page around it uses (a dark page would otherwise give it light text on
   * its white boxes, and show through between them). */
  color-scheme: light;
  color: #242428;
  background: #fff;
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
   Left to itself each glyph of the insert menu contributes its own line box,
   so the buttons came out different heights. A fixed box means the glyph no
   longer sets the height. */
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

/* View settings live behind one button instead of spending four slots. The
   button sits at the start of the toolbar, so the popover opens towards the
   end: anchored on the right, it hung out of the editor's left edge. */
.popover {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
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
.popover .notice {
  grid-column: 1 / -1;
  max-width: 240px;
  padding: 6px 8px;
  font-size: 12px;
  line-height: 1.4;
  background: #fff8e1;
  border: 1px solid #f0c36d;
  border-radius: 3px;
}
.popover .notice .actions { display: flex; gap: 6px; margin-top: 6px; }

/* A narrow editor: the icons carry the meaning, the titles carry the words. */
@container (max-width: 760px) {
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

/* The blocks. Drag one into the diagram, or tap it and then tap a place. */
.palette {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  padding: 6px 8px;
  background: var(--toolbar-bg);
  border-left: 1px solid var(--toolbar-border);
  border-right: 1px solid var(--toolbar-border);
  border-bottom: 1px solid var(--toolbar-border);
}
.palette .blocks { display: flex; flex-wrap: wrap; gap: 4px; }
/* A finger dragging a block must not scroll the page instead. */
.palette .blocks button { touch-action: none; cursor: grab; }
.palette .blocks button.active { cursor: pointer; }
.palette .hint { font-size: 12px; color: #555; flex: 1 1 200px; }
@media (pointer: coarse) {
  .palette .blocks button { min-height: 40px; padding: 6px 12px; font-size: 14px; }
  .palette .cancel { min-height: 40px; }
}
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

/* What is being carried, following the pointer: a block, slightly lifted. */
.drag-ghost {
  position: fixed;
  z-index: 40;
  display: none;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  min-width: 140px;
  max-width: 260px;
  padding: 8px 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: #242428;
  background: #fff;
  border: 2px solid rgb(1, 116, 96);
  border-radius: 4px;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
  opacity: 0.95;
  transform: rotate(-1.5deg);
  pointer-events: none;
}
.drag-ghost .icon { color: rgb(1, 116, 96); }
/* While dragging the diagram only shows where the block will land. */
.editor-area.dragging { cursor: grabbing; }
.editor-area.dragging svg * { pointer-events: none !important; }

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
@media (pointer: coarse) {
  .type-menu { gap: 6px; padding: 8px; }
  .type-menu button { min-height: 44px; font-size: 15px; }
}

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
  border-top: none;
  border-radius: 0 0 4px 4px;
}
.code-editor {
  height: 180px;
  min-height: 80px;
  resize: vertical;
  overflow: hidden;
}
/* A program in Java, Python or JavaScript is longer than its pseudocode. */
.pseudocode-area.java .code-editor,
.pseudocode-area.python .code-editor,
.pseudocode-area.javascript .code-editor { height: 340px; }
.code-editor .cm-editor { height: 100%; font-size: 13px; background: #fff; }
.code-editor .cm-editor.cm-focused {
  outline: none;
  box-shadow: inset 0 0 0 2px rgba(1, 116, 96, 0.3);
}
.code-editor .cm-scroller {
  font-family: "Fira Code", "Consolas", monospace;
  line-height: 1.5;
}
.code-editor .cm-gutters { background: var(--toolbar-bg); border-right: 1px solid var(--toolbar-border); color: #777; }
.code-editor .cm-activeLineGutter { background: #e2f2ee; color: #333; }
.code-editor .cm-error-line { background: #fdecea; }
.code-editor .cm-placeholder { color: #999; }
/* "No code": the diagram alone. */
.pseudocode-area.none { display: none; }
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
 *   code-mode — the language the structogram is written in: "pseudocode"
 *              (default), "java", "python" or "javascript". Also in View.
 *              "none" hides the code (the older way of saying hide-code).
 *   hide-code — the diagram alone, without the code under it; the language
 *              stays. Also in View ("Show code").
 *   embedded — the host owns the file. Hides the Save/Load buttons and turns the
 *              PNG/SVG buttons into an "export-image" event instead of a download.
 *   resettable — a Reset button beside Undo/Redo: after asking, it goes back to
 *              the structogram the element started with (see reset()).
 *
 * Properties:
 *   tree, pseudocode, keywords (same as <struktolab-renderer>)
 *
 * Methods:
 *   toCode(lang)         — export to Python/Java/JavaScript
 *   loadCode(code, lang) — build the structogram from Java/Python/JavaScript/pseudocode
 *   toDocument()         — model, settings and the student's code as one object
 *   fromDocument(doc)    — restore what toDocument() returned
 *   saveJSON()           — return clean JSON string of the tree
 *   loadJSON(json)       — load from JSON string or object
 *   exportImage(format)  — export as PNG or SVG Blob (async)
 *   change(tree)         — set a new tree programmatically
 *   reset()              — back to the structogram the element started with: its
 *                          code/pseudocode/JSON <script>, else `src`, else empty
 *
 * Events:
 *   "change"       — fired when the tree changes (detail: { tree })
 *   "export-image" — embedded only: an image is ready (detail: { format, blob })
 *   "reset"        — reset() ran; a host that saves the student's work drops it
 */
class StruktolabEditor extends HTMLElement {
  static get observedAttributes() {
    return ["scale", "font-size", "src", "lang", "color-mode", "embedded", "code-mode", "hide-code", "resettable"];
  }

  constructor() {
    super();
    this._tree = null;
    this._keywords = null;
    this._mode = null; // null | "place:TYPE" | "move:ID"
    /**
     * The language the structogram is written in. "No code" only hides the
     * code, so this remembers the language behind it. Null until there is one.
     */
    this._codeLanguage = null;
    /** The language the code area's text is in, and whether it lags behind the diagram. */
    this._codeTextLanguage = null;
    this._codeNeedsSync = false;
    /**
     * The student's code around the algorithm (imports, class, main …), from
     * the last time their code was read. Regenerated blocks go back inside it.
     */
    this._codeFrame = null;
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

    // Block palette: where adding starts
    this._palette = document.createElement("div");
    this._palette.className = "palette";
    this._buildPalette();
    this._shadow.appendChild(this._palette);

    // Editor area
    this._editorArea = document.createElement("div");
    this._editorArea.className = "editor-area";
    this._editorArea.setAttribute("role", "application");
    this._editorArea.setAttribute(
      "aria-label",
      this._t("editorAria"),
    );
    this._shadow.appendChild(this._editorArea);

    // Code area: pseudocode, Java, Python or JavaScript, in sync with the diagram
    this._pseudoArea = document.createElement("div");
    this._pseudoArea.className = "pseudocode-area";
    this._codeHost = document.createElement("div");
    this._codeHost.className = "code-editor";
    this._pseudoArea.appendChild(this._codeHost);
    this._createCodeView();
    this._applyCodeMode();
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
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLInputElement ||
      Boolean(target && target.isContentEditable); // the code editor

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
    whenChildrenParsed(() => this._initialize());
    this._observeWidth();
  }

  disconnectedCallback() {
    this._widthObserver?.disconnect();
    this._widthObserver = null;
  }

  /**
   * The diagram is laid out for one width and then stretched to fill the
   * editor, so when the editor gets narrower (a side panel dragged smaller)
   * the text would shrink with it. Lay it out again for the new width
   * instead, so `font-size` stays the size it says.
   *
   * Not while a text is being edited or a column dragged: both hold pixel
   * positions in the drawn diagram. The render that ends them picks up the
   * width.
   */
  _observeWidth() {
    if (this._widthObserver || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    this._widthObserver = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!this._tree || this._renderedWidth == null) return;
        if (this._resolveWidth() === this._renderedWidth) return;
        if (this._overlay.style.display === "flex") return;
        if (this._editorArea.classList.contains("resizing")) return;
        this._render();
      });
    });
    this._widthObserver.observe(this._editorArea);
  }

  _uiLang() {
    const lang = (this.getAttribute("lang") || "de").toLowerCase();
    return lang === "en" ? "en" : "de";
  }

  /** A UI string in the language of the `lang` attribute, English as fallback. */
  _t(key) {
    return (
      UI_STRINGS[this._uiLang()][key] ?? UI_STRINGS.en[key] ?? key
    );
  }

  _getKeywords() {
    if (this._keywords) return this._keywords;
    return this._uiLang() === "en" ? KEYWORDS_EN : KEYWORDS_DE;
  }

  _prepTree(tree) {
    return ensureIds(wrapWithInsertNodes(tree));
  }

  _initialize() {
    if (!this._tree) {
      // <script type="text/plain" data-code="java|python|javascript">
      const codeScript = this.querySelector("script[data-code]");
      const mode = codeScript?.dataset.code;
      if (codeScript && CODE_PARSERS[mode]) {
        try {
          const code = inlineSource(codeScript.textContent);
          this._tree = this._prepTree(this._readCode(code, mode));
          // The code's language, also behind code-mode="none".
          if (!this.hasAttribute("code-mode")) this.setAttribute("code-mode", mode);
          else if (this.getAttribute("code-mode") === "none") this._codeLanguage = mode;
          // Shown as written — not as the generator would write it.
          this._setCode(code);
          this._codeTextLanguage = mode;
          this._emitChange();
        } catch (e) {
          console.error(`struktolab-editor: failed to parse ${mode}`, e);
        }
      }
    }
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
    // A host may have put the student's own code in already (a saved
    // document); start-up must not replace it with generated code.
    if (this._codeTextLanguage !== this.codeMode || this._codeNeedsSync) {
      this._syncTreeToPseudocode();
    }
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (name === "src" && newVal && newVal !== oldVal) {
      this._fetchTree(newVal);
    } else if (name === "embedded" || name === "resettable") {
      this._applyEmbedded();
    } else if (name === "code-mode" || name === "hide-code") {
      if (name === "code-mode" && CODE_MODES.includes(newVal) && newVal !== "none") this._codeLanguage = newVal;
      this._applyCodeMode();
      if (this._tree) {
        // Hiding the code changes nothing in it; back from "No code" to the
        // same language, the text is still right unless the diagram changed.
        const shown = this.codeMode !== "none";
        if (shown && (this.codeMode !== this._codeTextLanguage || this._codeNeedsSync)) {
          this._syncTreeToPseudocode();
        }
        this._render(); // function headers read like the code beside them
      }
    } else {
      if (name === "lang") {
        // Every toolbar and menu label comes from _t(), so they are all stale
        // now. Rebuilding also closes the popover — it holds the language
        // select the user is interacting with, so put it back up.
        const popoverOpen =
          this._viewPopover && this._viewPopover.style.display !== "none";
        this._rebuildToolbar();
        this._applyCodeMode();
        if (popoverOpen) {
          this._toggleViewPopover(true);
          this._langSelect?.focus();
        }
      }
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

  /**
   * Build the structogram from source code and show that code.
   * @param {string} code
   * @param {"java"|"python"|"javascript"|"pseudocode"} mode
   * @throws {CodeParseError} with a `.line` when the code cannot be read
   */
  loadCode(code, mode) {
    if (!CODE_MODES.includes(mode) || mode === "none") {
      throw new Error(`struktolab-editor: cannot load code as "${mode}"`);
    }
    this._tree = this._prepTree(this._readCode(code, mode));
    this._resetHistory();
    this.codeMode = mode;
    this._render();
    // Keep the code as it was written, not as the generator would write it.
    this._setCode(code);
    this._codeTextLanguage = mode;
    this._codeNeedsSync = false;
    this._clearCodeError();
    this._emitChange();
  }

  /**
   * Everything a saved structogram needs, as one object: the model, the
   * view settings (language, font size, colours, scale, code mode) and the
   * student's own code. What a `.struktolab` file and a shared link hold.
   * @returns {{version: number, model: Object|null, settings: Object, code?: Object}}
   */
  toDocument() {
    return serializeDocument(this);
  }

  /**
   * Restore what `toDocument()` returned. Also takes a bare model tree.
   * @param {Object|string} doc
   * @returns {boolean} whether a model was loaded
   */
  fromDocument(doc) {
    return applyDocument(this, typeof doc === "string" ? JSON.parse(doc) : doc);
  }

  /**
   * The code as the student wrote it, for saving with the document — or
   * null when there is nothing the diagram cannot give back by itself.
   * @returns {{lang: string, text: string} | null}
   */
  get codeSnapshot() {
    const lang = this._codeTextLanguage;
    if (!lang || lang === "pseudocode" || this._codeNeedsSync) return null;
    const text = this._getCode();
    return text.trim() ? { lang, text } : null;
  }

  /**
   * Put saved code back without rebuilding the diagram from it — the diagram
   * comes from the document's model. Code that no longer parses is shown
   * with its error, as it was when it was saved.
   */
  restoreCode(snapshot) {
    if (!snapshot || !CODE_PARSERS[snapshot.lang]) return;
    if (this.codeMode !== "none" && this.codeMode !== snapshot.lang) return;
    this._codeLanguage = snapshot.lang;
    this._setCode(snapshot.text);
    this._codeTextLanguage = snapshot.lang;
    this._codeNeedsSync = false;
    try {
      this._readCode(snapshot.text, snapshot.lang);
      this._clearCodeError();
    } catch (e) {
      this._showCodeError(e.message, e.line);
    }
  }

  /**
   * What the code area below the diagram shows: "none" when the code is
   * hidden (hide-code, or code-mode="none"), otherwise the language it is
   * written in — "pseudocode", "java", "python", "javascript".
   */
  get codeMode() {
    if (this.hasAttribute("hide-code")) return "none";
    const mode = this.getAttribute("code-mode");
    return CODE_MODES.includes(mode) ? mode : "pseudocode";
  }
  set codeMode(mode) {
    this.setAttribute("code-mode", CODE_MODES.includes(mode) ? mode : "pseudocode");
  }

  /**
   * The language the structogram is written in, shown or not:
   * "pseudocode", "java", "python" or "javascript".
   */
  get codeLanguage() {
    const mode = this.getAttribute("code-mode");
    if (CODE_MODES.includes(mode) && mode !== "none") return mode;
    return this._codeLanguage || "pseudocode";
  }

  /** Whether the code under the diagram is hidden. */
  get codeHidden() {
    return this.codeMode === "none";
  }
  set codeHidden(hidden) {
    if (hidden) {
      this.setAttribute("hide-code", "");
      return;
    }
    // Shown again: in its language, also when it was hidden the older way.
    if (this.getAttribute("code-mode") === "none") this.setAttribute("code-mode", this.codeLanguage);
    this.removeAttribute("hide-code");
  }

  /** Function headers read like the code beside them: Java puts the type in front. */
  _functionStyle() {
    return this.codeLanguage === "java" ? "java" : "arrow";
  }

  _parseCode(code, mode) {
    if (mode === "pseudocode") return parsePseudocode(code, this._getKeywords());
    return CODE_PARSERS[mode](code, { lang: this._uiLang() });
  }

  /** Parse the student's code and remember the program around the algorithm. */
  _readCode(code, mode) {
    const tree = this._parseCode(code, mode);
    if (tree._frame) this._codeFrame = tree._frame;
    // No blocks to measure from: an earlier frame of this language still fits.
    else if (this._codeFrame?.lang !== mode) this._codeFrame = null;
    return tree;
  }

  toCode(lang) {
    if (!this._tree) return "";
    return generateCode(this._tree, lang);
  }

  async _fetchTree(url) {
    try {
      const res = await fetch(url);
      const data = await res.json();
      // A saved .struktolab document brings its settings and code along.
      if (data && typeof data === "object" && ("model" in data || "settings" in data)) {
        this.fromDocument(data);
        return;
      }
      this._tree = this._prepTree(data);
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
    iconEl.append(icon);
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
    this._undoBtn = this._button(icon("undo"), this._t("undo"), this._t("undoTitle"), () => this.undo());
    this._redoBtn = this._button(icon("redo"), this._t("redo"), this._t("redoTitle"), () => this.redo());
    this._resetBtn = this._button(icon("reset"), this._t("reset"), this._t("resetTitle"), () => {
      if (window.confirm(this._t("resetConfirm"))) this.reset();
    });
    history.append(this._undoBtn, this._redoBtn, this._resetBtn);
    this._historyGroup = history;
    this._historySep = this._separator();

    /* View settings, behind one button */
    const view = this._group("view");
    const viewBtn = this._button(icon("view"), this._t("view"), this._t("viewTitle"));
    viewBtn.setAttribute("aria-haspopup", "true");
    viewBtn.setAttribute("aria-expanded", "false");
    viewBtn.addEventListener("click", () => this._toggleViewPopover());
    view.appendChild(viewBtn);
    this._viewBtn = viewBtn;
    this._viewPopover = this._buildViewPopover();
    view.appendChild(this._viewPopover);

    /* Files and export */
    const file = this._group("file");

    this._saveBtn = this._button(icon("save"), this._t("save"), this._t("saveTitle"), () =>
      this._downloadJSON(),
    );
    this._loadBtn = this._button(icon("load"), this._t("load"), this._t("loadTitle"), () =>
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
      this._button(icon("png"), "PNG", this._t("pngTitle"), () => this._downloadImage("png")),
      this._button(icon("svg"), "SVG", this._t("svgTitle"), () => this._downloadImage("svg")),
    );

    this._updateHistoryButtons();
  }

  /**
   * The blocks. Drag one into the diagram, or tap it and then tap the place.
   * It sits on its own row under the toolbar: this is where adding starts, so
   * it must be visible without hunting for it.
   */
  _buildPalette() {
    const palette = this._palette;
    palette.replaceChildren();
    palette.setAttribute("role", "toolbar");
    palette.setAttribute("aria-label", this._t("paletteLabel"));

    const blocks = document.createElement("div");
    blocks.className = "blocks";
    this._paletteButtons = new Map();
    for (const item of TOOLBAR_ITEMS) {
      const label = this._t("toolbarLabels")[item.type] ?? item.label;
      const btn = this._button(item.icon, label, this._t("paletteItemTitle").replace("{label}", label));
      btn.dataset.type = item.type;
      btn.setAttribute("aria-pressed", "false");

      btn.addEventListener("pointerdown", (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        if (this._mode === "place:" + item.type) {
          this._setMode(null);
          return;
        }
        this._startCarry("place:" + item.type, label, e, item.icon);
      });
      // Pointer presses are handled above; this is the keyboard's way in.
      btn.addEventListener("click", (e) => {
        if (e.detail !== 0) return;
        if (this._mode === "place:" + item.type) {
          this._setMode(null);
          return;
        }
        this._keyboardMove = true;
        this._startCarry("place:" + item.type, label);
      });
      blocks.appendChild(btn);
      this._paletteButtons.set(item.type, btn);
    }

    const hint = document.createElement("span");
    hint.className = "hint";
    hint.setAttribute("aria-live", "polite");
    this._paletteHint = hint;

    const cancel = this._button("✕", this._t("cancel"), this._t("cancel"), () => this._setMode(null));
    cancel.className = "cancel";
    this._paletteCancel = cancel;

    palette.append(blocks, hint, cancel);
    this._updatePalette();
  }

  _updatePalette() {
    if (!this._paletteButtons) return;
    const mode = this._mode || "";
    const placing = mode.startsWith("place:") ? mode.slice("place:".length) : null;
    for (const [type, btn] of this._paletteButtons) {
      btn.classList.toggle("active", type === placing);
      btn.setAttribute("aria-pressed", String(type === placing));
    }
    let hint = this._t("paletteHint");
    if (placing) {
      const label = this._t("toolbarLabels")[placing] ?? placing;
      hint = this._t("placeHint").replace("{label}", label);
    } else if (mode.startsWith("move:")) {
      hint = this._t("moveHint");
    }
    this._paletteHint.textContent = hint;
    this._paletteCancel.style.display = mode ? "" : "none";
  }

  /**
   * Build the toolbar again from scratch. The labels only depend on the
   * `lang` attribute, so this is where a language change lands.
   */
  _rebuildToolbar() {
    if (!this._toolbar) return;
    this._toolbar.replaceChildren();
    this._buildToolbar();
    this._applyEmbedded();
    if (this._palette) this._buildPalette();
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
      // Pseudocode is written in the UI language's keywords; real code is not.
      // Hidden pseudocode is brought up to date when it is shown again.
      if (this.codeLanguage === "pseudocode") this._onTreeChange();
      else this._onViewChange();
    });
    row(this._t("language"), langSelect);
    this._langSelect = langSelect;

    const fsInput = document.createElement("input");
    fsInput.type = "number";
    fsInput.min = "8";
    fsInput.max = "32";
    fsInput.value = this.getAttribute("font-size") || "14";
    fsInput.addEventListener("change", () => {
      this.setAttribute("font-size", fsInput.value);
      this._onViewChange();
    });
    row(this._t("fontSize"), fsInput);
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
      this._onViewChange();
    });
    row(this._t("scale"), scaleInput);
    this._scaleInput = scaleInput;

    const colorModeSelect = document.createElement("select");
    colorModeSelect.innerHTML =
      `<option value="color">${this._t("colour")}</option>` +
      `<option value="greyscale">${this._t("greyscale")}</option>` +
      `<option value="bw">${this._t("blackWhite")}</option>`;
    colorModeSelect.value = this.getAttribute("color-mode") || "color";
    colorModeSelect.addEventListener("change", () => {
      this.setAttribute("color-mode", colorModeSelect.value);
      this._onViewChange();
    });
    row(this._t("colours"), colorModeSelect);
    this._colorModeSelect = colorModeSelect;

    const codeModeSelect = document.createElement("select");
    const names = this._t("codeModes");
    for (const mode of CODE_MODES) {
      if (mode === "none") continue; // that is "Show code" below
      const option = document.createElement("option");
      option.value = mode;
      option.textContent = names[mode];
      codeModeSelect.appendChild(option);
    }
    codeModeSelect.value = this.codeLanguage;
    codeModeSelect.addEventListener("change", () => this._switchCodeMode(codeModeSelect.value));
    row(this._t("codeMode"), codeModeSelect);
    this._codeModeSelect = codeModeSelect;

    const showCode = document.createElement("input");
    showCode.type = "checkbox";
    showCode.checked = !this.codeHidden;
    showCode.addEventListener("change", () => {
      this.codeHidden = !showCode.checked;
      this._emitChange(); // whether it shows is part of the saved document
    });
    row(this._t("showCode"), showCode);
    this._showCodeInput = showCode;

    return pop;
  }

  _toggleViewPopover(force) {
    const open = force ?? this._viewPopover.style.display === "none";
    this._viewPopover.style.display = open ? "grid" : "none";
    if (!open) this._dismissLanguageNotice();
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
    this._resetBtn.style.display = this.hasAttribute("resettable") ? "" : "none";
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
      this._slots = [];
      this._activeSlot = null;
      if (this._drag) {
        this._drag.ghost.remove();
        this._drag = null;
      }
    }
    this._updatePalette();
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
    this._renderedWidth = width;
    const colorMode = this.getAttribute("color-mode");

    // Remove old SVG (keep overlay). If the keyboard was on a node, it has to
    // land on the same node again once the new SVG is in — a re-render is not
    // a reason to lose your place.
    const oldSvg = this._editorArea.querySelector("svg");
    const hadFocus = oldSvg ? oldSvg.contains(this._shadow.activeElement) : false;
    if (oldSvg) oldSvg.remove();

    // While something is being placed, every slot opens up into a block of
    // its own. The renderer reports where each one landed — the editor does
    // not guess, so a target can never sit beside the gap it stands for.
    const carrying = Boolean(this._mode);
    setInsertNodeHeight(carrying ? INSERT_HEIGHT : 0);
    setEmptyBranchHeight(EMPTY_BRANCH_HEIGHT);
    this._slotLayout = new Map();
    this._closedSlots = this._unusableSlots();
    const svg = renderStructogramSVG(this._tree, {
      width,
      fontSize,
      colorMode,
      keywords: this._getKeywords(),
      functionStyle: this._functionStyle(),
      layout: this._slotLayout,
      nodeLayout: (this._drawnBoxes = new Map()),
      closedSlots: this._closedSlots,
    });
    setEmptyBranchHeight(0);
    setInsertNodeHeight(0);

    svg.setAttribute("role", "group");
    svg.setAttribute("aria-label", this._t("structogram"));

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
      this._slots?.[0]?.element.focus({ preventScroll: true });
    }
  }

  _addInteractivity(svg, width, fontSize) {
    const carrying = Boolean(this._mode);

    if (carrying) {
      this._addSlotTargets(svg, width, fontSize);
      // Pressing anywhere that is not a slot puts the carried thing down.
      //
      // This listens for pointerdown, not click: arming the move re-renders,
      // which removes the grip mid-gesture, and the click that gesture goes on
      // to produce is retargeted onto this very SVG — cancelling the move the
      // instant it began. A pointerdown can only belong to a later gesture.
      svg.addEventListener("pointerdown", (e) => {
        const onSlot = (this._slots || []).some((slot) =>
          e.composedPath().includes(slot.element),
        );
        if (!onSlot) this._setMode(null);
      });
      return;
    }

    // Order is hit-testing order: the node layer covers whole nodes and goes in
    // first, then the "+" in empty places, then the small handles and buttons
    // last so they always win the click.
    this._addNodeTargets(svg, width, fontSize);
    this._addEmptySlotTargets(svg);
    this._addResizeHandles(svg, width, fontSize);
    this._addCaseButtons(svg, width, fontSize);
  }

  /**
   * Walk the tree and compute bounding boxes for each node.
   * Returns a Map of nodeId → { x, y, w, h, type, text }.
   * @param {boolean} withInsertSpace - if true, InsertNodes occupy INSERT_HEIGHT
   */
  /**
   * Every node's box as the diagram draws it. Branches and loops are
   * stretched to fill their column, which only the renderer knows, so its
   * report wins; the own calculation is what is left without one.
   */
  _boxesFor(width, fontSize) {
    const computed = this._computeLayout(this._tree, 0, 0, width, fontSize, false);
    const drawn = this._drawnBoxes;
    if (!drawn || !drawn.size) return computed;
    for (const [id, box] of drawn) computed.set(id, { ...computed.get(id), ...box });
    return computed;
  }

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
        // Both branches empty would leave no body at all, and so nothing to
        // tap to put the first node into either branch.
        const maxChildH = Math.max(trueH, falseH, EMPTY_BRANCH_HEIGHT);
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
        const headerText = functionHeader(node, this._functionStyle()) + " {";
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

  /** Nesting depth of every slot, and whether it ends its column. */
  _slotInfo(node, depth = 0, info = new Map()) {
    // A case column starts with its label (InsertCase), which is not content:
    // a slot right after it is still the only thing in the column.
    let content = false;
    for (let n = node; n; n = n.followElement) {
      if (n.type === "InsertNode" && n.id) {
        const f = n.followElement;
        const trailing = !f || f.type === "Placeholder";
        info.set(n.id, { depth, trailing, alone: trailing && !content });
      } else if (n.type !== "InsertCase" && n.type !== "Placeholder") {
        content = true;
      }
      for (const key of ["trueChild", "falseChild", "child", "tryChild", "catchChild", "defaultNode"]) {
        if (n[key]) this._slotInfo(n[key], depth + 1, info);
      }
      for (const c of n.cases || []) this._slotInfo(c, depth + 1, info);
    }
    return info;
  }

  /* ── Insert targets ─────────────────────────────────────── */


  /* ── The empty diagram's place ──────────────────────────── */

  /**
   * An empty diagram has nothing in it to point at, so it gets a quiet "+"
   * that is always there and opens the block menu.
   */
  _addEmptySlotTargets(svg) {
    const svgNS = "http://www.w3.org/2000/svg";
    for (const zone of this._slotZones()) {
      const { group, hit, setActive } = this._slotBlock(svgNS, zone);
      hit.setAttribute("aria-label", this._t("insertHere"));
      group.addEventListener("mouseenter", () => setActive(true));
      group.addEventListener("mouseleave", () => setActive(false));
      group.addEventListener("click", (e) => {
        e.stopPropagation();
        this._showTypeMenu(zone.id, { x: zone.x, y: zone.top, w: zone.w, h: zone.bottom - zone.top });
      });
      svg.appendChild(group);
    }
  }

  /** One place to put something: a dashed block with a "+" in the middle. */
  _slotBlock(svgNS, zone) {
    const group = document.createElementNS(svgNS, "g");
    group.style.cursor = "pointer";

    const block = document.createElementNS(svgNS, "rect");
    block.setAttribute("x", zone.x + 3);
    block.setAttribute("y", zone.top + 3);
    block.setAttribute("width", Math.max(zone.w - 6, 1));
    block.setAttribute("height", Math.max(zone.bottom - zone.top - 6, 1));
    block.setAttribute("rx", 4);
    block.setAttribute("stroke", INSERT_LINE_COLOR);
    block.setAttribute("pointer-events", "none");
    block.style.transition = "fill 0.1s";

    const badge = this._plusBadge(svgNS, zone.x + zone.w / 2, (zone.top + zone.bottom) / 2);

    const hit = document.createElementNS(svgNS, "rect");
    hit.setAttribute("x", zone.x);
    hit.setAttribute("y", zone.top);
    hit.setAttribute("width", Math.max(zone.w, 1));
    hit.setAttribute("height", Math.max(zone.bottom - zone.top, 1));
    hit.setAttribute("fill", "transparent");
    hit.setAttribute("role", "button");

    const setActive = (on) => {
      block.setAttribute("fill", on ? "rgba(1, 116, 96, 0.30)" : "rgba(1, 116, 96, 0.07)");
      block.setAttribute("stroke-width", on ? "2" : "1");
      block.setAttribute("stroke-dasharray", on ? "none" : "5 4");
      badge.set(on ? "active" : "idle");
    };
    setActive(false);

    group.append(block, badge.element, hit);
    return { group, hit, setActive };
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
    menu.setAttribute("aria-label", this._t("insertHere"));

    for (const item of TOOLBAR_ITEMS) {
      const label =
        this._t("toolbarLabels")[item.type] ?? item.label;
      const btn = this._button(item.icon, label, this._t("insertNode").replace("{label}", label), () => {
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
    const tree = insertAt(this._tree, targetId, type);
    const created = findNode(tree, targetId)?.followElement;
    this._tree = this._prepTree(tree);
    this._setMode(null);
    this._onTreeChange();
    // A new node is almost always followed by typing its text, so go straight
    // there instead of making the user find and double-tap it first.
    const box = created?.id && this._boxes?.get(created.id);
    if (box) {
      this._setFocusedNode(created.id);
      this._showEditOverlay(created.id, box);
    }
  }

  /* ── Delete targets ─────────────────────────────────────── */


  /* ── Edit targets (click-to-edit) ───────────────────────── */

  _addNodeTargets(svg, width, fontSize) {
    const layout = this._boxesFor(width, fontSize);
    // Where every node sits in the diagram at rest, for dragging onto it.
    this._nodeBoxes = layout;
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

      // Older Safari hands click a MouseEvent without pointerType, so remember
      // what the press itself was.
      let pressedWith = "mouse";
      rect.addEventListener("pointerdown", (e) => {
        pressedWith = e.pointerType;
      });
      rect.addEventListener("click", (e) => {
        e.stopPropagation();
        // Touch has no reliable double-tap: the first tap selects the node,
        // a second tap on the selected node edits it.
        const wasSelected = this._shadow.activeElement === rect;
        rect.focus();
        if (wasSelected && pressedWith !== "mouse") {
          this._showEditOverlay(id, box);
        }
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
    // A do-while has its condition at the bottom, and the top-right corner
    // belongs to the first node of its body — buttons there would be covered
    // by that node's own, so the loop's go into its footer row instead.
    const top = box.type === "FootLoopNode" ? box.y + box.h - size - 3 : box.y + 3;
    const right = box.x + box.w - 3;

    const actions = document.createElementNS(svgNS, "g");
    actions.style.transition = "opacity 0.12s";

    const button = (x, glyph, colour, label, onActivate, w = size) => {
      const g = document.createElementNS(svgNS, "g");
      g.style.cursor = "pointer";

      const bg = document.createElementNS(svgNS, "rect");
      bg.setAttribute("x", x);
      bg.setAttribute("y", top);
      bg.setAttribute("width", w);
      bg.setAttribute("height", size);
      bg.setAttribute("rx", 3);
      bg.setAttribute("fill", "rgba(255,255,255,0.85)");
      bg.setAttribute("stroke", colour);
      bg.setAttribute("stroke-width", "1");

      const text = document.createElementNS(svgNS, "text");
      text.setAttribute("x", x + w / 2);
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
    // Pressing a button must not blur the node first: the blur hides the
    // buttons, and the click would then land on nothing.
    const keepFocus = (g) =>
      g.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        e.preventDefault();
      });

    const del = button(
      right - size,
      "✕",
      "rgb(192, 57, 43)",
      this._t("deleteNode"),
      (g) => {
        keepFocus(g);
        g.addEventListener("click", (e) => {
          e.stopPropagation();
          this._deleteNode(id);
        });
      },
    );

    const drag = button(
      right - size * 2 - gap,
      "⠿",
      "rgb(1, 116, 96)",
      this._t("moveNode"),
      (g) => {
        g.setAttribute("data-grab", "move");
        g.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          e.preventDefault();
          this._startDrag(id, e);
        });
      },
    );

    // The seams are hover-only and thin; this is the way in that works the
    // same with a finger: tap the node, then "+".
    const add = button(
      right - size * 3 - gap * 2,
      "+",
      "rgb(1, 116, 96)",
      this._t("insertAfter"),
      (g) => {
        keepFocus(g);
        g.addEventListener("click", (e) => {
          e.stopPropagation();
          this._openInsertAfter(id, box);
        });
      },
    );

    actions.append(add, drag, del);

    // A switch also grows sideways: one more case. Spelled out, so it is not
    // mistaken for the "+" next to it that adds a block after the switch.
    if (box.type === "CaseNode") {
      const text = this._t("addCase");
      const w = Math.round(text.length * size * 0.42 + size * 0.6);
      const addCaseBtn = button(
        right - size * 3 - gap * 3 - w,
        text,
        "rgb(1, 116, 96)",
        this._t("addCaseTitle"),
        (g) => {
          keepFocus(g);
          g.addEventListener("click", (e) => {
            e.stopPropagation();
            this._commit(addCase(this._tree, id));
          });
        },
        w,
      );
      addCaseBtn.querySelector("text").setAttribute("font-size", String(Math.round(size * 0.62)));
      actions.append(addCaseBtn);
    }
    return actions;
  }

  /** "If/Else: a[i] > max" — what a screen reader should read out. */
  _nodeLabel(box) {
    const name = this._t("nodeLabels")[box.type] || box.type;
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

    // A function's header is edited as one line, in its language's order:
    // "int max(int a, int b)" in Java, "max(a: int, b: int) -> int" elsewhere.
    const isFunction = node.type === "FunctionNode";
    const original = isFunction ? functionHeader(node, this._functionStyle()) : node.text || "";
    const input = document.createElement("textarea");
    input.value = original;
    input.rows = Math.max(2, original.split("\n").length);
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
      if (input.value === original) return;
      if (isFunction) {
        const header = parseFunctionHeader(input.value, this._functionStyle());
        this._commit(editFunctionHeader(this._tree, nodeId, header));
        return;
      }
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
      case "FunctionNode":
        return wrappedH(functionHeader(node, this._functionStyle()) + " {");
      case "TryCatchNode":
        return wrappedH(node.text || "");
      default:
        return wrappedH(node.text || "");
    }
  }

  /* ── Carrying: adding from the palette and moving a node ─── */

  /**
   * Adding and moving are one gesture with two sources. Something is picked
   * up — a block from the palette, or an existing node by its grip — and put
   * down in the diagram.
   *
   * With a pointer (mouse, pen or finger) it is a real drag. The diagram stays
   * as it is — nothing jumps away from where the pointer is heading — and one
   * line shows where the block would land: over the upper half of a block it
   * goes before it, over the lower half after it, and an empty branch lights
   * up as a whole. Escape puts it back.
   *
   * Press and release without moving and the thing stays picked up instead:
   * every place opens up as a gap, and a tap on one puts it there. That
   * second way is what a keyboard gets too.
   *
   * @param {string} mode "place:TYPE" or "move:ID"
   */
  _startCarry(mode, label, event, icon) {
    this._hideTypeMenu();
    this._hideEditOverlay();
    if (!event || event.pointerId === undefined) {
      this._setMode(mode);
      return;
    }

    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    if (icon) {
      const iconEl = document.createElement("span");
      iconEl.className = "icon";
      iconEl.textContent = icon;
      ghost.appendChild(iconEl);
    }
    ghost.append(label);
    this._shadow.appendChild(ghost);

    const drag = {
      mode,
      ghost,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
      target: null,
      closed: this._unusableSlots(mode),
    };
    this._drag = drag;
    this._positionGhost(event.clientX, event.clientY);

    const onMove = (e) => {
      if (
        !drag.moved &&
        Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6
      ) {
        return;
      }
      if (!drag.moved) {
        drag.moved = true;
        ghost.style.display = "flex";
        this._editorArea.classList.add("dragging");
        this._markMoving(drag);
      }
      this._positionGhost(e.clientX, e.clientY);
      // The page cannot scroll under a finger that is dragging, so it scrolls
      // for it near the edges of the window.
      const edge = 48;
      if (e.clientY < edge) window.scrollBy(0, -12);
      else if (e.clientY > window.innerHeight - edge) window.scrollBy(0, 12);
      drag.target = this._dropTargetAt(e.clientX, e.clientY, drag.closed);
      this._showDropTarget(drag);
    };

    const finish = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("keydown", onKey, true);
      ghost.remove();
      this._editorArea.classList.remove("dragging");
      this._drag = null;
    };
    const onUp = () => {
      finish();
      // A tap: stay picked up, with every place open, and wait for the second tap.
      if (!drag.moved) {
        this._setMode(mode);
        return;
      }
      if (drag.target) this._dropCarried(mode, drag.target.id);
      else this._render(); // nothing to drop on: clear the line and marker
    };
    const onCancel = () => {
      finish();
      this._render();
    };
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    document.addEventListener("keydown", onKey, true);
  }

  _startDrag(nodeId, event) {
    const node = findNode(this._tree, nodeId) ?? { type: "" };
    const icon = TOOLBAR_ITEMS.find((item) => item.type === node.type)?.icon;
    this._startCarry("move:" + nodeId, this._nodeLabel(node), event, icon);
  }

  _positionGhost(clientX, clientY) {
    if (!this._drag) return;
    this._drag.ghost.style.left = clientX + 14 + "px";
    this._drag.ghost.style.top = clientY + 10 + "px";
  }

  /** The diagram's own coordinates of a point on screen. */
  _svgPoint(clientX, clientY) {
    const svg = this._editorArea.querySelector("svg");
    const ctm = svg?.getScreenCTM();
    if (!ctm) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    return point.matrixTransform(ctm.inverse());
  }

  /**
   * How far left each place reaches when something is dragged onto it. A
   * place inside a loop, function or try reaches over that block's coloured
   * bar on the left: with the pointer on the bar, the block goes into that
   * body — the one way to reach the end of a loop whose last block is a
   * branch, where the ends of both lie on the same line.
   */
  _slotReach() {
    const reach = new Map();
    const boxes = this._nodeBoxes || new Map();
    const BARRED = new Set(["HeadLoopNode", "CountLoopNode", "FootLoopNode", "FunctionNode", "TryCatchNode"]);
    const walk = (chain, left) => {
      for (let n = chain; n; n = n.followElement) {
        if (n.type === "InsertNode" && n.id && left != null) reach.set(n.id, left);
        const box = n.id ? boxes.get(n.id) : null;
        const inner = BARRED.has(n.type) && box ? box.x : null;
        for (const key of ["child", "tryChild", "catchChild"]) if (n[key]) walk(n[key], inner);
        for (const key of ["trueChild", "falseChild"]) if (n[key]) walk(n[key], null);
        for (const c of n.cases || []) walk(c, null);
        if (n.defaultNode) walk(n.defaultNode, null);
      }
    };
    walk(this._tree, null);
    return reach;
  }

  /**
   * Where a block dropped at this point would go, from the diagram as it
   * rests: the closest place whose column the pointer is in — the line
   * between two blocks, or a whole empty body.
   *
   * Nested blocks often end on the same line: a branch that is the last block
   * of a loop or of another branch ends where its own branches end. Those
   * places are told apart by how close the pointer is to the line:
   *   - well above it, in the block that ends there: the innermost column;
   *   - coming closer, step by step outwards — the line grows as it does;
   *   - below it: right before the block that starts there, and if none does,
   *     the outermost end — under the whole branch.
   *
   * @returns {{id: string, x: number, w: number, top: number, bottom: number, empty: boolean} | null}
   */
  _dropTargetAt(clientX, clientY, closed) {
    const p = this._svgPoint(clientX, clientY);
    if (!p || !this._slotLayout) return null;
    const info = this._slotInfo(this._tree);
    const reach = this._slotReach();

    const candidates = [];
    for (const [id, b] of this._slotLayout) {
      if (closed.has(id)) continue;
      const left = Math.min(reach.get(id) ?? b.x, b.x);
      if (p.x < left || p.x > b.x + b.w) continue;
      const slot = info.get(id);
      const empty = Boolean(slot?.alone) && (b.avail ?? 0) > 1;
      const top = b.y;
      // An empty column is all target. The end of a column shorter than its
      // neighbour reaches over the free space under its last block too.
      const reachesDown = (empty || slot?.trailing) && (b.avail ?? 0) > 1;
      const bottom = reachesDown ? b.y + b.avail : b.y;
      const distance = p.y < top ? top - p.y : p.y > bottom ? p.y - bottom : 0;
      candidates.push({ id, x: b.x, w: b.w, top, bottom, empty, distance, trailing: Boolean(slot?.trailing) });
    }
    if (!candidates.length) return null;

    const nearest = Math.min(...candidates.map((c) => c.distance));
    if (nearest > 60) return null;
    // Innermost (narrowest) first.
    const tied = candidates
      .filter((c) => c.distance - nearest <= 0.5)
      .sort((a, b) => a.w - b.w);
    if (tied.length === 1) return tied[0];

    const line = tied[0];
    if (p.y > line.top) {
      return tied.find((c) => !c.trailing) ?? tied[tied.length - 1];
    }
    const STEP = 8;
    const outward = Math.floor((line.top - p.y) / STEP);
    return tied[Math.max(0, tied.length - 1 - outward)];
  }

  /** The one line (or lit empty body) that says where the block lands. */
  _showDropTarget(drag) {
    const svg = this._editorArea.querySelector("svg");
    if (!svg) return;
    const svgNS = "http://www.w3.org/2000/svg";
    let g = svg.querySelector(".drop-target");
    if (!g) {
      g = document.createElementNS(svgNS, "g");
      g.setAttribute("class", "drop-target");
      g.setAttribute("pointer-events", "none");
      svg.appendChild(g);
    }
    g.replaceChildren();
    const t = drag.target;
    if (!t) return;
    const color = "rgb(1, 116, 96)";
    if (t.empty) {
      const rect = document.createElementNS(svgNS, "rect");
      rect.setAttribute("x", t.x + 2);
      rect.setAttribute("y", t.top + 2);
      rect.setAttribute("width", Math.max(t.w - 4, 1));
      rect.setAttribute("height", Math.max(t.bottom - t.top - 4, 1));
      rect.setAttribute("rx", 3);
      rect.setAttribute("fill", "rgba(1, 116, 96, 0.18)");
      rect.setAttribute("stroke", color);
      rect.setAttribute("stroke-width", 2);
      rect.setAttribute("stroke-dasharray", "6 4");
      g.appendChild(rect);
      return;
    }
    const line = document.createElementNS(svgNS, "rect");
    line.setAttribute("x", t.x + 2);
    line.setAttribute("y", t.top - 2);
    line.setAttribute("width", Math.max(t.w - 4, 1));
    line.setAttribute("height", 4);
    line.setAttribute("rx", 2);
    line.setAttribute("fill", color);
    const dot = document.createElementNS(svgNS, "circle");
    dot.setAttribute("cx", t.x + 4);
    dot.setAttribute("cy", t.top);
    dot.setAttribute("r", 5);
    dot.setAttribute("fill", "#fff");
    dot.setAttribute("stroke", color);
    dot.setAttribute("stroke-width", 3);
    g.append(line, dot);
  }

  /** While moving: the node being moved, faded where it still is. */
  _markMoving(drag) {
    if (!drag.mode.startsWith("move:")) return;
    const box = this._nodeBoxes?.get(drag.mode.slice("move:".length));
    const svg = this._editorArea.querySelector("svg");
    if (!box || !svg) return;
    const veil = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    veil.setAttribute("x", box.x);
    veil.setAttribute("y", box.y);
    veil.setAttribute("width", box.w);
    veil.setAttribute("height", box.h);
    veil.setAttribute("fill", "rgba(255, 255, 255, 0.65)");
    veil.setAttribute("stroke", "rgb(1, 116, 96)");
    veil.setAttribute("stroke-width", 2);
    veil.setAttribute("stroke-dasharray", "6 4");
    veil.setAttribute("pointer-events", "none");
    svg.appendChild(veil);
  }

  /** Put what was dragged into the place `slotId`. */
  _dropCarried(mode, slotId) {
    if (mode.startsWith("place:")) {
      this._insertType(slotId, mode.slice("place:".length));
      return;
    }
    const nodeId = mode.slice("move:".length);
    this._pushHistory();
    this._tree = this._prepTree(moveNode(this._tree, nodeId, slotId));
    this._focusedId = nodeId;
    this._onTreeChange();
  }

  _highlightSlot(slot) {
    if (this._activeSlot === slot) return;
    this._activeSlot = slot;
    for (const candidate of this._slots || []) {
      candidate.setActive(candidate === slot);
    }
  }

  /** Put whatever is being carried into the slot `slotId`. */
  _activateSlot(slotId) {
    const mode = this._mode || "";
    this._activeSlot = null;
    this._slots = [];
    if (mode.startsWith("place:")) {
      this._insertType(slotId, mode.slice("place:".length));
      return;
    }
    if (!mode.startsWith("move:")) return;
    const nodeId = mode.slice("move:".length);
    this._pushHistory();
    this._tree = this._prepTree(moveNode(this._tree, nodeId, slotId));
    this._focusedId = nodeId;
    this._setMode(null);
    this._onTreeChange();
  }

  /**
   * The places to put something, as blocks, straight from what the renderer
   * drew.
   *
   * While placing, every slot is its own gap in the diagram, so the blocks
   * never overlap. The only slot of an empty column takes the whole column.
   * At rest only the places with nothing in them show: an empty diagram,
   * empty branches and bodies, and a strip under the diagram for the end.
   */
  _slotZones() {
    const layout = this._slotLayout || new Map();
    const info = this._slotInfo(this._tree);
    const carrying = Boolean(this._mode);
    const zones = [];
    for (const [id, b] of layout) {
      const slot = info.get(id) || { depth: 0, trailing: false, alone: false };
      const avail = b.avail ?? 0;
      let h = 0;
      if (carrying) {
        h = slot.alone && avail > b.h ? avail : b.h;
      } else if (slot.alone && slot.depth === 0) {
        // Only an empty diagram keeps a place to click into at all times;
        // everywhere else the palette and each block's "+" do the adding.
        h = EMPTY_BRANCH_HEIGHT;
      }
      if (h <= 0) continue;
      zones.push({ id, x: b.x, w: b.w, top: b.y, bottom: b.y + h, depth: slot.depth });
    }
    // Reading order, for the keyboard.
    return zones.sort((a, b) => a.top - b.top || a.x - b.x);
  }

  /**
   * Every slot the carried thing can go to, drawn over the diagram. While
   * moving, the slots inside the node itself are left out — dropping a loop
   * into its own body is not a move, and used to lose the loop.
   */
  _addSlotTargets(svg, width, fontSize) {
    const svgNS = "http://www.w3.org/2000/svg";
    const mode = this._mode || "";
    const isMove = mode.startsWith("move:");
    const movingId = isMove ? mode.slice("move:".length) : null;

    const closed = this._closedSlots || new Set();

    this._slots = [];
    this._activeSlot = null;

    // Show what is being carried, so it is never a mystery.
    // The node sits between the slot in front of it and the one after it, and
    // the renderer told us where both of those are.
    let movingBox = null;
    if (movingId) {
      const moving = findNode(this._tree, movingId);
      const before = this._slotLayout.get(this._slotHolding(this._tree, movingId));
      const after = moving?.followElement && this._slotLayout.get(moving.followElement.id);
      if (before && after) {
        const top = before.y + before.h;
        movingBox = { x: before.x, y: top, w: before.w, h: after.y - top };
      }
    }
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

    const zones = this._slotZones().filter((z) => !closed.has(z.id));
    const label = isMove ? this._t("moveHere") : this._t("placeHere");

    const elements = new Map();
    for (const zone of zones) {
      const { group, hit, setActive } = this._slotBlock(svgNS, zone);
      // The attributes go on the rect, not the group: a <g> is a container and
      // does not take focus, so a tabindex on it would be ignored.
      hit.setAttribute("aria-label", label);
      hit.setAttribute("tabindex", "-1");
      hit.addEventListener("focus", () => this._highlightSlot(slot));
      hit.addEventListener("mouseenter", () => this._highlightSlot(slot));
      hit.addEventListener("click", (e) => {
        e.stopPropagation();
        this._activateSlot(zone.id);
      });
      hit.addEventListener("keydown", (e) => this._onSlotKeyDown(e, zone.id));
      svg.appendChild(group);

      const slot = { id: zone.id, zone, setActive, element: hit };
      elements.set(zone.id, slot);
    }
    this._slots = zones.map((z) => elements.get(z.id));
    this._slots[0]?.element.setAttribute("tabindex", "0");
  }

  /**
   * While moving: the slots the node cannot go to — inside itself, and right
   * before or after itself, where it already is. They stay closed.
   */
  _unusableSlots(mode = this._mode || "") {
    if (!mode.startsWith("move:")) return new Set();
    const movingId = mode.slice("move:".length);
    const moving = findNode(this._tree, movingId);
    if (!moving) return new Set();
    const closed = new Set(collectMovedIds(moving));
    const before = this._slotHolding(this._tree, movingId);
    if (before) closed.add(before);
    const after = moving.followElement;
    if (after && after.type === "InsertNode" && after.id) closed.add(after.id);
    return closed;
  }

  /** Room under the diagram for adding at the end. */
  /** A round "+" that can be hidden, quiet, or lit. */
  _plusBadge(svgNS, cx, cy) {
    const r = this._coarsePointer ? 13 : 10;
    const g = document.createElementNS(svgNS, "g");
    g.setAttribute("pointer-events", "none");
    const circle = document.createElementNS(svgNS, "circle");
    circle.setAttribute("cx", cx);
    circle.setAttribute("cy", cy);
    circle.setAttribute("r", r);
    const plus = document.createElementNS(svgNS, "path");
    const a = r * 0.5;
    plus.setAttribute("d", `M${cx - a} ${cy}H${cx + a}M${cx} ${cy - a}V${cy + a}`);
    plus.setAttribute("stroke-width", "2.5");
    plus.setAttribute("stroke-linecap", "round");
    g.append(circle, plus);
    return {
      element: g,
      set(state) {
        g.style.display = state === "hidden" ? "none" : "";
        circle.setAttribute("fill", state === "active" ? INSERT_LINE_COLOR : "rgba(1, 116, 96, 0.15)");
        plus.setAttribute("stroke", state === "active" ? "#fff" : INSERT_LINE_COLOR);
      },
    };
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
    const at = this._slots.findIndex((s) => s.id === id);
    const focusSlot = (index) => {
      const slot = this._slots[Math.max(0, Math.min(this._slots.length - 1, index))];
      if (!slot) return;
      for (const other of this._slots) {
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
        this._activateSlot(id);
        return;
    }
  }

  /* ── Case add/delete buttons ────────────────────────────── */

  _addCaseButtons(svg, width, fontSize) {
    const layout = this._boxesFor(width, fontSize);
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

      // Adding a case is one of the switch's own buttons (see _nodeActions).

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
    const layout = this._boxesFor(width, fontSize);
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

  /* ── Code mode ──────────────────────────────────────────── */

  /** Show the code area in the language of the `code-mode` attribute. */
  _applyCodeMode() {
    if (!this._codeView) return;
    const mode = this.codeMode;
    for (const m of CODE_MODES) this._pseudoArea.classList.toggle(m, mode === m);
    if (this._codeModeSelect) this._codeModeSelect.value = this.codeLanguage;
    if (this._showCodeInput) this._showCodeInput.checked = mode !== "none";
    this._codeView.dispatch({
      effects: this._codeModeCompartment.reconfigure(this._codeModeExtensions(mode)),
    });
  }

  /** The CodeMirror editor the code is written in. */
  _createCodeView() {
    this._codeModeCompartment = new Compartment();
    this._settingCode = false;
    this._codeView = new EditorView({
      parent: this._codeHost,
      // Inside a shadow root CodeMirror has to be told where to put its styles.
      root: this._shadow,
      state: EditorState.create({
        doc: "",
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          indentUnit.of("    "),
          EditorState.tabSize.of(4),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          errorLineField,
          this._codeModeCompartment.of(this._codeModeExtensions(this.codeMode)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !this._settingCode) this._onPseudocodeInput();
            if (update.focusChanged && !update.view.hasFocus && this._debounceTimer) {
              this._syncPseudocodeToTree();
            }
          }),
        ],
      }),
    });
  }

  /** What differs between the modes: highlighting, placeholder, label. */
  _codeModeExtensions(mode) {
    const language = { java, python, javascript }[mode];
    return [
      language ? language() : [],
      cmPlaceholder(this._t(language ? mode + "Placeholder" : "placeholder")),
      EditorView.contentAttributes.of({
        "aria-label": this._t("codeModes")[mode] || "",
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
      }),
    ];
  }

  _getCode() {
    return this._codeView.state.doc.toString();
  }

  /** Replace the code without it counting as typing. */
  _setCode(code) {
    const view = this._codeView;
    if (view.state.doc.toString() === code) return;
    this._settingCode = true;
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: code },
        effects: setErrorLine.of(null),
      });
    } finally {
      this._settingCode = false;
    }
  }

  _showCodeError(message, line) {
    this._errorEl.textContent = this._t("parseError") + message;
    this._errorEl.style.display = "block";
    this._codeView.dispatch({ effects: setErrorLine.of(line ?? null) });
  }

  _clearCodeError() {
    this._errorEl.style.display = "none";
    this._codeView.dispatch({ effects: setErrorLine.of(null) });
  }

  /**
   * A structogram is written in one language, and the texts in its blocks
   * are that language's — `i++`, `int x = 1`. Nothing translates them, so
   * moving to another language starts over, after asking. Hiding the code
   * ("No code") or picking a language for an empty diagram just happens.
   */
  _switchCodeMode(mode) {
    this._dismissLanguageNotice();
    // "none" is hiding the code, not a language.
    if (mode === "none") {
      this.codeHidden = true;
      this._emitChange();
      return;
    }
    if (mode === this.codeLanguage) return;
    // Whatever was typed but not yet read belongs to the mode it was typed in.
    if (this._debounceTimer) this._syncPseudocodeToTree();
    const from = this._codeLanguage;
    if (from && from !== mode && !this._isEmpty()) {
      this._askLanguageSwitch(mode);
      return;
    }
    this._setLanguage(mode);
    this._emitChange(); // the language is part of the saved document
  }

  /** Another language; the code stays hidden or shown as it was. */
  _setLanguage(mode) {
    const hidden = this.codeHidden;
    this._codeLanguage = mode;
    this.codeMode = mode;
    if (hidden) this.setAttribute("hide-code", "");
  }

  _isEmpty() {
    const first = this._tree?.followElement;
    return !first || first.type === "Placeholder";
  }

  /** "Python starts a new, empty structogram … [Start new] [Cancel]", under the select. */
  _askLanguageSwitch(mode) {
    const notice = document.createElement("div");
    notice.className = "notice";
    notice.setAttribute("role", "alert");
    const text = document.createElement("div");
    text.textContent = this._t("switchLanguage").replace("{lang}", this._t("codeModes")[mode]);
    const actions = document.createElement("div");
    actions.className = "actions";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "danger";
    confirm.textContent = this._t("switchLanguageConfirm");
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = this._t("cancel");
    actions.append(confirm, cancel);
    notice.append(text, actions);

    confirm.addEventListener("click", () => {
      this._dismissLanguageNotice();
      this._tree = ensureIds({
        id: "__root",
        type: "InsertNode",
        followElement: { type: "Placeholder" },
      });
      // A structogram in another language, not an edit of this one.
      this._resetHistory();
      this._codeFrame = null;
      this._setLanguage(mode);
      this._render();
      this._syncTreeToPseudocode();
      this._emitChange();
      // Done with the settings: straight to writing the new structogram.
      this._toggleViewPopover(false);
      this._codeView.focus();
    });
    cancel.addEventListener("click", () => {
      this._dismissLanguageNotice();
      this._codeModeSelect?.focus();
    });

    this._languageNotice = notice;
    this._viewPopover.appendChild(notice);
    confirm.focus();
  }

  _dismissLanguageNotice() {
    if (!this._languageNotice) return;
    this._languageNotice.remove();
    this._languageNotice = null;
    // The select shows what was picked; put it back to what is in force.
    if (this._codeModeSelect) this._codeModeSelect.value = this.codeLanguage;
  }

  /** The tree as text in the current code mode. */
  _treeToCode() {
    const mode = this.codeMode;
    if (mode === "none") return "";
    if (mode === "pseudocode") return treeToPseudocode(this._tree, this._getKeywords());
    const frame = this._codeFrame;
    // Back inside the student's program, at the indentation it had.
    return wrapInFrame(generateCode(this._tree, mode), frame?.lang === mode ? frame : null);
  }

  /** Text in the current code mode as a tree. */
  _codeToTree(code) {
    return this._readCode(code, this.codeMode);
  }

  /* ── Pseudocode sync ────────────────────────────────────── */

  _syncTreeToPseudocode() {
    if (this._syncing) return;
    // Hidden code is brought up to date when it is shown again.
    if (this.codeMode === "none") {
      this._codeNeedsSync = true;
      return;
    }
    this._syncing = true;
    try {
      this._setCode(this._treeToCode());
      this._codeTextLanguage = this.codeMode;
      this._codeNeedsSync = false;
      this._clearCodeError();
    } catch (e) {
      // ignore serialization errors
    }
    this._syncing = false;
  }

  _onPseudocodeInput() {
    this._codeTextLanguage = this.codeMode;
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._syncPseudocodeToTree(), 600);
  }

  _syncPseudocodeToTree() {
    if (this._syncing) return;
    this._syncing = true;
    clearTimeout(this._debounceTimer);
    this._debounceTimer = null;
    // With no code shown, there is nothing typed to read back.
    if (this.codeMode === "none") {
      this._syncing = false;
      return;
    }
    try {
      const code = this._getCode();
      if (!code.trim()) {
        this._syncing = false;
        return;
      }
      const newTree = this._prepTree(this._codeToTree(code));
      // Pseudocode writes column widths down; real code has no place for them.
      if (this.codeMode !== "pseudocode") carryOverColumnWidths(this._tree, newTree);
      this._pushHistory();
      this._tree = newTree;
      this._clearCodeError();
      this._render();
      this._emitChange();
    } catch (e) {
      this._showCodeError(e.message, e.line);
    }
    this._syncing = false;
  }

  /* ── Change handling ────────────────────────────────────── */

  /** Only how the diagram looks changed: the code stays as it is. */
  _onViewChange() {
    this._render();
    this._emitChange();
  }

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
    this._codeFrame = null;
    // A different document, not an edit to this one — undoing back across it
    // would put the user in a structogram they never opened.
    this._resetHistory();
    this._render();
    this._syncTreeToPseudocode();
    this._emitChange();
  }

  /**
   * Back to the structogram the element started with — its code, pseudocode
   * or JSON <script>, else its `src`, else an empty one — and the code that
   * goes with it. The undo history goes too: the original is a fresh start.
   * Fires "reset", so a host that keeps the student's work can drop it, and
   * "change" with the restored tree.
   */
  reset() {
    this._tree = null;
    this._codeFrame = null;
    this._codeTextLanguage = null;
    this._codeNeedsSync = false;
    this._resetHistory();
    // _initialize() announces a tree it reads from a <script>, but not an
    // empty one; one from `src` arrives later, through fromDocument().
    let announced = false;
    const onChange = () => (announced = true);
    this.addEventListener("change", onChange);
    this._initialize();
    this.removeEventListener("change", onChange);
    if (this._tree && !announced) this._emitChange();
    this.dispatchEvent(new CustomEvent("reset", { bubbles: true }));
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
    const svg = renderStructogramSVG(this._tree, {
      width,
      fontSize,
      colorMode,
      keywords: this._getKeywords(),
      functionStyle: this._functionStyle(),
    });
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
  parseJava,
  parseJavaScript,
  parsePython,
  generateCode,
  treeToPseudocode,
  KEYWORDS_DE,
  KEYWORDS_EN,
};
export default StruktolabEditor;
