/**
 * Serialize a struktog tree back to pseudocode text.
 * Inverse of parsePseudocode.
 */

import { KEYWORDS_DE } from "./pseudocode-parser.js";

const INDENT = "    ";

/**
 * Convert a struktog tree to pseudocode string.
 * @param {Object} tree - The struktog tree
 * @param {Object} [keywords] - Keyword map (defaults to KEYWORDS_DE)
 * @returns {string} Pseudocode text
 */
export function treeToPseudocode(tree, keywords = KEYWORDS_DE) {
  const lines = [];
  serialize(tree, 0, lines, keywords);
  return lines.join("\n");
}

function ind(level) {
  return INDENT.repeat(level);
}

function colWidthSuffix(node) {
  if (node.columnWidths && node.columnWidths.length > 0) {
    return " [" + node.columnWidths.join(", ") + "]";
  }
  return "";
}

function serialize(node, level, lines, kw) {
  if (!node) return;

  switch (node.type) {
    case "InsertNode":
      serialize(node.followElement, level, lines, kw);
      return;

    case "Placeholder":
      return;

    case "TaskNode":
      lines.push(ind(level) + (node.text || ""));
      serialize(node.followElement, level, lines, kw);
      return;

    case "InputNode":
      lines.push(ind(level) + kw.input + '("' + (node.text || "") + '")');
      serialize(node.followElement, level, lines, kw);
      return;

    case "OutputNode":
      lines.push(ind(level) + kw.output + '("' + (node.text || "") + '")');
      serialize(node.followElement, level, lines, kw);
      return;

    case "BranchNode":
      lines.push(ind(level) + kw.if + " " + (node.text || "") + colWidthSuffix(node) + ":");
      serialize(node.trueChild, level + 1, lines, kw);
      lines.push(ind(level) + kw.else + ":");
      serialize(node.falseChild, level + 1, lines, kw);
      serialize(node.followElement, level, lines, kw);
      return;

    case "CaseNode": {
      lines.push(ind(level) + kw.switch + " " + (node.text || "") + colWidthSuffix(node) + ":");
      if (node.cases) {
        for (const c of node.cases) {
          lines.push(ind(level + 1) + kw.case + " " + c.text + ":");
          serialize(c.followElement, level + 2, lines, kw);
        }
      }
      if (node.defaultOn && node.defaultNode) {
        lines.push(ind(level + 1) + kw.else + ":");
        serialize(node.defaultNode.followElement, level + 2, lines, kw);
      }
      serialize(node.followElement, level, lines, kw);
      return;
    }

    case "HeadLoopNode":
      lines.push(ind(level) + kw.repeat + " " + kw.while + " " + (node.text || "") + ":");
      serialize(node.child, level + 1, lines, kw);
      serialize(node.followElement, level, lines, kw);
      return;

    case "CountLoopNode":
      lines.push(ind(level) + kw.repeat + " " + kw.for + " " + (node.text || "") + ":");
      serialize(node.child, level + 1, lines, kw);
      serialize(node.followElement, level, lines, kw);
      return;

    case "FootLoopNode":
      lines.push(ind(level) + kw.repeat + ":");
      serialize(node.child, level + 1, lines, kw);
      lines.push(ind(level) + kw.while + " " + (node.text || ""));
      serialize(node.followElement, level, lines, kw);
      return;

    case "FunctionNode": {
      const params = (node.parameters || []).map(p => p.parName).join(", ");
      lines.push(ind(level) + kw.function + " " + (node.text || "") + "(" + params + "):");
      serialize(node.child, level + 1, lines, kw);
      serialize(node.followElement, level, lines, kw);
      return;
    }

    case "TryCatchNode":
      lines.push(ind(level) + kw.try + ":");
      serialize(node.tryChild, level + 1, lines, kw);
      lines.push(ind(level) + kw.catch + " " + (node.text || "") + ":");
      serialize(node.catchChild, level + 1, lines, kw);
      serialize(node.followElement, level, lines, kw);
      return;

    default:
      return;
  }
}
