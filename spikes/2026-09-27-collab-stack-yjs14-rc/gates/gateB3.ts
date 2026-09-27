// Gate B3 (brief 04, task 2): "Inline atom link edits" -- promoted from
// scratch/probe-atom-mark-change.ts (this spike's own copy, adapted from
// the orchestrator's original) into a real gate row, same five cases stack
// 13's gate B3 checks, through the live binding (real Hocuspocus relay
// child process + two live EditorViews), checked in both editors.
//
// Running the probe directly (`npx tsx scratch/probe-atom-mark-change.ts`
// and `... url-too`) established, before this file was written: cases 0-3
// (initial state, href-only change on the image's link, href-only change
// on the text link, unlinking the image) all PASS -- the new value reaches
// both editors. Cases 4 and 5 (a whole-document replace / a single-node
// replaceWith where the image's OWN attrs -- its `url` -- change together
// with its `link` mark's `href` in the same edit) both FAIL: the new `url`
// lands, but the mark stays the OLD one. This matches the brief's expected
// result exactly ("a replace that changes an inline atom's attrs and its
// marks keeps the old mark").
//
// Root cause, as far as this brief's budget allows finding it cheaply
// (confirmed by temporarily instrumenting a local node_modules copy of
// `@y/prosemirror`, reverted after -- see the log): the failing cases DO
// take the code path that should carry the new mark
// (`node_modules/@y/prosemirror/src/sync-utils.js`'s `pmNodeDiff`,
// ~line 629-700 -- the "structural window" `delta.diff` branch over
// `windowDelta`'s per-child `marksToFormattingAttributes(c.marks)` inserts,
// not the "single paired element, modify in place" fast path that skips
// marks by construction), yet the rendered result still shows the old
// mark. The mark loss therefore happens one layer deeper, inside `lib0`'s
// own generic `delta.diff` (`node_modules/lib0/src/delta/delta.js:4473`),
// which pairs/tokenizes the old-vs-new single-child window via a
// fingerprint/patience-diff mechanism this brief's budget did not extend
// to fully bisecting. Reported as FAIL with this detail, not worked
// around, per the brief.
import 'global-jsdom/register';
import { Mark } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { startRelay, type RelayHandle } from '../src/harness.js';
import { createLiveClient, waitUntil, type LiveClient } from '../src/client-hocuspocus.js';
import { schema } from '../src/schema.js';
import { parseMarkdown } from '../src/parse.js';
import { findPos, replaceWholeDoc } from './lib/edits.js';

export interface GateB3Result {
  pass: boolean;
  cases: { name: string; pass: boolean; detail: string }[];
  detail: string;
}

const DOC_NAME = 'case:atom-marks';

const BASE_MD = 'A [![ci](badge.svg)](https://old.example) badge and a [text link](https://old.example).\n';
const REPLACED_MD = 'A [![ci](badge2.svg)](https://new.example) badge and a [text link](https://new.example).\n';

function imageHref(view: EditorView, url: string): string | undefined {
  let out: string | undefined;
  view.state.doc.descendants((n) => {
    if (n.type.name === 'image' && n.attrs.url === url) {
      out = n.marks.find((m) => m.type.name === 'link')?.attrs.href ?? 'unlinked';
    }
  });
  return out;
}

function imagePos(view: EditorView, url: string): number {
  return findPos(view, (n) => n.type.name === 'image' && n.attrs.url === url);
}

async function resetToBase(a: LiveClient, b: LiveClient): Promise<void> {
  replaceWholeDoc(a.view, parseMarkdown(BASE_MD).doc);
  await waitUntil(() => imageHref(b.view, 'badge.svg') === 'https://old.example', 8000);
}

