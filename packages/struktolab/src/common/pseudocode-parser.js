/**
 * Parse pseudocode into a struktog tree.
 *
 * Keywords are configurable via keyword maps (KEYWORDS_DE, KEYWORDS_EN).
 * Default is German (KEYWORDS_DE) for backward compatibility.
 *
 * Syntax (using German keywords):
 *   # TaskNode — any plain statement
 *   ergebnis = 1
 *
 *   # InputNode
 *   eingabe("Zahl n")
 *
 *   # OutputNode
 *   ausgabe("Ergebnis")
 *
 *   # CountLoopNode
 *   wiederhole für i = 1 bis 10:
 *       ...
 *
 *   # HeadLoopNode
 *   wiederhole solange x > 0:
 *       ...
 *
 *   # FootLoopNode
 *   wiederhole:
 *       ...
 *   solange eingabe != 0
 *
 *   # BranchNode
 *   falls x > 0:
 *       ...
 *   sonst:
 *       ...
 *
 *   # BranchNode with column widths
 *   falls x > 0 [0.7, 0.3]:
 *       ...
 *   sonst:
 *       ...
 *
 *   # CaseNode
 *   unterscheide farbe:
 *       fall "rot":
 *           ...
 *       fall "grün":
 *           ...
 *       sonst:
 *           ...
 *
 *   # CaseNode with column widths
 *   unterscheide farbe [0.4, 0.3, 0.3]:
 *       fall "rot":
 *           ...
 *       fall "grün":
 *           ...
 *       sonst:
 *           ...
 *
 *   # FunctionNode
 *   funktion factorial(n):
 *       ...
 *
 *   # TryCatchNode
 *   versuche:
 *       ...
 *   fange Exception e:
 *       ...
 */

export const KEYWORDS_DE = {
  if: "falls", else: "sonst",
  repeat: "wiederhole", while: "solange", for: "für",
  switch: "unterscheide", case: "fall",
  function: "funktion",
  try: "versuche", catch: "fange",
  input: "eingabe", output: "ausgabe",
  true: "Wahr", false: "Falsch",
  default: "Sonst",
};

export const KEYWORDS_EN = {
  if: "if", else: "else",
  repeat: "repeat", while: "while", for: "for",
  switch: "switch", case: "case",
  function: "function",
  try: "try", catch: "catch",
  input: "input", output: "output",
  true: "True", false: "False",
  default: "Default",
};

/** Escape special regex characters in a string. */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let _idCounter = 0;
function uid() {
  return "__pseudo_" + (++_idCounter);
}

function makeInsert(followElement) {
  return { id: uid(), type: "InsertNode", followElement };
}

function placeholder() {
  return { type: "Placeholder" };
}

/**
 * Extract optional column widths from the end of a condition string.
 * E.g. "x > 0 [0.7, 0.3]" → { text: "x > 0", columnWidths: [0.7, 0.3] }
 *      "x > 0"             → { text: "x > 0", columnWidths: null }
 */
function extractColumnWidths(str) {
  const match = str.match(/^(.*?)\s*\[([0-9.,\s]+)\]\s*$/);
  if (match) {
    const text = match[1].trim();
    const widths = match[2].split(",").map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
    return { text, columnWidths: widths.length > 0 ? widths : null };
  }
  return { text: str, columnWidths: null };
}

/**
 * Tokenize source into lines with their indent level.
 */
function tokenize(source) {
  const rawLines = source.split("\n");
  const lines = [];
  for (const raw of rawLines) {
    const trimmed = raw.trimEnd();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const stripped = raw.replace(/\t/g, "    ");
    const indent = stripped.length - stripped.trimStart().length;
    lines.push({ text: trimmed.trim(), indent });
  }
  return lines;
}

/**
 * Group lines into blocks by indent level.
 * Returns an array of { text, indent, children[] } where children
 * are lines that are indented deeper than the current line.
 */
function groupBlocks(lines, baseIndent) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.indent < baseIndent) break;
    if (line.indent > baseIndent) {
      // This shouldn't happen at top level — skip
      i++;
      continue;
    }
    // Collect children (all subsequent lines with indent > baseIndent)
    const children = [];
    i++;
    while (i < lines.length && lines[i].indent > baseIndent) {
      children.push(lines[i]);
      i++;
    }
    blocks.push({ text: line.text, indent: line.indent, children });
  }
  return blocks;
}

