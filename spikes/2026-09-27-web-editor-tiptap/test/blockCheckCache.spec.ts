// Brief 03, task 5/7 (unit test for the per-block cache).
import { describe, expect, it, vi } from 'vitest';
import { schema } from '../src/model/schema.js';
import { parseMarkdown } from '../src/model/parse.js';
import * as serializeModule from '../src/model/serialize.js';
import { BlockCheckCache } from '../src/editing/blockCheckCache.js';

function unlinkFirstMark(doc: ReturnType<typeof schema.node>) {
  let done = false;
  function rebuild(node: any): any {
    if (node.isText) {
      if (!done && node.marks.some((m: any) => m.type.name === 'link')) {
        done = true;
        return schema.text(node.text, node.marks.filter((m: any) => m.type.name !== 'link'));
      }
      return node;
    }
    const children: any[] = [];
    node.forEach((c: any) => children.push(rebuild(c)));
    return node.type.create(node.attrs, children, node.marks);
  }
  return rebuild(doc);
}

describe('BlockCheckCache', () => {
  it('reports no unverified blocks for an untouched document', () => {
    const { doc } = parseMarkdown('Hello *world*.\n\nSecond paragraph.\n');
    const cache = new BlockCheckCache();
    expect(cache.check(doc)).toEqual([]);
  });

  it('finds the unverifiable block: an autolink whose link mark was removed, leaving an unescapable backslash', () => {
    const { doc } = parseMarkdown('<https://example.com?find=\\*>\n');
    const edited = unlinkFirstMark(doc);
    const cache = new BlockCheckCache();
    const unverified = cache.check(edited);
    expect(unverified).toHaveLength(1);
    expect(unverified[0]!.index).toBe(0);
    expect(unverified[0]!.trace.kind).toBe('unverified');
  });

  it('reuses cached results for blocks whose node reference is unchanged (only changed blocks are re-serialized)', () => {
    const { doc } = parseMarkdown('First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n');
    const cache = new BlockCheckCache();
    const spy = vi.spyOn(serializeModule, 'serializeBlock');
    cache.check(doc);
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockClear();

    // Edit only the second block; first and third keep the same node reference.
    const second = doc.child(1);
    const newSecond = second.type.create(second.attrs, schema.text('Second paragraph, edited.'), second.marks);
    const edited = schema.node('doc', doc.attrs, [doc.child(0), newSecond, doc.child(2)]);

    cache.check(edited);
    // Only the one changed block should have been (re-)serialized; the other
    // two are served from cache by node identity.
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('invalidates the whole cache when a link/footnote definition block changes', () => {
    const { doc } = parseMarkdown('[foo]\n\n[foo]: /url\n');
    const cache = new BlockCheckCache();
    cache.check(doc);

    const spy = vi.spyOn(serializeModule, 'serializeBlock');
    const defBlock = doc.child(1);
    const newDef = defBlock.type.create(defBlock.attrs, schema.text('[foo]: /new-url'), defBlock.marks);
    const edited = schema.node('doc', doc.attrs, [doc.child(0), newDef]);
    cache.check(edited);
    // Both blocks re-verified: the definition itself changed, and the cache
    // is conservatively cleared for every block when the defs set changes.
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
