import StruktolabEditor, { renderStructogramSVG, parsePseudocode, generateCode, treeToPseudocode, KEYWORDS_DE, KEYWORDS_EN } from "./struktolab-editor.js";
import { stripInsertNodes } from "../common/tree-ops.js";

if (!customElements.get("struktolab-editor")) {
  customElements.define("struktolab-editor", StruktolabEditor);
}

export { StruktolabEditor, renderStructogramSVG, parsePseudocode, generateCode, treeToPseudocode, stripInsertNodes, KEYWORDS_DE, KEYWORDS_EN };
