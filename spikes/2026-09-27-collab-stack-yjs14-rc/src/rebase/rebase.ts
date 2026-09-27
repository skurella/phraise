// Fork-at-base rebase (plan sections 1 and 4), ported to Yjs 14.
// computeRebaseUpdate does not apply its result to `live` -- the caller
// does, via Y.applyUpdate(live, update). `Y.createDocFromSnapshot`,
// `Y.snapshot`, `Y.encodeSnapshot`/`decodeSnapshot`, `Y.encodeStateVector`,
// `Y.encodeStateAsUpdate` all exist unchanged on `@y/y` (same `Snapshot
// {sv, ds}` shape, `ds` now an `IdSet` instead of a `DeleteSet` -- verified
// in scratch/probe-rebase-primitives.ts).
import * as Y from "yjs";
import { parseMarkdown } from "./markdown.js";
import { applyTreeDiff } from "./diff.js";
import {
  PM_FRAGMENT,
  PHRAISE_MAP,
  AUTHORS_MAP,
  docToPM,
  base64ToUint8,
  uint8ToBase64,
  type Author,
} from "./seed.js";
import { rebasePeerId } from "./ids.js";

export interface Base {
  id: string;
  commit: string;
}

export interface RebaseRecord {
  id: string;
  baseId: string;
  baseCommit: string;
  targetCommit: string;
  author: Author;
  peer: number;
}

export interface RebaseOptions {
  docId: string;
  targetMarkdown: string;
  targetCommit: string;
  author: Author;
}

export interface RebaseResult {
  update: Uint8Array;
  rebaseId: string;
}

/**
 * Fork `live` at its current base snapshot, diff the fork's content (A) onto
 * `targetMarkdown` (B), write the rebase record + advanced base pointer +
 * new snapshot on the fork, and return the fork's update since the fork
 * point. Throws if the fork's content does not equal `parseMarkdown(B)`
 * after the diff (plan section 1, step 3: asserted on every rebase).
 */
export function computeRebaseUpdate(live: Y.Doc, opts: RebaseOptions): RebaseResult {
  const livePhraise = live.get(PHRAISE_MAP);
  const base = livePhraise.getAttr("base") as Base | undefined;
  if (!base) {
    throw new Error("live doc has no base pointer; was it seeded?");
  }
  const snapB64 = livePhraise.getAttr(`snapshot:${base.id}`) as string | undefined;
  if (!snapB64) {
    throw new Error(`live doc is missing snapshot:${base.id}`);
  }
  const snapshot = Y.decodeSnapshot(base64ToUint8(snapB64));

  const fork = Y.createDocFromSnapshot(live, snapshot, new Y.Doc({ gc: false }));
  const peer = rebasePeerId(opts.docId, base.id, opts.targetCommit);
  fork.clientID = peer;

  const pmA = docToPM(fork);
  const pmB = parseMarkdown(opts.targetMarkdown);

  // Captured before any local edit, so the exported update below contains
  // exactly what this rebase changed on the fork.
  const svBeforeEdits = Y.encodeStateVector(fork);

  const rebaseId = opts.targetCommit;

  fork.transact(() => {
    const ytype = fork.get(PM_FRAGMENT);
    applyTreeDiff(ytype, pmA, pmB);

    const result = docToPM(fork);
    if (!result.eq(pmB)) {
      throw new Error("computeRebaseUpdate: fork content does not equal target after diff");
    }

    const phraise = fork.get(PHRAISE_MAP);
    phraise.setAttr("base", { id: rebaseId, commit: opts.targetCommit });
    const record: RebaseRecord = {
      id: rebaseId,
      baseId: base.id,
      baseCommit: base.commit,
      targetCommit: opts.targetCommit,
      author: opts.author,
      peer,
    };
    phraise.setAttr(`rebase:${rebaseId}`, record);

    const authors = fork.get(AUTHORS_MAP);
    authors.setAttr(String(peer), {
      kind: "git",
      name: opts.author.name,
      email: opts.author.email,
      commit: opts.targetCommit,
    });
  }, "rebase");

  // Second transaction, same deterministic peer, after the snapshot is
  // taken (plan section 4, mirroring seed.ts).
  const snap = Y.encodeSnapshot(Y.snapshot(fork));
  fork.transact(() => {
    fork.get(PHRAISE_MAP).setAttr(`snapshot:${rebaseId}`, uint8ToBase64(snap));
  }, "rebase");

  const update = Y.encodeStateAsUpdate(fork, svBeforeEdits);
  return { update, rebaseId };
}

/**
 * Rebases that forked from the same base to different targets (orchestrator,
 * after review). Such siblings merge into a blend of both targets and the
 * `base` pointer resolves by LWW to one of them, so the doc matches neither
 * commit. Rebases must be serialized per document; this detector lets any
 * replica notice a violation and recover.
 */
export function baseConflicts(doc: Y.Doc): RebaseRecord[][] {
  const byBase = new Map<string, RebaseRecord[]>();
  (doc.get(PHRAISE_MAP) as any).forEachAttr((v: any, k: string) => {
    if (!k.startsWith("rebase:")) return;
    const r = v as RebaseRecord;
    const list = byBase.get(r.baseId) ?? [];
    list.push(r);
    byBase.set(r.baseId, list);
  });
  return [...byBase.values()].filter((l) => new Set(l.map((r) => r.id)).size > 1);
}
