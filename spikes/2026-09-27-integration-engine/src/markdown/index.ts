// Origin: adapted from spike 3 (daemon-file-sync-fork-import), branch
// spike/2026-09-27-daemon-file-sync, commit 9343b62, src/md/index.ts.
// Deviation: the yjs.ts re-exports (docToYDoc, yDocToDoc, encodeLeafMarks,
// decodeLeafMarks) are dropped -- this module must never import yjs (see
// README.md and the import-boundary test in test/). Those functions now
// live in src/crdt/codec.ts. `renderDoc` is added (see render.ts).
export { schema, isMetaAttrName } from './schema.js';
export { parseMarkdown, parseMdast, detectEol, type ParseResult, type ParseOpts, type BlockPos } from './parse.js';
export { parseBlock, clearParseBlockCache, type ParseBlockResult, type BlockPosMap, type NodePosInfo, type TextRun, type LinkSpan } from './parse.js';
export { buildDefsContextFromDoc } from './parse.js';
export { serializeDoc, type SerializeOpts, type TraceInfo } from './serialize.js';
export { detectStyle, type Style } from './style.js';
export { semanticEq, stripMeta, type SemanticEqOpts } from './compare.js';
export { UnverifiedSerializationError } from './serialize.js';
export { renderDoc, type RenderResult } from './render.js';
