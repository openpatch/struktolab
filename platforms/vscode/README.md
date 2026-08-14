# StruktoLab Studio

Draw Nassi-Shneiderman structograms in VS Code. Open any `.struktolab` file and it
opens as a diagram instead of as JSON.

![The StruktoLab editor](icon.png)

## What it does

- **A visual editor for `.struktolab` files.** Hover the seam between two nodes and
  click the `+` to insert a statement, branch, case, loop, function or try/catch.
  Each node carries its own move and delete buttons; double-click one to rename it.
- **Pseudocode alongside the diagram.** The text and the diagram stay in sync, so you
  can type a whole structogram out and watch it draw itself, in German or English.
- **Generated code.** Open the structogram as Python, Java or JavaScript in a tab
  beside it, or copy it straight to the clipboard.
- **Export.** PNG and SVG land next to the file.
- **Keyboard and screen reader.** `Tab` into the diagram, arrows to move, `Enter`
  to edit, `+` to insert, `Delete` to remove. Every node announces itself.

The file is an ordinary JSON document, so the tab's dirty marker, `Ctrl+S`, undo and
redo, and Git diffs all behave exactly as they do for source code.

## Commands

| Command | What it does |
| --- | --- |
| **StruktoLab: New Structogram** | Ask for a name and create an empty `.struktolab` in the workspace |
| **StruktoLab: Show Source** | Open the current structogram as JSON |
| **StruktoLab: Show Structogram** | Go back to the diagram |
| **StruktoLab: Open Generated Code** | Open the Python / Java / JavaScript beside the diagram |
| **StruktoLab: Copy Generated Code** | Put the generated code on the clipboard |

`Show Source`, `Show Structogram` and `Open Generated Code` also sit in the editor
title bar whenever a `.struktolab` file is open.

Undo is VS Code's own: the diagram writes into the document, so `Ctrl+Z` walks
back through your edits the way it does in any other file.

## The file format

```json
{
  "version": 2,
  "model": { "type": "TaskNode", "text": "max = a[1]", "followElement": null },
  "settings": { "lang": "de", "fontSize": "14", "colorMode": "color", "scale": "1" }
}
```

`model` is the structogram itself; `settings` remembers how it was being looked at.
This is the same envelope [struktolab.openpatch.org](https://struktolab.openpatch.org)
packs into a shareable URL, so a structogram moves between the two freely. A file
holding nothing but a bare model tree — what older StruktoLab versions downloaded as
`structogram.json` — opens fine too.

## Built on

The [`struktolab`](https://www.npmjs.com/package/struktolab) web component, which you
can also embed in your own page. Source at
[github.com/openpatch/struktolab](https://github.com/openpatch/struktolab).

## License

MIT
