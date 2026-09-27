// Brief 03, task 5 (gate H): "After a local transaction ... check the
// top-level blocks that changed, not the whole document: keep a cache of
// serialized output keyed by top-level node identity and serialize only new
// or changed blocks, with the document's link and footnote definitions as
// context, using `onUnverified: 'emit'` and `trace` to find blocks that do
// not verify. Debounce the check."
//
// ProseMirror nodes are immutable and structurally shared: a top-level block
// that a transaction did not touch keeps the exact same JS object reference
// in the new `doc` as it had in the old one. A `WeakMap<PMNode, TraceInfo>`
// keyed by that reference is therefore a correct "did this block change"
// test with no extra bookkeeping -- the same structural-sharing fact
// `src/editing/freshSrc.ts`'s own comment already leans on.
//
// The one thing block identity alone does NOT capture: `serializeBlock`'s
// splice/re-serialize candidates read the document's link and footnote
// definitions (`ctx`, from `buildBlockCheckContext`) and its detected style.
// If those change, a cached "verified" result for an unrelated, unchanged
// block could go stale (its splice depended on a definition that just
// changed). Handled conservatively: whenever the top-level set of
// `definition`/`footnoteDefinition` blocks (by reference) differs from the
// last check, the whole cache is invalidated and every block is
// re-verified once. This is the rare case (editing a link's own definition,
// not the common "type a word in a paragraph" edit gate H is measuring), so
// it does not undermine the performance goal.
import { Node as PMNode } from 'prosemirror-model';
import { buildBlockCheckContext, serializeBlock, type SerializeOpts, type TraceInfo } from '../model/serialize.js';

export interface UnverifiedBlock {
  index: number;
  block: PMNode;
  trace: TraceInfo;
}

export class BlockCheckCache {
  private entries = new WeakMap<PMNode, TraceInfo>();
  private lastDefsBlocks: PMNode[] = [];
  private context: ReturnType<typeof buildBlockCheckContext> | null = null;

  /** Reset all cached state (e.g. after opening a different document). */
  reset(): void {
    this.entries = new WeakMap();
    this.lastDefsBlocks = [];
    this.context = null;
  }

  /**
   * Check every top-level block of `doc`, reusing cached results for blocks
   * whose node reference is unchanged since the last call. Returns every
   * block whose best-effort serialization did not verify (an ordinary block
   * whose edit the serializer's ladder cannot express -- ai `raw_block`
   * never appears here; see `serializeBlock`'s own comment).
   */
  check(doc: PMNode, opts: SerializeOpts = {}): UnverifiedBlock[] {
    const defsBlocks: PMNode[] = [];
    doc.forEach((b) => {
      if (b.type.name === 'raw_block' && (b.attrs.kind === 'definition' || b.attrs.kind === 'footnoteDefinition')) {
        defsBlocks.push(b);
      }
    });
    const defsChanged =
      this.context == null ||
      defsBlocks.length !== this.lastDefsBlocks.length ||
      defsBlocks.some((b, i) => b !== this.lastDefsBlocks[i]);

    if (defsChanged) {
      this.context = buildBlockCheckContext(doc);
      this.lastDefsBlocks = defsBlocks;
      this.entries = new WeakMap();
    }

    const unverified: UnverifiedBlock[] = [];
    doc.forEach((block, _offset, index) => {
      let trace = this.entries.get(block);
      if (!trace) {
        const result = serializeBlock(block, this.context!, { ...opts, onUnverified: 'emit' });
        trace = result.trace;
        this.entries.set(block, trace);
      }
      if (trace.kind === 'unverified') unverified.push({ index, block, trace });
    });
    return unverified;
  }
}
