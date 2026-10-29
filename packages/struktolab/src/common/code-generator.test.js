import assert from "node:assert/strict";
import { test } from "node:test";
import { generateCode } from "./code-generator.js";
import { KEYWORDS_EN, parsePseudocode } from "./pseudocode-parser.js";

const python = (code) => generateCode(parsePseudocode(code, KEYWORDS_EN), "python");

test("indents the break of a nested foot loop in Python", () => {
  const code = "function f(n):\n    repeat:\n        n = n - 1\n    while n > 0";
  assert.equal(
    python(code),
    "def f(n):\n    while True:\n        n = n - 1\n        if not n > 0:\n            break\n",
  );
});
