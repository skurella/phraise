// Brief 03, task 5 (gate H): "After a local transaction (never a remote
// one, so that two users never both convert the same block), check the
// top-level blocks that changed ... Debounce the check ... For a block that
// does not verify: replace it with a `raw_block` of kind `unverified`
// holding the best-effort Markdown, and show on it a plain-language
// banner ... with two buttons."
//
// Layering: `src/editing/blockCheckCache.ts` (schema-agnostic, keyed by
// node identity within whatever doc it is given) does the actual
// verification and caching; this module is the Tiptap-specific wiring
// around it -- converting the LIVE (Tiptap-schema) doc's top-level blocks
// to spike 1's canonical schema instance (the same conversion
// `web/src/main.ts`'s `markdown()` already does, and for the same reason:
// `serializeBlock`/`semanticEq` compare node TYPES BY NAME, not by
// reference, but the actual verification and re-serialization candidates
// are built from the canonical schema's own node/mark constructors, e.g.
// `mdastWrapperFor` in `src/model/serialize.ts`), detecting local vs remote
// transactions, debouncing, and dispatching the replacement + undo/keep
// commands the node view's banner (`web/src/nodeviews/rawBlockView.ts`)
// calls into.
//
// Identity across the JSON round-trip: `PMNode.fromJSON` always allocates a
// fresh node object, which would defeat `BlockCheckCache`'s whole
// node-identity cache if a fresh canonical doc were built from scratch on
// every debounce cycle. `liveBlockToCanonical` below is itself cached by the
// LIVE block's own reference (which Tiptap/ProseMirror DOES keep stable
// across transactions for a top-level block no step touched), so an
// unchanged live block reuses the exact same canonical node object across
// cycles too -- which is what lets `BlockCheckCache`'s cache actually work
// end to end.
import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Node as PMNode } from '@tiptap/pm/model';
import { schema as modelSchema } from '../../../src/model/schema.js';
import { parseBlock, buildDefsContextFromDoc } from '../../../src/model/parse.js';
import { BlockCheckCache } from '../../../src/editing/blockCheckCache.js';

// A well-known convention in the y-prosemirror ecosystem (and this app's
// `@tiptap/y-tiptap`, which follows the same `new PluginKey('y-sync')`
// naming): a transaction that applies a remote Yjs update carries
// `tr.setMeta(ySyncPluginKey, { isChangeOrigin: true, ... })`, and
// `PluginKey`'s own meta storage is keyed by the plain string `key.key`
// (`prosemirror-state`'s `createKey('y-sync')` -> `'y-sync$'` the first
// time that base name is used, which it is here: this app registers
// exactly one `Collaboration` extension). Reading the meta by that string
// avoids needing the actual (unexported) PluginKey instance.
function isRemoteTransaction(transaction: { getMeta(key: string): unknown }): boolean {
  const meta = transaction.getMeta('y-sync$') as { isChangeOrigin?: boolean } | undefined;
  return !!meta?.isChangeOrigin;
}

const PHRAISE_FIX_META = 'phraiseUnverifiedFix';

const canonicalBlockCache = new WeakMap<object, PMNode>();

function liveBlockToCanonical(liveBlock: PMNode): PMNode {
  let canonical = canonicalBlockCache.get(liveBlock);
  if (!canonical) {
    canonical = PMNode.fromJSON(modelSchema, liveBlock.toJSON());
    canonicalBlockCache.set(liveBlock, canonical);
  }
  return canonical;
}

function toCanonicalDoc(liveDoc: PMNode): PMNode {
  const children: PMNode[] = [];
  liveDoc.forEach((liveBlock) => children.push(liveBlockToCanonical(liveBlock)));
  return modelSchema.node('doc', { lead: liveDoc.attrs.lead ?? '', eol: liveDoc.attrs.eol ?? '\n' }, children);
}

/** Position, in the LIVE doc, of the top-level child at `index`. */
function liveTopLevelPos(liveDoc: PMNode, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += liveDoc.child(i).nodeSize;
  return pos;
}