/**
 * Strip trailing colon from a line.
 */
function stripColon(text) {
  return text.endsWith(":") ? text.slice(0, -1).trimEnd() : text;
}

/**
 * Parse a sequence of blocks into a linked list of nodes.
 * Returns the root InsertNode of the chain.
 */
function parseBlocks(lines, baseIndent) {
  const blocks = groupBlocks(lines, baseIndent);
  if (blocks.length === 0) return makeInsert(placeholder());

  // Build the chain from the end backwards
  let tail = makeInsert(null);

  // Process blocks in reverse to build the followElement chain
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    const node = parseStatement(block, baseIndent, tail);
    tail = node;
  }
  return tail;
}

/**
 * Parse a single statement block into a node, with `followTail` as the
 * continuation after this node.
 */
function parseStatement(block, baseIndent, followTail) {
  const text = block.text;
  const children = block.children;
  const childIndent = baseIndent + 4;

  // --- eingabe("...") → InputNode ---
  const inputMatch = text.match(/^eingabe\s*\(\s*"?([^"]*)"?\s*\)$/i);
  if (inputMatch) {
    return makeInsert({
      id: uid(), type: "InputNode", text: inputMatch[1],
      followElement: followTail,
    });
  }

  // --- ausgabe("...") → OutputNode ---
  const outputMatch = text.match(/^ausgabe\s*\(\s*"?([^"]*)"?\s*\)$/i);
  if (outputMatch) {
    return makeInsert({
      id: uid(), type: "OutputNode", text: outputMatch[1],
      followElement: followTail,
    });
  }

  // --- funktion name(params): → FunctionNode ---
  const funcMatch = text.match(/^funktion\s+(\w+)\s*\(([^)]*)\)\s*:$/i);
  if (funcMatch) {
    const fname = funcMatch[1];
    const paramStr = funcMatch[2].trim();
    const parameters = paramStr
      ? paramStr.split(",").map((p, i) => ({ pos: String(i * 3), parName: p.trim() }))
      : [];
    const childTree = parseBlocks(children, childIndent);
    return makeInsert({
      id: uid(), type: "FunctionNode", text: fname, parameters,
      child: childTree,
      followElement: followTail,
    });
  }

  // --- versuche: / fange ...: → TryCatchNode ---
  if (/^versuche\s*:$/i.test(text)) {
    const tryChild = parseBlocks(children, childIndent);
    // Look for the next sibling "fange" — it should be in followTail context
    // Actually, "fange" is handled as the next block in the parent sequence.
    // We need to peek ahead. This is done by the caller grouping.
    // For now, return partial — the caller will merge.
    return {
      _type: "try", tryChild, followTail,
    };
  }
  if (/^fange\s+/i.test(text)) {
    const catchText = stripColon(text.replace(/^fange\s+/i, ""));
    const catchChild = parseBlocks(children, childIndent);
    return {
      _type: "catch", catchText, catchChild, followTail,
    };
  }

  // --- wiederhole: ... solange X (FootLoopNode) ---
  if (/^wiederhole\s*:$/i.test(text)) {
    const childTree = parseBlocks(children, childIndent);
    // The "solange X" line follows as the next block — handled by caller merge
    return {
      _type: "wiederhole_body", childTree, followTail,
    };
  }
  // --- solange X (footer of FootLoopNode) ---
  if (/^solange\s+/i.test(text) && !text.endsWith(":")) {
    const cond = text.replace(/^solange\s+/i, "").trim();
    return {
      _type: "solange_footer", cond, followTail,
    };
  }

  // --- wiederhole für ...: → CountLoopNode ---
  const countMatch = text.match(/^wiederhole\s+für\s+(.+)\s*:$/i);
  if (countMatch) {
    const childTree = parseBlocks(children, childIndent);
    return makeInsert({
      id: uid(), type: "CountLoopNode", text: countMatch[1],
      child: childTree,
      followElement: followTail,
    });
  }

  // --- wiederhole solange ...: → HeadLoopNode ---
  const headMatch = text.match(/^wiederhole\s+solange\s+(.+)\s*:$/i);
  if (headMatch) {
    const childTree = parseBlocks(children, childIndent);
    return makeInsert({
      id: uid(), type: "HeadLoopNode", text: headMatch[1],
      child: childTree,
      followElement: followTail,
    });
  }

  // --- unterscheide ...: → CaseNode ---
  const caseMatch = text.match(/^unterscheide\s+(.+)\s*:$/i);
  if (caseMatch) {
    const varName = caseMatch[1];
    const caseBlocks = groupBlocks(children, childIndent);
    const cases = [];
    let defaultNode = null;
    let defaultOn = false;

    for (const cb of caseBlocks) {
      const fallMatch = cb.text.match(/^fall\s+(.+)\s*:$/i);
      if (fallMatch) {
        const caseChildIndent = childIndent + 4;
        const caseBody = parseBlocks(cb.children, caseChildIndent);
        cases.push({
          id: uid(), type: "InsertCase", text: stripColon(fallMatch[1].replace(/^"(.*)"$/, "$1")),
          followElement: caseBody,
        });
      } else if (/^sonst\s*:$/i.test(cb.text)) {
        defaultOn = true;
        const caseChildIndent = childIndent + 4;
        const caseBody = parseBlocks(cb.children, caseChildIndent);
        defaultNode = {
          id: uid(), type: "InsertCase", text: "Sonst",
          followElement: caseBody,
        };
      }
    }
    if (!defaultNode) {
      defaultNode = {
        id: uid(), type: "InsertCase", text: "Sonst",
        followElement: makeInsert(placeholder()),
      };
    }

    return makeInsert({
      id: uid(), type: "CaseNode", text: varName,
      defaultOn,
      defaultNode,
      cases,
      followElement: followTail,
    });
  }

  // --- falls ...: / sonst: → BranchNode ---
  const branchMatch = text.match(/^falls\s+(.+)\s*:$/i);
  if (branchMatch) {
    const cond = branchMatch[1];
    const trueChild = parseBlocks(children, childIndent);
    // "sonst:" is handled as separate block — return partial
    return {
      _type: "falls", cond, trueChild, followTail,
    };
  }
  if (/^sonst\s*:$/i.test(text)) {
    const falseChild = parseBlocks(children, childIndent);
    return {
      _type: "sonst", falseChild, followTail,
    };
  }

  // --- TaskNode (default) ---
  return makeInsert({
    id: uid(), type: "TaskNode", text: text,
    followElement: followTail,
  });
}

