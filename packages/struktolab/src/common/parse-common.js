/**
 * What the source-code parsers (Java, JavaScript, Python) share: the error
 * they throw, its messages in the editor's languages, and how they build the
 * InsertNode chains the editor works with.
 */

import { toParameters } from "./function-signature.js";

export class CodeParseError extends Error {
  constructor(message, line) {
    super(message);
    this.name = "CodeParseError";
    /** 1-based line the problem is on. */
    this.line = line;
  }
}

/** Error messages in the languages of the editor UI. */
const MESSAGES = {
  en: {
    line: (n) => `line ${n}`,
    textBlock: () => `Text block """ is not closed`,
    string: () => `String is not closed: the closing quote is missing`,
    char: () => `Character literal is not closed: the closing ' is missing`,
    expected: (v, f) => `Expected "${v}" but found "${f}"`,
    expectedEnd: (v) => `Expected "${v}" but the code ended`,
    neverClosed: (o) => `"${o}" is never closed`,
    semicolonAfter: (t) => `Missing ";" after "${t}"`,
    semicolonBefore: (t) => `Missing ";" before "${t}"`,
    missing: (v) => `Missing "${v}"`,
    endedInStatement: () => `The code ended in the middle of a statement`,
    withoutIf: (k) => `"${k}" without a matching "if"`,
    withoutTry: (k) => `"${k}" without a matching "try"`,
    outsideSwitch: (k) => `"${k}" outside of a switch`,
    unexpected: (v) => `Unexpected "${v}"`,
    forHeader: () => `A for loop needs "(start; condition; step)" or "(x of list)"`,
    caseColon: () => `Missing ":" after case`,
    expectedCase: (f) => `Expected "case" or "default" but found "${f}"`,
    braceAfterTry: () => `Expected "{" after try`,
    tryNeedsCatch: () => `"try" needs a "catch" or "finally"`,
    colonAfter: (k) => `Missing ":" at the end of the "${k}" line`,
    indentExpected: (k) => `The body of "${k}" must be indented`,
    indentUnexpected: () => `This line is indented more than the lines before it`,
    indentMismatch: () => `The indentation does not match any line above`,
    forIn: () => `A for loop needs "for x in …:"`,
  },
  de: {
    line: (n) => `Zeile ${n}`,
    textBlock: () => `Textblock """ wird nicht geschlossen`,
    string: () => `Zeichenkette wird nicht geschlossen: das schließende Anführungszeichen fehlt`,
    char: () => `Zeichen-Literal wird nicht geschlossen: das schließende ' fehlt`,
    expected: (v, f) => `„${v}“ erwartet, aber „${f}“ gefunden`,
    expectedEnd: (v) => `„${v}“ erwartet, aber der Code ist zu Ende`,
    neverClosed: (o) => `„${o}“ wird nie geschlossen`,
    semicolonAfter: (t) => `„;“ fehlt nach „${t}“`,
    semicolonBefore: (t) => `„;“ fehlt vor „${t}“`,
    missing: (v) => `„${v}“ fehlt`,
    endedInStatement: () => `Der Code endet mitten in einer Anweisung`,
    withoutIf: (k) => `„${k}“ ohne passendes „if“`,
    withoutTry: (k) => `„${k}“ ohne passendes „try“`,
    outsideSwitch: (k) => `„${k}“ außerhalb eines switch`,
    unexpected: (v) => `Unerwartetes „${v}“`,
    forHeader: () => `Eine for-Schleife braucht „(Start; Bedingung; Schritt)“ oder „(x of liste)“`,
    caseColon: () => `„:“ fehlt nach case`,
    expectedCase: (f) => `„case“ oder „default“ erwartet, aber „${f}“ gefunden`,
    braceAfterTry: () => `„{“ nach try erwartet`,
    tryNeedsCatch: () => `„try“ braucht ein „catch“ oder „finally“`,
    colonAfter: (k) => `„:“ fehlt am Ende der „${k}“-Zeile`,
    indentExpected: (k) => `Der Rumpf von „${k}“ muss eingerückt sein`,
    indentUnexpected: () => `Diese Zeile ist weiter eingerückt als die Zeilen davor`,
    indentMismatch: () => `Die Einrückung passt zu keiner Zeile darüber`,
    forIn: () => `Eine for-Schleife braucht „for x in …:“`,
  },
};

