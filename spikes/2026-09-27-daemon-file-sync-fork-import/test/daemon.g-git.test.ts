// Gate G: git underneath. One test per row of plan 4.5's action table, plus
// a negative control. Git operations are scripted directly with `git`
// subprocesses against the fixture's temp repo (never the Phraise
// repository). Daemons in this file use a generous `fileSettleMs` so a
// multi-step git script (write + add + commit, etc.) reliably lands as one
// settle rather than racing the debounce.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { setupFixture, type Fixture } from './daemon-helpers.js';
import { waitFor } from '../src/testkit/wait-for.js';
import { saveInPlace } from '../src/testkit/save-styles.js';

const execFileP = promisify(execFile);

async function git(repoDir: string, args: string[]): Promise<void> {
  await execFileP('git', args, { cwd: repoDir });
}

async function gitAs(repoDir: string, name: string, email: string, args: string[]): Promise<void> {
  await execFileP('git', ['-c', `user.name=${name}`, '-c', `user.email=${email}`, ...args], { cwd: repoDir });
}

const CONTENT = '# Corpus doc\n\nParagraph one is here.\n\nParagraph two is here.\n\nParagraph three is here.\n';
// A generous `fileSettleMs` gives a multi-step git script (write + add +
// commit, etc.) time to land as one settle. It must stay well under the
// default poll periods (`gitPollMs`/`filePollMs`): each poll tick also
// (re)arms the settle debounce as a safety net, so a poll period shorter
// than the debounce would keep resetting it forever and the debounce would
// never fire.
const GENEROUS_SETTLE = { fileSettleMs: 150 };

let fx: Fixture;

beforeEach(async () => {
  fx = await setupFixture({ content: CONTENT });
});

afterEach(async () => {
  await fx.cleanup();
});

test('gate G row 1: HEAD moves, same branch, file unchanged (commit) is harmless', async () => {
  const daemon = fx.makeDaemon({ timings: GENEROUS_SETTLE });
  await daemon.start();
  const detaches: unknown[] = [];
  daemon.on('detach', (e) => detaches.push(e));

  const originalHead = daemon.status().gitState?.head;

  writeFileSync(path.join(fx.repo.repoDir, 'unrelated.txt'), 'unrelated content\n', 'utf8');
  await git(fx.repo.repoDir, ['add', 'unrelated.txt']);
  await git(fx.repo.repoDir, ['commit', '-q', '-m', 'unrelated commit']);

  await waitFor(() => daemon.status().gitState?.head !== originalHead, 5000);

  expect(detaches).toEqual([]);
  expect(daemon.status().detached).toBe(false);
  expect(readFileSync(fx.repo.file, 'utf8')).toBe(CONTENT);

  await daemon.stop();
});

test('gate G row 2: branch changed detaches', async () => {
  const daemon = fx.makeDaemon({ timings: GENEROUS_SETTLE });
  await daemon.start();
  expect(daemon.status().detached).toBe(false);

  const detachEvents: any[] = [];
  daemon.on('detach', (e) => detachEvents.push(e));

  await git(fx.repo.repoDir, ['checkout', '-q', '-b', 'other-branch']);

  await waitFor(() => daemon.status().detached === true, 5000);
  expect(detachEvents.length).toBeGreaterThan(0);
  expect(String(detachEvents[0].reason)).toContain('branch changed');

  await daemon.stop();
});

test('gate G row 3: fast-forward HEAD move that also changes the file rebases with a git author', async () => {
  const daemon = fx.makeDaemon({ timings: GENEROUS_SETTLE });
  await daemon.start();

  const rebases: any[] = [];
  daemon.on('rebase', (e) => rebases.push(e));
  const detaches: any[] = [];
  daemon.on('detach', (e) => detaches.push(e));

  const newContent = CONTENT.replace('Paragraph two', 'Paragraph two REBASED-BY-GIT');
  writeFileSync(fx.repo.file, newContent, 'utf8');
  await gitAs(fx.repo.repoDir, 'Git Committer', 'git-committer@example.invalid', [
    'commit',
    '-q',
    '-a',
    '-m',
    'external change',
  ]);

  await waitFor(() => rebases.length > 0, 5000);
  expect(rebases[0].author).toBe('Git Committer');
  expect(detaches).toEqual([]);
  expect(daemon.status().detached).toBe(false);

  await waitFor(() => readFileSync(fx.repo.file, 'utf8').includes('REBASED-BY-GIT'), 5000);
  const authors = Object.values(daemon.docSync.authors);
  expect(authors.some((a) => a.kind === 'git' && a.name === 'Git Committer')).toBe(true);

  await daemon.stop();
});

test('gate G row 4: non-fast-forward HEAD move that changes the file detaches (reset --hard)', async () => {
  const daemon = fx.makeDaemon({ timings: GENEROUS_SETTLE });
  await daemon.start();

  // A second commit to reset away from. Wait for the daemon's CRDT to actually reflect
  // it (not just for the file to contain our own bytes, which is trivially true the
  // instant we write them, and not just for `gitState.head` to move, which updates
  // before the rebase-import that follows it finishes) before resetting: otherwise the
  // reset can land inside the same settle debounce as the commit, and since it reverts
  // HEAD to exactly where it started, the daemon would correctly see no net git change.
  const secondCommitContent = CONTENT.replace('Paragraph three', 'Paragraph three SECOND-COMMIT');
  writeFileSync(fx.repo.file, secondCommitContent, 'utf8');
  await gitAs(fx.repo.repoDir, 'Test User', fx.repo.userEmail, ['commit', '-q', '-a', '-m', 'second commit']);
  await waitFor(() => daemon.docSync.render() === secondCommitContent, 5000);

  const detaches: any[] = [];
  daemon.on('detach', (e) => detaches.push(e));

  await git(fx.repo.repoDir, ['reset', '--hard', 'HEAD~1']);

  await waitFor(() => daemon.status().detached === true, 5000);
  expect(detaches.length).toBeGreaterThan(0);
  expect(String(detaches[0].reason)).toContain('fast-forward');

  await daemon.stop();
});

