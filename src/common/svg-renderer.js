const SVG_NS = "http://www.w3.org/2000/svg";

const COLORS = {
  TaskNode: "rgb(253, 237, 206)",
  InputNode: "rgb(253, 237, 206)",
  OutputNode: "rgb(253, 237, 206)",
  HeadLoopNode: "rgb(220, 239, 231)",
  CountLoopNode: "rgb(220, 239, 231)",
  FootLoopNode: "rgb(220, 239, 231)",
  BranchNode: "rgb(250, 218, 209)",
  CaseNode: "rgb(250, 218, 209)",
  InsertCase: "rgb(250, 218, 209)",
  TryCatchNode: "rgb(250, 218, 209)",
  FunctionNode: "rgb(255, 255, 255)",
};

const DEFAULT_ROW_HEIGHT = 40;
const LOOP_INDENT = 20;
const PADDING_X = 8;
const PADDING_Y = 6;
const STROKE_COLOR = "#333";
const STROKE_WIDTH = 1.5;

/* ── Editor insert-node spacing (0 by default, set by editor) ──── */
let _insertNodeHeight = 0;
export function setInsertNodeHeight(h) { _insertNodeHeight = h; }

/* ── Text measurement & wrapping ─────────────────────────────── */

let _measureCanvas = null;
function getMeasureCtx(fontSize) {
  if (!_measureCanvas) _measureCanvas = document.createElement("canvas");
  const ctx = _measureCanvas.getContext("2d");
  ctx.font = `${fontSize}px sans-serif`;
  return ctx;
}

/** Measure the pixel width of a string at the given font size. */
function measureTextWidth(str, fontSize) {
  return getMeasureCtx(fontSize).measureText(str).width;
}

/**
 * Word-wrap `str` into lines that fit within `maxWidth` pixels.
 * Returns an array of strings.
 */
function wrapText(str, maxWidth, fontSize) {
  if (!str) return [""];
  const ctx = getMeasureCtx(fontSize);

  // Split on explicit newlines first, then wrap each paragraph
  const paragraphs = str.split("\n");
  const allLines = [];
  for (const para of paragraphs) {
    if (!para || ctx.measureText(para).width <= maxWidth) {
      allLines.push(para || "");
      continue;
    }
    const words = para.split(/\s+/);
    let current = "";
    for (const word of words) {
      const test = current ? current + " " + word : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        allLines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) allLines.push(current);
  }
  return allLines.length ? allLines : [""];
}

/** Height needed for wrapped text (lineCount * lineHeight + vertical padding). */
function wrappedTextHeight(str, maxWidth, fontSize) {
  const lines = wrapText(str, maxWidth, fontSize);
  const lineH = fontSize * 1.3;
  return Math.max(DEFAULT_ROW_HEIGHT, lines.length * lineH + PADDING_Y * 2);
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  return el;
}

/**
 * Create a (possibly multi-line) SVG text element.
 * For multi-line text, uses <tspan> elements.
 */
function textEl(str, x, y, h, fontSize, maxWidth, anchor = "start") {
  const lines = maxWidth != null ? wrapText(str, maxWidth, fontSize) : [str || ""];
  const lineH = fontSize * 1.3;
  const totalTextH = lines.length * lineH;
  const startY = y + (h - totalTextH) / 2 + lineH / 2;

  const el = svgEl("text", {
    x,
    "font-size": fontSize,
    "font-family": "sans-serif",
    fill: "#333",
    "text-anchor": anchor,
    "dominant-baseline": "central",
  });

  for (let i = 0; i < lines.length; i++) {
    const tspan = svgEl("tspan", { x, dy: i === 0 ? 0 : lineH });
    if (i === 0) tspan.setAttribute("y", startY);
    tspan.textContent = lines[i];
    el.appendChild(tspan);
  }
  return el;
}

/** Background rect with no stroke */
function bg(x, y, w, h, fill) {
  return svgEl("rect", { x, y, width: w, height: h, fill, stroke: "none" });
}

