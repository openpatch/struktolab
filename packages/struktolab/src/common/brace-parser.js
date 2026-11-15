/**
 * Parse Java or JavaScript source code into a struktog tree.
 *
 * This is the reverse of the code generator: a student writes the algorithm in
 * code and gets the structogram. It is not a compiler. Statements are
 * recognised structurally (if, while, do/while, for, switch, try, functions,
 * classes); expressions are kept as the text the student wrote. Both languages
 * share their braces, so one parser reads both, with a `js` switch for what
 * differs.
 *
 * What it does with the code around the algorithm:
 *   - package/import lines, annotations and comments are dropped
 *   - a class is a container only: its methods become function blocks
 *   - Java: a program whose only method is `main` shows just main's body
 *   - `Scanner sc = new Scanner(System.in)` and friends are setup, not
 *     algorithm, and are dropped
 *   - System.out.println / console.log / alert → output
 *   - `x = sc.nextInt()` / `x = prompt(…)` → input
 *   - `for (int i = 0; i < n; i++)` → count loop "i = 0 bis n - 1"
 *   - `for (int x : arr)` / `for (const x of arr)` → count loop "x in arr"
 *
 * Anything it does not understand as structure becomes a plain statement, so
 * nothing the student wrote silently disappears.
 */

import {
  CodeParseError,
  beginParse,
  fail,
  chain,
  uid,
  node,
  functionNode,
  ioText,
  inclusiveEnd,
  splitTopLevel,
  unwrapMain,
} from "./parse-common.js";

/** Thrown for code whose structure cannot be read; `.line` says where. */
export { CodeParseError, CodeParseError as JavaParseError };

/* ── Tokenizer ─────────────────────────────────────────────── */

const OPERATORS = [
  ">>>=", "===", "!==", "**=", "??=", "&&=", "||=", "<<=", ">>=", ">>>", "...",
  "->", "=>", "::", "?.", "??", "**", "++", "--", "&&", "||",
  "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=",
  "<<", ">>",
];

const IDENT_START = /[\p{L}_$]/u;
const IDENT_PART = /[\p{L}\p{N}_$]/u;
const NUMBER = /(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?|\.\d[\d_]*(?:[eE][+-]?\d+)?)[lLfFdD]?/y;

function tokenize(src) {
  const tokens = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  let space = false;

  const countLines = (from, to) => {
    for (let j = from; j < to; j++) if (src[j] === "\n") line++;
  };

  while (i < n) {
    const c = src[i];
    if (c === "\n") { line++; i++; space = true; continue; }
    if (/\s/.test(c)) { i++; space = true; continue; }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      space = true;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      countLines(i, stop);
      i = stop;
      space = true;
      continue;
    }

    const start = i;
    const startLine = line;
    let type;
    if (src.startsWith('"""', i)) {
      const end = src.indexOf('"""', i + 3);
      if (end < 0) fail("textBlock", line);
      i = end + 3;
      countLines(start, i);
      type = "string";
    } else if (c === "`") {
      // JavaScript template literal; ${…} may hold braces and strings of its own.
      i++;
      let depth = 0;
      while (i < n && !(src[i] === "`" && depth === 0)) {
        if (src[i] === "\\") i++;
        else if (src[i] === "$" && src[i + 1] === "{") { depth++; i++; }
        else if (src[i] === "}" && depth > 0) depth--;
        i++;
      }
      if (i >= n) fail("string", line);
      i++;
      countLines(start, i);
      type = "string";
    } else if (c === '"' || c === "'") {
      i++;
      while (i < n && src[i] !== c && src[i] !== "\n") {
        if (src[i] === "\\") i++;
        i++;
      }
      if (src[i] !== c) {
        fail(c === '"' ? "string" : "char", line);
      }
      i++;
      type = "string";
    } else if (IDENT_START.test(c)) {
      while (i < n && IDENT_PART.test(src[i])) i++;
      type = "ident";
    } else if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
      NUMBER.lastIndex = i;
      NUMBER.exec(src);
      i = NUMBER.lastIndex;
      type = "number";
    } else {
      const op = OPERATORS.find((o) => src.startsWith(o, i));
      i += op ? op.length : 1;
      type = "op";
    }
    tokens.push({ type, value: src.slice(start, i), line: startLine, space });
    space = false;
  }
  tokens.push({ type: "eof", value: "", line, space: false });
  return tokens;
}

