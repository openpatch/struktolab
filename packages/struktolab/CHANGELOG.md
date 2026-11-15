# struktolab

## 0.8.0

### Minor Changes

- 40b6f30: Write Java, Python or JavaScript and get the structogram.

  - The code area under the diagram can be written in Pseudocode, Java, Python or JavaScript, or hidden ("No code"). Pick the language under View → Code or with the `code-mode` attribute. Code and diagram stay in sync both ways: typing builds the diagram, editing the diagram rewrites the code. The choice is saved in documents and shared links.
  - The code area is a CodeMirror editor with line numbers, syntax highlighting, auto-indent and bracket matching. A syntax error — a missing `;` or `:`, an unclosed bracket or string, wrong indentation — is shown in German or English with its line, the line is marked, and the last good diagram stays. CodeMirror is bundled into the editor build, so embedding still needs no extra dependencies.
  - Java: a whole class, loose methods or statements. A program that is only `main` shows main's body; imports, annotations and `Scanner` setup are left out. `IO.println`/`IO.print` (java.lang.IO, Java 25) and `System.out.println` → output; `x = IO.readln(…)`, `x = Integer.parseInt(IO.readln(…))` and the older `x = sc.nextInt()` (also `nextLine`, `readLine`, `JOptionPane.showInputDialog`) → input. A compact source file with just `void main() { … }` works too.
  - Generated Java uses java.lang.IO: `x = IO.readln();` and `IO.println(…)` instead of `System.console().readLine()` and `System.out.println(…)`.
  - JavaScript: semicolons optional; `function` declarations and `const f = (…) => {…}` become function blocks, class methods too. `console.log`/`alert` → output, `x = prompt(…)` (also wrapped in `Number(…)`, `parseInt(…)`) → input. `for…of` → "x in list".
  - Python: if/elif/else, while (and `while True: … if not c: break` as do-while), for, def, class, try/except/finally, match/case. `print(…)` → output, `x = int(input(…))` → input, `range(a, b)` → "i = a bis b - 1". `if __name__ == "__main__":` and a lone `main()` are unwrapped.
  - Count loops: `for (int i = 0; i < n; i++)` → "i = 0 bis n - 1"; for-each loops → "x in list", which the Java and JavaScript generators now write as for-each loops again.
  - New API: `code-mode` attribute, `editor.codeMode`, `editor.loadCode(code, lang)`, `<script type="text/plain" data-code="java|python|javascript">` content; `parseJava`, `parseJavaScript`, `parsePython` and `CodeParseError` in `struktolab/core`.
  - The web app no longer shows a separate code panel; pick the language in the editor instead.
  - One language at a time: a structogram is written in Pseudocode, Java, Python or JavaScript, and its blocks keep that language's text. Nothing is translated. Switching an empty structogram to another language just happens; with blocks in it, the editor says the other language starts a new, empty structogram and asks first. "No code" only hides the code.
  - Functions have an optional return type. The header is kept as written and edited as one line in its language's order: `int max(int a, int b)` in Java, `max(a: int, b: int) -> int` in Python and pseudocode (`funktion max(a, b) -> int:`), `max(a, b)` in JavaScript. Editing the header in the diagram now changes the parameters too. `renderStructogramSVG` takes a `functionStyle` option ("arrow" or "java").
  - The "+" places are no longer shown at all times: only an empty diagram keeps one. Empty branches, cases and loop bodies stay quiet until a block is being placed or moved, and the strip under the diagram is gone; each block's "+" and the palette do the adding.
  - The student's code is kept. Editing the diagram rewrites only the algorithm part and puts it back where it was: imports, the class, `main`'s header, the `Scanner` line, `if __name__ == "__main__":` and comments around it stay. Input and output lines that were not changed keep their exact text (`int n = sc.nextInt();`), Java methods keep their modifiers (`static`), and functions are followed by a blank line. Changing font size, scale or colours, or hiding the code, no longer touches it.
  - Documents and shared links save the code as written (`code: { lang, text }`) and restore it on load, comments and all.
  - `<struktolab-renderer>` reads Java, Python and JavaScript too: `<script type="text/plain" data-code="java|python|javascript">`, the `code-mode` attribute (function headers in that language's order), `loadCode(code, lang)`, and `src` pointing to a saved `.struktolab` document. Code with a syntax error shows the error and its line instead of the diagram.
  - `<struktolab-editor>` gets `toDocument()` and `fromDocument(doc)` to save and restore a student's work with settings and code; `src` loads saved `.struktolab` documents with their settings.
  - Inline code drops the page's surrounding blank lines and shared indentation.
  - Both components wait for the page to be parsed before reading inline code; on a long page they could start before their `<script>` children existed and come up empty.
  - Dragging a block is calmer and more precise. The diagram no longer jumps open when a drag starts; one line shows where the block will land — the upper half of a block means before it, the lower half after it, an empty branch lights up whole. Where nested blocks end on the same line (a branch that is the last block of a loop or of another branch), moving the pointer towards the line steps outwards and the line grows with it; below a branch block is "after the whole branch". The coloured bar of a loop, function or try is part of its body. A block being moved is faded where it is, the dragged block looks like a block, and Escape cancels. Tapping a block and then a place still opens every place as before.
  - Click areas, the buttons on a block, the column resize handles and the faded block while moving now cover a block as it is drawn. Nested branches and loops are stretched to fill their column; the lower part of such a stretched block could not be clicked before. The renderer reports each node's drawn box (`nodeLayout` option of `renderStructogramSVG`).

## 0.7.0

### Minor Changes

- 21daee0: Rework adding nodes in the editor.

  - A block palette under the toolbar: drag a block into the diagram, or pick it and then pick the place. Works the same with mouse, pen, finger and keyboard.
  - While placing or moving, the diagram opens a gap with a "+" block at every place the block can go, so targets are big, never overlap, and sit exactly where the node will land. This also fixes nodes that could not be added at the end of an if/else branch.
  - Empty branches, cases, loop bodies and the end of the diagram show a "+" block at all times; an if/else with two empty branches gets a body to click into.
  - A new node opens its text editor right away; on touch, tapping a selected node again edits it.
  - Every node gets a "+" button to insert after it; a do-while's buttons sit in its footer so they are reachable, and a switch's "+ Case" button no longer overlaps them.
  - Moving a node out of a body no longer leaves a duplicate slot behind.

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
