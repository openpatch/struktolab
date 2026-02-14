/**
 * Tree manipulation helpers for the struktog editor.
 * All operations return a new tree (immutable style via deep clone).
 */

let _idCounter = 0;

/** Generate a unique ID for new nodes. */
export function genId() {
  return "__ed_" + Date.now().toString(36) + "_" + (++_idCounter);
}

/** Deep clone a tree. */
export function cloneTree(node) {
  if (!node) return null;
  return JSON.parse(JSON.stringify(node));
}

/** Find a node by id in the tree. Returns the node or null. */
export function findNode(tree, id) {
  if (!tree) return null;
  if (tree.id === id) return tree;
  for (const key of ["followElement", "trueChild", "falseChild", "child", "tryChild", "catchChild"]) {
    if (tree[key]) {
      const found = findNode(tree[key], id);
      if (found) return found;
    }
  }
  if (tree.cases) {
    for (const c of tree.cases) {
      const found = findNode(c, id);
      if (found) return found;
    }
  }
  if (tree.defaultNode) {
    const found = findNode(tree.defaultNode, id);
    if (found) return found;
  }
  return null;
}

/** Find the parent of a node by id. Returns { parent, key, index } or null. */
export function findParent(tree, id, parent = null, key = null, index = null) {
  if (!tree) return null;
  if (tree.id === id) return { parent, key, index };
  for (const k of ["followElement", "trueChild", "falseChild", "child", "tryChild", "catchChild"]) {
    if (tree[k]) {
      const found = findParent(tree[k], id, tree, k);
      if (found) return found;
    }
  }
  if (tree.cases) {
    for (let i = 0; i < tree.cases.length; i++) {
      const found = findParent(tree.cases[i], id, tree, "cases", i);
      if (found) return found;
    }
  }
  if (tree.defaultNode) {
    const found = findParent(tree.defaultNode, id, tree, "defaultNode");
    if (found) return found;
  }
  return null;
}

/**
 * Create a new empty node template of the given type.
 */
export function createNode(type) {
  const id = genId();
  const insert = { id: genId(), type: "InsertNode", followElement: { type: "Placeholder" } };

  switch (type) {
    case "TaskNode":
      return { id, type: "TaskNode", text: "Anweisung", followElement: null };
    case "InputNode":
      return { id, type: "InputNode", text: "Eingabe", followElement: null };
    case "OutputNode":
      return { id, type: "OutputNode", text: "Ausgabe", followElement: null };
    case "BranchNode":
      return {
        id, type: "BranchNode", text: "Bedingung",
        trueChild: { ...insert, id: genId() },
        falseChild: { id: genId(), type: "InsertNode", followElement: { type: "Placeholder" } },
        followElement: null,
      };
    case "CaseNode":
      return {
        id, type: "CaseNode", text: "Variable",
        defaultOn: true,
        defaultNode: {
          id: genId(), type: "InsertCase", text: "Sonst",
          followElement: { id: genId(), type: "InsertNode", followElement: { type: "Placeholder" } },
        },
        cases: [
          {
            id: genId(), type: "InsertCase", text: "Fall 1",
            followElement: { id: genId(), type: "InsertNode", followElement: { type: "Placeholder" } },
          },
          {
            id: genId(), type: "InsertCase", text: "Fall 2",
            followElement: { id: genId(), type: "InsertNode", followElement: { type: "Placeholder" } },
          },
        ],
        followElement: null,
      };
    case "HeadLoopNode":
      return {
        id, type: "HeadLoopNode", text: "Bedingung",
        child: { ...insert, id: genId() },
        followElement: null,
      };
    case "CountLoopNode":
      return {
        id, type: "CountLoopNode", text: "i = 1 bis 10",
        child: { id: genId(), type: "InsertNode", followElement: { type: "Placeholder" } },
        followElement: null,
      };
    case "FootLoopNode":
      return {
        id, type: "FootLoopNode", text: "Bedingung",
        child: { id: genId(), type: "InsertNode", followElement: { type: "Placeholder" } },
        followElement: null,
      };
    case "FunctionNode":
      return {
        id, type: "FunctionNode", text: "funktion",
        parameters: [{ pos: "0", parName: "param" }],
        child: { id: genId(), type: "InsertNode", followElement: { type: "Placeholder" } },
        followElement: null,
      };
    case "TryCatchNode":
      return {
        id, type: "TryCatchNode", text: "Exception e",
        tryChild: { id: genId(), type: "InsertNode", followElement: { type: "Placeholder" } },
        catchChild: { id: genId(), type: "InsertNode", followElement: { type: "Placeholder" } },
        followElement: null,
      };
    default:
      return { id, type: "TaskNode", text: type, followElement: null };
  }
}