/** Single line */
function ln(x1, y1, x2, y2) {
  return svgEl("line", {
    x1, y1, x2, y2,
    stroke: STROKE_COLOR,
    "stroke-width": STROKE_WIDTH,
  });
}

/**
 * Compute column pixel widths from optional fractions array.
 * @param {number} totalWidth - Total available width
 * @param {number} numCols - Number of columns
 * @param {number[]} [fractions] - Optional array of fractions summing to 1
 * @returns {number[]} Array of pixel widths
 */
function columnWidths(totalWidth, numCols, fractions) {
  if (fractions && fractions.length === numCols) {
    return fractions.map(f => totalWidth * f);
  }
  const w = totalWidth / numCols;
  return Array(numCols).fill(w);
}

/**
 * Recursively measure the height needed for a subtree.
 * Width is needed to compute text wrapping.
 */
function measureHeight(node, fontSize, width) {
  if (!node) return 0;
  const textW = width - PADDING_X * 2;

  switch (node.type) {
    case "InsertNode":
      return _insertNodeHeight + measureHeight(node.followElement, fontSize, width);
    case "Placeholder":
      return 0;
    case "TaskNode":
    case "InputNode":
    case "OutputNode": {
      let label = node.text || "";
      if (node.type === "InputNode") label = "▶ " + label;
      if (node.type === "OutputNode") label = "◀ " + label;
      const rowH = wrappedTextHeight(label, textW, fontSize);
      return rowH + measureHeight(node.followElement, fontSize, width);
    }
    case "InsertCase": {
      const rowH = wrappedTextHeight(node.text || "", textW, fontSize);
      return rowH + measureHeight(node.followElement, fontSize, width);
    }
    case "BranchNode": {
      const condH = wrappedTextHeight(node.text || "", textW, fontSize);
      const slopeH = fontSize * 1.3 + PADDING_Y;
      const labelRowH = fontSize * 1.3 + PADDING_Y;
      const headerH = condH + slopeH + labelRowH;
      const colW = columnWidths(width, 2, node.columnWidths);
      const trueH = measureHeight(node.trueChild, fontSize, colW[0]);
      const falseH = measureHeight(node.falseChild, fontSize, colW[1]);
      return (
        headerH + Math.max(trueH, falseH) + measureHeight(node.followElement, fontSize, width)
      );
    }
    case "CaseNode": {
      const numCols = node.cases.length + (node.defaultOn ? 1 : 0);
      const colW = columnWidths(width, numCols, node.columnWidths);
      const condH = wrappedTextHeight(node.text || "", textW, fontSize);
      const slopeH = fontSize * 1.3 + PADDING_Y;
      const headerH = condH + slopeH;
      let maxChildH = 0;
      for (let i = 0; i < node.cases.length; i++) {
        maxChildH = Math.max(maxChildH, measureHeight(node.cases[i], fontSize, colW[i]));
      }
      if (node.defaultOn && node.defaultNode) {
        maxChildH = Math.max(maxChildH, measureHeight(node.defaultNode, fontSize, colW[numCols - 1]));
      }
      return headerH + maxChildH + measureHeight(node.followElement, fontSize, width);
    }
    case "HeadLoopNode":
    case "CountLoopNode": {
      const innerW = width - LOOP_INDENT;
      const rowH = wrappedTextHeight(node.text || "", textW, fontSize);
      const childH = measureHeight(node.child, fontSize, innerW);
      const bodyH = Math.max(childH, rowH * 0.5);
      return (
        rowH + bodyH + measureHeight(node.followElement, fontSize, width)
      );
    }
    case "FootLoopNode": {
      const innerW = width - LOOP_INDENT;
      const rowH = wrappedTextHeight(node.text || "", textW, fontSize);
      const childH = measureHeight(node.child, fontSize, innerW);
      const bodyH = Math.max(childH, rowH * 0.5);
      return (
        bodyH + rowH + measureHeight(node.followElement, fontSize, width)
      );
    }
    case "FunctionNode": {
      const innerW = width - LOOP_INDENT;
      let headerText = node.text || "";
      if (node.parameters && node.parameters.length > 0) {
        headerText += "(" + node.parameters.map((p) => p.parName || "").join(", ") + ")";
      } else {
        headerText += "()";
      }
      headerText += " {";
      const rowH = wrappedTextHeight(headerText, textW, fontSize);
      const childH = measureHeight(node.child, fontSize, innerW);
      const bodyH = Math.max(childH, rowH * 0.5);
      const footH = DEFAULT_ROW_HEIGHT * 0.6;
      return (
        rowH + bodyH + footH + measureHeight(node.followElement, fontSize, width)
      );
    }
    case "TryCatchNode": {
      const innerW = width - LOOP_INDENT;
      const tryRowH = wrappedTextHeight("Try", textW, fontSize);
      let catchLabel = "Catch";
      if (node.text) catchLabel += " (" + node.text + ")";
      const catchRowH = wrappedTextHeight(catchLabel, textW, fontSize);
      const tryH = measureHeight(node.tryChild, fontSize, innerW);
      const tryBodyH = Math.max(tryH, tryRowH * 0.5);
      const catchH = measureHeight(node.catchChild, fontSize, innerW);
      const catchBodyH = Math.max(catchH, catchRowH * 0.5);
      return (
        tryRowH + tryBodyH + catchRowH + catchBodyH +
        measureHeight(node.followElement, fontSize, width)
      );
    }
    default:
      return 0;
  }
}

