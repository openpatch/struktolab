/**
 * A function block's header: name, parameters and return type.
 *
 * A structogram is written in one language at a time, so the parts are kept
 * exactly as the student wrote them — parameters as `int a` in Java and as
 * `a: int` in Python — and nothing is translated. Only the order differs:
 * Java writes `int max(int a, int b)`, Python and the pseudocode write
 * `max(a: int, b: int) -> int`, JavaScript has no return types.
 */

/**
 * The header as one line in a language's order.
 * @param {Object} node a FunctionNode
 * @param {"arrow"|"java"} [style="arrow"] `max(a) -> int` or `int max(int a)`
 */
export function functionHeader(node, style = "arrow") {
  const params = (node.parameters || []).map((p) => p.parName || "").join(", ");
  const call = `${node.text || ""}(${params})`;
  const type = node.returnType || "";
  if (!type) return call;
  return style === "java" ? `${type} ${call}` : `${call} -> ${type}`;
}

/**
 * Read a header line back, in the same order `functionHeader` wrote it.
 * Without brackets the whole line is the name.
 *
 * @returns {{name: string, parameters: string[], returnType: string}}
 */
export function parseFunctionHeader(text, style = "arrow") {
  const line = (text || "").replace(/\s+/g, " ").trim();
  const m =
    style === "java"
      ? /^(?:(.+?)\s+)?([\p{L}_$][\p{L}\p{N}_$]*)\s*\((.*)\)$/u.exec(line)
      : /^([\p{L}_$][\p{L}\p{N}_$]*)\s*\((.*)\)\s*(?:->\s*(.+))?$/u.exec(line);
  if (!m) return { name: line, parameters: [], returnType: "" };
  return style === "java"
    ? { name: m[2], parameters: splitParameters(m[3]), returnType: (m[1] || "").trim() }
    : { name: m[1], parameters: splitParameters(m[2]), returnType: (m[3] || "").trim() };
}

/** "int a, Map<K, V> m" → ["int a", "Map<K, V> m"]: commas inside brackets stay. */
export function splitParameters(text) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of text || "") {
    if ("(<[{".includes(ch)) depth++;
    else if (")>]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

/** Parameter texts as the model keeps them. */
export function toParameters(texts) {
  return texts.map((t, i) => ({ pos: String(i * 3), parName: t.trim() }));
}
