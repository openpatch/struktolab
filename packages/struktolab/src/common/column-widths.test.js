import { test } from "node:test";
import assert from "node:assert/strict";
import { carryOverColumnWidths } from "./tree-ops.js";
import { parseJava } from "./brace-parser.js";

const findAll = (node, type, out = []) => {
  if (!node || typeof node !== "object") return out;
  if (node.type === type) out.push(node);
  for (const v of Object.values(node)) {
    if (Array.isArray(v)) v.forEach((x) => findAll(x, type, out));
    else if (v && typeof v === "object") findAll(v, type, out);
  }
  return out;
};

test("editing code keeps resized branch columns", () => {
  const before = parseJava("if (x > 0) { a(); } else { b(); }\nif (y) { c(); }");
  const [b1, b2] = findAll(before, "BranchNode");
  b1.columnWidths = [0.7, 0.3];
  b2.columnWidths = [0.2, 0.8];

  // A new statement in front, and the second condition edited.
  const after = parseJava("d();\nif (x > 0) { a(); e(); } else { b(); }\nif (y && z) { c(); }");
  carryOverColumnWidths(before, after);
  const [n1, n2] = findAll(after, "BranchNode");
  assert.deepEqual(n1.columnWidths, [0.7, 0.3]);
  assert.deepEqual(n2.columnWidths, [0.2, 0.8]);
});

test("a new branch does not take another branch's widths", () => {
  const before = parseJava("if (x) { a(); }");
  findAll(before, "BranchNode")[0].columnWidths = [0.7, 0.3];
  const after = parseJava("if (q) { z(); }\nif (x) { a(); }");
  carryOverColumnWidths(before, after);
  const [n1, n2] = findAll(after, "BranchNode");
  assert.equal(n1.columnWidths, undefined);
  assert.deepEqual(n2.columnWidths, [0.7, 0.3]);
});
