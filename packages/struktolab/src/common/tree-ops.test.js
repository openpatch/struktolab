import { test } from "node:test";
import assert from "node:assert/strict";
import { wrapWithInsertNodes, ensureIds, moveNode, findNode } from "./tree-ops.js";

/** True if any InsertNode is directly followed by another InsertNode. */
function hasDoubleSlot(node) {
  if (!node || typeof node !== "object") return false;
  if (node.type === "InsertNode" && node.followElement?.type === "InsertNode") return true;
  return Object.values(node).some((v) =>
    Array.isArray(v) ? v.some(hasDoubleSlot) : hasDoubleSlot(v),
  );
}

test("moving the only node out of a body leaves one slot, not two", () => {
  const prep = (t) => ensureIds(wrapWithInsertNodes(t));
  let tree = prep({
    type: "HeadLoopNode",
    text: "while x",
    child: { type: "TaskNode", text: "a", followElement: null },
    followElement: { type: "TaskNode", text: "b", followElement: null },
  });
  const loop = tree.followElement;
  const task = loop.child.followElement;
  const end = findNode(tree, loop.followElement.followElement.followElement.id);
  tree = prep(moveNode(tree, task.id, end.id));
  assert.equal(hasDoubleSlot(tree), false);
});
