// Gate G (plan section 6): scripted git operations against a temp repo.
// Reuses the scenarios `test/daemon.g-git.test.ts` already scripts (brief 03
// task "reuse their scenarios for gates D, G, H"): one row per plan 4.5's
// git-action table, plus the negative control. Each row is its own fixture.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { setupFixture, type Fixture } from './lib/fixture.js';
import { waitFor } from '../src/testkit/wait-for.js';
import { saveInPlace } from '../src/testkit/save-styles.js';
import type { GateOpts, GateResult } from './lib/types.js';

const execFileP = promisify(execFile);
const CONTENT = '# Corpus doc\n\nParagraph one is here.\n\nParagraph two is here.\n\nParagraph three is here.\n';
const GENEROUS_SETTLE = { fileSettleMs: 150 };

async function git(repoDir: string, args: string[]): Promise<void> {
  await execFileP('git', args, { cwd: repoDir });
}
async function gitAs(repoDir: string, name: string, email: string, args: string[]): Promise<void> {
  await execFileP('git', ['-c', `user.name=${name}`, '-c', `user.email=${email}`, ...args], { cwd: repoDir });
}

type RowFn = (fx: Fixture) => Promise<string[]>; // returns failure messages, empty on pass

const row1: RowFn = async (fx) => {
  const failures: string[] = [];
  const daemon = fx.makeDaemon({ timings: GENEROUS_SETTLE });
  await daemon.start();
  const detaches: unknown[] = [];
  daemon.on('detach', (e) => detaches.push(e));
  const originalHead = daemon.status().gitState?.head;
  writeFileSync(path.join(fx.repo.repoDir, 'unrelated.txt'), 'unrelated content\n', 'utf8');
  await git(fx.repo.repoDir, ['add', 'unrelated.txt']);
  await git(fx.repo.repoDir, ['commit', '-q', '-m', 'unrelated commit']);
  await waitFor(() => daemon.status().gitState?.head !== originalHead, 5000);
  if (detaches.length !== 0) failures.push('row1: unexpected detach on harmless commit');
  if (daemon.status().detached) failures.push('row1: daemon detached on harmless commit');
  if (readFileSync(fx.repo.file, 'utf8') !== CONTENT) failures.push('row1: file changed unexpectedly');
  await daemon.stop();
  return failures;
};

const row2: RowFn = async (fx) => {
  const failures: string[] = [];
  const daemon = fx.makeDaemon({ timings: GENEROUS_SETTLE });
  await daemon.start();
  const detachEvents: any[] = [];
  daemon.on('detach', (e) => detachEvents.push(e));
  await git(fx.repo.repoDir, ['checkout', '-q', '-b', 'other-branch']);
  await waitFor(() => daemon.status().detached === true, 5000);
  if (detachEvents.length === 0) failures.push('row2: no detach event on branch change');
  else if (!String(detachEvents[0].reason).includes('branch changed'))
    failures.push('row2: detach reason did not mention branch changed');
  await daemon.stop();
  return failures;
};

const row3: RowFn = async (fx) => {
  const failures: string[] = [];
  const daemon = fx.makeDaemon({ timings: GENEROUS_SETTLE });
  await daemon.start();
  const rebases: any[] = [];
  const detaches: any[] = [];
  daemon.on('rebase', (e) => rebases.push(e));
  daemon.on('detach', (e) => detaches.push(e));
  const newContent = CONTENT.replace('Paragraph two', 'Paragraph two REBASED-BY-GIT');
  writeFileSync(fx.repo.file, newContent, 'utf8');
  await gitAs(fx.repo.repoDir, 'Git Committer', 'git-committer@example.invalid', ['commit', '-q', '-a', '-m', 'external change']);
  await waitFor(() => rebases.length > 0, 5000);
  if (rebases[0]?.author !== 'Git Committer') failures.push('row3: rebase author mismatch');
  if (detaches.length !== 0) failures.push('row3: unexpected detach on fast-forward rebase');
  await waitFor(() => readFileSync(fx.repo.file, 'utf8').includes('REBASED-BY-GIT'), 5000).catch(() =>
    failures.push('row3: file never reflected rebased content'),
  );
  const authors = Object.values(daemon.docSync.authors);
  if (!authors.some((a: any) => a.kind === 'git' && a.name === 'Git Committer'))
    failures.push('row3: no git-kind author recorded for the rebase');
  await daemon.stop();
  return failures;
};

const row4: RowFn = async (fx) => {
  const failures: string[] = [];
  const daemon = fx.makeDaemon({ timings: GENEROUS_SETTLE });
  await daemon.start();
  const secondCommitContent = CONTENT.replace('Paragraph three', 'Paragraph three SECOND-COMMIT');
  writeFileSync(fx.repo.file, secondCommitContent, 'utf8');
  await gitAs(fx.repo.repoDir, 'Test User', fx.repo.userEmail, ['commit', '-q', '-a', '-m', 'second commit']);
  await waitFor(() => daemon.docSync.render() === secondCommitContent, 5000);
  const detaches: any[] = [];
  daemon.on('detach', (e) => detaches.push(e));
  await git(fx.repo.repoDir, ['reset', '--hard', 'HEAD~1']);
  await waitFor(() => daemon.status().detached === true, 5000);
  if (detaches.length === 0) failures.push('row4: no detach on non-fast-forward reset');
  else if (!String(detaches[0].reason).includes('fast-forward')) failures.push('row4: detach reason did not mention fast-forward');
  await daemon.stop();
  return failures;
};

