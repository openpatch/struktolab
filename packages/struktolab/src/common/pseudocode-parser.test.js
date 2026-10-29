import assert from "node:assert/strict";
import { test } from "node:test";
import { KEYWORDS_EN, parsePseudocode } from "./pseudocode-parser.js";
import { treeToPseudocode } from "./tree-to-pseudocode.js";

const roundTrip = (code) => treeToPseudocode(parsePseudocode(code, KEYWORDS_EN), KEYWORDS_EN);

test("keeps loops and their bodies", () => {
  const code = 'repeat while x > 0:\n    x = x - 1\noutput("x")';
  assert.equal(roundTrip(code), code);
});

test("keeps the body of a line it does not understand", () => {
  // "while" alone is not a loop ("repeat while" is); its body used to vanish.
  const out = roundTrip('while x > 0:\n    x = x - 1\n    output("x")\ny = 1');
  assert.equal(out, 'while x > 0:\nx = x - 1\noutput("x")\ny = 1');
});

test("keeps an index at the end of a condition", () => {
  const code = "switch notes[0]:\n    case 1:\n        y = 1";
  assert.equal(roundTrip(code), code);
});

test("reads column widths after the condition", () => {
  const tree = parsePseudocode("if a[0] > 1 [0.7, 0.3]:\n    y = 1\nelse:\n    y = 2", KEYWORDS_EN);
  assert.equal(tree.followElement.text, "a[0] > 1");
  assert.deepEqual(tree.followElement.columnWidths, [0.7, 0.3]);
});
