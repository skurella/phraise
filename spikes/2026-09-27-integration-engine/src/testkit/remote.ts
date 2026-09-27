// New for this spike (brief 02, src/testkit/): a temporary bare git remote
// and plain clones of it, for `src/git/` tests to play "someone else pushes
// a commit" without any `GitStore` involved. Modeled on the shape of spike
// 3's `src/testkit/temp-repo.ts` (`makeTempRepo`: a temp dir under
// `os.tmpdir()`, local user config, a returned `cleanup()`), but the repo
// this creates is bare (a remote a `GitStore` points at), and `makeClone`
// adds the small set of operations a test needs to act as another writer.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { git, type GitResult, gitTolerant } from '../git/gitProcess.js';

export interface Identity {
  readonly name: string;
  readonly email: string;
}

export interface MakeRemoteOptions {
  readonly files?: Record<string, string>;
  readonly branch?: string;
  readonly author?: Identity;
}

export interface Remote {
  /** The remote's URL -- a filesystem path to the bare repo, usable directly as a `GitStore`'s `remoteUrl`. */
  readonly url: string;
  /** Same as `url`; kept as a separate field per the brief's `{url, dir, cleanup}` shape. */
  readonly dir: string;
  cleanup(): Promise<void>;
}

const DEFAULT_FILES: Record<string, string> = {
  'doc.md': '# Sample document\n\nParagraph one is here.\n\nParagraph two is here.\n',
};

const DEFAULT_AUTHOR: Identity = { name: 'Test Author', email: 'author@example.invalid' };

/** A bare repo under `os.tmpdir()` with one initial commit on `branch` (default `main`) containing `files` (default one Markdown file). Seeded through an ordinary (non-bare) throwaway clone, then discarded -- the returned repo has no working tree at all. */
export async function makeRemote(opts: MakeRemoteOptions = {}): Promise<Remote> {
  const branch = opts.branch ?? 'main';
  const author = opts.author ?? DEFAULT_AUTHOR;
  const files = opts.files ?? DEFAULT_FILES;

  const base = await mkdtemp(path.join(os.tmpdir(), 'phraise-remote-'));
  const bareDir = path.join(base, 'remote.git');
  const seedDir = path.join(base, 'seed');

  await git(base, ['init', '--bare', '-q', bareDir]);
  await git(base, ['init', '-q', '-b', branch, seedDir]);
  await git(seedDir, ['config', 'user.name', author.name]);
  await git(seedDir, ['config', 'user.email', author.email]);
  await git(seedDir, ['config', 'commit.gpgsign', 'false']);

  const paths = Object.keys(files);
  for (const p of paths) {
    const full = path.join(seedDir, p);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, files[p], 'utf8');
  }
  if (paths.length > 0) {
    await git(seedDir, ['add', '--', ...paths]);
    await git(seedDir, ['commit', '-q', '-m', 'initial commit']);
  } else {
    await git(seedDir, ['commit', '-q', '--allow-empty', '-m', 'initial commit']);
  }
  await git(seedDir, ['push', '-q', bareDir, `HEAD:refs/heads/${branch}`]);
  await rm(seedDir, { recursive: true, force: true });

  let cleaned = false;
  return {
    url: bareDir,
    dir: bareDir,
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      await rm(base, { recursive: true, force: true });
    },
  };
}

export interface Clone {
  readonly dir: string;
  /** Writes `text` to `relPath` (creating parent directories) and stages it for the next `commitAndPush`. Does not touch git itself; call `commitAndPush` to actually commit. */
  write(relPath: string, text: string): Promise<void>;
  /** Stages every path written since the last commit (explicitly, by name -- never `add -A`/`add .`), commits, and pushes to `branch`. Returns the new commit's sha. */
  commitAndPush(message: string, author?: Identity): Promise<string>;
  /** `git pull` (fast-forward or merge, whichever git does by default) of `branch`. */
  pull(): Promise<void>;
  /** The clone's current `HEAD` sha. */
  head(): Promise<string>;
  /** Runs an arbitrary `git <args>` in this clone, for assertions a test wants to make directly (`git diff --name-only`, `git log --format=...`). Throws on a non-zero exit; use `gitTolerant` for a call that may legitimately fail. */
  git(args: string[]): Promise<string>;
  /** Like `git`, but returns `{code, stdout, stderr}` instead of throwing. */
  gitTolerant(args: string[]): Promise<GitResult>;
  cleanup(): Promise<void>;
}

export interface MakeCloneOptions {
  readonly branch?: string;
  readonly author?: Identity;
}

const DEFAULT_CLONE_AUTHOR: Identity = { name: 'Someone Else', email: 'someone-else@example.invalid' };

/** An ordinary (non-bare) clone of `url`, for tests that need to act as another writer pushing to the remote a `GitStore` also watches. */
export async function makeClone(url: string, opts: MakeCloneOptions = {}): Promise<Clone> {
  const branch = opts.branch ?? 'main';
  const author = opts.author ?? DEFAULT_CLONE_AUTHOR;

  const dir = await mkdtemp(path.join(os.tmpdir(), 'phraise-clone-'));
  await git(path.dirname(dir), ['clone', '-q', url, dir]);
  await git(dir, ['config', 'user.name', author.name]);
  await git(dir, ['config', 'user.email', author.email]);
  await git(dir, ['config', 'commit.gpgsign', 'false']);
  const onBranch = await gitTolerant(dir, ['checkout', '-q', branch]);
  if (onBranch.code !== 0) {
    await git(dir, ['checkout', '-q', '-b', branch, `origin/${branch}`]);
  }

  const pending = new Set<string>();
  let cleaned = false;

  return {
    dir,
    async write(relPath, text) {
      const full = path.join(dir, relPath);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, text, 'utf8');
      pending.add(relPath.split(path.sep).join('/'));
    },
    async commitAndPush(message, commitAuthor) {
      if (pending.size === 0) throw new Error('commitAndPush: nothing written since the last commit');
      await git(dir, ['add', '--', ...pending]);
      pending.clear();
      const env = commitAuthor
        ? { GIT_AUTHOR_NAME: commitAuthor.name, GIT_AUTHOR_EMAIL: commitAuthor.email }
        : {};
      await git(dir, ['commit', '-q', '-m', message], env);
      await git(dir, ['push', '-q', 'origin', branch]);
      return (await git(dir, ['rev-parse', 'HEAD'])).trim();
    },
    async pull() {
      await git(dir, ['pull', '-q', 'origin', branch]);
    },
    async head() {
      return (await git(dir, ['rev-parse', 'HEAD'])).trim();
    },
    async git(args: string[]) {
      return git(dir, args);
    },
    async gitTolerant(args: string[]) {
      return gitTolerant(dir, args);
    },
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      await rm(dir, { recursive: true, force: true });
    },
  };
}
