// New for this spike (brief 02, src/git/): everything the relay needs from
// git against a remote that is a local bare repository, using the git CLI.
// No Yjs, no Markdown knowledge -- files are strings or bytes. Plan
// section 5 (git layout), amending D2/D6 per
// context/docs/2026-09-27-spike-4-findings-github-storage.md section D.
//
// Two deviations from the brief's stated fetch behaviour, found by
// experiment and recorded in `context/logs/2026-09-27-builder-spike-6-git-storage.md`:
// 1. The draft ref is fetched with a `+` (force) refspec, not a plain one.
//    A plain refspec fails non-fast-forward fetches, and a relay's own
//    successive draft flushes are routinely non-fast-forward siblings of
//    each other (same base, rewritten content) -- exactly the traffic this
//    method exists to read back. This is safe: `+` on a *push* refspec is
//    the spike-4 pitfall (it silently defeats `--force-with-lease`'s CAS),
//    but on a *fetch* it only controls whether the cache's own read-only
//    mirror ref may move non-fast-forward, which is exactly what a mirror
//    of a force-pushed ref needs.
// 2. The branch ref and the draft ref are fetched in two separate `git
//    fetch` calls, not one call with two refspecs. A single call is
//    all-or-nothing: when the draft ref does not exist yet on the remote
//    (the ordinary "no draft written" case) the whole command fails with
//    "couldn't find remote ref" and *also* fails to update the branch ref,
//    even though that ref existed and was otherwise fetchable.
import * as path from 'node:path';
import * as os from 'node:os';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { git, gitBuffer, gitTolerant } from './gitProcess.js';
import { buildTree, commitTree, gitPath, hashObject, type Identity } from './plumbing.js';

const SIDECAR_PREFIX = '.phraise/';

/** The identity used for the two internal bookkeeping commits a draft is made of (the draft commit itself and its parentless sidecar-only second parent). Neither is ever pushed to `refs/heads/*` or shown to a human as an authored commit. */
const DRAFT_IDENTITY: Identity = { name: 'Phraise', email: 'phraise@users.phraise.test' };

function branchRef(branch: string): string {
  return `refs/heads/${branch}`;
}

function draftRef(branch: string): string {
  return `refs/phraise/drafts/${branch}`;
}

function isStaleLeaseRejection(stderr: string): boolean {
  return /\[rejected\]/.test(stderr) && /stale info/i.test(stderr);
}

function isMissingRemoteRef(stderr: string): boolean {
  return /couldn't find remote ref|fatal: couldn't find remote ref/i.test(stderr);
}

export interface GitStoreOptions {
  readonly cacheDir: string;
  readonly remoteUrl: string;
}

export interface CommitInfo {
  readonly parents: readonly string[];
  readonly author: Identity;
  readonly message: string;
}

export interface WriteDraftOptions {
  readonly branch: string;
  readonly base: string;
  readonly files: Record<string, string>;
  readonly sidecar: Record<string, Uint8Array>;
  readonly expected: string | null;
}

export type WriteDraftResult = { ok: true; commit: string } | { ok: false; reason: 'stale'; actual: string | null };

export interface ReadDraftResult {
  readonly commit: string;
  readonly base: string;
  readonly files: Record<string, string>;
  readonly sidecar: Record<string, Uint8Array>;
}

export type DeleteDraftResult = { ok: true } | { ok: false; reason: 'stale'; actual: string | null };

export interface CommitOptions {
  readonly branch: string;
  readonly expectedHead: string;
  readonly files: Record<string, string>;
  readonly author: Identity;
  readonly message: string;
  readonly coAuthors: readonly Identity[];
}

export type CommitResult = { ok: true; commit: string } | { ok: false; reason: 'stale'; actual: string | null };

/** Builds the final commit message: `message`, a blank line, then one deduplicated `Co-authored-by:` trailer per co-author, excluding the author. Returns `message` unchanged when there are no trailers to add. */
export function composeCommitMessage(message: string, author: Identity, coAuthors: readonly Identity[]): string {
  const seen = new Set<string>([author.email.toLowerCase()]);
  const trailers: string[] = [];
  for (const co of coAuthors) {
    const key = co.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    trailers.push(`Co-authored-by: ${co.name} <${co.email}>`);
  }
  if (trailers.length === 0) return message;
  return `${message}\n\n${trailers.join('\n')}`;
}

