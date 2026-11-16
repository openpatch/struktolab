---
"struktolab": minor
---

The language a structogram is written in and whether its code shows are two settings now. `hide-code` (and `codeHidden`, and "Show code" in View) shows the diagram alone while `code-mode` keeps the language: Java's function headers stay Java's, and the code comes back in that language. `code-mode="none"` still hides the code, and now keeps the language of inline `data-code` too. A saved document stores the language as `codeMode` and `hideCode: true` when hidden; older documents with `codeMode: "none"` still load. `codeLanguage` reads the language, shown or not.
