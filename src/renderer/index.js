import StruktolabRenderer, { renderStructogramSVG } from "./struktolab-renderer.js";
import { parsePseudocode, KEYWORDS_DE, KEYWORDS_EN } from "../common/pseudocode-parser.js";
import { generateCode } from "../common/code-generator.js";

if (!customElements.get("struktolab-renderer")) {
  customElements.define("struktolab-renderer", StruktolabRenderer);
}

export { StruktolabRenderer, renderStructogramSVG, parsePseudocode, generateCode, KEYWORDS_DE, KEYWORDS_EN };
