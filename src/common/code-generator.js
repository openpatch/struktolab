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
      pre: "    if not ",
      post: ":\n        break\n",
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
    InputNode: { pre: "", post: " = System.console().readLine();\n" },
    OutputNode: { pre: "System.out.println(", post: ");\n" },
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
      lines.push(indent(level) + t.InputNode.pre + text + t.InputNode.post);
      break;

    case "OutputNode":
      lines.push(indent(level) + t.OutputNode.pre + text + t.OutputNode.post);
      break;

    case "BranchNode": {
      lines.push(
        indent(level) +
          t.BranchNode.pre +
          text +
          t.BranchNode.post +
          (t.leftBracket ? " " + t.leftBracket + "\n" : ""),
      );
      lines.push(...transform(node.trueChild, level + 1, t, lang));
      lines.push(indent(level) + t.BranchNode.between);
      lines.push(...transform(node.falseChild, level + 1, t, lang));
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
      lines.push(...transform(node.child, level + 1, t, lang));
      if (t.rightBracket) lines.push(indent(level) + t.rightBracket + "\n");
      break;

    case "CountLoopNode":
      lines.push(
        indent(level) +
          t.CountLoopNode.pre +
          text +
          t.CountLoopNode.post +
          (t.leftBracket ? " " + t.leftBracket + "\n" : ""),
      );
      lines.push(...transform(node.child, level + 1, t, lang));
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
          indent(level) + t.FootLoopNode.pre + text + t.FootLoopNode.post,
        );
      } else {
        if (t.rightBracket) lines.push(indent(level) + t.rightBracket + " ");
        lines.push(t.FootLoopNode.pre + text + t.FootLoopNode.post);
      }
      break;
    }

    case "FunctionNode": {
      const params = (node.parameters || []).map((p) => p.parName).join(", ");
      lines.push(
        indent(level) +
          t.FunctionNode.pre +
          text +
          t.FunctionNode.between +
          params +
          t.FunctionNode.post +
          (t.leftBracket ? " " + t.leftBracket + "\n" : ""),
      );
      lines.push(...transform(node.child, level + 1, t, lang));
      if (t.rightBracket) lines.push(indent(level) + t.rightBracket + "\n");
      break;
    }

    case "TryCatchNode": {
      lines.push(
        indent(level) +
          t.TryCatchNode.pre +
          (t.leftBracket ? " " + t.leftBracket + "\n" : ""),
      );
      lines.push(...transform(node.tryChild, level + 1, t, lang));
      lines.push(
        indent(level) +
          (t.rightBracket ? t.rightBracket + " " : "") +
          t.TryCatchNode.between +
          text +
          t.TryCatchNode.post +
          (t.leftBracket ? " " + t.leftBracket + "\n" : ""),
      );
      lines.push(...transform(node.catchChild, level + 1, t, lang));
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
            lines.push(...transform(c.followElement, level + 1, t, lang));
            first = false;
          }
        }
        if (node.defaultOn && node.defaultNode) {
          lines.push(
            indent(level) + t.InsertCase.preDefault + t.InsertCase.post,
          );
          lines.push(
            ...transform(node.defaultNode.followElement, level + 1, t, lang),
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
