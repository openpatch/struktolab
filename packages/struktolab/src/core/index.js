/**
 * The parts of StruktoLab that are just data.
 *
 * Everything here is pure JavaScript with no DOM behind it, so it runs in Node
 * — in a VS Code extension host, in a build script, on a server. Importing
 * `struktolab/editor` instead would register a custom element and need a
 * browser to do it.
 */

export { generateCode, TRANSLATIONS } from "../common/code-generator.js";
export {
  parsePseudocode,
  KEYWORDS_DE,
  KEYWORDS_EN,
} from "../common/pseudocode-parser.js";
export { treeToPseudocode } from "../common/tree-to-pseudocode.js";
export {
  stripInsertNodes,
  wrapWithInsertNodes,
  ensureIds,
  cloneTree,
  findNode,
} from "../common/tree-ops.js";
export {
  DOCUMENT_VERSION,
  serializeDocument,
  applyDocument,
  emptyDocument,
} from "../common/document.js";
