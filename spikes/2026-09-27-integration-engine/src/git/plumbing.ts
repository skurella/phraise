// New for this spike (brief 02, src/git/): tree and commit plumbing for the
// bare cache repository. Never uses a working tree: every write goes
// through `hash-object -w --stdin`, a scratch index selected per call via
// `GIT_INDEX_FILE` (`read-tree`, `update-index --add --cacheinfo`,
// `write-tree`), and `commit-tree` with author/committer set through
// environment variables. Plan section 5.
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { git, gitBuffer } from './gitProcess.js';

const BLOB_MODE = '100644';

/** Writes `content` as a git blob object in `cacheDir` and returns its sha1. */
export async function hashObject(cacheDir: string, content: Uint8Array): Promise<string> {
  const { code, stdout, stderr } = await gitBuffer(cacheDir, ['hash-object', '-w', '--stdin'], content);
  if (code !== 0) throw new Error(`git hash-object -w --stdin failed: ${stderr}`);
  return stdout.toString('utf8').trim();
}

/** Normalizes a caller-supplied relative path to the POSIX form git plumbing expects, and rejects anything that could escape the tree. */
export function gitPath(p: string): string {
  const posix = p.split(path.sep).join('/').replace(/^\/+/, '');
  if (posix === '' || posix.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) {
    throw new Error(`invalid tree path: ${JSON.stringify(p)}`);
  }
  return posix;
}

export interface TreeEntry {
  readonly path: string;
  readonly blob: string;
}

/**
 * Builds a new tree object in `cacheDir`: start from `baseTree` (or an
 * empty tree when `baseTree` is `null`), then set each `{path, blob}` entry
 * as a regular file (overwriting whatever was at that path in `baseTree`,
 * creating intermediate directories as needed). Every call gets its own
 * scratch index file so concurrent callers never race (there is no
 * `.git/index` in a bare repo to race on by default, but a shared temp
 * path would still be a race between concurrent `GitStore` calls).
 */
export async function buildTree(cacheDir: string, baseTree: string | null, entries: readonly TreeEntry[]): Promise<string> {
  const indexDir = await mkdtemp(path.join(os.tmpdir(), 'phraise-git-index-'));
  const indexFile = path.join(indexDir, 'index');
  try {
    const env = { GIT_INDEX_FILE: indexFile };
    if (baseTree) {
      await git(cacheDir, ['read-tree', baseTree], env);
    }
    for (const entry of entries) {
      await git(
        cacheDir,
        ['update-index', '--add', '--cacheinfo', `${BLOB_MODE},${entry.blob},${gitPath(entry.path)}`],
        env,
      );
    }
    const tree = await git(cacheDir, ['write-tree'], env);
    return tree.trim();
  } finally {
    await rm(indexDir, { recursive: true, force: true });
  }
}

export interface Identity {
  readonly name: string;
  readonly email: string;
}

export interface CommitTreeOptions {
  readonly tree: string;
  readonly parents: readonly string[];
  readonly message: string;
  readonly author: Identity;
  readonly committer?: Identity;
}

/** `git commit-tree`: builds a commit object directly from a tree and parent list, author/committer supplied through environment variables. Never `git commit`, which needs a working tree and a real index. */
export async function commitTree(cacheDir: string, opts: CommitTreeOptions): Promise<string> {
  const committer = opts.committer ?? opts.author;
  const args = ['commit-tree', opts.tree];
  for (const parent of opts.parents) args.push('-p', parent);
  args.push('-m', opts.message);
  const env = {
    GIT_AUTHOR_NAME: opts.author.name,
    GIT_AUTHOR_EMAIL: opts.author.email,
    GIT_COMMITTER_NAME: committer.name,
    GIT_COMMITTER_EMAIL: committer.email,
  };
  const out = await git(cacheDir, args, env);
  return out.trim();
}