/**
 * Insert a new node at the InsertNode/Placeholder with the given targetId.
 * The new node's followElement takes the previous followElement.
 */
export function insertAt(tree, targetId, nodeType) {
  const root = cloneTree(tree);
  const target = findNode(root, targetId);
  if (!target) return root;

  const newNode = createNode(nodeType);

  if (target.type === "InsertNode") {
    // Insert before the current followElement
    newNode.followElement = target.followElement;
    target.followElement = newNode;
  } else if (target.type === "Placeholder") {
    // Replace placeholder with InsertNode → newNode → Placeholder
    const info = findParent(root, targetId);
    if (info) {
      const insert = {
        id: genId(), type: "InsertNode",
        followElement: newNode,
      };
      newNode.followElement = { id: genId(), type: "InsertNode", followElement: { type: "Placeholder" } };
      if (info.index != null) {
        info.parent[info.key][info.index] = insert;
      } else {
        info.parent[info.key] = insert;
      }
    }
  }
  return root;
}

/**
 * Remove a node by id. Its children are removed too.
 * The followElement chain is reconnected.
 */
export function removeNode(tree, nodeId) {
  const root = cloneTree(tree);
  const info = findParent(root, nodeId);
  if (!info) return root;

  const node = info.index != null ? info.parent[info.key][info.index] : info.parent[info.key];
  if (!node) return root;

  // Replace this node with its followElement (reconnect the chain)
  const follow = node.followElement || { type: "Placeholder" };
  if (info.index != null) {
    info.parent[info.key][info.index] = follow;
  } else {
    info.parent[info.key] = follow;
  }
  return root;
}

/**
 * Update the text of a node by id.
 */
export function editText(tree, nodeId, newText) {
  const root = cloneTree(tree);
  const node = findNode(root, nodeId);
  if (node) node.text = newText;
  return root;
}

/**
 * Move a node from its current position to a target InsertNode/Placeholder.
 */
export function moveNode(tree, nodeId, targetId) {
  if (nodeId === targetId) return tree;
  let root = cloneTree(tree);

  // Find and detach the source node
  const srcInfo = findParent(root, nodeId);
  if (!srcInfo) return root;
  const srcNode = srcInfo.index != null
    ? srcInfo.parent[srcInfo.key][srcInfo.index]
    : srcInfo.parent[srcInfo.key];
  if (!srcNode) return root;

  // Detach: replace with followElement
  const follow = srcNode.followElement || { type: "Placeholder" };
  if (srcInfo.index != null) {
    srcInfo.parent[srcInfo.key][srcInfo.index] = follow;
  } else {
    srcInfo.parent[srcInfo.key] = follow;
  }

  // Now insert at target
  const target = findNode(root, targetId);
  if (!target) return root;

  srcNode.followElement = null;
  if (target.type === "InsertNode") {
    srcNode.followElement = target.followElement;
    target.followElement = srcNode;
  }
  return root;
}

/**
 * Collect all InsertNode and Placeholder ids from the tree (for drop targets).
 */
export function collectInsertPoints(tree) {
  const points = [];
  function walk(node) {
    if (!node) return;
    if (node.type === "InsertNode" && node.id) points.push(node.id);
    if (node.type === "Placeholder" && node.id) points.push(node.id);
    for (const key of ["followElement", "trueChild", "falseChild", "child", "tryChild", "catchChild"]) {
      if (node[key]) walk(node[key]);
    }
    if (node.cases) node.cases.forEach(walk);
    if (node.defaultNode) walk(node.defaultNode);
  }
  walk(tree);
  return points;
}

/**
 * Wrap a tree with InsertNodes between every content node, and ensure
 * every chain ends with InsertNode → Placeholder.
 * This makes every position in the structogram an insert target.
 */
export function wrapWithInsertNodes(tree) {
  if (!tree) return { id: genId(), type: "InsertNode", followElement: { id: genId(), type: "Placeholder" } };
  const root = cloneTree(tree);
  return _wrapChain(root);
}

function _wrapChain(node) {
  if (!node) return { id: genId(), type: "InsertNode", followElement: { id: genId(), type: "Placeholder" } };

  // Already an InsertNode — ensure its follow chain is wrapped
  if (node.type === "InsertNode") {
    node.followElement = node.followElement ? _wrapContent(node.followElement) : { id: genId(), type: "Placeholder" };
    return node;
  }

  // Already a Placeholder — wrap it with an InsertNode
  if (node.type === "Placeholder") {
    return { id: genId(), type: "InsertNode", followElement: node };
  }

  // Content node — wrap it with an InsertNode in front
  const wrapped = _wrapContent(node);
  return { id: genId(), type: "InsertNode", followElement: wrapped };
}

