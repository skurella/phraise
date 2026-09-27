// Plan section 4 / brief 02 task 3: the daemon runtime. Wraps DocSync (the
// pure core) with a Hocuspocus client connection, a file watcher, a guarded
// atomic writer, git awareness and on-disk persistence, all serialized
// through one queue per document (plan 4.1).
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';

import { DocSync, ORIGIN_IMPORT, type Author, type ImportResult } from '../core/docsync.js';
import { hashText, type Version } from '../core/versions.js';
import { FRAGMENT_NAME, META_MAP_NAME } from '../md/yjs.js';
import {
  readGitState,
  isAncestor,
  commitAuthor,
  readAtRevision,
  isIndexLocked,
  gitDir,
  type GitState,
} from './git.js';

export interface DaemonUser {
  name: string;
}

export interface DaemonTimings {
  /** Trailing debounce before a remote change is exported to the file (plan 4.2). */
  remoteDebounceMs: number;
  /** Cap on total wait since the first pending remote change (plan 4.2). */
  remoteMaxWaitMs: number;
  /** Quiet period after a file-system event before the file is read (plan 4.3). */
  fileSettleMs: number;
  /** Wait after seeing an unexpected empty file before re-reading it (plan 4.3). */
  emptyGraceMs: number;
  /** Safety-net poll of the watched file, alongside `fs.watch` (plan 4.3). */
  filePollMs: number;
  /** Safety-net poll of git state, alongside watching `.git` (plan 4.5). */
  gitPollMs: number;
}

export const DEFAULT_TIMINGS: DaemonTimings = {
  remoteDebounceMs: 30,
  remoteMaxWaitMs: 200,
  fileSettleMs: 30,
  emptyGraceMs: 250,
  filePollMs: 2000,
  gitPollMs: 500,
};

export interface DaemonOptions {
  /** The git working tree this daemon operates in. */
  repoDir: string;
  /** The materialized file, absolute or relative to `repoDir`. */
  file: string;
  docName: string;
  relayUrl: string;
  user: DaemonUser;
  /** Defaults to `<repoDir>/.git/phraise/daemon/<docName>`. */
  stateDir?: string;
  timings?: Partial<DaemonTimings>;
}

export interface DaemonStatus {
  started: boolean;
  detached: boolean;
  detachAttachedBranch: string | null;
  currentVersionHash: string | null;
  lastKnownHash: string | null;
  gitState: GitState | null;
}

interface PersistedStateJson {
  docName: string;
  relayUrl: string;
  user: DaemonUser;
  branch: string | null;
  head: string;
  detached: boolean;
  attachedBranch: string | null;
}

type GitAction =
  | { kind: 'attached' }
  | { kind: 'detach' }
  | { kind: 'detached' }
  | { kind: 'reattach' }
  | { kind: 'rebased' };

function readFullSync(fd: number, size: number): Buffer {
  const buf = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const n = fs.readSync(fd, buf, offset, size - offset, offset);
    if (n <= 0) break;
    offset += n;
  }
  return offset === size ? buf : buf.subarray(0, offset);
}

