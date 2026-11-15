/**
 * Standalone code generator for struktog trees.
 * Converts a structogram tree to plain-text source code.
 *
 * Supported languages: "python", "java", "javascript"
 */

const TRANSLATIONS = {
  python: {
    InputNode: { pre: "", post: ' = input("Eingabe")\n' },
    OutputNode: { pre: "print(", post: ")\n" },
    TaskNode: { pre: "", post: "\n" },
    BranchNode: { pre: "if ", post: ":\n", between: "else:\n" },
    TryCatchNode: { pre: "try:\n", between: "except ", post: ":\n" },
    CountLoopNode: { pre: "for ", post: ":\n" },
    HeadLoopNode: { pre: "while ", post: ":\n" },
    FootLoopNode: {
      prepre: "while True:\n",
      pre: "if not ",
      post: ":\n",
      postpost: "break\n",
    },
    FunctionNode: { pre: "def ", between: "(", post: "):\n" },
    CaseNode: { pre: "if ", post: ":\n" },
    InsertCase: {
      preNormal: "elif ",
      preDefault: "else",
      post: ":\n",
      postpost: "\n",
    },
    leftBracket: "",
    rightBracket: "",
    pseudoSwitch: true,
  },
  java: {
    // java.lang.IO (Java 25): no Scanner to set up, no System.out to explain.
    InputNode: { pre: "", post: " = IO.readln();\n" },
    OutputNode: { pre: "IO.println(", post: ");\n" },
    TaskNode: { pre: "", post: ";\n" },
    BranchNode: { pre: "if (", post: ")", between: "} else {\n" },
    TryCatchNode: { pre: "try", between: "catch (", post: ")" },
    CountLoopNode: { pre: "for (", post: ")" },
    HeadLoopNode: { pre: "while (", post: ")" },
    FootLoopNode: { prepre: "do", pre: "while (", post: ");\n" },
    FunctionNode: { pre: "public void ", between: "(", post: ")" },
    CaseNode: { pre: "switch (", post: ")" },
    InsertCase: {
      preNormal: "case ",
      preDefault: "default",
      post: ":\n",
      postpost: "break;\n",
    },
    leftBracket: "{",
    rightBracket: "}",
    pseudoSwitch: false,
  },
  javascript: {
    InputNode: { pre: "", post: ' = prompt("Eingabe");\n' },
    OutputNode: { pre: "console.log(", post: ");\n" },
    TaskNode: { pre: "", post: ";\n" },
    BranchNode: { pre: "if (", post: ")", between: "} else {\n" },
    TryCatchNode: { pre: "try", between: "catch (", post: ")" },
    CountLoopNode: { pre: "for (", post: ")" },
    HeadLoopNode: { pre: "while (", post: ")" },
    FootLoopNode: { prepre: "do", pre: "while (", post: ");\n" },
    FunctionNode: { pre: "function ", between: "(", post: ")" },
    CaseNode: { pre: "switch (", post: ")" },
    InsertCase: {
      preNormal: "case ",
      preDefault: "default",
      post: ":\n",
      postpost: "break;\n",
    },
    leftBracket: "{",
    rightBracket: "}",
    pseudoSwitch: false,
  },
};

function indent(level) {
  return "    ".repeat(level);
}

/**
 * A count loop is written as a range in words — "i = 2 bis n", "i = 1 to 10" —
 * and every target language spells that differently. Pull the three parts out
 * so each language can write its own loop header instead of echoing the German.
 *
 * @returns {{variable: string, from: string, to: string} | null}
 */
function parseCountRange(text) {
  const match = /^\s*(\S+)\s*=\s*(.+?)\s+(?:bis|to)\s+(.+?)\s*$/i.exec(text || "");
  if (!match) return null;
  return { variable: match[1], from: match[2].trim(), to: match[3].trim() };
}

/** The loop header for a count loop, without the surrounding brackets. */
function countLoopHeader(text, lang) {
  const range = parseCountRange(text);
  // "x in liste" walks a collection — Python's own spelling, Java's for-each.
  const each = /^\s*([\p{L}_$][\p{L}\p{N}_$]*)\s+in\s+(.+?)\s*$/u.exec(text || "");
  if (!range && each) {
    if (lang === "java") return { header: `var ${each[1]} : ${each[2]}`, wrap: true };
    if (lang === "javascript") return { header: `const ${each[1]} of ${each[2]}`, wrap: true };
  }
  // Anything that is not a range stays exactly as the user wrote it.
  if (!range) return { header: text, wrap: true };

  const { variable, from, to } = range;
  switch (lang) {
    case "python":
      // range() stops one short, so the inclusive end has to be spelled out.
      return { header: `${variable} in range(${from}, ${to} + 1)`, wrap: true };
    case "java":
      return {
        header: `int ${variable} = ${from}; ${variable} <= ${to}; ${variable}++`,
        wrap: true,
      };
    case "javascript":
      return {
        header: `let ${variable} = ${from}; ${variable} <= ${to}; ${variable}++`,
        wrap: true,
      };
    default:
      return { header: text, wrap: true };
  }
}

