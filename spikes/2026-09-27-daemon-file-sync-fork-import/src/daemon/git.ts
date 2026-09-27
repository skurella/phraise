// Plan section 4.5 / brief 02 task 4: reading git state underneath the
// daemon with plain `git` subprocesses. This module is read-only (it never
// runs a mutating git command); the daemon decides what to do with the
// state it reports.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface GitState {
  /** The current branch name, or `null` when HEAD is detached. */
  branch: string | null;
  /** The current commit HEAD resolves to. */
  head: string;
  /** The commit `refs/stash` resolves to, or `null` when there is no stash. */
  stash: string | null;
}

interface GitResult {
  stdout: string;
  code: number;
}

async function git(repoDir: string, args: string[]): Promise<GitResult> {
  try {
    const { stdout } = await execFileP('git', args, { cwd: repoDir, encoding: 'utf8' });
    return { stdout: stdout.trim(), code: 0 };
  } catch (err: any) {
    return { stdout: String(err?.stdout ?? '').trim(), code: typeof err?.code === 'number' ? err.code : 1 };
  }
}

/** `{ branch, head, stash }`, read with `symbolic-ref -q HEAD`, `rev-parse HEAD`, `rev-parse -q --verify refs/stash`. */
export async function readGitState(repoDir: string): Promise<GitState> {
  const [symbolic, headRes, stashRes] = await Promise.all([
    git(repoDir, ['symbolic-ref', '-q', 'HEAD']),
    git(repoDir, ['rev-parse', 'HEAD']),
    git(repoDir, ['rev-parse', '-q', '--verify', 'refs/stash']),
  ]);
  const branch = symbolic.code === 0 ? symbolic.stdout.replace(/^refs\/heads\//, '') : null;
  return {
    branch,
    head: headRes.stdout,
    stash: stashRes.code === 0 && stashRes.stdout ? stashRes.stdout : null,
  };
}

/** Whether `ancestor` is an ancestor of (or equal to) `descendant`, via `merge-base --is-ancestor`. */
export async function isAncestor(repoDir: string, ancestor: string, descendant: string): Promise<boolean> {
  if (ancestor === descendant) return true;
  const res = await git(repoDir, ['merge-base', '--is-ancestor', ancestor, descendant]);
  return res.code === 0;
}

/** The author name of a commit, via `log -1 --format=%an`. */
export async function commitAuthor(repoDir: string, rev: string): Promise<string> {
  const res = await git(repoDir, ['log', '-1', '--format=%an', rev]);
  return res.stdout || 'unknown';
}

/** The content of `relFile` at `rev`, or `undefined` if it does not exist there. */
export async function readAtRevision(repoDir: string, rev: string, relFile: string): Promise<string | undefined> {
  const spec = `${rev}:${relFile.split(path.sep).join('/')}`;
  const res = await git(repoDir, ['show', spec]);
  return res.code === 0 ? res.stdout : undefined;
}

/** Whether `.git/index.lock` currently exists (a mutating git command is mid-flight). */
export function isIndexLocked(repoDir: string): boolean {
  return existsSync(path.join(repoDir, '.git', 'index.lock'));
}

/** Absolute path to this repo's `.git` directory (plain `git init` repos only; no worktree/submodule indirection). */
export function gitDir(repoDir: string): string {
  return path.join(repoDir, '.git');
}

export function gitStatesEqual(a: GitState, b: GitState): boolean {
  return a.branch === b.branch && a.head === b.head && a.stash === b.stash;
}