function _wrapContent(node) {
  if (!node) return { id: genId(), type: "Placeholder" };
  if (node.type === "InsertNode") {
    node.followElement = node.followElement ? _wrapContent(node.followElement) : { id: genId(), type: "Placeholder" };
    return node;
  }
  if (node.type === "Placeholder") return node;

  // Recurse into compound children
  for (const key of ["trueChild", "falseChild", "child", "tryChild", "catchChild"]) {
    if (node[key]) node[key] = _wrapChain(node[key]);
  }
  if (node.cases) {
    for (let i = 0; i < node.cases.length; i++) {
      // InsertCase nodes: wrap their followElement chain
      if (node.cases[i] && node.cases[i].type === "InsertCase") {
        node.cases[i].followElement = _wrapChain(node.cases[i].followElement);
      } else {
        node.cases[i] = _wrapChain(node.cases[i]);
      }
    }
  }
  if (node.defaultNode) {
    if (node.defaultNode.type === "InsertCase") {
      node.defaultNode.followElement = _wrapChain(node.defaultNode.followElement);
    } else {
      node.defaultNode = _wrapChain(node.defaultNode);
    }
  }

  // Wrap the followElement chain: content → InsertNode → next...
  if (node.followElement) {
    node.followElement = _wrapChain(node.followElement);
  } else {
    node.followElement = { id: genId(), type: "InsertNode", followElement: { id: genId(), type: "Placeholder" } };
  }

  return node;
}

/**
 * Ensure all InsertNode and Placeholder nodes have IDs (needed for editing).
 */
export function ensureIds(tree) {
  if (!tree) return tree;
  const root = cloneTree(tree);
  function walk(node) {
    if (!node) return;
    if (!node.id) node.id = genId();
    for (const key of ["followElement", "trueChild", "falseChild", "child", "tryChild", "catchChild"]) {
      if (node[key]) walk(node[key]);
    }
    if (node.cases) node.cases.forEach(walk);
    if (node.defaultNode) walk(node.defaultNode);
  }
  walk(root);
  return root;
}

/**
 * Strip InsertNode and Placeholder wrappers, returning a clean tree
 * suitable for JSON export.
 */
export function stripInsertNodes(tree) {
  if (!tree) return null;
  const node = cloneTree(tree);
  return _stripChain(node);
}

function _stripChain(node) {
  if (!node) return null;
  if (node.type === "Placeholder") return null;
  if (node.type === "InsertNode") return _stripChain(node.followElement);

  // Recurse into compound children
  for (const key of ["trueChild", "falseChild", "child", "tryChild", "catchChild"]) {
    if (node[key]) node[key] = _stripChain(node[key]);
  }
  if (node.cases) {
    node.cases = node.cases.map(c => {
      if (c && c.type === "InsertCase") {
        c.followElement = _stripChain(c.followElement);
        return c;
      }
      return _stripChain(c);
    }).filter(Boolean);
  }
  if (node.defaultNode) {
    if (node.defaultNode.type === "InsertCase") {
      node.defaultNode.followElement = _stripChain(node.defaultNode.followElement);
    } else {
      node.defaultNode = _stripChain(node.defaultNode);
    }
  }

  node.followElement = _stripChain(node.followElement);
  // Remove internal IDs
  delete node.id;
  _cleanIds(node);
  return node;
}

function _cleanIds(node) {
  if (!node) return;
  delete node.id;
  for (const key of ["followElement", "trueChild", "falseChild", "child", "tryChild", "catchChild"]) {
    if (node[key]) _cleanIds(node[key]);
  }
  if (node.cases) node.cases.forEach(_cleanIds);
  if (node.defaultNode) _cleanIds(node.defaultNode);
}

/**
 * Collect all editable (non-structural) nodes with their ids and types.
 */
export function collectEditableNodes(tree) {
  const nodes = [];
  function walk(node) {
    if (!node) return;
    if (node.type !== "InsertNode" && node.type !== "Placeholder" && node.type !== "InsertCase") {
      nodes.push({ id: node.id, type: node.type, text: node.text });
    }
    if (node.type === "InsertCase") {
      nodes.push({ id: node.id, type: node.type, text: node.text });
    }
    for (const key of ["followElement", "trueChild", "falseChild", "child", "tryChild", "catchChild"]) {
      if (node[key]) walk(node[key]);
    }
    if (node.cases) node.cases.forEach(walk);
    if (node.defaultNode) walk(node.defaultNode);
  }
  walk(tree);
  return nodes;
}
