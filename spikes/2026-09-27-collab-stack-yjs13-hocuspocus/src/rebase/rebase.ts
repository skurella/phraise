// Fork-at-base rebase (plan sections 1 and 4). computeRebaseUpdate does not
// apply its result to `live` — the caller does, via Y.applyUpdate(live, update).
import * as Y from "yjs";
import { parseMarkdown } from "./markdown.js";
import { applyTreeDiff, type Granularity } from "./diff.js";
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
  granularity: Granularity;
}

export interface RebaseOptions {
  docId: string;
  targetMarkdown: string;
  targetCommit: string;
  author: Author;
  granularity: Granularity;
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
export function computeRebaseUpdate(
  live: Y.Doc,
  opts: RebaseOptions
): RebaseResult {
  const livePhraise = live.getMap(PHRAISE_MAP);
  const base = livePhraise.get("base") as Base | undefined;
  if (!base) {
    throw new Error("live doc has no base pointer; was it seeded?");
  }
  const snapB64 = livePhraise.get(`snapshot:${base.id}`) as string | undefined;
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
    const fragment = fork.getXmlFragment(PM_FRAGMENT);
    applyTreeDiff(fragment, pmA, pmB, opts.granularity);

    const result = docToPM(fork);
    if (!result.eq(pmB)) {
      throw new Error(
        "computeRebaseUpdate: fork content does not equal target after diff"
      );
    }

    const phraise = fork.getMap(PHRAISE_MAP);
    phraise.set("base", { id: rebaseId, commit: opts.targetCommit });
    const record: RebaseRecord = {
      id: rebaseId,
      baseId: base.id,
      baseCommit: base.commit,
      targetCommit: opts.targetCommit,
      author: opts.author,
      peer,
      granularity: opts.granularity,
    };
    phraise.set(`rebase:${rebaseId}`, record);

    const authors = fork.getMap(AUTHORS_MAP);
    authors.set(String(peer), {
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
    const phraise = fork.getMap(PHRAISE_MAP);
    phraise.set(`snapshot:${rebaseId}`, uint8ToBase64(snap));
  }, "rebase");

  const update = Y.encodeStateAsUpdate(fork, svBeforeEdits);
  return { update, rebaseId };
}

/**
 * Rebases that forked from the same base to different targets (orchestrator,
 * after review). Such siblings merge into a blend of both targets and the
 * `base` pointer resolves by map LWW to one of them, so the doc matches
 * neither commit. Rebases must be serialized per document (one runner or a
 * lease); this detector lets any replica notice a violation and recover,
 * for example by re-seeding from the real branch head per decision D1.
 */
export function baseConflicts(doc: Y.Doc): RebaseRecord[][] {
  const byBase = new Map<string, RebaseRecord[]>();
  doc.getMap(PHRAISE_MAP).forEach((v, k) => {
    if (!k.startsWith("rebase:")) return;
    const r = v as RebaseRecord;
    const list = byBase.get(r.baseId) ?? [];
    list.push(r);
    byBase.set(r.baseId, list);
  });
  return [...byBase.values()].filter((l) => new Set(l.map((r) => r.id)).size > 1);
}
