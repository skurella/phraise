// Gate B3 (brief 03, task 1): "Inline atom link edits" -- promoted from the
// orchestrator's scratch/probe-atom-mark-change.ts into a real gate row run
// by scripts/gates.ts. Same five cases the probe checked, through the live
// binding (real relay child process + two live EditorViews) with both
// workaround plugins, checked in both editors:
//   0. initial state -- the seeded linked image is linked in both editors.
//   1. change the href of a linked image.
//   2. unlink it.
//   3. whole-document replace where the image's url and its link's href
//      both change.
//   4. replace one image node with one whose url and link differ.
//
// Unlike gates A/B/C, this gate needs a *fresh, pristine* copy of the base
// document before cases 1-2 (sequential, like the probe's first pair) and
// again before each of cases 3 and 4 (each rewrites the image wholesale, so
// starting from wherever the previous case left off would just be testing
// the same case twice under a different name). Rather than adding
// throwaway fixture files, each reset re-seeds via the same
// gates/lib/edits.ts `replaceWholeDoc` gate C's path (b) already uses --
// a real transaction on the live EditorView, so ySyncPlugin and both
// workaround plugins see every reset as an ordinary local edit, same as any
// other case.
import 'global-jsdom/register';
import { Mark } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { startRelay, type RelayHandle } from '../src/harness.js';
import { createLiveClient, waitUntil, type LiveClient } from '../src/client.js';
import { schema } from '../src/schema.js';
import { parseMarkdown } from '../src/parse.js';
import { findPos, replaceWholeDoc } from './lib/edits.js';

export interface GateB3Result {
  pass: boolean;
  cases: { name: string; pass: boolean; detail: string }[];
  detail: string;
}

const DOC_NAME = 'case:atom-marks'; // matches neither `file:` nor `plain:`; onLoadDocument leaves it empty, seeded client-side below (same convention as gateC.ts's `load:sample`).

const BASE_MD = 'A [![ci](badge.svg)](https://old.example) badge and a [text link](https://old.example).\n';
// Same markdown gate C's path (b) style rewrites would produce: the badge's
// url and its link's href both change together.
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

      // --- Case 2: unlink it (continuing from case 1, like the probe) ---
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
        await waitUntil(() => imageHref(b.view, 'badge2.svg') === 'https://new.example', 8000);
        const hrefA = imageHref(a.view, 'badge2.svg');
        const hrefB = imageHref(b.view, 'badge2.svg');
        const pass = hrefA === 'https://new.example' && hrefB === 'https://new.example';
        cases.push({ name: '3. whole-document replace (url + href change)', pass, detail: `editor1=${hrefA} editor2=${hrefB}` });
      }

      // --- Case 4: replace one image node with one whose url and link differ ---
      {
        await resetToBase(a, b);
        const pos = imagePos(a.view, 'badge.svg');
        const old = a.view.state.doc.nodeAt(pos)!;
        const repl = schema.nodes.image.create(
          { ...old.attrs, url: 'badge3.svg', leafMarks: null },
          null,
          [schema.marks.link.create({ href: 'https://replaced.example' }) as Mark],
        );
        a.view.dispatch(a.view.state.tr.replaceWith(pos, pos + 1, repl));
        await waitUntil(() => imageHref(b.view, 'badge3.svg') === 'https://replaced.example', 8000);
        const hrefA = imageHref(a.view, 'badge3.svg');
        const hrefB = imageHref(b.view, 'badge3.svg');
        const pass = hrefA === 'https://replaced.example' && hrefB === 'https://replaced.example';
        cases.push({ name: '4. replace one image node (url + link differ)', pass, detail: `editor1=${hrefA} editor2=${hrefB}` });
      }

      const pass = cases.every((c) => c.pass);
      return {
        pass,
        cases,
        detail: pass ? 'all five cases showed the new value in both editors' : cases.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`).join('; '),
      };
    } finally {
      a.destroy();
      b.destroy();
    }
  } finally {
    if (relay) await relay.stop();
  }
}
