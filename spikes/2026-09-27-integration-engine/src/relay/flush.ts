// New for this spike (brief 04, src/relay/). The draft flush (plan
// sections 5 and 6): one draft ref per branch, holding every currently
// open document of the branch at its real path (Markdown) plus a
// `.ydoc`/`.json` sidecar pair per document, and carrying over the
// previous draft's entries for documents not currently open. On a lease
// rejection (`git.writeDraft`'s `--force-with-lease`): fetch the current
// remote draft; for each open document whose remote sidecar entry names
// the SAME docId and generation, merge its CRDT state into the live
// document (`applyUpdate` -- Yjs's own union semantics make this a safe
// merge, never a loss of the live document's own pending edits) and retry
// once against the new lease value; any open document whose remote
// sidecar entry names a DIFFERENT docId/generation (or is simply present
// under a path we don't recognize as "the same document") is a real
// conflict: reported, and nothing is overwritten.
import { encodeState, applyUpdate, type CrdtDoc } from '../crdt/index.js';
import { getBase, getDocId, getGeneration, renderForSave } from '../engine/index.js';
import type { GitStore, ReadDraftResult } from '../git/index.js';
import type { BranchState, LastDraft, RelayCounters } from './state.js';
import { sidecarJsonKey, sidecarYdocKey, type SidecarMeta } from './seeding.js';

/** Transaction origin for a draft-lease merge's `applyUpdate` (skipped by the relay's own `onChange`/`attachIntegration` re-entrancy guards, same idea as `ATTRIBUTION_ORIGIN`). */
export const DRAFT_MERGE_ORIGIN = 'phraise-draft-merge';

export type FlushOutcome =
  | { ok: true; commit: string | null; merged: boolean; deleted: boolean }
  | { ok: false; reason: 'conflict' };

function pathFromSidecarYdocKey(key: string): string | null {
  return key.endsWith('.ydoc') ? key.slice(0, -'.ydoc'.length) : null;
}

function buildFilesAndSidecar(opens: Iterable<{ path: string; doc: CrdtDoc }>): { files: Record<string, string>; sidecar: Record<string, Uint8Array> } {
  const files: Record<string, string> = {};
  const sidecar: Record<string, Uint8Array> = {};
  for (const { path, doc } of opens) {
    files[path] = renderForSave(doc).text;
    sidecar[sidecarYdocKey(path)] = encodeState(doc);
    const meta: SidecarMeta = {
      docId: getDocId(doc) ?? '',
      generation: getGeneration(doc),
      base: getBase(doc)?.commit ?? '',
      flushedAt: Date.now(),
    };
    sidecar[sidecarJsonKey(path)] = new Uint8Array(Buffer.from(JSON.stringify(meta), 'utf8'));
  }
  return { files, sidecar };
}

/** `prev`'s files/sidecar entries for documents NOT in `openPaths` (plan section 6: "carries over draft files of documents not currently open from the previous draft"). */
function carryOver(prev: LastDraft | null, openPaths: Set<string>): { files: Record<string, string>; sidecar: Record<string, Uint8Array> } {
  if (!prev) return { files: {}, sidecar: {} };
  const files: Record<string, string> = {};
  for (const [p, v] of Object.entries(prev.files)) {
    if (!openPaths.has(p)) files[p] = v;
  }
  const sidecar: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(prev.sidecar)) {
    const p = pathFromSidecarYdocKey(k) ?? (k.endsWith('.json') ? k.slice(0, -'.json'.length) : null);
    if (p !== null && !openPaths.has(p)) sidecar[k] = v;
  }
  return { files, sidecar };
}