/**
 * Second pass: merge multi-block constructs (falls/sonst, versuche/fange, wiederhole/solange).
 */
function mergeBlocks(lines, baseIndent, keywords) {
  const blocks = groupBlocks(lines, baseIndent);
  if (blocks.length === 0) return makeInsert(placeholder());

  const eTry = escapeRegex(keywords.try);
  const eCatch = escapeRegex(keywords.catch);
  const eIf = escapeRegex(keywords.if);
  const eElse = escapeRegex(keywords.else);
  const eRepeat = escapeRegex(keywords.repeat);
  const eWhile = escapeRegex(keywords.while);
  const eFor = escapeRegex(keywords.for);
  const eSwitch = escapeRegex(keywords.switch);
  const eCase = escapeRegex(keywords.case);
  const eFunction = escapeRegex(keywords.function);
  const eInput = escapeRegex(keywords.input);
  const eOutput = escapeRegex(keywords.output);

  const reTryBlock = new RegExp(`^${eTry}\\s*:$`, "i");
  const reCatchPrefix = new RegExp(`^${eCatch}\\s+`, "i");
  const reIfPrefix = new RegExp(`^${eIf}\\s+`, "i");
  const reElseBlock = new RegExp(`^${eElse}\\s*:$`, "i");
  const reRepeatBlock = new RegExp(`^${eRepeat}\\s*:$`, "i");
  const reWhilePrefix = new RegExp(`^${eWhile}\\s+`, "i");
  const reCountLoop = new RegExp(`^${eRepeat}\\s+${eFor}\\s+(.+)\\s*:$`, "i");
  const reHeadLoop = new RegExp(`^${eRepeat}\\s+${eWhile}\\s+(.+)\\s*:$`, "i");
  const reFuncDef = new RegExp(`^${eFunction}\\s+(\\w+)\\s*\\(([^)]*)\\)\\s*:$`, "i");
  const reSwitchBlock = new RegExp(`^${eSwitch}\\s+(.+)\\s*:$`, "i");
  const reCaseLabel = new RegExp(`^${eCase}\\s+(.+)\\s*:$`, "i");
  const reInput = new RegExp(`^${eInput}\\s*\\(\\s*"?([^"]*)"?\\s*\\)$`, "i");
  const reOutput = new RegExp(`^${eOutput}\\s*\\(\\s*"?([^"]*)"?\\s*\\)$`, "i");

  // First, parse all blocks individually
  const parsed = [];
  for (const block of blocks) {
    parsed.push({ block, _skip: false });
  }

  // Forward pre-scan: mark second-halves of pairs so they aren't processed as standalone
  for (let i = 0; i < parsed.length - 1; i++) {
    const text = parsed[i].block.text;
    const nextText = parsed[i + 1].block.text;
    if (reTryBlock.test(text) && reCatchPrefix.test(nextText)) {
      parsed[i + 1]._skip = true;
    } else if (reIfPrefix.test(text) && reElseBlock.test(nextText)) {
      parsed[i + 1]._skip = true;
    } else if (reRepeatBlock.test(text) && reWhilePrefix.test(nextText) && !nextText.endsWith(":")) {
      parsed[i + 1]._skip = true;
    }
  }

  // Build from end, merging pairs
  let tail = makeInsert(null);

  for (let i = parsed.length - 1; i >= 0; i--) {
    const block = parsed[i].block;
    const text = block.text;

    // Skip second-halves of pairs — they are consumed by their first-half
    if (parsed[i]._skip) continue;

    // The paired second-half is always at i+1 (already marked _skip)
    const nextBlock = i + 1 < parsed.length ? parsed[i + 1].block : null;

    // --- try: + catch ...: ---
    if (reTryBlock.test(text) && nextBlock && reCatchPrefix.test(nextBlock.text)) {
      const childIndent = baseIndent + 4;
      const tryChild = mergeBlocks(block.children, childIndent, keywords);
      const catchText = stripColon(nextBlock.text.replace(reCatchPrefix, ""));
      const catchChild = mergeBlocks(nextBlock.children, childIndent, keywords);
      const node = makeInsert({
        id: uid(), type: "TryCatchNode", text: catchText,
        tryChild,
        catchChild,
        followElement: tail,
      });
      tail = node;
      continue;
    }

    // --- if ...: + else: ---
    if (reIfPrefix.test(text) && nextBlock && reElseBlock.test(nextBlock.text)) {
      const rawCond = stripColon(text.replace(reIfPrefix, ""));
      const { text: cond, columnWidths: cw } = extractColumnWidths(rawCond);
      const childIndent = baseIndent + 4;
      const trueChild = mergeBlocks(block.children, childIndent, keywords);
      const falseChild = mergeBlocks(nextBlock.children, childIndent, keywords);
      const branchNode = {
        id: uid(), type: "BranchNode", text: cond,
        trueChild,
        falseChild,
        followElement: tail,
      };
      if (cw) branchNode.columnWidths = cw;
      const node = makeInsert(branchNode);
      tail = node;
      continue;
    }

    // --- if ...: without else ---
    if (reIfPrefix.test(text)) {
      const rawCond = stripColon(text.replace(reIfPrefix, ""));
      const { text: cond, columnWidths: cw } = extractColumnWidths(rawCond);
      const childIndent = baseIndent + 4;
      const trueChild = mergeBlocks(block.children, childIndent, keywords);
      const branchNode = {
        id: uid(), type: "BranchNode", text: cond,
        trueChild,
        falseChild: makeInsert(placeholder()),
        followElement: tail,
      };
      if (cw) branchNode.columnWidths = cw;
      const node = makeInsert(branchNode);
      tail = node;
      continue;
    }

    // --- repeat: + while X (FootLoopNode) ---
    if (reRepeatBlock.test(text) && nextBlock && reWhilePrefix.test(nextBlock.text) && !nextBlock.text.endsWith(":")) {
      const cond = nextBlock.text.replace(reWhilePrefix, "").trim();
      const childIndent = baseIndent + 4;
      const childTree = mergeBlocks(block.children, childIndent, keywords);
      const node = makeInsert({
        id: uid(), type: "FootLoopNode", text: cond,
        child: childTree,
        followElement: tail,
      });
      tail = node;
      continue;
    }

    // --- repeat for ...: (CountLoopNode) ---
    const countMatch = text.match(reCountLoop);
    if (countMatch) {
      const childIndent = baseIndent + 4;
      const childTree = mergeBlocks(block.children, childIndent, keywords);
      const node = makeInsert({
        id: uid(), type: "CountLoopNode", text: countMatch[1],
        child: childTree,
        followElement: tail,
      });
      tail = node;
      continue;
    }

    // --- repeat while ...: (HeadLoopNode) ---
    const headMatch = text.match(reHeadLoop);
    if (headMatch) {
      const childIndent = baseIndent + 4;
      const childTree = mergeBlocks(block.children, childIndent, keywords);
      const node = makeInsert({
        id: uid(), type: "HeadLoopNode", text: headMatch[1],
        child: childTree,
        followElement: tail,
      });
      tail = node;
      continue;
    }

    // --- function name(params): (FunctionNode) ---
    const funcMatch = text.match(reFuncDef);
    if (funcMatch) {
      const fname = funcMatch[1];
      const paramStr = funcMatch[2].trim();
      const parameters = paramStr
        ? paramStr.split(",").map((p, idx) => ({ pos: String(idx * 3), parName: p.trim() }))
        : [];
      const childIndent = baseIndent + 4;
      const childTree = mergeBlocks(block.children, childIndent, keywords);
      const node = makeInsert({
        id: uid(), type: "FunctionNode", text: fname, parameters,
        child: childTree,
        followElement: tail,
      });
      tail = node;
      continue;
    }

    // --- switch ...: (CaseNode) ---
    const caseNodeMatch = text.match(reSwitchBlock);
    if (caseNodeMatch) {
      const rawVar = caseNodeMatch[1];
      const { text: varName, columnWidths: cw } = extractColumnWidths(rawVar);
      const childIndent = baseIndent + 4;
      const caseBlocks = groupBlocks(block.children, childIndent);
      const cases = [];
      let defaultNode = null;
      let defaultOn = false;

      for (const cb of caseBlocks) {
        const fallMatch = cb.text.match(reCaseLabel);
        if (fallMatch) {
          const caseChildIndent = childIndent + 4;
          const caseBody = mergeBlocks(cb.children, caseChildIndent, keywords);
          cases.push({
            id: uid(), type: "InsertCase",
            text: fallMatch[1].replace(/^"(.*)"$/, "$1"),
            followElement: caseBody,
          });
        } else if (reElseBlock.test(cb.text)) {
          defaultOn = true;
          const caseChildIndent = childIndent + 4;
          const caseBody = mergeBlocks(cb.children, caseChildIndent, keywords);
          defaultNode = {
            id: uid(), type: "InsertCase", text: keywords.default,
            followElement: caseBody,
          };
        }
      }
      if (!defaultNode) {
        defaultNode = {
          id: uid(), type: "InsertCase", text: keywords.default,
          followElement: makeInsert(placeholder()),
        };
      }

      const caseNode = {
        id: uid(), type: "CaseNode", text: varName,
        defaultOn, defaultNode, cases,
        followElement: tail,
      };
      if (cw) caseNode.columnWidths = cw;
      const node = makeInsert(caseNode);
      tail = node;
      continue;
    }

    // --- input("...") → InputNode ---
    const inputMatch = text.match(reInput);
    if (inputMatch) {
      tail = makeInsert({
        id: uid(), type: "InputNode", text: inputMatch[1],
        followElement: tail,
      });
      continue;
    }

    // --- output("...") → OutputNode ---
    const outputMatch = text.match(reOutput);
    if (outputMatch) {
      tail = makeInsert({
        id: uid(), type: "OutputNode", text: outputMatch[1],
        followElement: tail,
      });
      continue;
    }

    // --- TaskNode (default) ---
    tail = makeInsert({
      id: uid(), type: "TaskNode", text: text,
      followElement: tail,
    });
  }

  return tail;
}

/**
 * Parse pseudocode string into a struktog tree.
 * @param {string} source - The pseudocode
 * @param {Object} [keywords=KEYWORDS_DE] - Keyword map for the source language
 * @returns {Object} A struktog tree rooted at an InsertNode
 */
export function parsePseudocode(source, keywords = KEYWORDS_DE) {
  _idCounter = 0;
  const lines = tokenize(source);
  if (lines.length === 0) return makeInsert(placeholder());

  // Determine base indent (minimum indent of all lines)
  const baseIndent = Math.min(...lines.map((l) => l.indent));
  return mergeBlocks(lines, baseIndent, keywords);
}
