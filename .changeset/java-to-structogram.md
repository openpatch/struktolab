---
"struktolab": minor
---

Write Java, Python or JavaScript and get the structogram.

- The code area under the diagram can be written in Pseudocode, Java, Python or JavaScript, or hidden ("No code"). Pick the language under View → Code or with the `code-mode` attribute. Code and diagram stay in sync both ways: typing builds the diagram, editing the diagram rewrites the code. The choice is saved in documents and shared links.
- The code area is a CodeMirror editor with line numbers, syntax highlighting, auto-indent and bracket matching. A syntax error — a missing `;` or `:`, an unclosed bracket or string, wrong indentation — is shown in German or English with its line, the line is marked, and the last good diagram stays. CodeMirror is bundled into the editor build, so embedding still needs no extra dependencies.
- Java: a whole class, loose methods or statements. A program that is only `main` shows main's body; imports, annotations and `Scanner` setup are left out. `System.out.println` → output, `x = sc.nextInt()` (also `nextLine`, `readLine`, `Integer.parseInt(…)`, `JOptionPane.showInputDialog`) → input.
- JavaScript: semicolons optional; `function` declarations and `const f = (…) => {…}` become function blocks, class methods too. `console.log`/`alert` → output, `x = prompt(…)` (also wrapped in `Number(…)`, `parseInt(…)`) → input. `for…of` → "x in list".
- Python: if/elif/else, while (and `while True: … if not c: break` as do-while), for, def, class, try/except/finally, match/case. `print(…)` → output, `x = int(input(…))` → input, `range(a, b)` → "i = a bis b - 1". `if __name__ == "__main__":` and a lone `main()` are unwrapped.
- Count loops: `for (int i = 0; i < n; i++)` → "i = 0 bis n - 1"; for-each loops → "x in list", which the Java and JavaScript generators now write as for-each loops again.
- New API: `code-mode` attribute, `editor.codeMode`, `editor.loadCode(code, lang)`, `<script type="text/plain" data-code="java|python|javascript">` content; `parseJava`, `parseJavaScript`, `parsePython` and `CodeParseError` in `struktolab/core`.
- The web app no longer shows a separate code panel; pick the language in the editor instead.
- One language at a time: a structogram is written in Pseudocode, Java, Python or JavaScript, and its blocks keep that language's text. Nothing is translated. Switching an empty structogram to another language just happens; with blocks in it, the editor says the other language starts a new, empty structogram and asks first. "No code" only hides the code.
- Functions have an optional return type. The header is kept as written and edited as one line in its language's order: `int max(int a, int b)` in Java, `max(a: int, b: int) -> int` in Python and pseudocode (`funktion max(a, b) -> int:`), `max(a, b)` in JavaScript. Editing the header in the diagram now changes the parameters too. `renderStructogramSVG` takes a `functionStyle` option ("arrow" or "java").
- The "+" places are no longer shown at all times: only an empty diagram keeps one. Empty branches, cases and loop bodies stay quiet until a block is being placed or moved, and the strip under the diagram is gone; each block's "+" and the palette do the adding.
