---
"struktolab": minor
"struktolab-studio": minor
---

Six usability changes to the editor.

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