/**
 * Render a subtree into SVG elements positioned at (x, y) within the given width.
 *
 * Border convention: each block draws its own TOP line and LEFT line.
 * The outermost wrapper draws the RIGHT edge and the final BOTTOM line.
 * This prevents doubled horizontal/vertical lines between adjacent blocks.
 *
 * @param {number} [availH] - Available column height. When set, the last
 *   visible node stretches its background to fill remaining space.
 *
 * Returns { elements: SVGElement[], height: number }
 */
function renderNode(node, x, y, width, fontSize, availH) {
  if (!node) return { elements: [], height: 0 };
  const textW = width - PADDING_X * 2;
  const elements = [];

  switch (node.type) {
    case "InsertNode": {
      const inh = _insertNodeHeight;
      const sub = renderNode(node.followElement, x, y + inh, width, fontSize, availH ? availH - inh : undefined);
      return { elements: sub.elements, height: inh + sub.height };
    }

    case "Placeholder":
      return { elements: [], height: 0 };

    case "TaskNode":
    case "InputNode":
    case "OutputNode": {
      const color = COLORS[node.type];
      let label = node.text || "";
      if (node.type === "InputNode") label = "▶ " + label;
      if (node.type === "OutputNode") label = "◀ " + label;
      const rowH = wrappedTextHeight(label, textW, fontSize);

      const followH = measureHeight(node.followElement, fontSize, width);
      // Stretch this node's bg if it (or its tail) is the last in a column
      const naturalH = rowH + followH;
      const stretchH = (availH != null && availH > naturalH)
        ? rowH + (availH - naturalH) : rowH;

      elements.push(bg(x, y, width, stretchH, color));
      elements.push(ln(x, y, x + width, y));
      elements.push(ln(x, y, x, y + stretchH));
      elements.push(textEl(label, x + PADDING_X, y, rowH, fontSize, textW));

      const remainH = availH != null ? availH - stretchH : undefined;
      const follow = renderNode(node.followElement, x, y + stretchH, width, fontSize, remainH);
      return {
        elements: elements.concat(follow.elements),
        height: stretchH + follow.height,
      };
    }

    case "InsertCase": {
      const color = COLORS.InsertCase;
      const rowH = wrappedTextHeight(node.text || "", textW, fontSize);

      const followH = measureHeight(node.followElement, fontSize, width);
      const naturalH = rowH + followH;
      const stretchH = (availH != null && availH > naturalH)
        ? rowH + (availH - naturalH) : rowH;

      elements.push(bg(x, y, width, stretchH, color));
      elements.push(ln(x, y, x, y + stretchH));
      elements.push(textEl(node.text || "", x + PADDING_X, y, rowH, fontSize, textW));

      const remainH = availH != null ? availH - stretchH : undefined;
      const follow = renderNode(node.followElement, x, y + stretchH, width, fontSize, remainH);
      return {
        elements: elements.concat(follow.elements),
        height: stretchH + follow.height,
      };
    }

    case "BranchNode": {
      const color = COLORS.BranchNode;
      const condH = wrappedTextHeight(node.text || "", textW, fontSize);
      const slopeH = fontSize * 1.3 + PADDING_Y;
      const labelRowH = fontSize * 1.3 + PADDING_Y;
      const headerH = condH + slopeH + labelRowH;
      const colW = columnWidths(width, 2, node.columnWidths);
      const divX = x + colW[0];

      // Background for entire header
      elements.push(bg(x, y, width, headerH, color));
      elements.push(ln(x, y, x + width, y));
      elements.push(ln(x, y, x, y + headerH));

      // Condition text centered above slopes
      elements.push(
        textEl(node.text || "", x + width / 2, y, condH, fontSize, textW, "middle")
      );
      // Diagonal lines from condition bottom to divider at slope bottom
      const slopeBottom = y + condH + slopeH;
      elements.push(ln(x, y + condH, divX, slopeBottom));
      elements.push(ln(x + width, y + condH, divX, slopeBottom));
      // True/False labels below slopes
      const smallFS = fontSize * 0.8;
      elements.push(textEl("Wahr", x + PADDING_X, slopeBottom, labelRowH, smallFS, null));
      elements.push(
        textEl("Falsch", x + width - PADDING_X, slopeBottom, labelRowH, smallFS, null, "end")
      );
      // Vertical divider in label row
      elements.push(ln(divX, slopeBottom, divX, y + headerH));

      // Children
      const trueH = measureHeight(node.trueChild, fontSize, colW[0]);
      const falseH = measureHeight(node.falseChild, fontSize, colW[1]);
      const followH = measureHeight(node.followElement, fontSize, width);
      const naturalChildH = Math.max(trueH, falseH);
      const extraH = (availH != null && availH > headerH + naturalChildH + followH)
        ? availH - headerH - naturalChildH - followH : 0;
      const childH = naturalChildH + extraH;

      const trueResult = renderNode(node.trueChild, x, y + headerH, colW[0], fontSize, childH);
      elements.push(...trueResult.elements);

      const falseResult = renderNode(node.falseChild, divX, y + headerH, colW[1], fontSize, childH);
      elements.push(...falseResult.elements);

      // Vertical divider between true/false columns
      elements.push(ln(divX, y + headerH, divX, y + headerH + childH));

      const totalH = headerH + childH;
      const remainH = availH != null ? availH - totalH : undefined;
      const follow = renderNode(node.followElement, x, y + totalH, width, fontSize, remainH);
      return {
        elements: elements.concat(follow.elements),
        height: totalH + follow.height,
      };
    }

    case "CaseNode": {
      const color = COLORS.CaseNode;
      const numCols = node.cases.length + (node.defaultOn ? 1 : 0);
      const colW = columnWidths(width, numCols, node.columnWidths);
      const condH = wrappedTextHeight(node.text || "", textW, fontSize);
      const slopeH = fontSize * 1.3 + PADDING_Y;
      const headerH = condH + slopeH;

      // Header background
      elements.push(bg(x, y, width, headerH, color));
      elements.push(ln(x, y, x + width, y));
      elements.push(ln(x, y, x, y + headerH));

      // Condition text centered above slopes
      elements.push(
        textEl(node.text || "", x + width / 2, y, condH, fontSize, textW, "middle")
      );

      // Compute cumulative x positions for column dividers
      const colXPositions = [0];
      for (let i = 0; i < numCols; i++) {
        colXPositions.push(colXPositions[i] + colW[i]);
      }

      // Diagonal slopes start below the condition text
      if (node.defaultOn) {
        // Last divider position (between last case and default)
        const lastDivX = x + colXPositions[numCols - 1];
        elements.push(ln(x, y + condH, lastDivX, y + headerH));
        elements.push(ln(x + width, y + condH, lastDivX, y + headerH));
        // Intermediate vertical dividers extending from the left diagonal down
        for (let i = 1; i < numCols - 1; i++) {
          const dividerX = x + colXPositions[i];
          // Left diagonal goes from (x, y+condH) to (lastDivX, y+headerH)
          const frac = (colXPositions[i]) / colXPositions[numCols - 1];
          const diagY = y + condH + slopeH * frac;
          elements.push(ln(dividerX, diagY, dividerX, y + headerH));
        }
      } else {
        // No default: single diagonal from top-left to bottom-right
        elements.push(ln(x, y + condH, x + width, y + headerH));
        for (let i = 1; i < numCols; i++) {
          const dividerX = x + colXPositions[i];
          const frac = colXPositions[i] / width;
          const diagY = y + condH + slopeH * frac;
          elements.push(ln(dividerX, diagY, dividerX, y + headerH));
        }
      }

      // Measure children
      let maxChildH = 0;
      const childHeights = [];
      for (let i = 0; i < node.cases.length; i++) {
        const h = measureHeight(node.cases[i], fontSize, colW[i]);
        childHeights.push(h);
        maxChildH = Math.max(maxChildH, h);
      }
      if (node.defaultOn && node.defaultNode) {
        const h = measureHeight(node.defaultNode, fontSize, colW[numCols - 1]);
        childHeights.push(h);
        maxChildH = Math.max(maxChildH, h);
      }

      const followH = measureHeight(node.followElement, fontSize, width);
      const extraCaseH = (availH != null && availH > headerH + maxChildH + followH)
        ? availH - headerH - maxChildH - followH : 0;
      maxChildH += extraCaseH;

      // Render each case column
      let curX = x;
      for (let i = 0; i < node.cases.length; i++) {
        const caseResult = renderNode(node.cases[i], curX, y + headerH, colW[i], fontSize, maxChildH);
        elements.push(...caseResult.elements);
        if (i > 0) {
          elements.push(ln(curX, y + headerH, curX, y + headerH + maxChildH));
        }
        curX += colW[i];
      }
      // Default case
      if (node.defaultOn && node.defaultNode) {
        const defaultResult = renderNode(node.defaultNode, curX, y + headerH, colW[numCols - 1], fontSize, maxChildH);
        elements.push(...defaultResult.elements);
        elements.push(ln(curX, y + headerH, curX, y + headerH + maxChildH));
      }

      const totalH = headerH + maxChildH;
      const remainH = availH != null ? availH - totalH : undefined;
      const follow = renderNode(node.followElement, x, y + totalH, width, fontSize, remainH);
      return {
        elements: elements.concat(follow.elements),
        height: totalH + follow.height,
      };
    }

    case "HeadLoopNode":
    case "CountLoopNode": {
      const color = COLORS[node.type];
      const rowH = wrappedTextHeight(node.text || "", textW, fontSize);

      elements.push(bg(x, y, width, rowH, color));
      elements.push(ln(x, y, x + width, y));
      elements.push(ln(x, y, x, y + rowH));
      elements.push(textEl(node.text || "", x + PADDING_X, y, rowH, fontSize, textW));

      // Child body (indented)
      const innerW = width - LOOP_INDENT;
      const childH = measureHeight(node.child, fontSize, innerW);
      const bodyH = Math.max(childH, rowH * 0.5);

      elements.push(bg(x, y + rowH, LOOP_INDENT, bodyH, color));
      elements.push(ln(x, y + rowH, x, y + rowH + bodyH));
      elements.push(ln(x + LOOP_INDENT, y + rowH, x + LOOP_INDENT, y + rowH + bodyH));

      const childResult = renderNode(
        node.child, x + LOOP_INDENT, y + rowH, innerW, fontSize
      );
      elements.push(...childResult.elements);

      const totalH = rowH + bodyH;
      const remainH = availH != null ? availH - totalH : undefined;
      const follow = renderNode(node.followElement, x, y + totalH, width, fontSize, remainH);
      return {
        elements: elements.concat(follow.elements),
        height: totalH + follow.height,
      };
    }

    case "FootLoopNode": {
      const color = COLORS.FootLoopNode;
      const innerW = width - LOOP_INDENT;
      const rowH = wrappedTextHeight(node.text || "", textW, fontSize);
      const childH = measureHeight(node.child, fontSize, innerW);
      const bodyH = Math.max(childH, rowH * 0.5);

      // Left indent bar background (drawn first so border lines appear on top)
      elements.push(bg(x, y, LOOP_INDENT, bodyH, color));
      elements.push(ln(x, y, x + width, y));
      elements.push(ln(x, y, x, y + bodyH));
      elements.push(ln(x + LOOP_INDENT, y, x + LOOP_INDENT, y + bodyH));

      const childResult = renderNode(
        node.child, x + LOOP_INDENT, y, innerW, fontSize
      );
      elements.push(...childResult.elements);

      // Footer
      elements.push(bg(x, y + bodyH, width, rowH, color));
      elements.push(ln(x + LOOP_INDENT, y + bodyH, x + width, y + bodyH));
      elements.push(ln(x, y + bodyH, x, y + bodyH + rowH));
      elements.push(textEl(node.text || "", x + PADDING_X, y + bodyH, rowH, fontSize, textW));

      const totalH = bodyH + rowH;
      const remainH = availH != null ? availH - totalH : undefined;
      const follow = renderNode(node.followElement, x, y + totalH, width, fontSize, remainH);
      return {
        elements: elements.concat(follow.elements),
        height: totalH + follow.height,
      };
    }

    case "FunctionNode": {
      const color = COLORS.FunctionNode;
      let headerText = node.text || "";
      if (node.parameters && node.parameters.length > 0) {
        const params = node.parameters.map((p) => p.parName || "").join(", ");
        headerText += "(" + params + ")";
      } else {
        headerText += "()";
      }
      headerText += " {";

      const rowH = wrappedTextHeight(headerText, textW, fontSize);

      // Header
      elements.push(bg(x, y, width, rowH, color));
      elements.push(ln(x, y, x + width, y));
      elements.push(ln(x, y, x, y + rowH));
      elements.push(textEl(headerText, x + PADDING_X, y, rowH, fontSize, textW));

      // Child body
      const innerW = width - LOOP_INDENT;
      const childH = measureHeight(node.child, fontSize, innerW);
      const bodyH = Math.max(childH, rowH * 0.5);

      elements.push(bg(x, y + rowH, LOOP_INDENT, bodyH, color));
      elements.push(ln(x, y + rowH, x, y + rowH + bodyH));
      elements.push(ln(x + LOOP_INDENT, y + rowH, x + LOOP_INDENT, y + rowH + bodyH));

      const childResult = renderNode(
        node.child, x + LOOP_INDENT, y + rowH, innerW, fontSize
      );
      elements.push(...childResult.elements);

      // Footer "}"
      const footH = DEFAULT_ROW_HEIGHT * 0.6;
      elements.push(bg(x, y + rowH + bodyH, width, footH, color));
      elements.push(ln(x + LOOP_INDENT, y + rowH + bodyH, x + width, y + rowH + bodyH));
      elements.push(ln(x, y + rowH + bodyH, x, y + rowH + bodyH + footH));
      elements.push(textEl("}", x + PADDING_X, y + rowH + bodyH, footH, fontSize, null));

      const totalH = rowH + bodyH + footH;
      const remainH = availH != null ? availH - totalH : undefined;
      const follow = renderNode(node.followElement, x, y + totalH, width, fontSize, remainH);
      return {
        elements: elements.concat(follow.elements),
        height: totalH + follow.height,
      };
    }

    case "TryCatchNode": {
      const color = COLORS.TryCatchNode;
      const innerW = width - LOOP_INDENT;

      // Try header
      const tryRowH = wrappedTextHeight("Try", textW, fontSize);
      elements.push(bg(x, y, width, tryRowH, color));
      elements.push(ln(x, y, x + width, y));
      elements.push(ln(x, y, x, y + tryRowH));
      elements.push(textEl("Try", x + PADDING_X, y, tryRowH, fontSize, null));

      // Try body
      const tryH = measureHeight(node.tryChild, fontSize, innerW);
      const tryBodyH = Math.max(tryH, tryRowH * 0.5);

      elements.push(bg(x, y + tryRowH, LOOP_INDENT, tryBodyH, color));
      elements.push(ln(x, y + tryRowH, x, y + tryRowH + tryBodyH));
      elements.push(ln(x + LOOP_INDENT, y + tryRowH, x + LOOP_INDENT, y + tryRowH + tryBodyH));

      const tryResult = renderNode(
        node.tryChild, x + LOOP_INDENT, y + tryRowH, innerW, fontSize
      );
      elements.push(...tryResult.elements);

      // Catch header
      const catchY = y + tryRowH + tryBodyH;
      let catchLabel = "Catch";
      if (node.text) catchLabel += " (" + node.text + ")";
      const catchRowH = wrappedTextHeight(catchLabel, textW, fontSize);
      elements.push(bg(x, catchY, width, catchRowH, color));
      elements.push(ln(x + LOOP_INDENT, catchY, x + width, catchY));
      elements.push(ln(x, catchY, x, catchY + catchRowH));
      elements.push(textEl(catchLabel, x + PADDING_X, catchY, catchRowH, fontSize, textW));

      // Catch body
      const catchH = measureHeight(node.catchChild, fontSize, innerW);
      const catchBodyH = Math.max(catchH, catchRowH * 0.5);

      elements.push(bg(x, catchY + catchRowH, LOOP_INDENT, catchBodyH, color));
      elements.push(ln(x, catchY + catchRowH, x, catchY + catchRowH + catchBodyH));
      elements.push(ln(x + LOOP_INDENT, catchY + catchRowH, x + LOOP_INDENT, catchY + catchRowH + catchBodyH));
      elements.push(ln(x, catchY + catchRowH + catchBodyH, x + LOOP_INDENT, catchY + catchRowH + catchBodyH));

      const catchResult = renderNode(
        node.catchChild, x + LOOP_INDENT, catchY + catchRowH, innerW, fontSize
      );
      elements.push(...catchResult.elements);

      const totalH = tryRowH + tryBodyH + catchRowH + catchBodyH;
      const remainH = availH != null ? availH - totalH : undefined;
      const follow = renderNode(node.followElement, x, y + totalH, width, fontSize, remainH);
      return {
        elements: elements.concat(follow.elements),
        height: totalH + follow.height,
      };
    }

    default:
      return { elements: [], height: 0 };
  }
}

/**
 * Render a structogram tree to an SVG element.
 * @param {Object} tree - The structogram tree
 * @param {Object} [options]
 * @param {number} [options.width=600] - SVG coordinate width (used for layout calculations)
 * @param {number} [options.fontSize=14] - Font size in px
 * @returns {SVGSVGElement}
 */
export function renderStructogramSVG(tree, options = {}) {
  const width = options.width || 600;
  const fontSize = options.fontSize || 14;

  const totalHeight = measureHeight(tree, fontSize, width);
  const h = totalHeight || 40;
  const pad = STROKE_WIDTH;
  const svg = svgEl("svg", {
    xmlns: SVG_NS,
    viewBox: `${-pad} ${-pad} ${width + pad * 2} ${h + pad * 2}`,
    preserveAspectRatio: "xMinYMin meet",
  });
  svg.style.display = "block";
  svg.style.width = "100%";
  svg.style.height = "auto";

  const result = renderNode(tree, 0, 0, width, fontSize);
  for (const el of result.elements) {
    svg.appendChild(el);
  }

  // Right edge of entire structogram
  svg.appendChild(ln(width, 0, width, result.height));
  // Bottom closing line
  svg.appendChild(ln(0, result.height, width, result.height));

  return svg;
}