/** The catch text is written Java-style, "Exception e". */
function catchClause(text, lang) {
  if (lang === "python") {
    const match = /^\s*(\S+)\s+(\w+)\s*$/.exec(text);
    return match ? `${match[1]} as ${match[2]}` : text;
  }
  if (lang === "javascript") {
    const match = /(\w+)\s*$/.exec(text);
    return match ? match[1] : text;
  }
  return text;
}

/**
 * Generate source code from a struktog tree.
 * @param {Object} tree - The struktog tree (root InsertNode)
 * @param {string} lang - Target language: "python", "java", or "javascript"
 * @returns {string} The generated source code
 */
export function generateCode(tree, lang = "python") {
  const t = TRANSLATIONS[lang.toLowerCase()];
  if (!t) {
    throw new Error(
      `Unsupported language: ${lang}. Supported: ${Object.keys(TRANSLATIONS).join(", ")}`,
    );
  }
  return transform(tree, 0, t, lang.toLowerCase()).join("");
}

/** Whether a real block comes after this InsertNode/Placeholder chain link. */
function hasNext(link) {
  let n = link;
  while (n && (n.type === "InsertNode" || n.type === "Placeholder")) n = n.followElement;
  return Boolean(n);
}

function body(node, level, t, lang) {
  const lines = transform(node, level, t, lang);
  if (lines.length === 0 && lang === "python") return [indent(level) + "pass\n"];
  return lines;
}