/** The tokens as the student wrote them, every run of whitespace one space. */
function joinTokens(tokens) {
  let out = "";
  tokens.forEach((t, idx) => {
    if (idx > 0 && t.space) out += " ";
    out += t.value;
  });
  return out;
}

/* ── Statement classification ──────────────────────────────── */

const MODIFIERS = new Set([
  "public", "private", "protected", "static", "final", "abstract", "native",
  "synchronized", "transient", "volatile", "strictfp", "sealed", "non",
]);

/** Words after which a statement can go on on the next line. */
const CONTINUES = new Set(["return", "throw", "new", "yield", "assert", "final", "instanceof", "typeof", "await", "in", "of"]);

/** JavaScript words that come before a declaration and do not change it. */
const JS_PREFIXES = new Set(["export", "default", "async"]);

/** Lines that set up I/O rather than being part of the algorithm. */
const SETUP = /^(?:final\s+)?(?:java\.util\.)?(?:Scanner|BufferedReader|InputStreamReader|Console)\s+\w+\s*=\s*(?:new\s+\w|System\.console\s*\()/;

const OUTPUT = /^System\s*\.\s*(?:out|err)\s*\.\s*(println|print|printf|format)\s*\(([\s\S]*)\)$/;

/** `x = sc.nextInt()`, `int n = Integer.parseInt(reader.readLine())`, … */
const ASSIGNMENT = /^(?:final\s+)?(?:[\w$.<>?,\[\]\s]+?\s+)?([\p{L}_$][\p{L}\p{N}_$]*(?:\s*\[[^\]]*\])*)\s*=(?!=)\s*([\s\S]+)$/u;
const READ_CALL = /^(?:[\w.]+\s*\.\s*(?:parse\w+|valueOf)\s*\(\s*)?(?:[\w.]+(?:\s*\(\s*\))?\s*\.\s*)+(?:next\w*|readLine)\s*\(\s*\)\s*\)?$/;
const DIALOG = /^(?:javax\.swing\.)?JOptionPane\s*\.\s*showInputDialog\s*\(/;

const JS_OUTPUT = /^(?:console\s*\.\s*(?:log|info|warn|error)|alert|document\s*\.\s*write(?:ln)?)\s*\(([\s\S]*)\)$/;
/** `prompt(…)`, `Number(prompt(…))`, `parseInt(prompt(…), 10)`, `+prompt(…)` */
const JS_READ = /^(?:\+|(?:Number|parseInt|parseFloat|String|Boolean)\s*\(\s*)?(?:window\s*\.\s*)?prompt\s*\(/;
/** Lines that only set JavaScript up. */
const JS_SETUP = /^(?:["']use strict["']$|import\b)/;

function simpleStatement(text, js) {
  if (js ? JS_SETUP.test(text) : SETUP.test(text)) return [];

  const out = (js ? JS_OUTPUT : OUTPUT).exec(text);
  if (out) return [node("OutputNode", ioText(out[js ? 1 : 2]))];

  const assign = ASSIGNMENT.exec(text);
  if (assign) {
    const rhs = assign[2].trim();
    const isRead = js ? JS_READ.test(rhs) : READ_CALL.test(rhs) || DIALOG.test(rhs);
    if (isRead) return [node("InputNode", assign[1].replace(/\s+/g, ""))];
  }
  return [node("TaskNode", text)];
}

/** `for (int i = 0; i < n; i++)` in the words a count loop is written in. */
function countRange(init, cond, update, rangeWord) {
  const i = /^(?:final\s+)?(?:\w+\s+)?([\p{L}_$][\p{L}\p{N}_$]*)\s*=\s*(.+)$/u.exec(init);
  if (!i) return null;
  const v = i[1];
  const from = i[2].trim();
  const esc = v.replace(/\$/g, "\\$");

  const c = new RegExp(`^${esc}\\s*(<=|<)\\s*(.+)$`, "u").exec(cond);
  if (!c) return null;

  const step = update.replace(/\s+/g, "");
  if (![`${v}++`, `++${v}`, `${v}+=1`, `${v}=${v}+1`].includes(step)) return null;

  const to = c[1] === "<" ? inclusiveEnd(c[2]) : c[2].trim();
  return `${v} = ${from} ${rangeWord} ${to}`;
}

/* ── Parser ────────────────────────────────────────────────── */

class Parser {
  constructor(tokens, options) {
    this.tokens = tokens;
    this.pos = 0;
    this.rangeWord = options.rangeWord;
    this.defaultLabel = options.defaultLabel;
    /** JavaScript: semicolons are optional, functions have their own keyword. */
    this.js = options.js;
  }

  peek(k = 0) {
    return this.tokens[Math.min(this.pos + k, this.tokens.length - 1)];
  }
  next() {
    const t = this.peek();
    if (t.type !== "eof") this.pos++;
    return t;
  }
  is(value, k = 0) {
    const t = this.peek(k);
    return t.type !== "string" && t.value === value;
  }
  eat(value) {
    if (this.is(value)) return this.next();
    return null;
  }
  expect(value) {
    if (this.is(value)) return this.next();
    const t = this.peek();
    if (t.type === "eof") fail("expectedEnd", t.line, value);
    fail("expected", t.line, value, t.value);
  }

  /** Index just past the bracket matching the one at `index`. */
  matching(index) {
    const open = this.tokens[index].value;
    const close = { "(": ")", "[": "]", "{": "}", "<": ">" }[open];
    let depth = 0;
    for (let j = index; j < this.tokens.length; j++) {
      const t = this.tokens[j];
      if (t.type === "eof") break;
      if (t.type === "string") continue;
      if (open === "<") {
        // Generic brackets: >> and >>> close more than one.
        if (t.value === "<") depth++;
        else if (/^>+$/.test(t.value)) depth -= t.value.length;
        else if (![",", ".", "?", "[", "]", "&", "@"].includes(t.value) && t.type !== "ident") return -1;
        if (depth <= 0) return j + 1;
        continue;
      }
      if (t.value === open) depth++;
      else if (t.value === close && --depth === 0) return j + 1;
    }
    fail("neverClosed", this.tokens[index].line, open);
  }

  /** `( … )` as text, the brackets dropped. */
  parenText() {
    const open = this.pos;
    this.expect("(");
    const end = this.matching(open);
    const text = joinTokens(this.tokens.slice(open + 1, end - 1));
    this.pos = end;
    return text;
  }

  /**
   * Tokens up to the `;` that ends a statement, brackets balanced. In
   * JavaScript the semicolon is optional: a line break, a `}` or the end of
   * the code ends the statement as well, where Java would report it missing.
   */
  untilSemicolon() {
    const start = this.pos;
    let depth = 0;
    const endHere = () => joinTokens(this.tokens.slice(start, this.pos));
    for (;;) {
      const t = this.peek();
      if (this.js && depth === 0 && this.pos > start && (t.type === "eof" || t.value === "}")) {
        return endHere();
      }
      if (t.type === "eof") {
        fail("semicolonAfter", this.tokens[start].line, joinTokens(this.tokens.slice(start, this.pos)));
      }
      if (t.type !== "string") {
        if ("([{".includes(t.value)) depth++;
        else if (")]}".includes(t.value)) {
          if (depth === 0) {
            // The statement before the bracket is the one missing it.
            if (this.pos > start) {
              fail("semicolonAfter", this.tokens[this.pos - 1].line, joinTokens(this.tokens.slice(start, this.pos)));
            }
            fail("semicolonBefore", t.line, t.value);
          }
          depth--;
        } else if (t.value === ";" && depth === 0) break;
      }
      // `int x = 1⏎int y = 2;` — two words on two lines with nothing joining
      // them is a forgotten semicolon, the mistake made most often.
      const prev = this.tokens[this.pos - 1];
      if (
        depth === 0 && this.pos > start && t.line > prev.line &&
        t.type !== "op" &&
        (prev.type !== "op" || [")", "]", "++", "--"].includes(prev.value)) &&
        !CONTINUES.has(prev.value)
      ) {
        if (this.js) return endHere();
        fail("semicolonAfter", prev.line, joinTokens(this.tokens.slice(start, this.pos)));
      }
      this.next();
    }
    const text = joinTokens(this.tokens.slice(start, this.pos));
    if (!this.js) this.expect(";");
    return text;
  }

  skipBalanced() {
    this.pos = this.matching(this.pos);
  }

  skipAnnotation() {
    this.next(); // @
    this.next(); // name
    while (this.is(".") && this.peek(1).type === "ident") {
      this.next();
      this.next();
    }
    if (this.is("(")) this.skipBalanced();
  }

  /** Statements and declarations up to `end` ("}" or end of file). */
  parseSequence(end, member) {
    const items = [];
    for (;;) {
      if (end === "}" ? this.is("}") : this.peek().type === "eof") break;
      if (this.peek().type === "eof") {
        fail("missing", this.peek().line, "}");
      }
      items.push(...(member ? this.parseMember() : this.parseStatement()));
    }
    return items;
  }

  /** Something that can stand in a class body — or at the top of the file. */
  parseMember() {
    if (this.is("package") || this.is("import")) {
      this.untilSemicolon();
      return [];
    }
    if (this.is(";")) {
      this.next();
      return [];
    }

    // Modifiers and annotations, remembering where the declaration started.
    const start = this.pos;
    for (;;) {
      if (this.js) {
        // static, async, get, set — but only in front of a name, as `get(x)` is a method too.
        const word = this.peek().value;
        if (["static", "async", "get", "set"].includes(word) && this.peek(1).type === "ident") {
          this.next();
          continue;
        }
        break;
      }
      if (this.is("@") && !this.is("interface", 1)) this.skipAnnotation();
      else if (this.peek().type === "ident" && MODIFIERS.has(this.peek().value)) {
        if (this.is("non") && this.is("-", 1)) { this.next(); this.next(); }
        this.next();
      } else break;
    }
    const hadModifiers = this.pos > start;

    if (this.is("class") || this.is("interface") || this.is("enum") || this.is("record") || (this.is("@") && this.is("interface", 1))) {
      return this.parseClass();
    }
    // `static { … }` initializer
    if (this.is("{")) {
      this.next();
      const body = this.parseSequence("}", false);
      this.expect("}");
      return body;
    }

    const method = this.methodAhead();
    if (method) return [this.parseMethod(method)];

    // Not a declaration: a statement. Modifiers (`final int x`) are part of it.
    if (hadModifiers) this.pos = start;
    return this.parseStatement();
  }

  /**
   * Whether a method or constructor declaration starts here. Scans the header
   * — return type, name, parameters — and looks for the body or `throws`
   * after it, which is what tells `foo(x) {` from the call `foo(x);`.
   */
  methodAhead() {
    let j = this.pos;
    if (this.tokens[j].value === "<") {
      j = this.matching(j);
      if (j < 0) return null;
    }
    const first = j;
    while (j < this.tokens.length) {
      const t = this.tokens[j];
      if (t.type === "eof" || t.type === "string") return null;
      if ([";", "=", "{", "}", ")"].includes(t.value)) return null;
      if (t.value === "(") break;
      if (t.value === "<") {
        const after = this.matching(j);
        if (after < 0) return null;
        j = after;
        continue;
      }
      j++;
    }
    const nameTok = this.tokens[j - 1];
    if (j - 1 < first || !nameTok || nameTok.type !== "ident") return null;
    if (["if", "while", "for", "switch", "try", "catch", "synchronized", "return", "new", "throw"].includes(nameTok.value)) return null;
    const after = this.matching(j);
    const follow = this.tokens[after];
    if (!follow || !(follow.value === "{" || follow.value === "throws")) return null;
    return { nameIndex: j - 1, parenIndex: j, typeStart: first };
  }

  parseMethod({ nameIndex, parenIndex, typeStart }) {
    const name = this.tokens[nameIndex].value;
    // Everything between the modifiers and the name; a constructor has none.
    const returnType = this.js ? "" : joinTokens(this.tokens.slice(typeStart, nameIndex));
    this.pos = parenIndex;
    const parameters = this.parameters();
    while (!this.is("{")) {
      if (this.peek().type === "eof") fail("missing", this.peek().line, "{");
      this.next(); // throws …
    }
    return functionNode(name, parameters, this.block(), returnType);
  }

  /** `(int a, final int b)` → ["int a", "int b"] */
  parameters() {
    return splitTopLevel(this.parenText())
      .map((p) => p.replace(/@\w+(?:\([^)]*\))?\s*/g, "").replace(/^final\s+/, "").trim())
      .filter(Boolean);
  }

  /** `{ … }` as nodes. */
  block() {
    this.expect("{");
    const body = this.parseSequence("}", false);
    this.expect("}");
    return body;
  }

  /**
   * JavaScript functions: `function f(a) {…}`, and a constant holding one —
   * `const f = (a) => {…}`, `const f = function (a) {…}`. Returns null when
   * the statement here is not one of them.
   */
  jsFunction() {
    const start = this.pos;
    if (this.is("async") && this.is("function", 1)) this.next();
    if (this.eat("function")) {
      this.eat("*");
      if (this.peek().type !== "ident" || !this.is("(", 1)) {
        this.pos = start;
        return null;
      }
      const name = this.next().value;
      return functionNode(name, this.parameters(), this.block());
    }

    if (!["const", "let", "var"].includes(this.peek().value) || this.peek(1).type !== "ident" || !this.is("=", 2)) {
      return null;
    }
    const name = this.peek(1).value;
    this.pos += 3;
    this.eat("async");
    let parameters = null;
    if (this.eat("function")) {
      if (this.peek().type === "ident") this.next();
      if (this.is("(")) parameters = this.parameters();
    } else if (this.is("(")) {
      const after = this.matching(this.pos);
      if (this.tokens[after]?.value === "=>") {
        parameters = this.parameters();
        this.expect("=>");
      }
    } else if (this.peek().type === "ident" && this.is("=>", 1)) {
      parameters = [this.next().value];
      this.expect("=>");
    }
    // Only a function with a body of statements is worth a function block;
    // `const double = (x) => x * 2` stays the one statement it is.
    if (!parameters || !this.is("{")) {
      this.pos = start;
      return null;
    }
    const fn = functionNode(name, parameters, this.block());
    this.eat(";");
    return fn;
  }

  parseClass() {
    const kind = this.next().value;
    if (kind === "@") this.next(); // @interface
    // Interfaces, enums, records and annotation types hold no algorithm a
    // structogram would show: skip them whole.
    const containsCode = kind === "class";
    while (!this.is("{")) {
      if (this.peek().type === "eof") fail("missing", this.peek().line, "{");
      if (this.is("(")) this.skipBalanced();
      else this.next();
    }
    if (!containsCode) {
      this.skipBalanced();
      return [];
    }
    this.next();
    // A JavaScript class body may hold fields and methods but no statements.
    const members = this.parseSequence("}", true);
    this.expect("}");
    return members;
  }

  /** One statement as structogram nodes — often one, sometimes none or several. */
  parseStatement() {
    const t = this.peek();
    if (t.type === "eof") fail("endedInStatement", t.line);

    if (this.js && t.type === "ident") {
      if (JS_PREFIXES.has(t.value) && !this.is("(", 1) && !this.is("=", 1) && !this.is(".", 1)) {
        if (!(t.value === "async" && !this.is("function", 1))) {
          this.next(); // export / export default / async before a declaration
          return this.parseStatement();
        }
      }
      const fn = this.jsFunction();
      if (fn) return [fn];
    }

    if (t.type === "ident" || t.type === "op") {
      switch (t.value) {
        case "{": {
          this.next();
          const body = this.parseSequence("}", false);
          this.expect("}");
          return body;
        }
        case ";":
          this.next();
          return [];
        case "@":
          this.skipAnnotation();
          return [];
        case "if":
          return [this.parseIf()];
        case "while": {
          this.next();
          const cond = this.parenText();
          return [node("HeadLoopNode", cond, { child: chain(this.parseStatement()) })];
        }
        case "do": {
          this.next();
          const body = this.parseStatement();
          this.expect("while");
          const cond = this.parenText();
          if (this.js) this.eat(";");
          else this.expect(";");
          return [node("FootLoopNode", cond, { child: chain(body) })];
        }
        case "for":
          return [this.parseFor()];
        case "switch":
          if (this.is("(", 1)) return [this.parseSwitch()];
          break;
        case "try":
          return this.parseTry();
        case "synchronized":
          if (this.is("(", 1)) {
            this.next();
            this.parenText();
            return this.parseStatement();
          }
          break;
        case "class":
        case "interface":
        case "enum":
        case "record":
          if (this.peek(1).type === "ident") return this.parseClass();
          break;
        case "else":
          fail("withoutIf", t.line, "else");
        case "catch":
        case "finally":
          fail("withoutTry", t.line, t.value);
        case "case":
        case "default":
          if (!this.is("(", 1) && !this.is(".", 1)) {
            fail("outsideSwitch", t.line, t.value);
          }
          break;
        case "}":
          fail("unexpected", t.line, "}");
        default:
          break;
      }
      // A label, `outer: for (…)`, names the loop for break/continue.
      if (t.type === "ident" && this.is(":", 1)) {
        this.next();
        this.next();
        return this.parseStatement();
      }
    }

    const text = this.untilSemicolon();
    if (this.js) this.eat(";");
    return simpleStatement(text, this.js);
  }

  parseIf() {
    this.expect("if");
    const cond = this.parenText();
    const thenItems = this.parseStatement();
    const elseItems = this.eat("else") ? this.parseStatement() : [];
    return node("BranchNode", cond, {
      trueChild: chain(thenItems),
      falseChild: chain(elseItems),
    });
  }

  parseFor() {
    const forTok = this.expect("for");
    const open = this.pos;
    this.expect("(");
    const close = this.matching(open);
    const inner = this.tokens.slice(open + 1, close - 1);
    this.pos = close;

    // Split the header at the top-level `;` — or `:` for a for-each loop.
    const parts = [[]];
    let depth = 0;
    let colon = -1;
    inner.forEach((tok, idx) => {
      if (tok.type !== "string") {
        if ("([{".includes(tok.value)) depth++;
        else if (")]}".includes(tok.value)) depth--;
        else if (depth === 0 && tok.value === ";") {
          parts.push([]);
          return;
        } else if (depth === 0 && tok.value === ":" && colon < 0) colon = idx;
      }
      parts[parts.length - 1].push(tok);
    });

    let text;
    const body = () => chain(this.parseStatement());
    if (parts.length === 3 && !parts[0].length && !parts[2].length) {
      // for (;;) and for (; cond;) are while loops in a for loop's clothes.
      return node("HeadLoopNode", joinTokens(parts[1]) || "true", { child: body() });
    }
    const ofIn = this.js && parts.length === 1
      ? inner.findIndex((tok) => tok.type === "ident" && (tok.value === "of" || tok.value === "in"))
      : -1;
    if (ofIn > 0) {
      const decl = inner.slice(0, ofIn).filter((tok, idx) => !(idx === 0 && ["const", "let", "var"].includes(tok.value)));
      text = `${joinTokens(decl)} in ${joinTokens(inner.slice(ofIn + 1))}`;
    } else if (parts.length === 1 && colon >= 0) {
      const decl = inner.slice(0, colon);
      const variable = decl[decl.length - 1]?.value || "";
      text = `${variable} in ${joinTokens(inner.slice(colon + 1))}`;
    } else if (parts.length === 3) {
      const [init, cond, update] = parts.map(joinTokens);
      text = countRange(init, cond, update, this.rangeWord) ?? `${init}; ${cond}; ${update}`;
    } else {
      fail("forHeader", forTok.line);
    }
    return node("CountLoopNode", text, { child: body() });
  }

  parseSwitch() {
    this.expect("switch");
    const subject = this.parenText();
    this.expect("{");

    const cases = [];
    let defaultBody = null;
    let pendingLabels = [];

    while (!this.is("}")) {
      const t = this.peek();
      if (t.type === "eof") fail("missing", t.line, "}");
      let labels;
      if (this.eat("default")) {
        labels = null;
      } else if (this.eat("case")) {
        const start = this.pos;
        let depth = 0;
        while (!(depth === 0 && (this.is(":") || this.is("->")))) {
          const tok = this.next();
          if (tok.type === "eof") fail("caseColon", t.line);
          if (tok.type !== "string") {
            if ("([{".includes(tok.value)) depth++;
            else if (")]}".includes(tok.value)) depth--;
          }
        }
        labels = joinTokens(this.tokens.slice(start, this.pos));
      } else {
        fail("expectedCase", t.line, t.value);
      }

      let body;
      if (this.eat("->")) {
        body = this.parseStatement();
      } else {
        this.expect(":");
        body = [];
        while (!this.is("case") && !this.is("default") && !this.is("}")) {
          body.push(...this.parseStatement());
        }
        // `break` ends a case in Java; in the diagram the column ends anyway.
        const last = body[body.length - 1];
        if (last && last.type === "TaskNode" && last.text === "break") body.pop();
      }

      if (labels === null) {
        defaultBody = body;
        pendingLabels = [];
        continue;
      }
      pendingLabels.push(labels);
      // `case 1: case 2:` share one body — one column with both labels.
      const fallsThrough = body.length === 0 && (this.is("case") || this.is("default"));
      if (fallsThrough) continue;
      cases.push({
        id: uid(),
        type: "InsertCase",
        text: pendingLabels.join(", "),
        followElement: chain(body),
      });
      pendingLabels = [];
    }
    this.expect("}");

    return node("CaseNode", subject, {
      defaultOn: defaultBody !== null,
      defaultNode: {
        id: uid(),
        type: "InsertCase",
        text: this.defaultLabel,
        followElement: chain(defaultBody || []),
      },
      cases,
    });
  }

  parseTry() {
    const tryTok = this.expect("try");
    const resources = [];
    if (this.is("(")) {
      const text = this.parenText();
      for (const r of text.split(";").map((s) => s.trim()).filter(Boolean)) {
        resources.push(...simpleStatement(r, this.js));
      }
    }
    if (!this.is("{")) fail("braceAfterTry", this.peek().line);
    const tryItems = [...resources, ...this.parseStatement()];

    const catches = [];
    while (this.eat("catch")) {
      // `catch {` without a parameter is allowed in JavaScript.
      const param = this.is("(") ? this.parenText().replace(/^final\s+/, "") : "";
      catches.push({ param, body: this.parseStatement() });
    }
    const hasFinally = Boolean(this.eat("finally"));
    const finallyItems = hasFinally ? this.parseStatement() : [];
    if (catches.length === 0 && !hasFinally) {
      fail("tryNeedsCatch", tryTok.line);
    }

    // The diagram's try block has one catch; more catches nest, innermost first.
    let items = tryItems;
    for (const c of catches) {
      items = [
        node("TryCatchNode", c.param, {
          tryChild: chain(items),
          catchChild: chain(c.body),
        }),
      ];
    }
    return [...items, ...finallyItems];
  }
}

function parse(source, options, js) {
  const lang = beginParse(options, js ? "__js_" : "__java_");
  const parser = new Parser(tokenize(source || ""), {
    js,
    rangeWord: options.rangeWord || (lang === "en" ? "to" : "bis"),
    // The same word the pseudocode parser gives the default column.
    defaultLabel: lang === "en" ? "Default" : "Sonst",
  });
  // Java may have methods at the top (the generator writes them so); a
  // JavaScript file has statements and declares its functions with a keyword.
  return parser.parseSequence("eof", !js);
}

/**
 * Parse Java source into a struktog tree.
 *
 * Accepts a whole class, loose methods, or just a few statements.
 *
 * @param {string} source - Java source code
 * @param {Object} [options]
 * @param {"de"|"en"} [options.lang="de"] - language of error messages and count-loop ranges
 * @param {string} [options.rangeWord] - word for count-loop ranges, "bis" or "to" by `lang`
 * @returns {Object} A struktog tree rooted at an InsertNode
 * @throws {CodeParseError} when the code's structure cannot be read
 */
export function parseJava(source, options = {}) {
  return chain(unwrapMain(parse(source, options, false)));
}

/**
 * Parse JavaScript source into a struktog tree. Semicolons are optional.
 *
 * @param {string} source - JavaScript source code
 * @param {Object} [options] - as for parseJava
 * @returns {Object} A struktog tree rooted at an InsertNode
 * @throws {CodeParseError} when the code's structure cannot be read
 */
export function parseJavaScript(source, options = {}) {
  return chain(parse(source, options, true));
}