test('gate G row 5: stash changing the file detaches', async () => {
  const daemon = fx.makeDaemon({ timings: GENEROUS_SETTLE });
  await daemon.start();

  const imports: any[] = [];
  daemon.on('import', (e) => imports.push(e));

  const editedContent = CONTENT.replace('Paragraph one', 'Paragraph one UNSTASHED-EDIT');
  writeFileSync(fx.repo.file, editedContent, 'utf8');
  // Wait for the daemon to actually import this edit (not just for the file to contain
  // our own bytes, which is trivially true the instant we write them): otherwise `git
  // stash` -- which both changes refs/stash AND reverts the file back to HEAD's content
  // -- can land inside the same settle debounce as our own edit, and since the net file
  // change then cancels out (back to exactly HEAD's content, the daemon's `lastKnown`
  // from before our edit), the daemon would correctly see no net file change at all.
  await waitFor(() => imports.length > 0 && daemon.docSync.render() === editedContent, 5000);

  const detaches: any[] = [];
  daemon.on('detach', (e) => detaches.push(e));

  await git(fx.repo.repoDir, ['stash', '-q']);

  await waitFor(() => daemon.status().detached === true, 5000);
  expect(detaches.length).toBeGreaterThan(0);
  expect(String(detaches[0].reason)).toContain('stash');

  await daemon.stop();
});

test('gate G row 6: index.lock seen during settle detaches even though refs and content look like a plain edit', async () => {
  // `fs.watch`'s macOS FSEvents backend coalesces a rapid create-then-delete of the same
  // path into a single notification delivered only once both have already happened (measured:
  // the `index.lock` watch event arrived ~15ms *after* the file was removed, having never
  // fired while it existed) -- watching cannot reliably catch a momentary lock at all, only a
  // plain, phase-independent poll can. `gitPollMs` is set short and the lock held longer than
  // it, so at least one poll tick is guaranteed to land while the lock still exists regardless
  // of the poll's phase (a real `git checkout -- file` on a tiny repo holds the lock far more
  // briefly than this; row 6 exercises the daemon's detection mechanism deterministically
  // rather than depending on a real git command's actual, much narrower, timing).
  const daemon = fx.makeDaemon({ timings: { fileSettleMs: 50, gitPollMs: 150 } });
  await daemon.start();

  const detaches: any[] = [];
  daemon.on('detach', (e) => detaches.push(e));

  const lockPath = path.join(fx.repo.repoDir, '.git', 'index.lock');
  writeFileSync(lockPath, '', 'utf8');
  // Change the file underneath, as `git checkout -- file` would, while the lock is held.
  writeFileSync(fx.repo.file, CONTENT.replace('Paragraph two', 'Paragraph two REVERTED-BY-CHECKOUT'), 'utf8');
  await new Promise((r) => setTimeout(r, 400));
  rmSync(lockPath, { force: true });

  await waitFor(() => daemon.status().detached === true, 5000);
  expect(detaches.length).toBeGreaterThan(0);
  expect(String(detaches[0].reason)).toContain('index.lock');
  // Never written while detached: the (still reverted-looking) file is left untouched.
  expect(readFileSync(fx.repo.file, 'utf8')).toContain('REVERTED-BY-CHECKOUT');

  await daemon.stop();
});

test('gate G row 7: returning to the attached branch with disk unchanged reattaches and exports', async () => {
  const daemon = fx.makeDaemon({ timings: GENEROUS_SETTLE });
  await daemon.start();

  await git(fx.repo.repoDir, ['checkout', '-q', '-b', 'side-branch']);
  await waitFor(() => daemon.status().detached === true, 5000);

  const attaches: any[] = [];
  daemon.on('attach', () => attaches.push({}));

  await git(fx.repo.repoDir, ['checkout', '-q', 'main']);

  await waitFor(() => daemon.status().detached === false, 5000);
  expect(attaches.length).toBeGreaterThan(0);

  await daemon.stop();
});

test('gate G negative control: a save that happens to match HEAD content, with no git command run, imports normally', async () => {
  const daemon = fx.makeDaemon({ timings: GENEROUS_SETTLE });
  await daemon.start();

  const detaches: any[] = [];
  const rebases: any[] = [];
  daemon.on('detach', (e) => detaches.push(e));
  daemon.on('rebase', (e) => rebases.push(e));
  const imports: any[] = [];
  daemon.on('import', (e) => imports.push(e));

  const gitStateBefore = daemon.status().gitState;

  // Edit, then edit back to the exact original (HEAD) bytes: two ordinary local saves.
  await saveInPlace(fx.repo.file, CONTENT.replace('Paragraph one', 'Paragraph one TEMP'));
  await waitFor(() => imports.length >= 1, 5000);
  await saveInPlace(fx.repo.file, CONTENT);
  await waitFor(() => imports.length >= 2, 5000);

  expect(detaches).toEqual([]);
  expect(rebases).toEqual([]);
  const local = Object.values(daemon.docSync.authors).some((a) => a.kind === 'local');
  expect(local).toBe(true);
  expect(daemon.status().gitState).toEqual(gitStateBefore);
  expect(readFileSync(fx.repo.file, 'utf8')).toBe(CONTENT);

  await daemon.stop();
});
