---
"struktolab": minor
"struktolab-studio": minor
"web": minor
---

Add StruktoLab Studio, a VS Code extension that opens `.struktolab` files as a
structogram instead of as JSON, and split the repository into a pnpm workspace to
make room for it: the component library moves to `packages/struktolab`, the web app
to `platforms/web`, and the extension lives in `platforms/vscode`.

The editor gains an `embedded` attribute for hosts that own the file — it hides the
Save/Load buttons and turns PNG/SVG export into an `export-image` event — and a
shared document envelope (`serializeDocument`, `applyDocument`) so a structogram
moves between a file and a shared URL unchanged.
