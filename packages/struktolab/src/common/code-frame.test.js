import assert from "node:assert/strict";
import { test } from "node:test";
import { parseJava, parseJavaScript } from "./brace-parser.js";
import { parsePython } from "./python-parser.js";
import { generateCode } from "./code-generator.js";
import { wrapInFrame } from "./parse-common.js";
import { editText } from "./tree-ops.js";

/** The id of the first block with this text or type. */
function idOf(tree, match) {
  for (let n = tree; n; n = n.followElement) {
    if (n.type !== "InsertNode" && (n.text === match || n.type === match)) return n.id;
  }
  throw new Error("no block " + match);
}

/** What the editor does after a diagram edit: generate, put back in the frame. */
const regenerate = (tree, lang, frame) => wrapInFrame(generateCode(tree, lang), frame);

const JAVA = `import java.util.Scanner;

public class Summe {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        int summe = 0;
        for (int i = 1; i <= n; i++) {
            summe = summe + i;
        }
        System.out.println("Summe: " + summe);
    }
}
`;

test("Java: unchanged blocks come back as the student's program", () => {
  const tree = parseJava(JAVA);
  assert.equal(regenerate(tree, "java", tree._frame), JAVA);
});

test("Java: an edited block changes, the program around it stays", () => {
  const tree = parseJava(JAVA);
  const edited = editText(tree, idOf(tree, "int summe = 0"), "int summe = 1");
  const code = regenerate(edited, "java", tree._frame);
  assert.equal(code, JAVA.replace("int summe = 0;", "int summe = 1;"));
});

test("Java: an edited input block is generated anew, an untouched one is kept", () => {
  const tree = parseJava(JAVA);
  const edited = editText(tree, idOf(tree, "InputNode"), "zahl");
  const code = regenerate(edited, "java", tree._frame);
  assert.match(code, /^ {8}zahl = IO\.readln\(\);$/m);
  assert.match(code, /^ {8}System\.out\.println\("Summe: " \+ summe\);$/m);
});

test("Java: several methods keep their class and static", () => {
  const src = `public class M {
    static int max(int a, int b) {
        if (a > b) {
            return a;
        } else {
            return b;
        }
    }

    public static void main(String[] args) {
        System.out.println(max(1, 2));
    }
}
`;
  const tree = parseJava(src);
  assert.equal(regenerate(tree, "java", tree._frame), src);
});

test("Python: imports, def main and __main__ stay", () => {
  const src = `import math

def main():
    n = int(input("n: "))
    print(math.sqrt(n))

if __name__ == "__main__":
    main()
`;
  const tree = parsePython(src);
  assert.equal(regenerate(tree, "python", tree._frame), src);
});

test("JavaScript: code around the statements stays", () => {
  const src = `"use strict"
// Summe
let s = 0;
for (const x of werte) {
    s += x;
}
console.log(s);
`;
  const tree = parseJavaScript(src);
  assert.equal(regenerate(tree, "javascript", tree._frame), src);
});

test("one-line methods get their blocks on lines of their own", () => {
  const tree = parseJava("class A { void f() { x(); } }");
  assert.equal(regenerate(tree, "java", tree._frame), "class A {\n    void f() {\n        x();\n    }\n}");
});

test("inline code loses the page's blank lines and indentation, keeps its own", async () => {
  const { inlineSource } = await import("./parse-common.js");
  assert.equal(inlineSource("\n    for i in x:\n        print(i)\n  \n"), "for i in x:\n    print(i)\n");
});
