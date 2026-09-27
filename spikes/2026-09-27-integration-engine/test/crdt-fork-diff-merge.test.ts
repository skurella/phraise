// Origin: scenario adapted from spike 3 (daemon-file-sync-fork-import),
// branch spike/2026-09-27-daemon-file-sync, commit 9343b62,
// test/core.docsync.test.ts's "stale save" and "undo" tests, rewritten
// against this spike's forkDiffMerge(doc, base, target, opts) instead of
// DocSync.importText (which also owns the version ring / base choice this
// spike's daemon adds later -- see forkDiffMerge.ts's own origin comment).
import { test, expect } from 'vitest';
import { parseMarkdown } from '../src/markdown/index.js';
import { createDoc, seed, read, snapshot, forkDiffMerge } from '../src/crdt/index.js';
import { makeToken, tokensIn } from '../src/testkit/tokens.js';

test('forkDiffMerge at an old snapshot keeps a concurrent live edit and applies the fork target: both tokens present', () => {
  const base = 'One two three four.\n\nFive six seven.\n\nEight nine ten.\n';

  const doc = createDoc();
  seed(doc, parseMarkdown(base).doc, { clientId: 1 });
  const v0 = snapshot(doc); // base === the live state right now

  // "Remote" edit: applied directly to the live doc (fast path, base ===
  // live snapshot, so no fork is needed) -- a different block from the
  // local edit below.
  const remoteToken = makeToken('remote');
  const remoteText = base.replace('Five six seven.', remoteToken);
  const remoteResult = forkDiffMerge(doc, v0, parseMarkdown(remoteText).doc, { clientId: 2 });
  expect(remoteResult.forked).toBe(false);

  // Live doc has now diverged from v0 (the remote edit landed). A "local"
  // editor whose buffer still starts from v0 saves its own, independent
  // edit in a different block.
  const localToken = makeToken('local');
  const localText = base.replace('One two three four.', localToken);
  const localResult = forkDiffMerge(doc, v0, parseMarkdown(localText).doc, { clientId: 3 });
  expect(localResult.forked).toBe(true); // live has diverged from v0 in between

  const rendered = read(doc);
  let text = '';
  rendered.descendants((n) => {
    if (n.isText) text += n.text ?? '';
    text += ' ';
  });
  const tokens = tokensIn(text);
  expect(tokens).toContain(remoteToken);
  expect(tokens).toContain(localToken);
  // The remote edit's own block content is untouched by the local merge.
  expect(text).not.toMatch(/Five six seven/);
});

test('forkDiffMerge is a no-op (no inserts/deletes/attr changes) when the base equals the live state and the target equals the current content', () => {
  const base = 'Alpha bravo charlie.\n';
  const doc = createDoc();
  seed(doc, parseMarkdown(base).doc, { clientId: 1 });
  const v0 = snapshot(doc);

  const current = read(doc);
  const result = forkDiffMerge(doc, v0, current, { clientId: 1 });

  expect(result.forked).toBe(false);
  expect(result.repaired).toBe(false);
  expect(result.counters.inserts).toBe(0);
  expect(result.counters.deletes).toBe(0);
  expect(result.counters.attrOnly).toBe(0);
});
