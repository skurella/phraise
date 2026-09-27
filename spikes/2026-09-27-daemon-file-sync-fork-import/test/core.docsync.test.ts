import { describe, test, expect } from 'vitest';
import * as Y from 'yjs';
import { DocSync } from '../src/core/docsync.js';
import { RemoteEditor } from '../src/testkit/remote-editor.js';
import { makeToken, tokensIn } from '../src/testkit/tokens.js';
import { syncDocs, changedTypesDuring, topLevelBlockOf, rootFragment } from './helpers.js';

test('fresh save: one word changed in one paragraph stays local to that block, attributed to the local user', () => {
  const ydoc = new Y.Doc({ gc: false });
  const sync = new DocSync(ydoc);
  const text = 'Paragraph one is here.\n\nParagraph two is here.\n\nParagraph three is here.\n';
  sync.adopt(text);

  const edited = text.replace('Paragraph one is here.', 'Paragraph ONE is here.');

  const { result, changed } = changedTypesDuring(ydoc, () =>
    sync.importText(edited, { author: { name: 'local-editor', kind: 'local' } }),
  );

  expect(result.kind).toBe('ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  expect(result.forked).toBe(false); // fast path: base is the current live snapshot
  expect(result.repaired).toBe(false);
  expect(sync.render()).toBe(edited);

  // Every changed Y type lies inside the edited (first) top-level block.
  const root = rootFragment(ydoc);
  const targetBlock = root.toArray()[0];
  const touchedBlocks = new Set<any>();
  for (const t of changed) {
    const blk = topLevelBlockOf(t, root);
    if (blk) touchedBlocks.add(blk);
  }
  expect(touchedBlocks.size).toBe(1);
  expect(touchedBlocks.has(targetBlock)).toBe(true);

  // The inserting client (the live doc's own client ID, fast path) maps to the local user.
  const authorRecord = sync.authors[String(ydoc.clientID)];
  expect(authorRecord).toBeDefined();
  expect(authorRecord.name).toBe('local-editor');
  expect(authorRecord.kind).toBe('local');
});

test('stale save (gate D): remote edits in another block and in the same paragraph survive; the remote deletion is not undone', () => {
  const ydoc = new Y.Doc({ gc: false });
  const sync = new DocSync(ydoc);
  const base = 'One two three four.\n\nFive six seven.\n\nEight nine ten.\n';
  const v0 = sync.adopt(base);

  const remoteDoc = new Y.Doc({ gc: false });
  syncDocs(ydoc, remoteDoc);

  const remoteToken1 = makeToken('remote-other-block');
  const remoteToken2 = makeToken('remote-same-para');
  const deletedWord = 'two';

  const remoteEditor = new RemoteEditor(remoteDoc);
  // Different block: paragraph 1 ("Five six seven.").
  remoteEditor.replaceWord(1, 0, remoteToken1);
  // Same paragraph as the editor's own edit (paragraph 0): delete a word...
  remoteEditor.replaceWord(0, 1, ''); // "One two three four." -> "One three four."
  // ...and change a different word.
  remoteEditor.replaceWord(0, 1, remoteToken2); // "three" (now at index 1) -> token

  // The daemon receives the remote edits while the editor's buffer is still V0.
  syncDocs(ydoc, remoteDoc);

  const localToken = makeToken('local-edit');
  const editorText = v0.text.replace('One', localToken); // editor's buffer: V0 plus its own edit, unaware of remote's

  const result = sync.importText(editorText, { author: { name: 'local-editor', kind: 'local' }, base: v0 });
  expect(result.kind).toBe('ok');
  if (result.kind !== 'ok') throw new Error('unreachable');
  expect(result.forked).toBe(true); // live has diverged from v0's snapshot (remote edits landed in between)

  const rendered = sync.render();
  const tokens = tokensIn(rendered);
  expect(tokens).toContain(remoteToken1);
  expect(tokens).toContain(remoteToken2);
  expect(tokens).toContain(localToken);
  expect(rendered).not.toMatch(new RegExp(`\\b${deletedWord}\\b`));

  // Both replicas converge once the merge is echoed back.
  syncDocs(ydoc, remoteDoc);
  expect(Y.equalSnapshots(Y.snapshot(ydoc), Y.snapshot(remoteDoc))).toBe(true);
});

test('undo after save picks the anchor; cost-0 saves import nothing', () => {
  const ydoc = new Y.Doc({ gc: false });
  const sync = new DocSync(ydoc);
  const v0Text = 'Alpha bravo charlie.\n';
  const v0 = sync.adopt(v0Text);

  const v1Text = v0Text.replace('bravo', 'BRAVO');
  const v1Result = sync.importText(v1Text, { author: { name: 'local-editor', kind: 'local' } });
  expect(v1Result.kind).toBe('ok');

  // Cost-0 save: re-saving the current text imports nothing new.
  const noopResult = sync.importText(sync.render(), { author: { name: 'local-editor', kind: 'local' } });
  expect(noopResult.kind).toBe('noop');
  expect(noopResult.cost).toBe(0);
  const ringSizeAfterNoop = sync.versions.length;

  // The user undoes back to V0's bytes. V0 predates the anchor (V1, an
  // import), so it cannot be chosen as a base: the undo is imported as an
  // edit, not treated as an unchanged stale save.
  const undoResult = sync.importText(v0Text, { author: { name: 'local-editor', kind: 'local' } });
  expect(undoResult.kind).toBe('ok');
  if (undoResult.kind !== 'ok') throw new Error('unreachable');
  expect(undoResult.base.seq).not.toBe(v0.seq);
  expect(sync.render()).toBe(v0Text);
  expect(sync.versions.length).toBe(ringSizeAfterNoop + 1);
});
