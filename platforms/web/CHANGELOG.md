# web

## 0.5.10

### Patch Changes

- Updated dependencies [9ba7579]
  - struktolab@0.10.1

## 0.5.9

### Patch Changes

- Updated dependencies [36b0a4e]
  - struktolab@0.10.0

## 0.5.8

### Patch Changes

- eff0f64: The documentation lists all of the editor's attributes — `scale`, `color-mode`, `code-mode`, `hide-code` and `embedded` were missing — with an example of a Java structogram whose code is hidden, the code properties (`codeLanguage`, `codeHidden`) and what a shared link's settings hold.

## 0.5.7

### Patch Changes

- Updated dependencies [83026b8]
- Updated dependencies [9e6096e]
  - struktolab@0.9.0

## 0.5.6

### Patch Changes

- Updated dependencies [e451129]
  - struktolab@0.8.1

## 0.5.5

### Patch Changes

- Updated dependencies [40b6f30]
  - struktolab@0.8.0

## 0.5.4

### Patch Changes

- Updated dependencies [21daee0]
  - struktolab@0.7.0

## 0.5.3

### Patch Changes

- 91d4e00: - Draw the editor toolbar icons (and the website's share button) as inline SVG instead of emoji, so they look the same on every system.
  - Label the branch in the language of the structogram.
  - Keep an index at the end of a condition when parsing pseudocode.
  - Indent the `break` of a nested foot loop in generated Python.
- Updated dependencies [91d4e00]
  - struktolab@0.6.3

## 0.5.2

### Patch Changes

- Updated dependencies [38fff6b]
  - struktolab@0.6.2

## 0.5.1

### Patch Changes

- Updated dependencies [89f5590]
  - struktolab@0.6.1

## 0.5.0

### Minor Changes

- 21aaf82: Add StruktoLab Studio, a VS Code extension that opens `.struktolab` files as a
  structogram instead of as JSON, and split the repository into a pnpm workspace to
  make room for it: the component library moves to `packages/struktolab`, the web app
  to `platforms/web`, and the extension lives in `platforms/vscode`.

  The editor gains an `embedded` attribute for hosts that own the file — it hides the
  Save/Load buttons and turns PNG/SVG export into an `export-image` event — and a
  shared document envelope (`serializeDocument`, `applyDocument`) so a structogram
  moves between a file and a shared URL unchanged.

### Patch Changes

- Updated dependencies [21aaf82]
- Updated dependencies [21aaf82]
  - struktolab@0.6.0
