// Brief 01, task 7: "the workaround plugin order is enforced." Per
// src/collab/tiptapWorkaroundsExtension.ts's own doc comment: leafMarksPlugin
// must come before rootAttrsPlugin, or rootAttrsPlugin's view()-hook
// dispatch triggers leafMarksPlugin's "local edit" branch before its own
// initial restore has happened, clobbering the leafMarks attr.
//
// Brief 05: `localCaretFollowPlugin` (workaround 3 of 3) is asserted last,
// per the same file's updated comment -- a documented convention, not a
// correctness requirement of its own (see the comment for why).
//
// Reads the plugin list PhraiseWorkarounds.addProseMirrorPlugins() actually
// returns (via the Extension's own `.config`, a plain object at runtime
// despite TypeScript typing it as internal -- confirmed directly, not
// assumed) rather than re-asserting the source order by inspection, so a
// future edit that silently reorders the array fails this test.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Plugin } from 'prosemirror-state';
import { PhraiseWorkarounds } from '../src/collab/tiptapWorkaroundsExtension.js';
import { rootAttrsPluginKey } from '../src/collab/workarounds/rootAttrs.js';
import { leafMarksPluginKey } from '../src/collab/workarounds/leafMarks.js';
import { localCaretFollowPluginKey } from '../src/collab/workarounds/localCaretFollow.js';

interface ExtensionConfigLike {
  addProseMirrorPlugins?: (this: unknown) => Plugin[];
}

describe('PhraiseWorkarounds plugin order', () => {
  it('returns leafMarksPlugin, then rootAttrsPlugin, then localCaretFollowPlugin', () => {
    const configured = PhraiseWorkarounds.configure({
      ydoc: new Y.Doc(),
      stats: {
        rootAttrs: { mapWrites: 0, docWrites: 0 },
        leafMarks: { attrWrites: 0, restores: 0 },
        localCaretFollow: { corrections: 0 },
      },
    });
    const config = (configured as unknown as { config: ExtensionConfigLike }).config;
    expect(typeof config.addProseMirrorPlugins).toBe('function');
    const plugins = config.addProseMirrorPlugins!.call(configured);
    expect(plugins).toHaveLength(3);
    // `.key` is a runtime-only property of Plugin/PluginKey (not part of
    // either class's public TypeScript surface), confirmed directly.
    expect((plugins[0] as unknown as { key: string }).key).toBe((leafMarksPluginKey as unknown as { key: string }).key);
    expect((plugins[1] as unknown as { key: string }).key).toBe((rootAttrsPluginKey as unknown as { key: string }).key);
    expect((plugins[2] as unknown as { key: string }).key).toBe((localCaretFollowPluginKey as unknown as { key: string }).key);
  });
});
