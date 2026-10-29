# struktolab

## 0.6.3

### Patch Changes

- 91d4e00: - Draw the editor toolbar icons (and the website's share button) as inline SVG instead of emoji, so they look the same on every system.
  - Label the branch in the language of the structogram.
  - Keep an index at the end of a condition when parsing pseudocode.
  - Indent the `break` of a nested foot loop in generated Python.

## 0.6.2

### Patch Changes

- 38fff6b: Keep the indented lines under a line the pseudocode parser does not recognise (e.g. `while x:` instead of `repeat while x:`); they follow it instead of disappearing

## 0.6.1

### Patch Changes

- 89f5590: Translate the editor UI (toolbar, menus, tooltips, screen reader labels) based on the `lang` attribute

## 0.6.0

### Minor Changes

- 21aaf82: Add StruktoLab Studio, a VS Code extension that opens `.struktolab` files as a
  structogram instead of as JSON, and split the repository into a pnpm workspace to
  make room for it: the component library moves to `packages/struktolab`, the web app
  to `platforms/web`, and the extension lives in `platforms/vscode`.

  The editor gains an `embedded` attribute for hosts that own the file — it hides the
  Save/Load buttons and turns PNG/SVG export into an `export-image` event — and a
  shared document envelope (`serializeDocument`, `applyDocument`) so a structogram
  moves between a file and a shared URL unchanged.

- 21aaf82: Six usability changes to the editor.

  - **Undo and redo.** Every structural edit is now reversible, with `Ctrl+Z` /
    `Ctrl+Shift+Z`, toolbar buttons, and `editor.undo()` / `editor.redo()` on the
    component. Deleting a node is no longer a one-way door. Under `embedded` the
    history is left to the host, so VS Code's own undo stack stays in charge.
  - **Touch works.** Moving nodes and dragging column dividers use Pointer Events
    instead of mouse-only handlers, and hit areas grow on coarse pointers, so
    tablets can do everything a mouse can.
  - **Keyboard and screen reader access.** The diagram is one tab stop with arrow
    navigation in reading order, `Enter` to edit, `+` to insert, `Delete` to
    remove, and a visible focus ring. Each node is exposed as a button named like
    `If/Else: a[i] > max`.
  - **Editing moved onto the diagram.** Hovering the seam between two nodes shows a
    green bar with a `+` that opens the type menu right there, and each node
    carries its own move and delete buttons, revealed on hover or focus. The
    toolbar's row of node types and its delete mode are gone entirely; what
    remains is undo/redo, a view-settings popover (language, size, scale, colours)
    and the file actions, on one row that collapses to icons on narrow screens.
  - **Moving a node is a drag.** Dragging the grip sends a label along with the
    pointer and thickens the slot it would land in; tapping the grip and then a
    slot still works, and `m` does it from the keyboard. The node being carried is
    outlined, the diagram no longer grows and slides out from under the pointer
    when a move starts, and `Escape` puts it back.
  - **Fixed: moving a node into itself deleted it.** `moveNode` detached the node
    before looking for the target, so a target inside that node could no longer be
    found and the half-finished move was returned with the node — and everything
    nested in it — gone. It is now a no-op, and those slots are not offered in the
    first place.
  - **Loop headers are translated.** A count loop written `i = 2 bis n` now
    generates `for i in range(2, n + 1)`, `for (int i = 2; i <= n; i++)` and the
    JavaScript equivalent, instead of repeating the German verbatim. Text that is
    not a range is still passed through untouched.
  - **`struktolab/core`**, a new DOM-free entry point exporting the parser, the code
    generator and the tree operations for use in Node.

  In VS Code, `StruktoLab: Open Generated Code` and `Copy Generated Code` turn the
  active structogram into Python, Java or JavaScript.

## 0.5.0

### Minor Changes

- 8c90fd3: Add resizie via mouse dragging
- 9471476: Add button for adding and removing cases

## 0.4.2

### Patch Changes

- 431ec73: Fix editor not accessible

## 0.4.1

### Patch Changes

- c0c5d9f: Fix scale not used in renderer

## 0.4.0

### Minor Changes

- 0e1c655: Add greyscale and black & white option. Also fixed loading of color mode.

## 0.3.0

### Minor Changes

- 61a5162: Renderer can now also use color-mode

## 0.2.0

### Minor Changes

- e31f70a: save all settings to the url

## 0.1.0

### Minor Changes

- 983fcc5: Complete rewrite of the old struktog. There are now two webcomponents, which are using an svg-renderer.
- b99e6e9: Add color mode switcher
