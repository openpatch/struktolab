# StruktoLab

A free, web-based structogram (Nassi-Shneiderman diagram) editor with automatic code generation. Built entirely with web components — no framework dependencies.

## Features

- 📝 Bidirectional pseudocode editing (visual ↔ text)
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
<script src="struktolab-editor.js"></script>

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

// Listen for changes
editor.addEventListener('change', (e) => {
  console.log('Tree changed:', e.detail.tree);
});
```

### `<struktolab-renderer>`

Read-only SVG renderer for displaying structograms.

```html
<script src="struktolab-renderer.js"></script>

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

### Prerequisites

- Node.js (v14+)
- npm

### Setup

```bash
git clone https://github.com/openpatch/struktolab.git
cd struktog
npm install
```

### Dev Server

```bash
npm run dev
```

### Production Build

```bash
# App (index.html + bundled editor)
npm run build

# Component libraries (UMD + ES modules)
npm run build:renderer
npm run build:editor

# All at once
npm run build:all
```

Outputs:
- `build/` — app with `index.html`
- `dist/renderer/` — `struktolab-renderer.umd.js` / `.es.js`
- `dist/editor/` — `struktolab-editor.umd.js` / `.es.js`

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
