import assert from "node:assert/strict";
import { test } from "node:test";
import { generateCode } from "./code-generator.js";
import { parseJava } from "./brace-parser.js";
import { KEYWORDS_EN } from "./pseudocode-parser.js";
import { treeToPseudocode } from "./tree-to-pseudocode.js";
import { stripInsertNodes } from "./tree-ops.js";

const pseudo = (java) => treeToPseudocode(parseJava(java, { lang: "en" }), KEYWORDS_EN);

test("a class with only main shows main's body", () => {
  const java = `
    import java.util.Scanner;

    public class Fakultaet {
        public static void main(String[] args) {
            Scanner sc = new Scanner(System.in);
            int n = sc.nextInt(); // read n
            int f = 1;
            for (int i = 2; i <= n; i++) {
                f = f * i;
            }
            System.out.println("Ergebnis: " + f);
        }
    }`;
  assert.equal(
    pseudo(java),
    [
      "input(\"n\")",
      "int f = 1",
      "repeat for i = 2 to n:",
      "    f = f * i",
      'output("Ergebnis: " + f)',
    ].join("\n"),
  );
});

test("several methods become functions", () => {
  const java = `
    class A {
        static int max(int a, int b) {
            if (a > b) { return a; } else { return b; }
        }
        public static void main(String[] args) {
            System.out.println(max(1, 2));
        }
    }`;
  const tree = stripInsertNodes(parseJava(java));
  assert.equal(tree.type, "FunctionNode");
  assert.equal(tree.text, "max");
  assert.deepEqual(tree.parameters.map((p) => p.parName), ["int a", "int b"]);
  assert.equal(tree.child.type, "BranchNode");
  assert.equal(tree.followElement.text, "main");
});

test("loops", () => {
  const java = `
    int i = 0;
    while (i < 10) i++;
    do {
        x--;
    } while (x > 0);
    for (int k = 0; k < 5; k++) sum += k;
    for (int k = 0; k < n; k++) sum += k;
    for (int k = n; k > 0; k--) sum += k;
    for (String s : names) System.out.println(s);
    for (;;) { break; }`;
  assert.equal(
    pseudo(java),
    [
      "int i = 0",
      "repeat while i < 10:",
      "    i++",
      "repeat:",
      "    x--",
      "while x > 0",
      "repeat for k = 0 to 4:",
      "    sum += k",
      "repeat for k = 0 to n - 1:",
      "    sum += k",
      "repeat for int k = n; k > 0; k--:",
      "    sum += k",
      "repeat for s in names:",
      '    output("s")',
      "repeat while true:",
      "    break",
    ].join("\n"),
  );
});

test("else if nests in the else branch", () => {
  const tree = stripInsertNodes(
    parseJava("if (a) x = 1; else if (b) x = 2; else x = 3;"),
  );
  assert.equal(tree.text, "a");
  assert.equal(tree.falseChild.type, "BranchNode");
  assert.equal(tree.falseChild.text, "b");
  assert.equal(tree.falseChild.falseChild.text, "x = 3");
});

test("switch with fall-through, break and default", () => {
  const java = `
    switch (tag) {
        case 1:
        case 7:
            System.out.println("Wochenende");
            break;
        case 2 -> x = 2;
        default:
            x = 0;
    }`;
  const tree = stripInsertNodes(parseJava(java));
  assert.equal(tree.type, "CaseNode");
  assert.deepEqual(tree.cases.map((c) => c.text), ["1, 7", "2"]);
  assert.equal(tree.cases[0].followElement.type, "OutputNode");
  assert.equal(tree.cases[0].followElement.followElement ?? null, null);
  assert.equal(tree.defaultOn, true);
  assert.equal(tree.defaultNode.followElement.text, "x = 0");
});

test("try with two catches and finally", () => {
  const tree = stripInsertNodes(
    parseJava(
      "try { a(); } catch (IOException e) { b(); } catch (Exception e) { c(); } finally { d(); }",
    ),
  );
  assert.equal(tree.type, "TryCatchNode");
  assert.equal(tree.text, "Exception e");
  assert.equal(tree.tryChild.type, "TryCatchNode");
  assert.equal(tree.tryChild.text, "IOException e");
  assert.equal(tree.followElement.text, "d()");
});

