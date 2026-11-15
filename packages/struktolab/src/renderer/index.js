import StruktolabRenderer, { renderStructogramSVG } from "./struktolab-renderer.js";
import { parsePseudocode, KEYWORDS_DE, KEYWORDS_EN } from "../common/pseudocode-parser.js";
import { generateCode } from "../common/code-generator.js";
import { parseJava, parseJavaScript } from "../common/brace-parser.js";
import { parsePython } from "../common/python-parser.js";

if (!customElements.get("struktolab-renderer")) {
  customElements.define("struktolab-renderer", StruktolabRenderer);
}

export {
  StruktolabRenderer,
  renderStructogramSVG,
  parsePseudocode,
  parseJava,
  parseJavaScript,
  parsePython,
  generateCode,
  KEYWORDS_DE,
  KEYWORDS_EN,
};