const row5: RowFn = async (fx) => {
  const failures: string[] = [];
  const daemon = fx.makeDaemon({ timings: GENEROUS_SETTLE });
  await daemon.start();
  const imports: any[] = [];
  daemon.on('import', (e) => imports.push(e));
  const editedContent = CONTENT.replace('Paragraph one', 'Paragraph one UNSTASHED-EDIT');
  writeFileSync(fx.repo.file, editedContent, 'utf8');
  await waitFor(() => imports.length > 0 && daemon.docSync.render() === editedContent, 5000);
  const detaches: any[] = [];
  daemon.on('detach', (e) => detaches.push(e));
  await git(fx.repo.repoDir, ['stash', '-q']);
  await waitFor(() => daemon.status().detached === true, 5000);
  if (detaches.length === 0) failures.push('row5: no detach on stash changing the file');
  else if (!String(detaches[0].reason).includes('stash')) failures.push('row5: detach reason did not mention stash');
  await daemon.stop();
  return failures;
};

const row6: RowFn = async (fx) => {
  const failures: string[] = [];
  const daemon = fx.makeDaemon({ timings: { fileSettleMs: 50, gitPollMs: 150 } });
  await daemon.start();
  const detaches: any[] = [];
  daemon.on('detach', (e) => detaches.push(e));
  const lockPath = path.join(fx.repo.repoDir, '.git', 'index.lock');
  writeFileSync(lockPath, '', 'utf8');
  writeFileSync(fx.repo.file, CONTENT.replace('Paragraph two', 'Paragraph two REVERTED-BY-CHECKOUT'), 'utf8');
  await new Promise((r) => setTimeout(r, 400));
  rmSync(lockPath, { force: true });
  await waitFor(() => daemon.status().detached === true, 5000);
  if (detaches.length === 0) failures.push('row6: no detach on index.lock seen during settle');
  else if (!String(detaches[0].reason).includes('index.lock')) failures.push('row6: detach reason did not mention index.lock');
  if (!readFileSync(fx.repo.file, 'utf8').includes('REVERTED-BY-CHECKOUT'))
    failures.push('row6: file was written to while detached');
  await daemon.stop();
  return failures;
};

const row7: RowFn = async (fx) => {
  const failures: string[] = [];
  const daemon = fx.makeDaemon({ timings: GENEROUS_SETTLE });
  await daemon.start();
  await git(fx.repo.repoDir, ['checkout', '-q', '-b', 'side-branch']);
  await waitFor(() => daemon.status().detached === true, 5000);
  const attaches: any[] = [];
  daemon.on('attach', () => attaches.push({}));
  await git(fx.repo.repoDir, ['checkout', '-q', 'main']);
  await waitFor(() => daemon.status().detached === false, 5000);
  if (attaches.length === 0) failures.push('row7: no attach event on returning to the attached branch');
  await daemon.stop();
  return failures;
};

const negativeControl: RowFn = async (fx) => {
  const failures: string[] = [];
  const daemon = fx.makeDaemon({ timings: GENEROUS_SETTLE });
  await daemon.start();
  const detaches: any[] = [];
  const rebases: any[] = [];
  const imports: any[] = [];
  daemon.on('detach', (e) => detaches.push(e));
  daemon.on('rebase', (e) => rebases.push(e));
  daemon.on('import', (e) => imports.push(e));
  const gitStateBefore = daemon.status().gitState;
  await saveInPlace(fx.repo.file, CONTENT.replace('Paragraph one', 'Paragraph one TEMP'));
  await waitFor(() => imports.length >= 1, 5000);
  await saveInPlace(fx.repo.file, CONTENT);
  await waitFor(() => imports.length >= 2, 5000);
  if (detaches.length !== 0) failures.push('negative control: unexpected detach');
  if (rebases.length !== 0) failures.push('negative control: unexpected rebase');
  const local = Object.values(daemon.docSync.authors).some((a: any) => a.kind === 'local');
  if (!local) failures.push('negative control: no local author recorded');
  if (JSON.stringify(daemon.status().gitState) !== JSON.stringify(gitStateBefore))
    failures.push('negative control: git state changed with no git command run');
  if (readFileSync(fx.repo.file, 'utf8') !== CONTENT) failures.push('negative control: file does not equal original content');
  await daemon.stop();
  return failures;
};

const ROWS: Array<{ name: string; fn: RowFn }> = [
  { name: 'row1-harmless-commit', fn: row1 },
  { name: 'row2-branch-changed-detaches', fn: row2 },
  { name: 'row3-fast-forward-rebases', fn: row3 },
  { name: 'row4-non-fast-forward-detaches', fn: row4 },
  { name: 'row5-stash-detaches', fn: row5 },
  { name: 'row6-index-lock-detaches', fn: row6 },
  { name: 'row7-reattach', fn: row7 },
  { name: 'negative-control', fn: negativeControl },
];

export async function runGateG(_opts: GateOpts = {}): Promise<GateResult> {
  const failures: string[] = [];
  let passed = 0;
  for (const row of ROWS) {
    const fx = await setupFixture({ content: CONTENT });
    try {
      const rowFailures = await row.fn(fx);
      if (rowFailures.length === 0) passed++;
      else failures.push(...rowFailures.map((f) => `${row.name}: ${f}`));
    } catch (err) {
      failures.push(`${row.name}: threw ${String((err as Error)?.message ?? err)}`);
    } finally {
      await fx.cleanup();
    }
  }
  return {
    gate: 'G',
    requirement: 'git commit harmless; branch/reset/stash detach; index.lock detected; reattach works; no local-attributed import while detached.',
    pass: passed === ROWS.length,
    numbers: { rows: ROWS.length, passed },
    failures,
  };
}
