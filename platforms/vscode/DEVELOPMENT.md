# Developing StruktoLab Studio

## Architecture

The extension is two programs that never share memory.

```
platforms/vscode/src/
├── extension.ts                 the extension host (Node): commands, registration
├── StruktogramEditorProvider.ts the bridge: TextDocument <-> webview
├── webview.ts                   the webview (browser): <struktolab-editor>
└── webview.css                  the webview's chrome; the editor styles itself
```

`scripts/build-vscode.mjs` at the repo root esbuilds both halves — the host as
CJS for Node, the webview as an IIFE for the browser, with every asset inlined as
a `data:` URI because the webview's content security policy allows no other
source. The webview bundles the `struktolab` package from `packages/`, so **build
the library first**; `pnpm -r build` does that in topological order.

## The document is the source of truth

`StruktogramEditorProvider` implements `CustomTextEditorProvider`, not
`CustomEditorProvider`. The `.struktolab` file stays a `TextDocument` that the
webview writes into, and everything a user expects from a file — the dirty dot,
`Ctrl+S`, undo, redo, Git integration — is VS Code's own behaviour rather than
something this extension reimplements.

Two pieces of that are not obvious:

**Echo suppression.** Writing to the document raises `onDidChangeTextDocument`,
which would push the text straight back into the webview and reload it — losing
the user's undo history and whatever they had selected mid-drag. `ownEdit` holds
the exact text the provider last wrote, and a change carrying it is dropped.

**The save handshake.** Edits are debounced 250ms in the webview, so at the
moment of `Ctrl+S` the newest keystroke may still be in flight.
`onWillSaveTextDocument` therefore posts `{type:"flush"}` and hands the answer to
`e.waitUntil(...)` as a `TextEdit` — the sanctioned way to amend a document on
its way to disk. It gives up after 500ms rather than blocking the save if the
webview is wedged.

## Message protocol

| Direction | Message | Meaning |
| --- | --- | --- |
| webview → host | `ready` | The webview is mounted; send it the document |
| webview → host | `edit` | The structogram changed (debounced 250ms) |
| webview → host | `flushed` | Answer to `flush` — the newest structogram |
| webview → host | `exportImage` | A PNG/SVG blob, base64, to write to disk |
| host → webview | `update` | The document's text; whatever is in the file wins |
| host → webview | `flush` | A save is waiting on the pending debounce |

The webview sets `applying` while pushing an `update` into the editor, because
`loadJSON` fires `change` like any other edit and the update would otherwise come
straight back as an edit of its own.

## What the component does differently when embedded

`<struktolab-editor embedded>` (see `packages/struktolab/src/editor/struktolab-editor.js`):

- The **Save/Load** toolbar buttons are hidden. They move a file around, which is
  the host's job here.
- The **Undo/Redo** buttons are hidden and `Ctrl+Z` is left unbound. The component
  has its own history stack, but here the document is the source of truth and VS
  Code's undo already walks it; two stacks fighting over `Ctrl+Z` is worse than
  either alone.
- **PNG/SVG** dispatch an `export-image` event carrying the blob instead of
  triggering a browser download, since a webview cannot hand the user a file. The
  provider offers a save dialog next to the structogram and writes it.

## Generating code without the webview

`struktolab/core` is a DOM-free build of the parser, the code generator and the
tree operations, so the extension host can generate Python/Java/JavaScript
straight from the document text — no round-trip to the webview, and it works on a
`.struktolab` opened as source with no diagram in sight. Importing
`struktolab/editor` there instead would try to register a custom element and need
a browser to do it.

## Working on it

```sh
pnpm install
pnpm build                             # the library first, then everything else
pnpm --filter struktolab-studio watch  # rebuild on change
```

Then F5 in this folder ("Run Extension") and open `example.struktolab` in the
development host window. The webview does not hot-reload: after a rebuild, run
**Developer: Reload Window** in the development host.

## Releasing

Changesets owns the version. `pnpm changeset` at the repo root, then merging the
"Version Packages" pull request publishes the npm package and pushes the `.vsix`
to both the Marketplace (`VSCE_TOKEN`) and Open VSX (`OVSX_TOKEN`).

To build one locally:

```sh
pnpm --filter struktolab-studio vscode:package
```

## Known gaps

- No JSON schema for `.struktolab`, so "Show Source" gives no completion.
- The `browser` entry in `package.json` points at the Node build, so the
  extension is optimistically declared web-compatible; `extension.ts` uses
  `Buffer`, which vscode.dev does not have.
- `--watch` does not re-run the library build; run `pnpm --filter struktolab build`
  after changing the component.
