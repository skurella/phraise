// Brief 09 defect 1 (milestone-2 review log's blocker): a concurrent
// editor's edit landing between `prepareCommit`'s snapshot and
// `recordCommit` (exactly what happens during `relay/commit.ts`'s await on
// the real git push) must NOT be baked into the stored `snapshot:<commit>`
// base -- it must survive a later rebase that touches the same block, get
// flagged for review, and its author must keep co-author credit (not be
// cleared by the commit whose content never actually included her edit).
// Reproduced directly at the engine level, mirroring the exact call
// sequence `relay/commit.ts` uses (`prepareCommit` -> [concurrent edit
// lands on the SAME doc] -> `recordCommit`).
import { test, expect } from 'vitest';
import { createDoc, read, snapshot } from '../src/crdt/index.js';
import { semanticEq, parseMarkdown } from '../src/markdown/index.js';
import { seedFromCommit } from '../src/engine/seed.js';
import { markEditor, prepareCommit, recordCommit, editorsSinceCommit } from '../src/engine/commit.js';
import { rebase, ORIGIN_REBASE } from '../src/engine/rebase.js';
import { attachIntegration, listReview } from '../src/engine/integrate.js';
import { importText } from '../src/engine/import.js';
import { makeToken, tokensIn } from '../src/testkit/tokens.js';

const AUTHOR = { name: 'Ada', email: 'ada@example.com' };
const MD0 = '# Title\n\nOne two three.\n\nFour five six.\n';

test('a concurrent edit landing during a commit`s push is not baked into the committed base: it survives a later rebase of the same block, is flagged, and its author keeps co-author credit', () => {
  const docId = 'doc-concurrent-during-push';
  const doc = createDoc();
  seedFromCommit(doc, { docId, markdown: MD0, commit: 'c0', author: AUTHOR });

  // A live editor's replica would treat an incoming rebase batch (relayed
  // from the server) as remote; on this single shared doc we simulate that
  // by treating ORIGIN_REBASE transactions as worth scanning -- exactly
  // what happens on every OTHER connected replica when the relay computes
  // a rebase and it is relayed to them (the relay's own doc acks its own
  // rebase immediately instead, per rebaseHead.ts's S5-5 comment, but the
  // review flag it writes is a shared CRDT write any replica's scan
  // produces identically).
  attachIntegration(doc, { isRemoteOrigin: (origin) => origin === ORIGIN_REBASE });

  markEditor(doc, 'alice');
  const prepared = prepareCommit(doc); // renders + snapshots MD0, BEFORE bob's edit below

  // Bob's edit lands on the SAME doc during the commit's (simulated) git
  // push -- relay/commit.ts's onChange hook applies an incoming connection
  // update directly to the shared doc exactly like this.
  const bobToken = makeToken('bob-during-push');
  const withBobEdit = MD0.replace('Four five six.', `Four five six ${bobToken}.`);
  importText(doc, { base: prepared.snapshot, text: withBobEdit, clientId: 42, author: AUTHOR });
  markEditor(doc, 'bob');

  recordCommit(doc, { commit: 'c1', snapshot: prepared.snapshot, preparedSeq: prepared.preparedSeq });

  // The commit's own content (prepared.text) never contained bob's edit.
  expect(prepared.text).not.toContain(bobToken);
  expect(semanticEq(parseMarkdown(prepared.text).doc, parseMarkdown(MD0).doc)).toBe(true);

  // Alice's mark IS cleared (her edit predates prepareCommit); bob's is
  // NOT (his commitSeq, bumped by prepareCommit, is higher than
  // preparedSeq) -- he still gets credited on the NEXT commit.
  expect(editorsSinceCommit(doc)).toEqual(['bob']);

  // An external commit now changes the SAME block bob concurrently edited.
  const target = MD0.replace('Four five six.', 'Four five six SEVEN.');
  const res = rebase(doc, { docId, targetMarkdown: target, targetCommit: 'c2', author: AUTHOR });
  expect(res.applied).toBe(true);

  // Bob's edit survives the rebase (the actual bug: previously silently
  // dropped, because recordCommit's fresh post-meta-write snapshot had
  // already baked it into what this rebase forked from as "the base",
  // making it look like no local change had happened).
  const rendered = read(doc);
  let text = '';
  rendered.descendants((n) => {
    if (n.isText) text += (n.text ?? '') + ' ';
  });
  expect(tokensIn(text)).toContain(bobToken);
  expect(text).toContain('SEVEN');

  // ...and the block is flagged for review (not silently merged over).
  const reviewList = listReview(doc);
  expect(reviewList.some((r) => r.reason === 'concurrent-edit')).toBe(true);

  // The next commit's coAuthors still include bob.
  expect(prepareCommit(doc).coAuthors).toEqual(['bob']);
});

test('the tie-break scenario (commit, then an immediate rebase) still resolves the base pointer to the rebase target -- 50 repetitions', () => {
  for (let i = 0; i < 50; i++) {
    const docId = `doc-tiebreak-${i}`;
    const doc = createDoc();
    seedFromCommit(doc, { docId, markdown: MD0, commit: 'c0', author: AUTHOR });

    const prepared = prepareCommit(doc);
    recordCommit(doc, { commit: 'c1', snapshot: prepared.snapshot, preparedSeq: prepared.preparedSeq });

    const target = MD0.replace('One two three.', `One two three ${i}.`);
    const res = rebase(doc, { docId, targetMarkdown: target, targetCommit: 'c2', author: AUTHOR });
    expect(res.applied, `iteration ${i}`).toBe(true);

    const rendered = read(doc);
    expect(semanticEq(rendered, parseMarkdown(target).doc), `iteration ${i}`).toBe(true);
  }
});