function attemptMerge(branchState: BranchState, remote: ReadDraftResult): boolean {
  let allOk = true;
  for (const { path, doc } of branchState.open.values()) {
    const jsonBytes = remote.sidecar[sidecarJsonKey(path)];
    const ydocBytes = remote.sidecar[sidecarYdocKey(path)];
    if (!jsonBytes || !ydocBytes) continue; // remote draft doesn't mention this document: no conflict for it
    let meta: SidecarMeta;
    try {
      meta = JSON.parse(Buffer.from(jsonBytes).toString('utf8')) as SidecarMeta;
    } catch {
      allOk = false;
      continue;
    }
    if (meta.docId === getDocId(doc) && meta.generation === getGeneration(doc)) {
      applyUpdate(doc, ydocBytes, DRAFT_MERGE_ORIGIN);
    } else {
      allOk = false;
    }
  }
  return allOk;
}

/**
 * Flushes `branchState`'s branch: writes (or, if nothing is open and
 * nothing carries over, deletes) its draft. Always fetches the branch head
 * first (drafts are always based on the CURRENT head; milestone 1 has no
 * rebase yet, so every open document's own `base` is expected to already
 * equal it -- a mismatch here would mean an external commit landed, out of
 * this brief's scope).
 */
export async function flushBranch(gitStore: GitStore, branchState: BranchState, counters: RelayCounters): Promise<FlushOutcome> {
  const head = await gitStore.remoteHead(branchState.branch);
  if (!head) throw new Error(`flushBranch: branch "${branchState.branch}" not found on remote`);

  const openPaths = new Set(branchState.open.keys());
  const openEntries = [...branchState.open.values()];
  const { files: openFiles, sidecar: openSidecar } = buildFilesAndSidecar(openEntries);
  const carried = carryOver(branchState.lastDraft, openPaths);
  const files = { ...carried.files, ...openFiles };
  const sidecar = { ...carried.sidecar, ...openSidecar };

  if (Object.keys(files).length === 0) {
    if (branchState.expectedDraft === null) return { ok: true, commit: null, merged: false, deleted: false };
    const del = await gitStore.deleteDraft(branchState.branch, branchState.expectedDraft);
    if (del.ok) {
      branchState.expectedDraft = null;
      branchState.lastDraft = null;
      return { ok: true, commit: null, merged: false, deleted: true };
    }
    // Someone else moved the draft since we last knew about it: re-sync and report a conflict rather than guess.
    counters.staleFlushes++;
    counters.flushConflicts++;
    branchState.expectedDraft = del.actual;
    return { ok: false, reason: 'conflict' };
  }

  const result = await gitStore.writeDraft({ branch: branchState.branch, base: head, files, sidecar, expected: branchState.expectedDraft });
  if (result.ok) {
    branchState.expectedDraft = result.commit;
    branchState.lastDraft = { commit: result.commit, base: head, files, sidecar };
    return { ok: true, commit: result.commit, merged: false, deleted: false };
  }

  counters.staleFlushes++;
  const remote = await gitStore.readDraft(branchState.branch);
  if (!remote) {
    counters.flushConflicts++;
    return { ok: false, reason: 'conflict' };
  }
  const mergeable = attemptMerge(branchState, remote);
  if (!mergeable) {
    counters.flushConflicts++;
    return { ok: false, reason: 'conflict' };
  }

  // Retry once, re-rendering the (now-merged) open documents and carrying over the remote draft's own entries for closed documents.
  const { files: openFiles2, sidecar: openSidecar2 } = buildFilesAndSidecar(openEntries);
  const carried2 = carryOver({ commit: remote.commit, base: remote.base, files: remote.files, sidecar: remote.sidecar }, openPaths);
  const files2 = { ...carried2.files, ...openFiles2 };
  const sidecar2 = { ...carried2.sidecar, ...openSidecar2 };
  const retry = await gitStore.writeDraft({ branch: branchState.branch, base: head, files: files2, sidecar: sidecar2, expected: remote.commit });
  if (!retry.ok) {
    counters.flushConflicts++;
    return { ok: false, reason: 'conflict' };
  }
  counters.mergedFlushRetries++;
  branchState.expectedDraft = retry.commit;
  branchState.lastDraft = { commit: retry.commit, base: head, files: files2, sidecar: sidecar2 };
  return { ok: true, commit: retry.commit, merged: true, deleted: false };
}