/** The table for the parse running now — parsing is synchronous, like the id counter. */
let messages = MESSAGES.de;
let idPrefix = "__code_";
let idCounter = 0;

/**
 * Start a parse: pick the message language, restart the ids.
 * @returns {"de"|"en"} the language picked
 */
export function beginParse(options = {}, prefix = "__code_") {
  const lang = options.lang === "en" ? "en" : "de";
  messages = MESSAGES[lang];
  idPrefix = prefix;
  idCounter = 0;
  return lang;
}

export function fail(key, line, ...args) {
  throw new CodeParseError(`${messages[key](...args)} (${messages.line(line)})`, line);
}

export function uid() {
  return idPrefix + (++idCounter);
}

export function makeInsert(followElement) {
  return { id: uid(), type: "InsertNode", followElement };
}

/** A list of nodes as the InsertNode → node → InsertNode … chain the editor uses. */
export function chain(nodes) {
  if (nodes.length === 0) return makeInsert({ type: "Placeholder" });
  let tail = makeInsert(null);
  for (let i = nodes.length - 1; i >= 0; i--) {
    nodes[i].followElement = tail;
    tail = makeInsert(nodes[i]);
  }
  return tail;
}

export function node(type, text, extra = {}) {
  return { id: uid(), type, text, ...extra };
}

/** A function block that remembers its body as a list, for unwrapping `main`. */
export function functionNode(name, parameters, body, returnType = "") {
  const fn = node("FunctionNode", name, {
    parameters: toParameters(parameters),
    child: chain(body),
  });
  if (returnType) fn.returnType = returnType;
  Object.defineProperty(fn, "_body", { value: body, enumerable: false });
  return fn;
}

/** A lone string literal loses its quotes, an expression like "Summe: " + s is kept as written. */
export function ioText(arg) {
  const trimmed = arg.trim();
  const literal = /^(["'`])((?:(?!\1)[^\\]|\\.)*)\1$/.exec(trimmed);
  if (!literal) return trimmed;
  // A template literal with ${…} in it is an expression, not a plain text.
  if (literal[1] === "`" && literal[2].includes("${")) return trimmed;
  return literal[2];
}

/** The last value an exclusive upper bound reaches: `n` → `n - 1`, `n + 1` → `n`, `10` → `9`. */
export function inclusiveEnd(exclusive) {
  const to = exclusive.trim();
  if (/^-?\d+$/.test(to)) return String(Number(to) - 1);
  const plusOne = /^(.+?)\s*\+\s*1$/.exec(to);
  if (plusOne) return plusOne[1];
  return `${to} - 1`;
}

/** Split at commas outside brackets and strings. */
export function splitTopLevel(text) {
  const out = [];
  let depth = 0;
  let quote = null;
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") {
        cur += ch + (text[++i] ?? "");
        continue;
      }
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if ("(<[{".includes(ch)) depth++;
    else if (")>]}".includes(ch)) depth--;
    if (ch === "," && depth === 0 && !quote) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter((p) => p !== "");
}

/**
 * When a program is just a `main` function and its call, the algorithm is the
 * body of main — the function box around it would be noise.
 *
 * @param {Array} items top-level nodes
 * @param {(node) => boolean} isMainCall recognises a call of main to drop
 */
export function unwrapMain(items, isMainCall = () => false) {
  const functions = items.filter((n) => n.type === "FunctionNode");
  if (functions.length !== 1 || functions[0].text !== "main") return items;
  const main = functions[0];
  return items.flatMap((n) => (n === main ? main._body : isMainCall(n) ? [] : [n]));
}
