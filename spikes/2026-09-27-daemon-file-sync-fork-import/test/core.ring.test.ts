// Regression for the review's finding 1: with a FIFO ring, 32 remote writes
// between two saves evicted the anchor, and a stale save was then diffed
// against an older base, deleting every remote edit since.
import { test, expect } from 'vitest';
import * as Y from 'yjs';
import { DocSync } from '../src/core/docsync.js';
import { VersionRing } from '../src/core/versions.js';
import { RemoteEditor } from '../src/testkit/remote-editor.js';
import { makeToken } from '../src/testkit/tokens.js';
import { syncDocs } from './helpers.js';

test('a stale save after 60 remote writes keeps every remote edit', () => {
  const ydoc = new Y.Doc({ gc: false });
  const sync = new DocSync(ydoc);
  const base = 'Intro paragraph here.\n\nMiddle paragraph here.\n\nLast paragraph here.\n';
  sync.adopt(base);
  // The editor saves once, so the anchor is an import.
  const saved = base.replace('Intro', 'Opening');
  expect(sync.importText(saved, { author: { name: 'local', kind: 'local' } }).kind).toBe('ok');

  const remote = new Y.Doc({ gc: false });
  syncDocs(ydoc, remote);
  const editor = new RemoteEditor(remote);
  const markers: string[] = [];
  for (let i = 0; i < 60; i++) {
    const m = makeToken(`r${i}`);
    markers.push(m);
    editor.insertParagraphAfter(1, m);
    syncDocs(ydoc, remote);
    sync.recordWrite(sync.render());
  }

  // The editor never reloaded: its buffer is still `saved`. It adds one word.
  const stale = saved.replace('Last', 'Final');
  const r = sync.importText(stale, { author: { name: 'local', kind: 'local' } });
  expect(r.kind).toBe('ok');
  const out = sync.render();
  for (const m of markers) expect(out).toContain(m);
  expect(out).toContain('Final paragraph');
});

test('the ring never evicts the anchor and keeps the newest versions', () => {
  const ring = new VersionRing();
  const snap = Y.snapshot(new Y.Doc({ gc: false }));
  const mk = (origin: 'write' | 'import', i: number) => ({ text: `v${i}`, hash: `h${i}`, snapshot: snap, origin, at: i });
  ring.push(mk('write', 0));
  const anchor = ring.push(mk('import', 1));
  for (let i = 2; i < 200; i++) ring.push(mk('write', i));
  const cands = ring.candidates();
  expect(cands[0].seq).toBe(anchor.seq);
  expect(cands.slice(-16).map((v) => v.at)).toEqual(Array.from({ length: 16 }, (_, k) => 184 + k));
  expect(ring.size).toBeLessThanOrEqual(48);
});