const checkCache = new BlockCheckCache();

/**
 * Test-only visibility (gate H: "a second connected browser context does
 * not also convert the block"): counts real invocations of `runCheck`, so
 * a test can assert that a REMOTE browser context's own check never runs in
 * response to a transaction that only ever originated elsewhere -- rather
 * than inferring this indirectly from the absence of a double-conversion,
 * which a race could hide. Not read by any production code path.
 */
export const debugStats = { checkRuns: 0, lastRunMs: 0 };

function runCheck(editor: Editor): void {
  debugStats.checkRuns++;
  const t0 = performance.now();
  const liveDoc = editor.state.doc;
  const canonicalDoc = toCanonicalDoc(liveDoc);
  const unverified = checkCache.check(canonicalDoc, { onUnverified: 'emit' });
  // Gate K (scale): the wall time of one full check pass -- the FIRST call
  // is "cold" (no cache yet: `BlockCheckCache` builds its definitions
  // context and re-serializes every top-level block); a later call after
  // exactly one more edit is "warm" (only the changed block's identity
  // misses the cache; see this file's own header comment and
  // `src/editing/blockCheckCache.ts`). Recorded unconditionally (not only
  // when something is actually flagged unverified) since the cost gate K
  // cares about is the CHECK itself, not its rare positive result.
  debugStats.lastRunMs = performance.now() - t0;
  if (unverified.length === 0) return;

  let tr = editor.state.tr;
  let changed = false;
  // Apply from the end backwards so earlier positions stay valid as later
  // ones are replaced.
  for (const u of [...unverified].sort((a, b) => b.index - a.index)) {
    const pos = liveTopLevelPos(tr.doc, u.index);
    const liveNode = tr.doc.child(u.index);
    if (liveNode.type.name === 'raw_block') continue; // never itself flagged; defensive.
    const rawBlock = editor.schema.nodes.raw_block!.create({ kind: 'unverified' }, editor.schema.text(u.trace.text));
    tr = tr.replaceWith(pos, pos + liveNode.nodeSize, rawBlock);
    changed = true;
  }
  if (changed) {
    tr.setMeta(PHRAISE_FIX_META, true);
    tr.setMeta('addToHistory', true);
    editor.view.dispatch(tr);
  }
}

/** The "Keep this" button (see `rawBlockView.ts`): parse the shown
 * best-effort Markdown (this node's own current text) back into rich
 * content, in isolation with the document's current link/footnote
 * definitions as context -- the same `parseBlock` gate H's own check uses
 * to verify a candidate -- and splice the result in the `unverified`
 * block's place. If the shown text somehow does not parse to exactly one
 * block (the user edited it into something else while it was showing),
 * this is a no-op: the text stays editable as a plain source block rather
 * than silently doing nothing.
 */
export function keepUnverifiedBlock(editor: Editor, getPos: () => number | undefined): void {
  const pos = getPos();
  if (pos == null) return;
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  const canonicalDoc = toCanonicalDoc(editor.state.doc);
  const ctx = buildDefsContextFromDoc(canonicalDoc);
  const { node: parsed, count } = parseBlock(node.textContent, ctx);
  if (count !== 1) return;
  const liveNode = PMNode.fromJSON(editor.schema, parsed.toJSON());
  const tr = editor.state.tr.replaceWith(pos, pos + node.nodeSize, liveNode);
  tr.setMeta('addToHistory', true);
  editor.view.dispatch(tr);
}

export interface UnverifiedCheckOptions {
  debounceMs?: number;
}

export const UnverifiedCheck = Extension.create<UnverifiedCheckOptions>({
  name: 'unverifiedCheck',
  addOptions() {
    return { debounceMs: 400 };
  },
  onCreate() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const editor = this.editor;
    editor.on('update', ({ transaction }) => {
      if (!transaction.docChanged) return;
      if (isRemoteTransaction(transaction)) return;
      if (transaction.getMeta(PHRAISE_FIX_META)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => runCheck(editor), this.options.debounceMs);
    });
  },
});