test("expressions with braces, lambdas and strings stay one statement", () => {
  const java = `
    int[] a = {3, 1, 2};
    list.forEach(x -> { System.out.println(x); });
    String s = "if (x) { ; }";`;
  assert.equal(
    pseudo(java),
    ["int[] a = {3, 1, 2}", "list.forEach(x -> { System.out.println(x); })", 'String s = "if (x) { ; }"'].join("\n"),
  );
});

test("umlauts in names", () => {
  assert.equal(pseudo("int größe = 3;"), "int größe = 3");
});

test("reports a missing semicolon with its line", () => {
  assert.throws(() => parseJava("int x = 1\nint y = 2;", { lang: "en" }), /Missing ";" after "int x = 1" \(line 1\)/);
  assert.throws(() => parseJava("if (x) {\n  y = 1;\n", { lang: "en" }), /Missing "}"/);
  assert.throws(() => parseJava("void f() {\n  g()\n}", { lang: "en" }), /Missing ";" after "g\(\)" \(line 2\)/);
  assert.throws(() => parseJava("x = 1", { lang: "de" }), /„;“ fehlt nach „x = 1“ \(Zeile 1\)/);
});

test("the Java generator's output reads back to the same tree", () => {
  const java = `
    void ggt(int a, int b) {
        while (b != 0) {
            int h = a % b;
            a = b;
            b = h;
        }
        System.out.println(a);
    }`;
  const tree = parseJava(java);
  const regenerated = generateCode(tree, "java");
  assert.deepEqual(
    stripInsertNodes(parseJava(regenerated)),
    stripInsertNodes(parseJava(java)),
  );
});

test("for-each loops generate for-each loops again", () => {
  const tree = parseJava("for (int x : zahlen) summe += x;");
  assert.match(generateCode(tree, "java"), /for \(var x : zahlen\)/);
  assert.match(generateCode(tree, "python"), /for x in zahlen:/);
});

import { parseJavaScript } from "./brace-parser.js";

const jsPseudo = (js) => treeToPseudocode(parseJavaScript(js, { lang: "en" }), KEYWORDS_EN);

test("JavaScript without semicolons", () => {
  const js = `
"use strict"
const n = Number(prompt("Zahl n"))
let summe = 0
for (let i = 0; i < n; i++) {
  if (i % 2 === 0) summe += i
}
for (const x of werte) console.log(x)
console.log(\`Summe: \${summe}\`)`;
  assert.equal(
    jsPseudo(js),
    [
      'input("n")',
      "let summe = 0",
      "repeat for i = 0 to n - 1:",
      "    if i % 2 === 0:",
      "        summe += i",
      "    else:",
      "repeat for x in werte:",
      '    output("x")',
      'output("`Summe: ${summe}`")',
    ].join("\n"),
  );
});

test("JavaScript functions: declarations, arrows, classes", () => {
  const tree = stripInsertNodes(parseJavaScript(`
export function max(a, b) {
  return a > b ? a : b
}
const twice = (x) => {
  return 2 * x
}
const inc = x => x + 1
class Konto {
  constructor(stand) { this.stand = stand }
  async abheben(betrag) {
    this.stand -= betrag
  }
}`));
  assert.equal(tree.type, "FunctionNode");
  assert.equal(tree.text, "max");
  assert.equal(tree.followElement.text, "twice");
  assert.deepEqual(tree.followElement.parameters.map((p) => p.parName), ["x"]);
  assert.equal(tree.followElement.followElement.text, "const inc = x => x + 1");
  const ctor = tree.followElement.followElement.followElement;
  assert.equal(ctor.text, "constructor");
  assert.equal(ctor.followElement.text, "abheben");
});

test("JavaScript do-while, switch and try", () => {
  const tree = stripInsertNodes(parseJavaScript(`
do { n-- } while (n > 0)
switch (tag) {
  case 1:
  case 7: alert("WE"); break
  default: x = 0
}
try { a() } catch { b() }`));
  assert.equal(tree.type, "FootLoopNode");
  assert.equal(tree.followElement.type, "CaseNode");
  assert.deepEqual(tree.followElement.cases.map((c) => c.text), ["1, 7"]);
  assert.equal(tree.followElement.followElement.type, "TryCatchNode");
});

test("the JavaScript generator's output reads back to the same tree", () => {
  const js = "function f(n) {\n  let s = 0\n  for (const x of n) s += x\n  do { s-- } while (s > 10)\n  console.log(s)\n}";
  const tree = parseJavaScript(js);
  assert.deepEqual(stripInsertNodes(parseJavaScript(generateCode(tree, "javascript"))), stripInsertNodes(tree));
});
