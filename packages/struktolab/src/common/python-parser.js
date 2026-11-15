/**
 * Parse Python source code into a struktog tree.
 *
 * Python marks its blocks by indentation, so this parser works on logical
 * lines — a statement, however many physical lines its brackets span — and
 * their indentation. Like the Java and JavaScript parser it recognises the
 * structure and keeps expressions as the text the student wrote.
 *
 *   - if/elif/else, while, for, def, try/except/finally, match/case, class
 *   - `while True:` ending in `if not c: break` → do-while loop "c"
 *     (the shape the code generator writes for one)
 *   - `for i in range(a, b):` → count loop "i = a bis b - 1"
 *   - `for x in xs:` → count loop "x in xs"
 *   - print(…) → output, `x = input(…)` / `x = int(input(…))` → input
 *   - import lines, comments, docstrings and `pass` are dropped
 *   - `if __name__ == "__main__":` is boilerplate: its body is kept, the if is not
 *   - a program that is only `def main()` and its call shows main's body
 */

import {
  CodeParseError,
  beginParse,
  fail,
  chain,
  node,
  uid,
  functionNode,
  ioText,
  inclusiveEnd,
  splitTopLevel,
  unwrapMain,
  setSpan,
  attachFrame,
  withOrigin,
} from "./parse-common.js";

export { CodeParseError };

/* ── Logical lines ─────────────────────────────────────────── */

/**
 * Cut the source into logical lines: comments gone, lines joined across open
 * brackets and trailing backslashes.
 *
 * @returns {{text: string, indent: number, line: number}[]}
 */
function logicalLines(src) {
  const lines = [];
  const n = src.length;
  let i = 0;
  let line = 1;

  let text = "";
  let startLine = 1;
  let indent = 0;
  let atLineStart = true;
  const brackets = []; // [char, line]

  let startOffset = 0;
  const flush = (endOffset) => {
    const t = text.trim();
    if (t) lines.push({ text: t, indent, line: startLine, start: startOffset, end: endOffset });
    text = "";
    atLineStart = true;
  };

  while (i < n) {
    const c = src[i];

    if (atLineStart) {
      // Measure the indentation of a new logical line.
      let width = 0;
      while (i < n && (src[i] === " " || src[i] === "\t")) {
        width = src[i] === "\t" ? width + 4 - (width % 4) : width + 1;
        i++;
      }
      indent = width;
      startLine = line;
      startOffset = i;
      atLineStart = false;
      continue;
    }

    if (c === "#") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "\\" && src[i + 1] === "\n") {
      i += 2;
      line++;
      text += " ";
      continue;
    }
    if (c === "\n") {
      line++;
      i++;
      if (brackets.length) {
        // Inside brackets a line break is only a space.
        while (i < n && (src[i] === " " || src[i] === "\t")) i++;
        if (!/[([{]$/.test(text) && !/^[)\]}]/.test(src[i] || "")) text += " ";
        continue;
      }
      flush(i - 1);
      continue;
    }

    // Strings, with any prefix letters already in `text`.
    if (c === '"' || c === "'") {
      const triple = src.startsWith(c.repeat(3), i);
      const quote = triple ? c.repeat(3) : c;
      const start = i;
      const strLine = line;
      i += quote.length;
      for (;;) {
        if (i >= n) fail("string", strLine);
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src.startsWith(quote, i)) {
          i += quote.length;
          break;
        }
        if (src[i] === "\n") {
          if (!triple) fail("string", strLine);
          line++;
        }
        i++;
      }
      text += src.slice(start, i);
      continue;
    }

    if ("([{".includes(c)) brackets.push([c, line]);
    else if (")]}".includes(c)) {
      const open = brackets.pop();
      const want = { ")": "(", "]": "[", "}": "{" }[c];
      if (!open) fail("unexpected", line, c);
      if (open[0] !== want) fail("neverClosed", open[1], open[0]);
    }
    // Runs of spaces inside a line become one.
    if (c === " " || c === "\t") {
      if (!text.endsWith(" ")) text += " ";
      i++;
      continue;
    }
    text += c;
    i++;
  }
  if (brackets.length) {
    const [open, at] = brackets[brackets.length - 1];
    fail("neverClosed", at, open);
  }
  flush(n);
  return lines;
}

/* ── Statement helpers ─────────────────────────────────────── */