/** Parses `git cat-file -p <commit>` into parents/author/message without relying on a delimiter that a message body might itself contain: the header/message boundary is the first blank line, exactly as git itself defines a commit object. */
function parseCommitObject(commit: string, raw: string): CommitInfo {
  const sep = raw.indexOf('\n\n');
  const header = sep === -1 ? raw : raw.slice(0, sep);
  const message = sep === -1 ? '' : raw.slice(sep + 2).replace(/\n$/, '');
  const parents: string[] = [];
  let author: Identity | null = null;
  for (const line of header.split('\n')) {
    if (line.startsWith('parent ')) {
      parents.push(line.slice('parent '.length).trim());
    } else if (line.startsWith('author ') && !author) {
      const m = /^author (.*) <([^>]*)> \d+ [+-]\d{4}$/.exec(line);
      if (m) author = { name: m[1], email: m[2] };
    }
  }
  if (!author) throw new Error(`could not parse author from commit object ${commit}`);
  return { parents, author, message };
}

/**
 * Git storage against a remote given by URL or filesystem path, using a
 * local bare cache repository for all reads and for object creation before
 * a push. No working tree is ever used in the cache.
 */
export class GitStore {
  readonly cacheDir: string;
  readonly remoteUrl: string;

  constructor(opts: GitStoreOptions) {
    this.cacheDir = opts.cacheDir;
    this.remoteUrl = opts.remoteUrl;
  }

