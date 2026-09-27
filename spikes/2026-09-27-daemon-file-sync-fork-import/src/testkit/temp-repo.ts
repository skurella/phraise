// Brief 02 task 2: `makeTempRepo()` -- a `git init` repository under
// `os.tmpdir()` with user name/email configured locally, one committed
// Markdown file, returning paths and a `cleanup()`. Every test creates its
// own temp repo and removes it; never the Phraise repository (charter
// constraint).
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileP('git', args, { cwd, encoding: 'utf8' });
  return stdout;
}

export interface TempRepo {
  /** Absolute path to the repository working tree. */
  readonly repoDir: string;
  /** Absolute path to the committed Markdown file. */
  readonly file: string;
  /** `file`'s path relative to `repoDir`, as git sees it. */
  readonly relFile: string;
  readonly userName: string;
  readonly userEmail: string;
  /** Removes the whole temp directory. Safe to call more than once. */
  cleanup(): Promise<void>;
}

export interface MakeTempRepoOptions {
  fileName?: string;
  content?: string;
  userName?: string;
  userEmail?: string;
}

const DEFAULT_CONTENT =
  '# Sample document\n\nParagraph one is here.\n\nParagraph two is here.\n\nParagraph three is here.\n';

/** A fresh `git init` repo under `$TMPDIR`, with one committed Markdown file. */
export async function makeTempRepo(opts: MakeTempRepoOptions = {}): Promise<TempRepo> {
  const repoDir = await mkdtemp(path.join(os.tmpdir(), 'phraise-daemon-'));
  const userName = opts.userName ?? 'Test User';
  const userEmail = opts.userEmail ?? 'test-user@example.invalid';
  const relFile = opts.fileName ?? 'doc.md';
  const file = path.join(repoDir, relFile);

  await git(repoDir, ['init', '-q', '-b', 'main']);
  await git(repoDir, ['config', 'user.name', userName]);
  await git(repoDir, ['config', 'user.email', userEmail]);
  await git(repoDir, ['config', 'commit.gpgsign', 'false']);
  await git(repoDir, ['config', 'core.autocrlf', 'false']);

  await writeFile(file, opts.content ?? DEFAULT_CONTENT, 'utf8');
  await git(repoDir, ['add', relFile]);
  await git(repoDir, ['commit', '-q', '-m', 'initial commit']);

  let cleaned = false;
  return {
    repoDir,
    file,
    relFile,
    userName,
    userEmail,
    async cleanup() {
      if (cleaned) return;
      cleaned = true;
      await rm(repoDir, { recursive: true, force: true });
    },
  };
}
