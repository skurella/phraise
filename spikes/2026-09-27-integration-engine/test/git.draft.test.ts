// Brief 02 task 3, draft bullets:
// - writeDraft then, in a separate plain clone, `git fetch
//   refs/phraise/drafts/main:refs/draft` and `git diff --name-only main
//   refs/draft` lists exactly the Markdown paths written, no `.phraise/`
//   paths; `git diff main refs/draft` shows the changed lines.
// - readDraft returns the same files and byte-identical sidecar data.
// - a draft written with a stale `expected` is rejected and the remote
//   draft is unchanged; one with the right `expected` succeeds; a create
//   with `expected: null` when the ref exists is rejected.
// - the draft commit's first parent is `base`.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { GitStore } from '../src/git/index.js';
import { makeClone, makeRemote, type Remote } from '../src/testkit/remote.js';

let remote: Remote;
let cacheBase: string;
let store: GitStore;
let base: string;

beforeEach(async () => {
  remote = await makeRemote();
  cacheBase = await mkdtemp(path.join(os.tmpdir(), 'phraise-cache-'));
  store = new GitStore({ cacheDir: path.join(cacheBase, 'cache.git'), remoteUrl: remote.url });
  await store.init();
  const head = await store.remoteHead('main');
  if (!head) throw new Error('test setup: remote main has no head');
  base = head;
  await store.fetch('main');
});

afterEach(async () => {
  await remote.cleanup();
  await rm(cacheBase, { recursive: true, force: true });
});

const YDOC_BYTES = new Uint8Array([0, 1, 2, 253, 254, 255, 10, 13, 0, 128, 200]);
const JSON_BYTES = new TextEncoder().encode(JSON.stringify({ docId: 'doc.md', generation: 1 }));

test('writeDraft: the draft ref, seen from a plain clone, diffs to exactly the written Markdown paths, no .phraise/ paths, with the changed lines', async () => {
  const written = await store.writeDraft({
    branch: 'main',
    base,
    files: { 'doc.md': '# Sample document\n\nParagraph one, edited in the draft.\n' },
    sidecar: { 'doc.md.ydoc': YDOC_BYTES, 'doc.md.json': JSON_BYTES },
    expected: null,
  });
  expect(written.ok).toBe(true);
  if (!written.ok) return;

  const clone = await makeClone(remote.url);
  await clone.git(['fetch', 'origin', 'refs/phraise/drafts/main:refs/draft']);

  const nameOnly = (await clone.git(['diff', '--name-only', 'main', 'refs/draft']))
    .split('\n')
    .filter((l) => l.length > 0);
  expect(nameOnly).toEqual(['doc.md']);
  expect(nameOnly.some((p) => p.startsWith('.phraise/'))).toBe(false);

  const fullDiff = await clone.git(['diff', 'main', 'refs/draft']);
  expect(fullDiff).toContain('-Paragraph one is here.');
  expect(fullDiff).toContain('+Paragraph one, edited in the draft.');

  await clone.cleanup();
});

test('readDraft returns the same files and byte-identical sidecar data', async () => {
  const written = await store.writeDraft({
    branch: 'main',
    base,
    files: { 'doc.md': '# Sample document\n\nEdited once.\n' },
    sidecar: { 'doc.md.ydoc': YDOC_BYTES, 'doc.md.json': JSON_BYTES },
    expected: null,
  });
  expect(written.ok).toBe(true);
  if (!written.ok) return;

  const draft = await store.readDraft('main');
  expect(draft).not.toBeNull();
  if (!draft) return;

  expect(draft.commit).toBe(written.commit);
  expect(draft.base).toBe(base);
  expect(draft.files).toEqual({ 'doc.md': '# Sample document\n\nEdited once.\n' });
  expect(Object.keys(draft.sidecar).sort()).toEqual(['doc.md.json', 'doc.md.ydoc']);
  expect(Buffer.from(draft.sidecar['doc.md.ydoc'])).toEqual(Buffer.from(YDOC_BYTES));
  expect(Buffer.from(draft.sidecar['doc.md.json'])).toEqual(Buffer.from(JSON_BYTES));
});

test("the draft commit's first parent is base", async () => {
  const written = await store.writeDraft({
    branch: 'main',
    base,
    files: { 'doc.md': '# Sample document\n\nEdited.\n' },
    sidecar: {},
    expected: null,
  });
  expect(written.ok).toBe(true);
  if (!written.ok) return;

  const info = await store.commitInfo(written.commit);
  expect(info.parents.length).toBe(2);
  expect(info.parents[0]).toBe(base);
});

test('a create with expected: null when the ref already exists is rejected as stale, and the remote draft is unchanged', async () => {
  const first = await store.writeDraft({
    branch: 'main',
    base,
    files: { 'doc.md': '# Sample document\n\nFirst draft.\n' },
    sidecar: {},
    expected: null,
  });
  expect(first.ok).toBe(true);
  if (!first.ok) return;

  const second = await store.writeDraft({
    branch: 'main',
    base,
    files: { 'doc.md': '# Sample document\n\nShould not land.\n' },
    sidecar: {},
    expected: null,
  });
  expect(second).toEqual({ ok: false, reason: 'stale', actual: first.commit });

  const stillThere = await store.readDraft('main');
  expect(stillThere?.commit).toBe(first.commit);
  expect(stillThere?.files).toEqual({ 'doc.md': '# Sample document\n\nFirst draft.\n' });
});

test('a draft written with a stale expected is rejected and the remote draft is unchanged; the right expected succeeds', async () => {
  const first = await store.writeDraft({
    branch: 'main',
    base,
    files: { 'doc.md': '# Sample document\n\nFirst.\n' },
    sidecar: {},
    expected: null,
  });
  expect(first.ok).toBe(true);
  if (!first.ok) return;

  const staleAttempt = await store.writeDraft({
    branch: 'main',
    base,
    files: { 'doc.md': '# Sample document\n\nShould not land either.\n' },
    sidecar: {},
    expected: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  });
  expect(staleAttempt).toEqual({ ok: false, reason: 'stale', actual: first.commit });

  const unchanged = await store.readDraft('main');
  expect(unchanged?.commit).toBe(first.commit);

  const second = await store.writeDraft({
    branch: 'main',
    base,
    files: { 'doc.md': '# Sample document\n\nSecond, with the right lease.\n' },
    sidecar: {},
    expected: first.commit,
  });
  expect(second.ok).toBe(true);
  if (!second.ok) return;
  expect(second.commit).not.toBe(first.commit);

  const updated = await store.readDraft('main');
  expect(updated?.commit).toBe(second.commit);
  expect(updated?.files).toEqual({ 'doc.md': '# Sample document\n\nSecond, with the right lease.\n' });
});

test('deleteDraft removes the ref under a lease, rejects a stale lease, and readDraft then returns null', async () => {
  const written = await store.writeDraft({
    branch: 'main',
    base,
    files: { 'doc.md': '# Sample document\n\nTo be deleted.\n' },
    sidecar: {},
    expected: null,
  });
  expect(written.ok).toBe(true);
  if (!written.ok) return;

  const staleDelete = await store.deleteDraft('main', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
  expect(staleDelete).toEqual({ ok: false, reason: 'stale', actual: written.commit });

  const deleted = await store.deleteDraft('main', written.commit);
  expect(deleted).toEqual({ ok: true });

  const afterDelete = await store.readDraft('main');
  expect(afterDelete).toBeNull();
});