function tmpNameBeside(filePath: string, tag: string): string {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  return path.join(dir, `.${base}.phraise-${tag}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

function conflictPathBeside(filePath: string, at: Date): string {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const ts = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return path.join(dir, `${stem}.phraise-conflict-${ts}${ext || '.md'}`);
}

/**
 * The daemon runtime (plan section 4). Construct, `start()`, and `stop()`
 * when done. Emits the events of plan 4.6: `import`, `import-noop`,
 * `export`, `export-skip`, `detach`, `attach`, `rebase`, `conflict`, `error`.
 */
export class Daemon extends EventEmitter {
  readonly docSync: DocSync;
  private readonly repoDir: string;
  private readonly filePath: string;
  private readonly relFile: string;
  private readonly docName: string;
  private readonly relayUrl: string;
  private readonly user: DaemonUser;
  private readonly stateDir: string;
  private readonly timings: DaemonTimings;

  private provider: HocuspocusProvider | undefined;
  private started = false;

  /** Serial queue: every step that reads/writes the file or the version ring runs through this (plan 4.1). */
  private queue: Promise<void> = Promise.resolve();

  /** The text this daemon believes is currently on disk (content-based echo check, plan 4.3). */
  private lastKnown: string | undefined;
  /** The most recent version this daemon knows the file side had (write, import, adopt or restore). */
  private currentVersion: Version | undefined;

  private gitState: GitState = { branch: null, head: '', stash: null };
  private detached = false;
  private detachAttachedBranch: string | null | undefined;

  private settleTimer: NodeJS.Timeout | undefined;
  private indexLockSeenThisCycle = false;
  private lockGraceApplied = false;
  private exportDebounceTimer: NodeJS.Timeout | undefined;
  private exportMaxWaitTimer: NodeJS.Timeout | undefined;

  private fileWatcher: fs.FSWatcher | undefined;
  private filePollTimer: NodeJS.Timeout | undefined;
  private gitWatcher: fs.FSWatcher | undefined;
  private gitPollTimer: NodeJS.Timeout | undefined;

  constructor(opts: DaemonOptions) {
    super();
    this.repoDir = path.resolve(opts.repoDir);
    this.filePath = path.isAbsolute(opts.file) ? opts.file : path.join(this.repoDir, opts.file);
    this.relFile = path.relative(this.repoDir, this.filePath).split(path.sep).join('/');
    this.docName = opts.docName;
    this.relayUrl = opts.relayUrl;
    this.user = opts.user;
    this.stateDir = opts.stateDir ?? path.join(this.repoDir, '.git', 'phraise', 'daemon', this.docName);
    this.timings = { ...DEFAULT_TIMINGS, ...opts.timings };
    this.docSync = new DocSync(new Y.Doc({ gc: false }));
  }

  status(): DaemonStatus {
    return {
      started: this.started,
      detached: this.detached,
      detachAttachedBranch: this.detachAttachedBranch ?? null,
      currentVersionHash: this.currentVersion?.hash ?? null,
      lastKnownHash: this.lastKnown !== undefined ? hashText(this.lastKnown) : null,
      gitState: this.gitState,
    };
  }

  // ---------------------------------------------------------------- start

  async start(): Promise<void> {
    if (this.started) throw new Error('Daemon.start: already started');

    await fsp.mkdir(this.stateDir, { recursive: true });
    this.cleanupTmpFiles();

    const persisted = this.loadPersistedState();
    if (persisted?.ydocUpdate) {
      Y.applyUpdate(this.docSync.doc, persisted.ydocUpdate, 'phraise-restore');
    }

    // Remote changes (any update not produced by our own import) get exported.
    this.docSync.doc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin === ORIGIN_IMPORT) return;
      this.scheduleExport();
    });

    this.provider = new HocuspocusProvider({
      url: this.relayUrl,
      name: this.docName,
      document: this.docSync.doc,
    });
    await this.waitSynced();

    this.gitState = await readGitState(this.repoDir);
    if (persisted?.state?.detached) {
      this.detached = true;
      this.detachAttachedBranch = persisted.state.attachedBranch ?? null;
    }

    const disk = this.readDiskTextSync();

    if (!persisted?.base) {
      await this.runAdoption(disk);
    } else {
      this.currentVersion = this.docSync.restore(persisted.base);
      if (disk === undefined) {
        await this.runExport();
      } else if (disk === persisted.base.text) {
        await this.runExport();
      } else {
        try {
          // Validate the persisted snapshot can still be forked before trusting it as a base.
          Y.createDocFromSnapshot(this.docSync.doc, persisted.base.snapshot, new Y.Doc({ gc: false }));
          const result = this.docSync.importText(disk, { author: this.localAuthor(), base: this.currentVersion });
          this.recordImportEvent(result, 0);
          this.currentVersion = result.kind === 'ok' ? result.version : result.base;
          this.lastKnown = disk;
          await this.persistState();
          await this.runExport();
        } catch {
          await this.handleForkFailure(disk);
        }
      }
    }

    this.setupWatchers();
    this.started = true;
  }

  private async waitSynced(timeoutMs = 10000): Promise<void> {
    const provider = this.provider!;
    if (provider.isSynced) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        provider.off('synced', onSynced);
        reject(new Error('Daemon.start: relay sync timed out'));
      }, timeoutMs);
      const onSynced = () => {
        clearTimeout(timer);
        provider.off('synced', onSynced);
        resolve();
      };
      provider.on('synced', onSynced);
    });
  }

  private isDocEmpty(): boolean {
    const fragment = this.docSync.doc.getXmlFragment(FRAGMENT_NAME);
    if (fragment.length > 0) return false;
    const meta = this.docSync.doc.getMap(META_MAP_NAME);
    return meta.size === 0;
  }

  private localAuthor(): Author {
    return { name: this.user.name, kind: 'local' };
  }

  private async runAdoption(disk: string | undefined): Promise<void> {
    if (this.isDocEmpty()) {
      const text = disk ?? '';
      this.currentVersion = this.docSync.adopt(text);
      this.lastKnown = text;
      await this.persistState();
      return;
    }

    const rendered = this.docSync.render();
    const headContent = await readAtRevision(this.repoDir, 'HEAD', this.relFile);
    if (disk === undefined || disk === headContent) {
      this.writeFreshFile(rendered);
      await this.persistState();
    } else {
      await this.enterConflict(rendered, 'adoption conflict: file differs from the relay document and from HEAD');
    }
  }

  private async handleForkFailure(disk: string | undefined): Promise<void> {
    const rendered = this.docSync.render();
    if (disk !== undefined && disk === rendered) {
      this.lastKnown = disk;
      this.recordWriteIfNew(rendered);
      await this.persistState();
    } else {
      await this.enterConflict(rendered, 'restart conflict: persisted base could not be forked and file does not match the document');
    }
  }

  private async enterConflict(rendered: string, reason: string): Promise<void> {
    const conflictPath = conflictPathBeside(this.filePath, new Date());
    fs.writeFileSync(conflictPath, rendered, 'utf8');
    this.emit('conflict', { path: conflictPath });
    this.detached = true;
    this.detachAttachedBranch = this.gitState.branch;
    this.emit('detach', { reason });
    await this.persistState();
  }

  // -------------------------------------------------------------- teardown

  async stop(opts: { persist?: boolean } = {}): Promise<void> {
    const persist = opts.persist ?? true;
    this.started = false;
    this.teardownWatchers();
    await this.queue.catch(() => {});
    if (persist) {
      await this.persistState();
    }
    this.provider?.destroy();
    this.provider = undefined;
  }

  private teardownWatchers(): void {
    this.fileWatcher?.close();
    this.fileWatcher = undefined;
    this.gitWatcher?.close();
    this.gitWatcher = undefined;
    if (this.filePollTimer) clearInterval(this.filePollTimer);
    this.filePollTimer = undefined;
    if (this.gitPollTimer) clearInterval(this.gitPollTimer);
    this.gitPollTimer = undefined;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = undefined;
    if (this.exportDebounceTimer) clearTimeout(this.exportDebounceTimer);
    this.exportDebounceTimer = undefined;
    if (this.exportMaxWaitTimer) clearTimeout(this.exportMaxWaitTimer);
    this.exportMaxWaitTimer = undefined;
  }

  // ------------------------------------------------------------- watchers

  /**
   * Called on every raw signal of activity (a file-system event or a poll
   * tick), before the settle debounce is (re)armed. `index.lock` is often
   * held only briefly (a plain `git checkout -- file` on a small repo can
   * create and remove it within a couple of event-loop ticks), so row 6 of
   * plan 4.5's table ("index.lock was seen during settle") is checked here,
   * at every such signal, rather than only once when the settle timer
   * finally fires -- that single end-of-window check would miss a lock that
   * came and went entirely inside the debounce period.
   */
  private noticeActivity(): void {
    if (isIndexLocked(this.repoDir)) this.indexLockSeenThisCycle = true;
    this.scheduleSettle();
  }

  private setupWatchers(): void {
    const dir = path.dirname(this.filePath);
    const base = path.basename(this.filePath);
    this.fileWatcher = fs.watch(dir, { persistent: false }, (_event, filename) => {
      if (filename === null || filename === base) this.noticeActivity();
    });
    this.filePollTimer = setInterval(() => this.noticeActivity(), this.timings.filePollMs);
    this.filePollTimer.unref?.();

    try {
      this.gitWatcher = fs.watch(gitDir(this.repoDir), { persistent: false }, () => this.noticeActivity());
    } catch {
      // .git may not support watching on some platforms; the poll below covers it.
    }
    this.gitPollTimer = setInterval(() => this.noticeActivity(), this.timings.gitPollMs);
    this.gitPollTimer.unref?.();
  }

  private scheduleSettle(): void {
    if (!this.started) return;
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = undefined;
      this.onSettleFire();
    }, this.timings.fileSettleMs);
  }

  private onSettleFire(): void {
    if (isIndexLocked(this.repoDir)) {
      this.indexLockSeenThisCycle = true;
      this.lockGraceApplied = false;
      this.settleTimer = setTimeout(() => this.onSettleFire(), this.timings.fileSettleMs);
      return;
    }
    // A git command's ref update (e.g. `refs/heads/<branch>.lock`) is a separate lock
    // from `.git/index.lock` and can land a moment after the index lock is released
    // (observed with `git reset --hard`: the working tree is already reverted and
    // `.git/index.lock` gone, but `refs/heads/<branch>` has not been rewritten yet).
    // Reading git state right as the index lock clears can therefore still see the OLD
    // ref alongside the ALREADY-reverted file, which looks like an ordinary local edit.
    // One extra settle-length grace period after the lock is first seen gone gives a
    // trailing ref write time to land before git state is compared.
    if (this.indexLockSeenThisCycle && !this.lockGraceApplied) {
      this.lockGraceApplied = true;
      this.settleTimer = setTimeout(() => this.onSettleFire(), this.timings.fileSettleMs);
      return;
    }
    this.lockGraceApplied = false;
    const lockSeen = this.indexLockSeenThisCycle;
    this.indexLockSeenThisCycle = false;
    this.enqueue(() => this.runSettle(lockSeen));
  }

  private scheduleExport(): void {
    if (!this.started) return;
    if (!this.exportMaxWaitTimer) {
      this.exportMaxWaitTimer = setTimeout(() => this.fireExport(), this.timings.remoteMaxWaitMs);
    }
    if (this.exportDebounceTimer) clearTimeout(this.exportDebounceTimer);
    this.exportDebounceTimer = setTimeout(() => this.fireExport(), this.timings.remoteDebounceMs);
  }

  private fireExport(): void {
    if (this.exportDebounceTimer) {
      clearTimeout(this.exportDebounceTimer);
      this.exportDebounceTimer = undefined;
    }
    if (this.exportMaxWaitTimer) {
      clearTimeout(this.exportMaxWaitTimer);
      this.exportMaxWaitTimer = undefined;
    }
    this.enqueue(() => this.runExport());
  }

  private enqueue(fn: () => Promise<void> | void): Promise<void> {
    const next = this.queue.then(async () => {
      try {
        await fn();
      } catch (err) {
        this.emit('error', { message: err instanceof Error ? (err.stack ?? err.message) : String(err) });
      }
    });
    this.queue = next;
    return next;
  }

  // ------------------------------------------------------- file -> remote

  private readDiskTextSync(): string | undefined {
    try {
      return fs.readFileSync(this.filePath, 'utf8');
    } catch (err: any) {
      if (err?.code === 'ENOENT') return undefined;
      throw err;
    }
  }

  private async runSettle(lockSeenThisCycle: boolean): Promise<void> {
    const disk = this.readDiskTextSync();
    const fileChanged = disk !== this.lastKnown;

    const action = await this.reconcileGit(fileChanged, lockSeenThisCycle);
    switch (action.kind) {
      case 'detach':
      case 'detached':
        return;
      case 'rebased':
        this.scheduleExport();
        return;
      case 'reattach':
        await this.runExport();
        return;
      case 'attached':
        if (!fileChanged) return;
        await this.processExternalSave(disk);
    }
  }

  private async processExternalSave(diskArg: string | undefined): Promise<void> {
    const start = Date.now();
    let disk = diskArg;
    if (disk === '' && this.lastKnown !== '' && this.lastKnown !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, this.timings.emptyGraceMs));
      disk = this.readDiskTextSync();
    }
    if (disk === undefined) return;
    if (disk === this.lastKnown) return;

    const result = this.docSync.importText(disk, { author: this.localAuthor() });
    this.recordImportEvent(result, Date.now() - start);
    this.currentVersion = result.kind === 'ok' ? result.version : result.base;
    this.lastKnown = disk;
    await this.persistState();
    this.scheduleExport();
  }

  private recordImportEvent(result: ImportResult, ms: number): void {
    if (result.kind === 'noop') {
      this.emit('import-noop', { hash: hashText(result.base.text) });
      return;
    }
    this.emit('import', {
      hash: result.version.hash,
      base: result.base.hash,
      forked: result.forked,
      changedBlocks: result.counters.inserts + result.counters.deletes + result.counters.pairedUpdates,
      coarse: result.counters.coarseTextblocks,
      repair: result.repaired,
      ms,
    });
  }

  private recordWriteIfNew(text: string): void {
    if (this.currentVersion && this.currentVersion.text === text) return;
    this.currentVersion = this.docSync.recordWrite(text);
  }

  private writeFreshFile(text: string): void {
    const tmpPath = tmpNameBeside(this.filePath, 'tmp');
    fs.writeFileSync(tmpPath, text, 'utf8');
    fs.renameSync(tmpPath, this.filePath);
    this.lastKnown = text;
    this.recordWriteIfNew(text);
  }

  // ------------------------------------------------------------ git (4.5)

  private async reconcileGit(fileChanged: boolean, lockSeenThisCycle: boolean): Promise<GitAction> {
    const newState = await readGitState(this.repoDir);
    const old = this.gitState;

    if (this.detached) {
      const backOnBranch = newState.branch !== null && newState.branch === this.detachAttachedBranch;
      this.gitState = newState;
      if (backOnBranch && !fileChanged) {
        this.detached = false;
        this.detachAttachedBranch = undefined;
        this.emit('attach', {});
        await this.persistState();
        return { kind: 'reattach' };
      }
      return { kind: 'detached' };
    }

    const branchChanged = newState.branch !== old.branch;
    const headChanged = newState.head !== old.head;
    const stashChanged = newState.stash !== old.stash;
    const gitChanged = branchChanged || headChanged || stashChanged;

    if (!gitChanged) {
      if (fileChanged && lockSeenThisCycle) {
        await this.doDetach('index.lock observed during settle (a git command changed the file)', newState);
        return { kind: 'detach' };
      }
      return { kind: 'attached' };
    }

    if (branchChanged) {
      await this.doDetach(
        `branch changed (${old.branch ?? '(detached HEAD)'} -> ${newState.branch ?? '(detached HEAD)'})`,
        newState,
      );
      return { kind: 'detach' };
    }

    if (stashChanged && fileChanged) {
      await this.doDetach('refs/stash changed and the file changed', newState);
      return { kind: 'detach' };
    }

    if (headChanged) {
      if (!fileChanged) {
        this.gitState = newState;
        return { kind: 'attached' };
      }
      const descendant = await isAncestor(this.repoDir, old.head, newState.head);
      if (!descendant) {
        await this.doDetach('HEAD moved but not as a fast-forward of the last known commit (reset/rebase)', newState);
        return { kind: 'detach' };
      }
      await this.runRebaseImport(newState);
      return { kind: 'rebased' };
    }

    // Only the stash ref changed, and the file did not: harmless.
    this.gitState = newState;
    return { kind: 'attached' };
  }

  private async doDetach(reason: string, newState: GitState): Promise<void> {
    this.detached = true;
    this.detachAttachedBranch = this.gitState.branch;
    this.gitState = newState;
    this.emit('detach', { reason });
    await this.persistState();
  }

  private async runRebaseImport(newState: GitState): Promise<void> {
    const start = Date.now();
    const author = await commitAuthor(this.repoDir, newState.head);
    const disk = this.readDiskTextSync();
    this.gitState = newState;
    if (disk === undefined || !this.currentVersion) return;
    const base = this.currentVersion;
    const result = this.docSync.importText(disk, { author: { name: author, kind: 'git' }, base });
    this.recordImportEvent(result, Date.now() - start);
    this.currentVersion = result.kind === 'ok' ? result.version : result.base;
    this.lastKnown = disk;
    this.emit('rebase', { head: newState.head, author });
    await this.persistState();
  }

  // ---------------------------------------------------------- remote -> file

  private async runExport(): Promise<void> {
    if (this.detached) {
      this.emit('export-skip', { reason: 'detached' });
      return;
    }
    const start = Date.now();
    let text: string;
    try {
      text = this.docSync.render();
    } catch (err) {
      this.emit('error', { message: err instanceof Error ? err.message : String(err) });
      return;
    }

    let fd: number | undefined;
    try {
      fd = fs.openSync(this.filePath, 'r');
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        this.writeFreshFile(text);
        await this.persistState();
        this.emit('export', { hash: hashText(text), ms: Date.now() - start });
        return;
      }
      this.emit('error', { message: String(err) });
      return;
    }

    try {
      const st = fs.fstatSync(fd);
      const disk = readFullSync(fd, st.size).toString('utf8');

      if (disk !== this.lastKnown) {
        fs.closeSync(fd);
        fd = undefined;
        this.emit('export-skip', { reason: 'disk changed since last read' });
        // Defer to the ordinary settle pipeline rather than importing `disk` directly:
        // this save has not been through `reconcileGit` yet, and skipping that check is
        // exactly how a git-driven change racing an export gets misattributed to the
        // local user (observed with `git reset --hard` landing while an export was
        // in flight, immediately after a rebase-import of an earlier commit).
        this.scheduleSettle();
        return;
      }

      if (text === disk) {
        this.recordWriteIfNew(text);
        this.emit('export-skip', { reason: 'unchanged' });
        return;
      }

      const tmpPath = tmpNameBeside(this.filePath, 'tmp');
      fs.writeFileSync(tmpPath, text, { mode: st.mode & 0o777 });

      const st2 = fs.statSync(this.filePath);
      if (st2.ino !== st.ino || st2.size !== st.size || st2.mtimeMs !== st.mtimeMs) {
        fs.unlinkSync(tmpPath);
        this.emit('export-skip', { reason: 'file changed during write' });
        fs.closeSync(fd);
        fd = undefined;
        this.scheduleSettle();
        return;
      }

      fs.renameSync(tmpPath, this.filePath);

      const st3 = fs.fstatSync(fd);
      if (st3.size !== st.size || st3.mtimeMs !== st.mtimeMs) {
        // An in-place writer hit the window between our stat and our rename: `fd` still
        // refers to that original (now unlinked) inode, which holds the writer's bytes.
        const raceText = readFullSync(fd, st3.size).toString('utf8');
        fs.closeSync(fd);
        fd = undefined;
        this.lastKnown = text;
        this.recordWriteIfNew(text);
        await this.persistState();
        this.emit('export', { hash: hashText(text), ms: Date.now() - start });
        await this.processExternalSave(raceText);
        return;
      }

      fs.closeSync(fd);
      fd = undefined;
      this.lastKnown = text;
      this.recordWriteIfNew(text);
      await this.persistState();
      this.emit('export', { hash: hashText(text), ms: Date.now() - start });
    } catch (err) {
      this.emit('error', { message: err instanceof Error ? err.message : String(err) });
    } finally {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          // already closed
        }
      }
    }
  }

  // ------------------------------------------------------------ persistence

  private cleanupTmpFiles(): void {
    if (fs.existsSync(this.stateDir)) {
      for (const name of fs.readdirSync(this.stateDir)) {
        if (name.startsWith('.') && name.includes('.tmp')) {
          try {
            fs.unlinkSync(path.join(this.stateDir, name));
          } catch {
            // best effort
          }
        }
      }
    }
    const dir = path.dirname(this.filePath);
    const base = path.basename(this.filePath);
    if (fs.existsSync(dir)) {
      for (const name of fs.readdirSync(dir)) {
        if (name.startsWith(`.${base}.phraise-tmp-`)) {
          try {
            fs.unlinkSync(path.join(dir, name));
          } catch {
            // best effort
          }
        }
      }
    }
  }

  private async persistState(): Promise<void> {
    await fsp.mkdir(this.stateDir, { recursive: true });
    const writeAtomic = (name: string, data: string | Buffer) => {
      const tmp = path.join(this.stateDir, `.${name}.tmp-${process.pid}`);
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, path.join(this.stateDir, name));
    };
    if (this.currentVersion) {
      writeAtomic('base.md', this.currentVersion.text);
      writeAtomic('base.snapshot', Buffer.from(Y.encodeSnapshot(this.currentVersion.snapshot)));
    }
    writeAtomic('ydoc.bin', Buffer.from(Y.encodeStateAsUpdate(this.docSync.doc)));
    const stateJson: PersistedStateJson = {
      docName: this.docName,
      relayUrl: this.relayUrl,
      user: this.user,
      branch: this.gitState.branch,
      head: this.gitState.head,
      detached: this.detached,
      attachedBranch: this.detachAttachedBranch ?? null,
    };
    writeAtomic('state.json', JSON.stringify(stateJson, null, 2));
  }

  private loadPersistedState():
    | { base?: Version; ydocUpdate?: Uint8Array; state?: PersistedStateJson }
    | undefined {
    const baseMdPath = path.join(this.stateDir, 'base.md');
    const baseSnapPath = path.join(this.stateDir, 'base.snapshot');
    const ydocPath = path.join(this.stateDir, 'ydoc.bin');
    const statePath = path.join(this.stateDir, 'state.json');

    const hasAnything = fs.existsSync(baseMdPath) || fs.existsSync(ydocPath) || fs.existsSync(statePath);
    if (!hasAnything) return undefined;

    let base: Version | undefined;
    if (fs.existsSync(baseMdPath) && fs.existsSync(baseSnapPath)) {
      const text = fs.readFileSync(baseMdPath, 'utf8');
      const snapBuf = new Uint8Array(fs.readFileSync(baseSnapPath));
      const snapshot = Y.decodeSnapshot(snapBuf);
      base = { seq: -1, text, hash: hashText(text), snapshot, origin: 'restore', at: Date.now() };
    }
    const ydocUpdate = fs.existsSync(ydocPath) ? new Uint8Array(fs.readFileSync(ydocPath)) : undefined;
    const state: PersistedStateJson | undefined = fs.existsSync(statePath)
      ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
      : undefined;
    return { base, ydocUpdate, state };
  }
}
