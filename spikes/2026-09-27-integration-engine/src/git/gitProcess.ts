// New for this spike (brief 02, src/git/): a sandboxed git subprocess
// helper. Every call is `execFile`/`spawn` with an argument array (no
// shell), `GIT_TERMINAL_PROMPT=0`, and a sanitized environment
// (`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`) so a test or
// relay process can never pick up the host user's global hooks, aliases or
// signing config. Modeled on spike 3's `src/daemon/git.ts` wrapper style
// (execFile + promisify), extended with a `spawn`-based variant for
// binary stdin/stdout (sidecar blobs are arbitrary bytes, not UTF-8 text).
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

const TIMEOUT_MS = 15_000;
const MAX_BUFFER = 64 * 1024 * 1024; // 64 MiB: generous for test-sized trees/blobs, not unbounded.

export class GitError extends Error {
  constructor(
    message: string,
    readonly args: readonly string[],
    readonly code: number,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

export interface GitResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The sanitized environment every git subprocess runs with. */
export function gitEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    ...extra,
  };
}

/** Runs `git <args>` in `cwd`; throws `GitError` on a non-zero exit. Use for calls whose only "normal" outcome is success. */
export async function git(cwd: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<string> {
  try {
    const { stdout } = await execFileP('git', args, {
      cwd,
      encoding: 'utf8',
      env: gitEnv(extraEnv),
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    });
    return stdout;
  } catch (err: unknown) {
    const e = err as { code?: number; stderr?: string; message?: string };
    throw new GitError(
      `git ${args.join(' ')} failed: ${String(e.stderr ?? e.message ?? err)}`,
      args,
      typeof e.code === 'number' ? e.code : 1,
      String(e.stderr ?? ''),
    );
  }
}

/** Like `git`, but never throws on a non-zero exit: returns `{code, stdout, stderr}` for callers that branch on the exit code themselves (`ls-remote`, `is-ancestor`, `rev-parse -q --verify`, a lease-guarded push that may legitimately be rejected). */
export async function gitTolerant(cwd: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileP('git', args, {
      cwd,
      encoding: 'utf8',
      env: gitEnv(extraEnv),
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    });
    return { code: 0, stdout, stderr };
  } catch (err: unknown) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.code === 'number' ? e.code : 1,
      stdout: String(e.stdout ?? ''),
      stderr: String(e.stderr ?? ''),
    };
  }
}

/**
 * Runs `git <args>` in `cwd`, feeding `input` on stdin and returning raw
 * stdout bytes. Used for `hash-object -w --stdin` (sidecar content is
 * arbitrary bytes) and for reading blobs whose content is not necessarily
 * valid UTF-8. Always exits (never left running): a child that outlives
 * `TIMEOUT_MS` is killed and the call rejects.
 */
export function gitBuffer(
  cwd: string,
  args: string[],
  input: Uint8Array | undefined,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, env: gitEnv(extraEnv) });
    const out: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new GitError(`git ${args.join(' ')} timed out after ${TIMEOUT_MS}ms`, args, -1, ''));
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk));
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr: Buffer.concat(errChunks).toString('utf8') });
    });

    if (input !== undefined) child.stdin.end(Buffer.from(input));
    else child.stdin.end();
  });
}