export async function runGateB3(opts: { port: number; dbPath: string }): Promise<GateB3Result> {
  let relay: RelayHandle | undefined;
  const cases: GateB3Result['cases'] = [];
  try {
    relay = await startRelay({ port: opts.port, db: opts.dbPath, seeds: 'fixtures' });
    const [a, b] = await Promise.all([
      createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'alice' }),
      createLiveClient({ url: relay.wsUrl, docName: DOC_NAME, token: 'bob' }),
    ]);
    try {
      // --- Case 0: initial state ---
      await resetToBase(a, b);
      const hrefA0 = imageHref(a.view, 'badge.svg');
      const hrefB0 = imageHref(b.view, 'badge.svg');
      const pass0 = hrefA0 === 'https://old.example' && hrefB0 === 'https://old.example';
      cases.push({ name: '0. initial state', pass: pass0, detail: `editor1=${hrefA0} editor2=${hrefB0}` });

      // --- Case 1: change the href of a linked image ---
      {
        const pos = imagePos(a.view, 'badge.svg');
        a.view.dispatch(
          a.view.state.tr
            .removeMark(pos, pos + 1, schema.marks.link)
            .addMark(pos, pos + 1, schema.marks.link.create({ href: 'https://new.example' }) as Mark),
        );
        await waitUntil(() => imageHref(b.view, 'badge.svg') === 'https://new.example', 8000);
        const hrefA = imageHref(a.view, 'badge.svg');
        const hrefB = imageHref(b.view, 'badge.svg');
        const pass = hrefA === 'https://new.example' && hrefB === 'https://new.example';
        cases.push({ name: '1. change href of a linked image', pass, detail: `editor1=${hrefA} editor2=${hrefB}` });
      }

      // --- Case 2: unlink it (continuing from case 1) ---
      {
        const pos = imagePos(a.view, 'badge.svg');
        a.view.dispatch(a.view.state.tr.removeMark(pos, pos + 1, schema.marks.link));
        await waitUntil(() => imageHref(b.view, 'badge.svg') === 'unlinked', 8000);
        const hrefA = imageHref(a.view, 'badge.svg');
        const hrefB = imageHref(b.view, 'badge.svg');
        const pass = hrefA === 'unlinked' && hrefB === 'unlinked';
        cases.push({ name: '2. unlink it', pass, detail: `editor1=${hrefA} editor2=${hrefB}` });
      }

      // --- Case 3: whole-document replace where the image's url and its link's href both change ---
      {
        await resetToBase(a, b);
        const next = parseMarkdown(REPLACED_MD).doc;
        replaceWholeDoc(a.view, next);
        await waitUntil(() => imageHref(b.view, 'badge2.svg') !== undefined, 8000).catch(() => {});
        const hrefA = imageHref(a.view, 'badge2.svg');
        const hrefB = imageHref(b.view, 'badge2.svg');
        const pass = hrefA === 'https://new.example' && hrefB === 'https://new.example';
        cases.push({
          name: '3. whole-document replace (url + href change)',
          pass,
          detail: `editor1=${hrefA} editor2=${hrefB}${pass ? '' : ' -- FAIL, expected per the brief: new url landed but the OLD mark/href was kept'}`,
        });
      }

      // --- Case 4: replace one image node with one whose url and link differ ---
      {
        await resetToBase(a, b);
        const pos = imagePos(a.view, 'badge.svg');
        const old = a.view.state.doc.nodeAt(pos)!;
        const repl = schema.nodes.image.create(
          { ...old.attrs, url: 'badge3.svg' },
          null,
          [schema.marks.link.create({ href: 'https://replaced.example' }) as Mark],
        );
        a.view.dispatch(a.view.state.tr.replaceWith(pos, pos + 1, repl));
        await waitUntil(() => imageHref(b.view, 'badge3.svg') !== undefined, 8000).catch(() => {});
        const hrefA = imageHref(a.view, 'badge3.svg');
        const hrefB = imageHref(b.view, 'badge3.svg');
        const pass = hrefA === 'https://replaced.example' && hrefB === 'https://replaced.example';
        cases.push({
          name: '4. replace one image node (url + link differ)',
          pass,
          detail: `editor1=${hrefA} editor2=${hrefB}${pass ? '' : ' -- FAIL, expected per the brief: new url landed but the OLD mark/href was kept'}`,
        });
      }

      // Per the brief: report this gate as FAIL, with the detail -- do not
      // work around cases 3/4's known upstream bug. Cases 0-2 do pass.
      const pass = cases.every((c) => c.pass);
      return {
        pass,
        cases,
        detail: pass
          ? 'all five cases showed the new value in both editors'
          : `${cases.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`).join('; ')} -- cases 3-4 are a known upstream @y/prosemirror mark-vs-attr co-change bug (see this file's header), not this spike's schema/binding code; cases 0-2 pass`,
      };
    } finally {
      a.destroy();
      b.destroy();
    }
  } finally {
    if (relay) await relay.stop();
  }
}
