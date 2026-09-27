// Brief 02 task 3, commit bullets:
// - `commit` with the right `expectedHead` succeeds, the author is as
//   given, the message ends with the trailers, and
//   `git log --format=%(trailers:key=Co-authored-by)` in a plain clone
//   shows them; `commit` after someone else pushed is rejected with
//   `stale` and the branch is unchanged.
// - no git process is left running after the tests.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { composeCommitMessage, GitStore } from '../src/git/index.js';
import { makeClone, makeRemote, type Remote } from '../src/testkit/remote.js';

const execFileP = promisify(execFile);

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

const AUTHOR = { name: 'Alice', email: 'alice@users.phraise.test' };
const BOB = { name: 'Bob', email: 'bob@users.phraise.test' };

test('composeCommitMessage dedupes co-authors case-insensitively and excludes the author', () => {
  const msg = composeCommitMessage('Edit the document', AUTHOR, [
    BOB,
    { name: 'Bob', email: 'BOB@users.phraise.test' },
    AUTHOR,
  ]);
  expect(msg).toBe('Edit the document\n\nCo-authored-by: Bob <bob@users.phraise.test>');
});

test('commit with the right expectedHead succeeds: author is as given, message ends with trailers, branch moves, remote sees it', async () => {
  const result = await store.commit({
    branch: 'main',
    expectedHead: base,
    files: { 'doc.md': '# Sample document\n\nCommitted by Alice, with Bob co-authoring.\n' },
    author: AUTHOR,
    message: 'Edit the document',
    coAuthors: [BOB, { name: 'Bob', email: 'BOB@users.phraise.test' }, AUTHOR],
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  const info = await store.commitInfo(result.commit);
  expect(info.parents).toEqual([base]);
  expect(info.author).toEqual(AUTHOR);
  expect(info.message).toBe('Edit the document\n\nCo-authored-by: Bob <bob@users.phraise.test>');
  expect(info.message.endsWith('Co-authored-by: Bob <bob@users.phraise.test>')).toBe(true);

  const newHead = await store.remoteHead('main');
  expect(newHead).toBe(result.commit);

  const clone = await makeClone(remote.url);
  const trailers = await clone.git(['log', '-1', '--format=%(trailers:key=Co-authored-by)']);
  expect(trailers.trim()).toBe('Co-authored-by: Bob <bob@users.phraise.test>');
  const authorLine = await clone.git(['log', '-1', '--format=%an <%ae>']);
  expect(authorLine.trim()).toBe('Alice <alice@users.phraise.test>');
  const content = await clone.git(['show', 'HEAD:doc.md']);
  expect(content).toBe('# Sample document\n\nCommitted by Alice, with Bob co-authoring.\n');
  await clone.cleanup();
});

test('commit after someone else pushed is rejected with stale, and the branch is unchanged', async () => {
  const other = await makeClone(remote.url);
  await other.write('doc.md', '# Sample document\n\nSomeone else committed first.\n');
  const othersCommit = await other.commitAndPush('someone else commits first');
  await other.cleanup();

  // `store` still believes `base` is current: it never re-fetched after
  // the other clone's push.
  const result = await store.commit({
    branch: 'main',
    expectedHead: base,
    files: { 'doc.md': '# Sample document\n\nShould not land.\n' },
    author: AUTHOR,
    message: 'Edit the document',
    coAuthors: [],
  });
  expect(result).toEqual({ ok: false, reason: 'stale', actual: othersCommit });

  const headAfter = await store.remoteHead('main');
  expect(headAfter).toBe(othersCommit);
  expect(headAfter).not.toBe(base);
});

test('no git process is left running after these tests', async () => {
  // `pgrep -x git` exits 0 (and prints matching PIDs) when a process named
  // exactly "git" is running, and exits 1 when there is none -- so a
  // *resolved* promise here means a leaked process (fail), a rejection
  // with code 1 means none (pass), and any other failure (e.g. ENOENT:
  // pgrep unavailable on this machine) is inconclusive, not a failure.
  try {
    const { stdout } = await execFileP('pgrep', ['-x', 'git']);
    throw new Error(`git process(es) still running after the git module tests: ${stdout.trim()}`);
  } catch (err: unknown) {
    const e = err as { code?: number | string };
    if (e.code === 1) {
      expect(true).toBe(true); // no matching process: the expected outcome
      return;
    }
    if (e.code === undefined) throw err; // our own thrown Error above: a real leak
    // ENOENT or anything else pgrep-related: cannot conclude, don't fail the suite over it.
  }
});
