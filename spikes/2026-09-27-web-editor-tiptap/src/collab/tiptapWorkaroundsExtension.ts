// Brief 03, gate D: "Wrap the two workaround plugins in a Tiptap
// Extension." A thin Tiptap Extension whose addProseMirrorPlugins() just
// returns the same two plain ProseMirror plugins src/client.ts uses
// directly -- no rewrite needed, since a Tiptap Extension's
// addProseMirrorPlugins() is exactly "return some prosemirror-state
// Plugins", the same contract raw ProseMirror uses.
//
// Order still matters, for the same reason src/client.ts documents:
// leafMarksPlugin's view() hook must run before rootAttrsPlugin's, or the
// latter's view()-hook dispatch triggers the former's "local edit" branch
// before its own initial restore has happened, clobbering the leafMarks
// attr. Tiptap concatenates addProseMirrorPlugins() output across
// extensions in the order extensions were listed when the Editor was
// constructed, so this Extension is only correct when whatever builds the
// extensions list keeps that order too (see src/tiptapClient.ts).
//
// Brief 05: `localCaretFollowPlugin` (workaround 3 of 3, see its own file
// comment for the bug and fix) is placed LAST. Its correctness does not
// depend on this order (leafMarks/rootAttrs only rewrite node attrs via
// same-size replacements, never shifting positions), but it is the final
// "correct the selection" pass over whatever doc leafMarks/rootAttrs leave
// behind, so it is listed after them by convention. Enforced together with
// the leafMarks-before-rootAttrs order by test/workaroundOrder.spec.ts.
import { Extension } from '@tiptap/core';
import * as Y from 'yjs';
import { rootAttrsPlugin, type RootAttrsStats } from './workarounds/rootAttrs.js';
import { leafMarksPlugin, type LeafMarksStats } from './workarounds/leafMarks.js';
import { localCaretFollowPlugin, type LocalCaretFollowStats } from './workarounds/localCaretFollow.js';

export interface PhraiseWorkaroundsOptions {
  ydoc: Y.Doc | null;
  stats: { rootAttrs: RootAttrsStats; leafMarks: LeafMarksStats; localCaretFollow: LocalCaretFollowStats };
}

export const PhraiseWorkarounds = Extension.create<PhraiseWorkaroundsOptions>({
  name: 'phraiseWorkarounds',
  addOptions() {
    return {
      ydoc: null,
      stats: {
        rootAttrs: { mapWrites: 0, docWrites: 0 },
        leafMarks: { attrWrites: 0, restores: 0 },
        localCaretFollow: { corrections: 0 },
      },
    };
  },
  addProseMirrorPlugins() {
    if (!this.options.ydoc) throw new Error('PhraiseWorkarounds: ydoc option is required');
    return [
      leafMarksPlugin(this.options.stats.leafMarks),
      rootAttrsPlugin(this.options.ydoc, this.options.stats.rootAttrs),
      localCaretFollowPlugin(this.options.stats.localCaretFollow),
    ];
  },
});