  /** Creates the bare cache repository if absent and points its `origin` remote at `remoteUrl`. Call once before any other method. */
  async init(): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
    const looksLikeRepo = existsSync(path.join(this.cacheDir, 'HEAD')) && existsSync(path.join(this.cacheDir, 'objects'));
    if (!looksLikeRepo) {
      await git(this.cacheDir, ['init', '--bare', '-q', '.']);
    }
    const existingRemote = await gitTolerant(this.cacheDir, ['remote', 'get-url', 'origin']);
    if (existingRemote.code === 0) {
      if (existingRemote.stdout.trim() !== this.remoteUrl) {
        await git(this.cacheDir, ['remote', 'set-url', 'origin', this.remoteUrl]);
      }
    } else {
      await git(this.cacheDir, ['remote', 'add', 'origin', this.remoteUrl]);
    }
  }

  /** `git ls-remote` for `ref`. Runs from `os.tmpdir()`, not the cache: `ls-remote` needs no repository context at all, only a directory that exists, and a poll should work even before `init()` has created the cache. `null` when the ref does not exist on the remote. */
  private async lsRemote(ref: string): Promise<string | null> {
    const res = await gitTolerant(os.tmpdir(), ['ls-remote', '--exit-code', this.remoteUrl, ref]);
    if (res.code === 2) return null;
    if (res.code !== 0) throw new Error(`git ls-remote ${this.remoteUrl} ${ref} failed: ${res.stderr}`);
    const line = res.stdout.split('\n').find((l) => l.length > 0);
    return line ? line.split('\t')[0] : null;
  }

  /** The remote's current head of `branch`, or `null` if the branch does not exist there. */
  async remoteHead(branch: string): Promise<string | null> {
    return this.lsRemote(branchRef(branch));
  }

  /**
   * Fetches `refs/heads/<branch>` and `refs/phraise/drafts/<branch>` into
   * the cache. The branch ref is expected to exist and a failure to fetch
   * it is thrown. The draft ref may legitimately not exist (no draft
   * written yet, or one just deleted); when the remote reports it missing,
   * the cache's own copy of that ref is removed instead of throwing, so a
   * deleted draft is never read back as if it still existed. See the
   * module header comment for why these are two separate `git fetch`
   * calls, and why the draft ref is force-fetched.
   */
  async fetch(branch: string): Promise<void> {
    const bRef = branchRef(branch);
    const branchRes = await gitTolerant(this.cacheDir, ['fetch', this.remoteUrl, `+${bRef}:${bRef}`]);
    if (branchRes.code !== 0) {
      throw new Error(`git fetch ${this.remoteUrl} ${bRef} failed: ${branchRes.stderr}`);
    }

    const dRef = draftRef(branch);
    const draftRes = await gitTolerant(this.cacheDir, ['fetch', this.remoteUrl, `+${dRef}:${dRef}`]);
    if (draftRes.code !== 0) {
      if (isMissingRemoteRef(draftRes.stderr)) {
        await gitTolerant(this.cacheDir, ['update-ref', '-d', dRef]);
      } else {
        throw new Error(`git fetch ${this.remoteUrl} ${dRef} failed: ${draftRes.stderr}`);
      }
    }
  }

  /** The blob at `path` inside `commit`'s tree, as raw bytes, or `undefined` if no such path exists there. */
  async readBlob(commit: string, filePath: string): Promise<Uint8Array | undefined> {
    const spec = `${commit}:${gitPath(filePath)}`;
    const { code, stdout, stderr } = await gitBuffer(this.cacheDir, ['cat-file', '-p', spec], undefined);
    if (code !== 0) {
      if (/does not exist|Not a valid object name|bad revision/i.test(stderr)) return undefined;
      throw new Error(`git cat-file -p ${spec} failed: ${stderr}`);
    }
    return new Uint8Array(stdout.buffer, stdout.byteOffset, stdout.byteLength);
  }

  /** `readBlob`, decoded as UTF-8 text. */
  async readFile(commit: string, filePath: string): Promise<string | undefined> {
    const blob = await this.readBlob(commit, filePath);
    return blob === undefined ? undefined : Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength).toString('utf8');
  }

  /** `{parents, author, message}` for `commit`, parsed from `git cat-file -p`. */
  async commitInfo(commit: string): Promise<CommitInfo> {
    const raw = await git(this.cacheDir, ['cat-file', '-p', commit]);
    return parseCommitObject(commit, raw);
  }

  /** The paths that differ between the trees of commits `a` and `b`. */
  async changedPaths(a: string, b: string): Promise<string[]> {
    const out = await git(this.cacheDir, ['diff', '--name-only', a, b]);
    return out.split('\n').filter((l) => l.length > 0);
  }

  /** Whether `ancestor` is an ancestor of (or equal to) `descendant`. */
  async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    if (ancestor === descendant) return true;
    const res = await gitTolerant(this.cacheDir, ['merge-base', '--is-ancestor', ancestor, descendant]);
    if (res.code === 0) return true;
    if (res.code === 1) return false;
    throw new Error(`git merge-base --is-ancestor ${ancestor} ${descendant} failed: ${res.stderr}`);
  }

  private async treeOf(commit: string): Promise<string> {
    const out = await git(this.cacheDir, ['rev-parse', `${commit}^{tree}`]);
    return out.trim();
  }

  /**
   * Writes (or overwrites) the draft for `branch`. The draft commit's tree
   * is `base`'s tree with each `files` entry replaced; its first parent is
   * `base`. `sidecar` becomes the tree of a parentless second parent
   * commit, each entry placed under `.phraise/`. Pushed with
   * `--force-with-lease` (a CAS on `expected`, never a `+` refspec, per the
   * spike-4 pitfall); a lease failure is returned as `{ok:false,
   * reason:'stale', actual}`, never thrown.
   */
  async writeDraft(opts: WriteDraftOptions): Promise<WriteDraftResult> {
    const baseTree = await this.treeOf(opts.base);

    const fileEntries = await Promise.all(
      Object.entries(opts.files).map(async ([p, content]) => ({
        path: p,
        blob: await hashObject(this.cacheDir, Buffer.from(content, 'utf8')),
      })),
    );
    const draftTree = await buildTree(this.cacheDir, baseTree, fileEntries);

    const sidecarEntries = await Promise.all(
      Object.entries(opts.sidecar).map(async ([p, content]) => ({
        path: SIDECAR_PREFIX + gitPath(p),
        blob: await hashObject(this.cacheDir, content),
      })),
    );
    const sidecarTree = await buildTree(this.cacheDir, null, sidecarEntries);
    const sidecarCommit = await commitTree(this.cacheDir, {
      tree: sidecarTree,
      parents: [],
      message: `phraise sidecar for ${opts.branch}`,
      author: DRAFT_IDENTITY,
    });

    const draftCommit = await commitTree(this.cacheDir, {
      tree: draftTree,
      parents: [opts.base, sidecarCommit],
      message: `phraise draft for ${opts.branch}`,
      author: DRAFT_IDENTITY,
    });

    const ref = draftRef(opts.branch);
    const lease = opts.expected === null ? `${ref}:` : `${ref}:${opts.expected}`;
    const push = await gitTolerant(this.cacheDir, [
      'push',
      this.remoteUrl,
      `${draftCommit}:${ref}`,
      `--force-with-lease=${lease}`,
    ]);
    if (push.code !== 0) {
      if (isStaleLeaseRejection(push.stderr)) {
        return { ok: false, reason: 'stale', actual: await this.lsRemote(ref) };
      }
      throw new Error(`git push ${ref} failed: ${push.stderr}`);
    }
    // Keep the cache's own ref in step with the remote we just updated, so
    // a readDraft in this same process sees it even before its own fetch.
    await gitTolerant(this.cacheDir, ['update-ref', ref, draftCommit]);
    return { ok: true, commit: draftCommit };
  }

  /**
   * The current draft for `branch`, or `null` if there is none. Always
   * fetches first, so this reflects the remote's current state even if
   * another process (or another `GitStore` instance) wrote or deleted the
   * draft since this cache last looked. `files` lists only paths whose
   * blob differs from `base` (`git diff --name-only base draft`); `sidecar`
   * is read from the second parent's tree with the `.phraise/` prefix
   * stripped back off.
   */
  async readDraft(branch: string): Promise<ReadDraftResult | null> {
    await this.fetch(branch);
    const ref = draftRef(branch);
    const verify = await gitTolerant(this.cacheDir, ['rev-parse', '-q', '--verify', ref]);
    if (verify.code !== 0) return null;
    const draftCommit = verify.stdout.trim();

    const info = await this.commitInfo(draftCommit);
    const [base, sidecarCommit] = info.parents;
    if (!base || !sidecarCommit) {
      throw new Error(`draft commit ${draftCommit} for branch ${branch} does not have two parents`);
    }

    const changed = await this.changedPaths(base, draftCommit);
    const files: Record<string, string> = {};
    for (const p of changed) {
      const content = await this.readFile(draftCommit, p);
      if (content !== undefined) files[p] = content;
    }

    const sidecarListing = await git(this.cacheDir, ['ls-tree', '-r', '--name-only', sidecarCommit]);
    const sidecar: Record<string, Uint8Array> = {};
    for (const p of sidecarListing.split('\n').filter((l) => l.length > 0)) {
      if (!p.startsWith(SIDECAR_PREFIX)) continue; // defensive: the sidecar tree is only ever built with this prefix
      const blob = await this.readBlob(sidecarCommit, p);
      if (blob !== undefined) sidecar[p.slice(SIDECAR_PREFIX.length)] = blob;
    }

    return { commit: draftCommit, base, files, sidecar };
  }

  /** Deletes the draft ref for `branch` under a lease. */
  async deleteDraft(branch: string, expected: string): Promise<DeleteDraftResult> {
    const ref = draftRef(branch);
    const push = await gitTolerant(this.cacheDir, [
      'push',
      this.remoteUrl,
      `:${ref}`,
      `--force-with-lease=${ref}:${expected}`,
    ]);
    if (push.code !== 0) {
      if (isStaleLeaseRejection(push.stderr)) {
        return { ok: false, reason: 'stale', actual: await this.lsRemote(ref) };
      }
      throw new Error(`git push (delete) ${ref} failed: ${push.stderr}`);
    }
    await gitTolerant(this.cacheDir, ['update-ref', '-d', ref]);
    return { ok: true };
  }

  /**
   * Commits `files` onto `branch`. Tree = `expectedHead`'s tree with the
   * files replaced; parent = `expectedHead`; message = `message` plus a
   * `Co-authored-by:` trailer per (deduplicated, author-excluded) entry in
   * `coAuthors`. Pushed under `--force-with-lease` against `expectedHead`;
   * a lease failure is returned as `{ok:false, reason:'stale', actual}`,
   * never thrown.
   */
  async commit(opts: CommitOptions): Promise<CommitResult> {
    const baseTree = await this.treeOf(opts.expectedHead);
    const fileEntries = await Promise.all(
      Object.entries(opts.files).map(async ([p, content]) => ({
        path: p,
        blob: await hashObject(this.cacheDir, Buffer.from(content, 'utf8')),
      })),
    );
    const tree = await buildTree(this.cacheDir, baseTree, fileEntries);
    const fullMessage = composeCommitMessage(opts.message, opts.author, opts.coAuthors);
    const commitSha = await commitTree(this.cacheDir, {
      tree,
      parents: [opts.expectedHead],
      message: fullMessage,
      author: opts.author,
    });

    const ref = branchRef(opts.branch);
    const push = await gitTolerant(this.cacheDir, [
      'push',
      this.remoteUrl,
      `${commitSha}:${ref}`,
      `--force-with-lease=${ref}:${opts.expectedHead}`,
    ]);
    if (push.code !== 0) {
      if (isStaleLeaseRejection(push.stderr)) {
        return { ok: false, reason: 'stale', actual: await this.lsRemote(ref) };
      }
      throw new Error(`git push ${ref} failed: ${push.stderr}`);
    }
    await gitTolerant(this.cacheDir, ['update-ref', ref, commitSha]);
    return { ok: true, commit: commitSha };
  }
}