function transform(node, level, t, lang) {
  if (!node) return [];
  if (node.type === "InsertNode" || node.type === "Placeholder") {
    return transform(node.followElement, level, t, lang);
  }

  const text = node.text || "";
  const lines = [];

  switch (node.type) {
    case "TaskNode":
      lines.push(indent(level) + t.TaskNode.pre + text + t.TaskNode.post);
      break;

    case "InputNode":
    case "OutputNode": {
      // Read from code in this language and not changed since: write it the
      // way the student did — `int n = sc.nextInt();`, not a generic read.
      const o = node.origin;
      if (o && o.lang === lang && o.text === node.text) {
        lines.push(indent(level) + o.code + (lang === "python" ? "" : ";") + "\n");
        break;
      }
      const tr = t[node.type];
      lines.push(indent(level) + tr.pre + text + tr.post);
      break;
    }

    case "BranchNode": {
      lines.push(
        indent(level) +
          t.BranchNode.pre +
          text +
          t.BranchNode.post +
          (t.leftBracket ? " " + t.leftBracket + "\n" : ""),
      );
      lines.push(...body(node.trueChild, level + 1, t, lang));
      const falseLines = transform(node.falseChild, level + 1, t, lang);
      if (falseLines.length > 0 || lang !== "python") {
        lines.push(indent(level) + t.BranchNode.between);
        lines.push(...falseLines);
      }
      if (t.rightBracket) lines.push(indent(level) + t.rightBracket + "\n");
      break;
    }

    case "HeadLoopNode":
      lines.push(
        indent(level) +
          t.HeadLoopNode.pre +
          text +
          t.HeadLoopNode.post +
          (t.leftBracket ? " " + t.leftBracket + "\n" : ""),
      );
      lines.push(...body(node.child, level + 1, t, lang));
      if (t.rightBracket) lines.push(indent(level) + t.rightBracket + "\n");
      break;

    case "CountLoopNode":
      lines.push(
        indent(level) +
          t.CountLoopNode.pre +
          countLoopHeader(text, lang.toLowerCase()).header +
          t.CountLoopNode.post +
          (t.leftBracket ? " " + t.leftBracket + "\n" : ""),
      );
      lines.push(...body(node.child, level + 1, t, lang));
      if (t.rightBracket) lines.push(indent(level) + t.rightBracket + "\n");
      break;

    case "FootLoopNode": {
      lines.push(
        indent(level) +
          t.FootLoopNode.prepre +
          (t.leftBracket ? " " + t.leftBracket + "\n" : ""),
      );
      lines.push(...transform(node.child, level + 1, t, lang));
      // For Python-style: "while True" body includes "if not cond: break"
      if (t.pseudoSwitch) {
        // Python: the pre/post contain the break logic
        lines.push(
          indent(level + 1) + t.FootLoopNode.pre + text + t.FootLoopNode.post,
        );
        lines.push(indent(level + 2) + t.FootLoopNode.postpost);
      } else {
        if (t.rightBracket) lines.push(indent(level) + t.rightBracket + " ");
        lines.push(t.FootLoopNode.pre + text + t.FootLoopNode.post);
      }
      break;
    }

    case "FunctionNode": {
      const params = (node.parameters || []).map((p) => p.parName).join(", ");
      const returnType = node.returnType || "";
      // Java names the return type in front, Python may annotate it behind,
      // JavaScript has none.
      // Java keeps the modifiers it was read with (`static`), new methods are public.
      const modifiers = node.modifiers ?? "public";
      const pre =
        lang === "java"
          ? `${modifiers ? modifiers + " " : ""}${returnType || "void"} `
          : t.FunctionNode.pre;
      const post =
        lang === "python" && returnType ? `) -> ${returnType}:\n` : t.FunctionNode.post;
      lines.push(
        indent(level) +
          pre +
          text +
          t.FunctionNode.between +
          params +
          post +
          (t.leftBracket ? " " + t.leftBracket + "\n" : ""),
      );
      lines.push(...body(node.child, level + 1, t, lang));
      if (t.rightBracket) lines.push(indent(level) + t.rightBracket + "\n");
      // A blank line between a function and what follows it, as people write it.
      if (hasNext(node.followElement)) lines.push("\n");
      break;
    }

    case "TryCatchNode": {
      lines.push(
        indent(level) +
          t.TryCatchNode.pre +
          (t.leftBracket ? " " + t.leftBracket + "\n" : ""),
      );
      lines.push(...body(node.tryChild, level + 1, t, lang));
      lines.push(
        indent(level) +
          (t.rightBracket ? t.rightBracket + " " : "") +
          t.TryCatchNode.between +
          catchClause(text, lang) +
          t.TryCatchNode.post +
          (t.leftBracket ? " " + t.leftBracket + "\n" : ""),
      );
      lines.push(...body(node.catchChild, level + 1, t, lang));
      if (t.rightBracket) lines.push(indent(level) + t.rightBracket + "\n");
      break;
    }

    case "CaseNode": {
      if (t.pseudoSwitch) {
        // Python-style: use if/elif/else chain
        let first = true;
        for (const c of node.cases || []) {
          if (c.type === "InsertCase") {
            const prefix = first ? "if " : t.InsertCase.preNormal;
            lines.push(
              indent(level) +
                prefix +
                text +
                " == " +
                c.text +
                t.InsertCase.post,
            );
            lines.push(...body(c.followElement, level + 1, t, lang));
            first = false;
          }
        }
        if (node.defaultOn && node.defaultNode) {
          lines.push(
            indent(level) + t.InsertCase.preDefault + t.InsertCase.post,
          );
          lines.push(
            ...body(node.defaultNode.followElement, level + 1, t, lang),
          );
        }
      } else {
        // C-style: switch/case
        lines.push(
          indent(level) +
            t.CaseNode.pre +
            text +
            t.CaseNode.post +
            (t.leftBracket ? " " + t.leftBracket + "\n" : ""),
        );
        for (const c of node.cases || []) {
          if (c.type === "InsertCase") {
            lines.push(
              indent(level + 1) +
                t.InsertCase.preNormal +
                c.text +
                t.InsertCase.post,
            );
            lines.push(...transform(c.followElement, level + 2, t, lang));
            if (t.InsertCase.postpost) {
              lines.push(indent(level + 2) + t.InsertCase.postpost);
            }
          }
        }
        if (node.defaultOn && node.defaultNode) {
          lines.push(
            indent(level + 1) + t.InsertCase.preDefault + t.InsertCase.post,
          );
          lines.push(
            ...transform(node.defaultNode.followElement, level + 2, t, lang),
          );
          if (lang === "java") {
            lines.push(indent(level + 2) + t.InsertCase.postpost);
          }
        }
        if (t.rightBracket) lines.push(indent(level) + t.rightBracket + "\n");
      }
      break;
    }

    default:
      break;
  }

  // Continue with followElement
  lines.push(...transform(node.followElement, level, t, lang));
  return lines;
}

export { TRANSLATIONS };
