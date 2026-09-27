// Fork-at-base rebase (plan sections 1 and 4), Loro version. Adapted from
// spikes/2026-09-27-crdt-rebase-yjs-fork/src/rebase.ts: same shape
// (computeRebaseUpdate does not apply its result to `live` -- the caller
// does via `live.import(update)`), but `live.forkAt(frontiers)` replaces
// `Y.createDocFromSnapshot`, and the exported update is `fork.export({mode:
// "update", from: vv})` instead of `Y.encodeStateAsUpdate(fork, sv)`.
import { LoroDoc, type Frontiers } from "loro-crdt";
import { parseMarkdown } from "./markdown.js";
import { applyTreeDiff, type Granularity } from "./diff.js";
import { docToPM, type Author, type Base } from "./seed.js";
import { PHRAISE_MAP, AUTHORS_MAP, configureTextStyle } from "./loro-doc.js";
import { rebasePeerId } from "./ids.js";

export interface RebaseRecord {
  id: string;
  baseId: string;
  baseCommit: string;
  targetCommit: string;
  author: Author;
  peer: string;
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
 * Fork `live` at its current base frontiers, diff the fork's content (A)
 * onto `targetMarkdown` (B), write the rebase record + advanced base pointer
 * on the fork, and return the fork's update since the fork point. Throws if
 * the fork's content does not equal `parseMarkdown(B)` after the diff (plan
 * section 1, step 3: asserted on every rebase).
 */
export function computeRebaseUpdate(live: LoroDoc, opts: RebaseOptions): RebaseResult {
  const livePhraise = live.getMap(PHRAISE_MAP);
  const base = livePhraise.get("base") as Base | undefined;
  if (!base) throw new Error("live doc has no base pointer; was it seeded?");

  const fork = live.forkAt(base.frontiers as Frontiers);
  const peer = rebasePeerId(opts.docId, base.id, opts.targetCommit);
  fork.setPeerId(peer);
  configureTextStyle(fork);

  const pmA = docToPM(fork);
  const pmB = parseMarkdown(opts.targetMarkdown);

  // Captured before any local edit, so the exported update below contains
  // exactly what this rebase changed on the fork.
  const vvBeforeEdits = fork.version();

  const rebaseId = opts.targetCommit;

  applyTreeDiff(fork, pmA, pmB, opts.granularity);

  const result = docToPM(fork);
  if (!result.eq(pmB)) {
    throw new Error("computeRebaseUpdate: fork content does not equal target after diff");
  }

  const authors = fork.getMap(AUTHORS_MAP);
  authors.set(String(peer), {
    kind: "git",
    name: opts.author.name,
    email: opts.author.email,
    commit: opts.targetCommit,
  });
  fork.commit({ origin: "rebase" });

  // Second commit, same deterministic peer, after the frontiers reflect the
  // diff (mirrors seed.ts / the Yjs fork's two-transaction shape).
  const frontiers = fork.frontiers();
  const record: RebaseRecord = {
    id: rebaseId,
    baseId: base.id,
    baseCommit: base.commit,
    targetCommit: opts.targetCommit,
    author: opts.author,
    peer,
    granularity: opts.granularity,
  };
  const phraise = fork.getMap(PHRAISE_MAP);
  phraise.set("base", { id: rebaseId, commit: opts.targetCommit, frontiers });
  phraise.set(`snapshot:${rebaseId}`, frontiers);
  phraise.set(`rebase:${rebaseId}`, record);
  fork.commit({ origin: "rebase" });

  const update = fork.export({ mode: "update", from: vvBeforeEdits });
  return { update, rebaseId };
}
