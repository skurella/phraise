// Brief 02 task 3: "remoteHead sees a push from a clone."
import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { GitStore } from '../src/git/index.js';
import { makeClone, makeRemote, type Remote } from '../src/testkit/remote.js';

let remote: Remote;
let cacheBase: string;

beforeEach(async () => {
  remote = await makeRemote();
  cacheBase = await mkdtemp(path.join(os.tmpdir(), 'phraise-cache-'));
});

afterEach(async () => {
  await remote.cleanup();
  await rm(cacheBase, { recursive: true, force: true });
});

test('remoteHead reports the branch head, and sees a push from a clone', async () => {
  const store = new GitStore({ cacheDir: path.join(cacheBase, 'cache.git'), remoteUrl: remote.url });
  await store.init();

  const initialHead = await store.remoteHead('main');
  expect(initialHead).not.toBeNull();

  const clone = await makeClone(remote.url);
  await clone.write('doc.md', '# Sample document\n\nEdited by someone else.\n');
  const pushed = await clone.commitAndPush('someone else edits');
  await clone.cleanup();

  const headAfter = await store.remoteHead('main');
  expect(headAfter).toBe(pushed);
  expect(headAfter).not.toBe(initialHead);
});

test('remoteHead returns null for a branch that does not exist', async () => {
  const store = new GitStore({ cacheDir: path.join(cacheBase, 'cache.git'), remoteUrl: remote.url });
  await store.init();
  expect(await store.remoteHead('does-not-exist')).toBeNull();
});
