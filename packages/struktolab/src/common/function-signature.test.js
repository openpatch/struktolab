import assert from "node:assert/strict";
import { test } from "node:test";
import { parseJava, parseJavaScript } from "./brace-parser.js";
import { parsePython } from "./python-parser.js";
import { generateCode } from "./code-generator.js";
import { KEYWORDS_DE, parsePseudocode } from "./pseudocode-parser.js";
import { treeToPseudocode } from "./tree-to-pseudocode.js";
import { stripInsertNodes } from "./tree-ops.js";
import { functionHeader, parseFunctionHeader, toParameters } from "./function-signature.js";

const fn = (tree) => stripInsertNodes(tree);
const params = (node) => node.parameters.map((p) => p.parName);

test("a header is one line in its language's order", () => {
  const java = { text: "max", returnType: "int", parameters: toParameters(["int a", "int b"]) };
  assert.equal(functionHeader(java, "java"), "int max(int a, int b)");
  const py = { text: "max", returnType: "int", parameters: toParameters(["a: int", "b: int"]) };
  assert.equal(functionHeader(py), "max(a: int, b: int) -> int");
  assert.equal(functionHeader({ text: "tick", parameters: [] }), "tick()");

  assert.deepEqual(parseFunctionHeader("static Map<String, Integer> zaehle(List<String> w, int n)", "java"), {
    name: "zaehle",
    parameters: ["List<String> w", "int n"],
    returnType: "static Map<String, Integer>",
  });
  assert.deepEqual(parseFunctionHeader("void main(String[] args)", "java"), {
    name: "main", parameters: ["String[] args"], returnType: "void",
  });
  assert.deepEqual(parseFunctionHeader("max(a: int, b: int = 2) -> int"), {
    name: "max", parameters: ["a: int", "b: int = 2"], returnType: "int",
  });
  assert.deepEqual(parseFunctionHeader("start"), { name: "start", parameters: [], returnType: "" });
});

test("Java keeps its header as written", () => {
  const tree = fn(parseJava("static int max(int a, int b) { return a; }\nstatic void p() { }"));
  assert.equal(tree.returnType, "int");
  assert.deepEqual(params(tree), ["int a", "int b"]);
  assert.equal(tree.followElement.returnType, "void");
  // Modifiers are written back as they were; a method without any stays without.
  assert.match(generateCode(parseJava("static int max(int a, int b) { return a; }"), "java"), /^static int max\(int a, int b\) \{/);
  assert.match(generateCode(parseJava("void p() { x(); }"), "java"), /^void p\(\) \{/);
});

test("Python keeps its header as written", () => {
  const tree = fn(parsePython("def f(a: int, b: int = 2) -> int:\n    return a"));
  assert.equal(tree.returnType, "int");
  assert.deepEqual(params(tree), ["a: int", "b: int = 2"]);
  assert.equal(
    generateCode(parsePython("def f(a: int) -> int:\n    return a"), "python"),
    "def f(a: int) -> int:\n    return a\n",
  );
});

test("JavaScript has no return types", () => {
  const tree = fn(parseJavaScript("function f(a, b = 2) { return a }"));
  assert.equal(tree.returnType, undefined);
  assert.deepEqual(params(tree), ["a", "b = 2"]);
});

test("pseudocode: funktion name(params) -> type:", () => {
  const code = "funktion max(a: Zahl, b: Zahl) -> Zahl:\n    ergebnis = a";
  const tree = parsePseudocode(code, KEYWORDS_DE);
  assert.equal(fn(tree).returnType, "Zahl");
  assert.equal(treeToPseudocode(tree, KEYWORDS_DE), code);
});
