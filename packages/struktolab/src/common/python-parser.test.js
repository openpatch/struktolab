import assert from "node:assert/strict";
import { test } from "node:test";
import { generateCode } from "./code-generator.js";
import { parsePython } from "./python-parser.js";
import { KEYWORDS_EN } from "./pseudocode-parser.js";
import { treeToPseudocode } from "./tree-to-pseudocode.js";
import { stripInsertNodes } from "./tree-ops.js";

const pseudo = (py) => treeToPseudocode(parsePython(py, { lang: "en" }), KEYWORDS_EN);

test("statements, input, output, range loops", () => {
  const py = `
import math

# Summe der geraden Zahlen
n = int(input("Zahl n: "))
summe = 0
for i in range(1, n + 1):
    if i % 2 == 0:
        summe += i
for x in werte:
    pass
print("Summe:", summe)
print("fertig")`;
  assert.equal(
    pseudo(py),
    [
      'input("n")',
      "summe = 0",
      "repeat for i = 1 to n:",
      "    if i % 2 == 0:",
      "        summe += i",
      "    else:",
      "repeat for x in werte:",
      'output("Summe:", summe)',
      'output("fertig")',
    ].join("\n"),
  );
});

test("elif becomes a branch in the else", () => {
  const tree = stripInsertNodes(parsePython("if a:\n    x = 1\nelif b:\n    x = 2\nelse:\n    x = 3"));
  assert.equal(tree.text, "a");
  assert.equal(tree.falseChild.type, "BranchNode");
  assert.equal(tree.falseChild.text, "b");
  assert.equal(tree.falseChild.falseChild.text, "x = 3");
});

test("while True with a closing if-not-break is a do-while", () => {
  const tree = stripInsertNodes(parsePython("while True:\n    n = n - 1\n    if not n > 0:\n        break"));
  assert.equal(tree.type, "FootLoopNode");
  assert.equal(tree.text, "n > 0");
  assert.equal(tree.child.text, "n = n - 1");
});

test("functions, main unwrapping and __main__", () => {
  const py = `
def main():
    zahl = int(input())
    print(zahl * 2)

if __name__ == "__main__":
    main()`;
  assert.equal(pseudo(py), 'input("zahl")\noutput("zahl * 2")');

  const two = stripInsertNodes(parsePython("def f(a, b=2):\n    return a + b\n\ndef g():\n    return 1"));
  assert.equal(two.type, "FunctionNode");
  assert.deepEqual(two.parameters.map((p) => p.parName), ["a", "b=2"]);
  assert.equal(two.followElement.text, "g");
});

test("try/except/finally and match/case", () => {
  const t = stripInsertNodes(parsePython("try:\n    a()\nexcept ValueError as e:\n    b()\nfinally:\n    c()"));
  assert.equal(t.type, "TryCatchNode");
  assert.equal(t.text, "ValueError e");
  assert.equal(t.followElement.text, "c()");

  const m = stripInsertNodes(parsePython('match tag:\n    case 1 | 7:\n        print("WE")\n    case _:\n        x = 0'));
  assert.equal(m.type, "CaseNode");
  assert.deepEqual(m.cases.map((c) => c.text), ["1, 7"]);
  assert.equal(m.defaultOn, true);
});

test("brackets join lines, one-line bodies", () => {
  assert.equal(pseudo("werte = [\n    1,\n    2,\n]\nif x: y = 1"), "werte = [1, 2,]\nif x:\n    y = 1\nelse:");
});

test("errors name the problem and the line", () => {
  assert.throws(() => parsePython("if x > 0\n    y = 1", { lang: "en" }), /Missing ":" at the end of the "if" line \(line 1\)/);
  assert.throws(() => parsePython("if x:\ny = 1", { lang: "en" }), /must be indented \(line 1\)/);
  assert.throws(() => parsePython("x = 1\n    y = 2", { lang: "en" }), /indented more \(line 2\)|indented more than/);
  assert.throws(() => parsePython("print(1", { lang: "de" }), /„\(“ wird nie geschlossen \(Zeile 1\)/);
  assert.throws(() => parsePython('s = "abc', { lang: "en" }), /String is not closed/);
});

test("the Python generator's output reads back to the same tree", () => {
  const py = "def ggt(a, b):\n    while b != 0:\n        h = a % b\n        a = b\n        b = h\n    print(a)\n\nrepeat = 1";
  const tree = parsePython(py);
  for (const code of [generateCode(tree, "python")]) {
    assert.deepEqual(stripInsertNodes(parsePython(code)), stripInsertNodes(parsePython(py)));
  }
});