/** Index of the first `ch` outside brackets and strings, or -1. */
function topLevelIndex(text, ch, from = 0) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === ch && depth === 0) {
      // `:=` is the walrus, not the end of a header.
      if (ch === ":" && text[i + 1] === "=") continue;
      return i;
    }
  }
  return -1;
}

/** Split `a = 1; b = 2` at its top-level semicolons. */
function splitSimple(text) {
  const parts = [];
  let rest = text;
  for (;;) {
    const at = topLevelIndex(rest, ";");
    if (at < 0) break;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at + 1);
  }
  parts.push(rest.trim());
  return parts.filter(Boolean);
}

const COMPOUND = /^(if|elif|else|while|for|def|async\s+def|async\s+for|async\s+with|class|try|except|finally|with|match|case)\b/;

const OUTPUT = /^print\s*\(([\s\S]*)\)$/;
const ASSIGNMENT = /^([\p{L}_][\p{L}\p{N}_]*(?:\s*\[[^\]]*\])?)\s*(?::\s*[^=]+?)?\s*=(?!=)\s*([\s\S]+)$/u;
const READ = /^(?:(?:int|float|str|eval|bool|complex)\s*\(\s*)?input\s*\(/;
const SETUP = /^(?:import\s|from\s+\S+\s+import\s|pass$|\.\.\.$|global\s|nonlocal\s)/;

function simpleStatement(text) {
  if (SETUP.test(text)) return [];
  // A string on its own is a docstring or a comment in disguise.
  if (/^[rbuf]*("""|'''|"|')[\s\S]*\1$/i.test(text) && topLevelIndex(text, "+") < 0) return [];

  const out = OUTPUT.exec(text);
  if (out) {
    const args = splitTopLevel(out[1]).filter((a) => !/^(?:sep|end|file|flush)\s*=/.test(a));
    const n = node("OutputNode", args.length === 1 ? ioText(args[0]) : args.join(", "));
    return [withOrigin(n, "python", text)];
  }
  const assign = ASSIGNMENT.exec(text);
  if (assign && READ.test(assign[2].trim())) {
    return [withOrigin(node("InputNode", assign[1].replace(/\s+/g, "")), "python", text)];
  }
  return [node("TaskNode", text)];
}

/** `range(…)` arguments as a count-loop range, or null. */
function countRange(variable, iterable, rangeWord) {
  const m = /^range\s*\(([\s\S]*)\)$/.exec(iterable);
  if (!m || !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(variable)) return null;
  const args = splitTopLevel(m[1]);
  if (args.length === 1) return `${variable} = 0 ${rangeWord} ${inclusiveEnd(args[0])}`;
  if (args.length === 2) return `${variable} = ${args[0]} ${rangeWord} ${inclusiveEnd(args[1])}`;
  return null;
}

/* ── Parser ────────────────────────────────────────────────── */

class Parser {
  constructor(lines, options) {
    this.lines = lines;
    this.pos = 0;
    this.rangeWord = options.rangeWord;
    this.defaultLabel = options.defaultLabel;
  }

  /** Statements indented exactly `indent`, until a line indented less. */
  block(indent) {
    const items = [];
    while (this.pos < this.lines.length) {
      const l = this.lines[this.pos];
      if (l.indent < indent) break;
      if (l.indent > indent) fail("indentUnexpected", l.line);
      const nodes = this.statement();
      setSpan(nodes, l.start, this.lines[this.pos - 1]?.end);
      items.push(...nodes);
    }
    return items;
  }

  /** Split a compound statement's line into keyword, header and inline body. */
  header(l, keyword) {
    const colon = topLevelIndex(l.text, ":");
    if (colon < 0) fail("colonAfter", l.line, keyword);
    return {
      head: l.text.slice(keyword.length, colon).trim(),
      inline: l.text.slice(colon + 1).trim(),
    };
  }

  /** The body after a header: on the same line, or the indented lines below. */
  body(l, keyword, inline) {
    this.pos++;
    if (inline) return splitSimple(inline).flatMap((s) => this.inlineStatement(s, l));
    const next = this.lines[this.pos];
    if (!next || next.indent <= l.indent) fail("indentExpected", l.line, keyword);
    const items = this.block(next.indent);
    const after = this.lines[this.pos];
    // Back out to an indentation that is not the header's, nor any enclosing one.
    if (after && after.indent > l.indent) fail("indentMismatch", after.line);
    return items;
  }

  /** A statement written after a colon on the header's line. */
  inlineStatement(text, l) {
    const saved = this.lines;
    const savedPos = this.pos;
    this.lines = [{ text, indent: 0, line: l.line }];
    this.pos = 0;
    try {
      return this.statement();
    } finally {
      this.lines = saved;
      this.pos = savedPos;
    }
  }

  /** Whether the next line is the clause `keyword` of the statement at `indent`. */
  clause(keyword, indent) {
    const l = this.lines[this.pos];
    return Boolean(l && l.indent === indent && new RegExp(`^${keyword}\\b`).test(l.text));
  }

  statement() {
    const l = this.lines[this.pos];
    const m = COMPOUND.exec(l.text);
    // `match = 3` and `case(x)` are names, not statements; a header needs its colon.
    const kw = m && (topLevelIndex(l.text, ":") >= 0 || !["match", "case"].includes(m[1])) ? m[1] : null;

    switch (kw) {
      case "if":
        return this.ifStatement(l);
      case "while":
        return this.whileStatement(l);
      case "for":
      case "async for":
        return this.forStatement(l, kw);
      case "def":
      case "async def":
        return [this.defStatement(l, kw)];
      case "class": {
        const { inline } = this.header(l, "class");
        // Methods become function blocks; `self` is no parameter a reader needs.
        return this.body(l, "class", inline).map((n) => {
          if (n.type === "FunctionNode" && /^(self|cls)$/.test(n.parameters[0]?.parName)) {
            n.parameters.shift();
          }
          return n;
        });
      }
      case "try":
        return this.tryStatement(l);
      case "with":
      case "async with": {
        const { head, inline } = this.header(l, kw);
        return [node("TaskNode", `${kw} ${head}`), ...this.body(l, kw, inline)];
      }
      case "match":
        return [this.matchStatement(l)];
      case "elif":
      case "else":
        fail("withoutIf", l.line, kw);
      // falls through (fail throws)
      case "except":
      case "finally":
        fail("withoutTry", l.line, kw);
      // falls through
      case "case":
        fail("outsideSwitch", l.line, "case");
      // falls through
      default: {
        this.pos++;
        return splitSimple(l.text).flatMap((s) => simpleStatement(s));
      }
    }
  }

  ifStatement(l) {
    const { head, inline } = this.header(l, "if");
    const trueItems = this.body(l, "if", inline);

    // `if __name__ == "__main__":` only says "run this as a script".
    if (/^__name__\s*==\s*["']__main__["']$/.test(head)) return trueItems;

    let falseItems = [];
    if (this.clause("elif", l.indent)) {
      const elif = this.lines[this.pos];
      // An elif is an if in the else branch.
      falseItems = this.ifStatement({ ...elif, text: elif.text.replace(/^elif/, "if") });
    } else if (this.clause("else", l.indent)) {
      const e = this.lines[this.pos];
      falseItems = this.body(e, "else", this.header(e, "else").inline);
    }
    return [
      node("BranchNode", head, { trueChild: chain(trueItems), falseChild: chain(falseItems) }),
    ];
  }

  whileStatement(l) {
    const { head, inline } = this.header(l, "while");
    const items = this.body(l, "while", inline);
    const elseItems = this.clause("else", l.indent) ? this.elseClause() : [];

    // `while True:` … `if not c: break` is how Python writes a do-while.
    const last = items[items.length - 1];
    if (/^True$/.test(head) && last && last.type === "BranchNode" && /^not\s/.test(last.text)) {
      const t = last.trueChild.followElement;
      const onlyBreak = t && t.type === "TaskNode" && t.text === "break" && !t.followElement.followElement;
      const noElse = last.falseChild.followElement?.type === "Placeholder";
      if (onlyBreak && noElse) {
        const cond = last.text.replace(/^not\s+/, "").replace(/^\((.*)\)$/, "$1");
        return [node("FootLoopNode", cond, { child: chain(items.slice(0, -1)) }), ...elseItems];
      }
    }
    return [node("HeadLoopNode", head, { child: chain(items) }), ...elseItems];
  }

  /** A loop's `else:` runs after the loop ends normally — so it goes after it. */
  elseClause() {
    const e = this.lines[this.pos];
    return this.body(e, "else", this.header(e, "else").inline);
  }

  forStatement(l, kw) {
    const { head, inline } = this.header(l, kw);
    const inAt = head.search(/\sin\s/);
    if (inAt < 0) fail("forIn", l.line);
    const variable = head.slice(0, inAt).trim();
    const iterable = head.slice(inAt + 4).trim();
    const text = countRange(variable, iterable, this.rangeWord) ?? `${variable} in ${iterable}`;
    const items = this.body(l, kw, inline);
    const elseItems = this.clause("else", l.indent) ? this.elseClause() : [];
    return [node("CountLoopNode", text, { child: chain(items) }), ...elseItems];
  }

  defStatement(l, kw) {
    const { head, inline } = this.header(l, kw);
    const m = /^([\p{L}_][\p{L}\p{N}_]*)\s*\(([\s\S]*)\)\s*(?:->\s*([\s\S]+))?$/u.exec(head);
    if (!m) fail("expected", l.line, "(", head);
    const returnType = (m[3] || "").trim();
    return functionNode(m[1], splitTopLevel(m[2]), this.body(l, kw, inline), returnType);
  }

  tryStatement(l) {
    const { inline } = this.header(l, "try");
    let tryItems = this.body(l, "try", inline);

    const handlers = [];
    while (this.clause("except", l.indent)) {
      const e = this.lines[this.pos];
      const { head, inline: eInline } = this.header(e, "except");
      // `except ValueError as e` is written "ValueError e", as Java has it.
      const text = head.replace(/^\*\s*/, "").replace(/\s+as\s+/, " ");
      handlers.push({ text, items: this.body(e, "except", eInline) });
    }
    // try … else: runs when nothing was raised — the end of the try block.
    if (this.clause("else", l.indent)) tryItems = [...tryItems, ...this.elseClause()];
    let finallyItems = [];
    const hasFinally = this.clause("finally", l.indent);
    if (hasFinally) {
      const f = this.lines[this.pos];
      finallyItems = this.body(f, "finally", this.header(f, "finally").inline);
    }
    if (!handlers.length && !hasFinally) fail("tryNeedsCatch", l.line);

    let items = tryItems;
    for (const h of handlers) {
      items = [node("TryCatchNode", h.text, { tryChild: chain(items), catchChild: chain(h.items) })];
    }
    return [...items, ...finallyItems];
  }

  matchStatement(l) {
    const { head, inline } = this.header(l, "match");
    if (inline) fail("indentExpected", l.line, "match");
    this.pos++;
    const first = this.lines[this.pos];
    if (!first || first.indent <= l.indent) fail("indentExpected", l.line, "match");

    const cases = [];
    let defaultItems = null;
    while (this.clause("case", first.indent)) {
      const c = this.lines[this.pos];
      const { head: pattern, inline: cInline } = this.header(c, "case");
      const items = this.body(c, "case", cInline);
      if (pattern === "_") defaultItems = items;
      else {
        cases.push({
          id: uid(),
          type: "InsertCase",
          text: pattern.replace(/\s*\|\s*/g, ", "),
          followElement: chain(items),
        });
      }
    }
    const after = this.lines[this.pos];
    if (after && after.indent > l.indent) fail("expectedCase", after.line, after.text.split(/\s/)[0]);

    return node("CaseNode", head, {
      defaultOn: defaultItems !== null,
      defaultNode: {
        id: uid(),
        type: "InsertCase",
        text: this.defaultLabel,
        followElement: chain(defaultItems || []),
      },
      cases,
    });
  }
}

/**
 * Parse Python source into a struktog tree.
 *
 * @param {string} source - Python source code
 * @param {Object} [options]
 * @param {"de"|"en"} [options.lang="de"] - language of error messages and count-loop ranges
 * @param {string} [options.rangeWord] - word for count-loop ranges, "bis" or "to" by `lang`
 * @returns {Object} A struktog tree rooted at an InsertNode
 * @throws {CodeParseError} when the code's structure cannot be read
 */
export function parsePython(source, options = {}) {
  const lang = beginParse(options, "__py_");
  const lines = logicalLines(source || "");
  const parser = new Parser(lines, {
    rangeWord: options.rangeWord || (lang === "en" ? "to" : "bis"),
    defaultLabel: lang === "en" ? "Default" : "Sonst",
  });
  const first = lines[0];
  const items = first ? parser.block(first.indent) : [];
  if (parser.pos < lines.length) fail("indentMismatch", lines[parser.pos].line);
  const algorithm = unwrapMain(items, (n) => n.type === "TaskNode" && /^main\s*\(\s*\)$/.test(n.text));
  return attachFrame(chain(algorithm), algorithm, source || "", "python");
}
