# StruktoLab

A free, web-based structogram (Nassi-Shneiderman diagram) editor with automatic code generation. Built entirely with web components — no framework dependencies.

## Features

- 📝 Bidirectional pseudocode editing (visual ↔ text)
- ↩️ Undo and redo
- ⌨️ Keyboard and screen reader access; works with mouse, pen and touch
- 🌍 German and English pseudocode support
- 💻 Code generation for Python, Java, and JavaScript
- 💾 Save/Load as JSON
- 🖼 Export as PNG or SVG image
- 🔗 Shareable URLs (state compressed in URL hash, compatible with [struktolab.openpatch.org](https://struktolab.openpatch.org))
- 📦 Web components — embed anywhere with zero dependencies

## Web Components

### `<struktolab-editor>`

Full-featured visual editor with toolbar, pseudocode sync, and import/export.

```html
<script src="https://cdn.jsdelivr.net/npm/struktolab/dist/editor/struktolab-editor.umd.min.js"></script>

<!-- Empty editor -->
<struktolab-editor font-size="14"></struktolab-editor>

<!-- With German pseudocode -->
<struktolab-editor font-size="14">
  <script type="text/pseudocode">
    eingabe("Zahl n")
    ergebnis = 1
    wiederhole für i = 1 bis n:
        ergebnis = ergebnis * i
    ausgabe(ergebnis)
  </script>
</struktolab-editor>

<!-- With English pseudocode -->
<struktolab-editor font-size="14" lang="en">
  <script type="text/pseudocode">
    input("number n")
    result = 1
    repeat for i = 1 to n:
        result = result * i
    output(result)
  </script>
</struktolab-editor>

<!-- From JSON -->
<struktolab-editor font-size="14">
  <script type="application/json">
    { "type": "TaskNode", "text": "x = 42" }
  </script>
</struktolab-editor>
```

#### Attributes

| Attribute   | Description                        | Default |
|-------------|------------------------------------|---------|
| `width`     | Fixed width in pixels              | auto    |
| `font-size` | Font size in pixels                | `14`    |
| `lang`      | Pseudocode language (`de` or `en`) | `de`    |
| `src`       | URL to a JSON tree file            | —       |
| `color-mode` | Color mode (`color`, `bw`)       | `color` |
| `embedded`  | The host owns the file: hides Save/Load, and PNG/SVG raise `export-image` instead of downloading | off |

#### JavaScript API

```js
const editor = document.querySelector('struktolab-editor');

// Get/set tree
editor.tree = { type: "TaskNode", text: "hello" };
console.log(editor.tree);

// Pseudocode
editor.pseudocode = 'eingabe("Zahl n")';

// Code generation
editor.toCode('python');    // → Python code
editor.toCode('java');      // → Java code
editor.toCode('javascript'); // → JavaScript code

// Save/Load JSON (clean, no internal IDs)
const json = editor.saveJSON();
editor.loadJSON(json);

// Export image
const pngBlob = await editor.exportImage('png');
const svgBlob = await editor.exportImage('svg');

// Programmatic update
editor.change({ type: "TaskNode", text: "updated" });

// Undo / redo
editor.undo();
editor.redo();
editor.canUndo;  // → boolean
editor.canRedo;

// Listen for changes
editor.addEventListener('change', (e) => {
  console.log('Tree changed:', e.detail.tree);
});

// Embedded in a host that owns the file (VS Code, an LMS, ...)
editor.setAttribute('embedded', '');
editor.addEventListener('export-image', (e) => {
  const { format, blob } = e.detail;  // no download happened; it is yours to place
});
```

#### Keyboard and pointers

The diagram is one tab stop; the arrow keys move within it, in reading order.

| Key | Does |
|-----|------|
| `Tab` | Enter the diagram |
| `↑` `↓` `←` `→` | Move to the previous / next node |
| `Home` `End` | First / last node |
| `Enter` or `F2` | Edit the node's text |
| `+` or `Insert` | Insert a node after this one |
| `m` | Pick the node up; arrows choose a slot, `Enter` drops it |
| `Delete` | Remove the node |
| `Escape` | Close the menu, or put a node being moved back down |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo (not bound when `embedded`) |

Every node is exposed as a button with a label like `If/Else: a[i] > max`, so a
screen reader can read the structogram out. Moving and resizing use Pointer
Events, so they work with a mouse, a pen or a finger; touch devices get larger
hit areas automatically.

Editing happens on the diagram rather than in a toolbar. Hovering the seam
between two nodes shows a green bar with a `+`; clicking it opens the type menu
right there. Hovering a node reveals its own two buttons at the top right — a
grip to move it and a `✕` to delete it. An empty structogram shows its one slot
without waiting to be hovered, so there is always a way in.

Moving a node works either way round: drag the grip and a label follows the
pointer while the slot it would land in thickens, or tap the grip and then tap a
slot. The node being carried is outlined, slots inside it are not offered — a
node cannot be dropped into itself — and the diagram does not reflow while you
aim. `Escape` or a press anywhere else puts it back.

The toolbar keeps only what is not node-local: undo/redo, view settings, and
files.

#### Documents

A document is the tree plus the settings it was being viewed with — the envelope
a `.struktolab` file holds and the web app packs into a shareable URL.

```js
import { serializeDocument, applyDocument, emptyDocument } from 'struktolab/editor';

const doc = serializeDocument(editor);
// { version: 2, model: {...}, settings: { lang, fontSize, colorMode, scale } }

applyDocument(editor, doc);      // → true when a model was loaded
applyDocument(editor, bareTree); // a plain tree works too, for older files
```

### `struktolab/core`

The same parsing, code generation and tree operations with no DOM behind them,
for Node — a build script, a server, a VS Code extension host.

```js
import { generateCode, parsePseudocode, treeToPseudocode } from 'struktolab/core';

generateCode(model, 'python');
```

### `<struktolab-renderer>`

Read-only SVG renderer for displaying structograms.

```html
<script src="https://cdn.jsdelivr.net/npm/struktolab/dist/renderer/struktolab-renderer.umd.min.js"></script>

<struktolab-renderer font-size="14">
  <script type="text/pseudocode">
    falls x > 0:
        ausgabe("positiv")
    sonst:
        ausgabe("nicht positiv")
  </script>
</struktolab-renderer>
```

Same attributes and tree format as the editor.

## Shareable URLs

StruktoLab supports shareable URLs with the structogram state compressed in the URL hash using pako (zlib). This is compatible with existing URLs from [struktolab.openpatch.org](https://struktolab.openpatch.org).

Example:
```
https://example.com/#pako:eNqlkstuE0EQRf-l166kH9Ov2UaJ...
```

The state is updated automatically as you edit.

## Development

This package lives in a pnpm workspace alongside the web app and the VS Code
extension that consume it.

### Prerequisites

- Node.js 22+
- pnpm 9+

### Setup

```bash
git clone https://github.com/openpatch/struktolab.git
cd struktolab
pnpm install
```

### Build

```bash
pnpm build                          # everything, in dependency order
pnpm --filter struktolab build      # just this package
pnpm --filter struktolab dev        # rebuild the editor on change
```

Outputs:
- `dist/renderer/` — `struktolab-renderer.umd.js` / `.es.js`
- `dist/editor/` — `struktolab-editor.umd.js` / `.es.js`
- `dist/core/` — `struktolab-core.umd.js` / `.es.js` (no DOM)

The web app is in `platforms/web` (`pnpm --filter web dev`), the VS Code extension
in `platforms/vscode`.

## Supported Node Types

| Node | Description |
|------|-------------|
| Task | Simple statement |
| Input | Read input |
| Output | Write output |
| If/Else | Two-way branch |
| Switch/Case | Multi-way branch |
| While | Head-controlled loop |
| Do-While | Foot-controlled loop |
| For | Counter-controlled loop |
| Function | Function definition |
| Try/Catch | Exception handling |

## License

MIT — see [license.md](license.md)

## Credits

Based on the original [structogram editor](https://gitlab.com/dev-ddi/cs-school-tools/struktog) by Didaktik der Informatik, TU Dresden.
