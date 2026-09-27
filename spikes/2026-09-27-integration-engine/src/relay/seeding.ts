// New for this spike (brief 04, src/relay/). "Seeding on first open" (plan
// section 6) and "Restore" (plan section 5, brief line 29): a document with
// no persisted state (SQLite had nothing for it) is restored from the
// draft ref's sidecar if one names it; otherwise it is seeded,
// deterministically, from the branch head commit.
//
// Brief 06 task 4: a draft can be behind the branch head (an external
// commit landed while the relay had no local state for this document,
// between whenever the draft was last written and this open). The
// original version of this function only restored a draft whose `base`
// equalled the CURRENT head, silently falling through to a fresh seed
// (discarding the draft's uncommitted content) otherwise. Fixed: any
// matching draft is restored first, unconditionally; when its `base` is
// behind the current head, `engine.rebase` runs against the head's content
// in the same open (author = the head commit's git author, from
// `commitInfo`), and the replica acks its own rebase record immediately
// (`ackOwnRebase`, S5-5 -- see engine/integrate.ts's header comment), the
// same way the head poller and a post-head-move commit do (poller.ts).
import { seedFromCommit, getBase } from '../engine/index.js';
import { applyUpdate, type CrdtDoc } from '../crdt/index.js';
import type { GitStore } from '../git/index.js';
import { docId as makeDocId } from './docName.js';
import { rebaseToHead } from './rebaseHead.js';

export interface SeedOrRestoreOpts {
  branch: string;
  path: string;
  generation: number;
  gitStore: GitStore;
}

export type SeedOrRestoreResult =
  | { kind: 'already-open'; commit: string }
  | { kind: 'restored'; base: string; rebasedTo: string | null }
  | { kind: 'seeded'; commit: string };

interface SidecarMeta {
  docId: string;
  generation: number;
  base: string;
  flushedAt: number;
}

function sidecarYdocKey(path: string): string {
  return `${path}.ydoc`;
}

function sidecarJsonKey(path: string): string {
  return `${path}.json`;
}

/**
 * Seeds or restores `doc` (freshly created, not yet populated by SQLite --
 * checked by the caller via `getBase(doc) === undefined`, since
 * `seedFromCommit`/a restored `.ydoc` both always set the `base` pointer).
 * Idempotent to call redundantly: a no-op once `doc` already has a base.
 */
export async function seedOrRestore(doc: CrdtDoc, opts: SeedOrRestoreOpts): Promise<SeedOrRestoreResult> {
  if (getBase(doc) !== undefined) {
    const base = getBase(doc)!;
    return { kind: 'already-open', commit: base.commit };
  }

  const id = makeDocId(opts.branch, opts.path);
  const head = await opts.gitStore.remoteHead(opts.branch);
  if (!head) throw new Error(`seedOrRestore: branch "${opts.branch}" not found on remote`);
  await opts.gitStore.fetch(opts.branch);

  const draft = await opts.gitStore.readDraft(opts.branch);
  if (draft) {
    const ydocBytes = draft.sidecar[sidecarYdocKey(opts.path)];
    const jsonBytes = draft.sidecar[sidecarJsonKey(opts.path)];
    if (ydocBytes && jsonBytes) {
      const meta = JSON.parse(Buffer.from(jsonBytes).toString('utf8')) as SidecarMeta;
      if (meta.docId === id && meta.generation === opts.generation) {
        applyUpdate(doc, ydocBytes);
        let rebasedTo: string | null = null;
        if (draft.base !== head) {
          // The draft is never silently dropped: restore it, then rebase
          // it forward to the head in this same open (a restore racing an
          // external commit is a distinct code path from the live poller's
          // per-branch rebase -- both end up calling engine.rebase the
          // same way, but this one runs once, synchronously, before any
          // editor can see the document at all).
          await rebaseToHead({ gitStore: opts.gitStore, doc, docId: id, path: opts.path, head });
          rebasedTo = head;
        }
        return { kind: 'restored', base: meta.base, rebasedTo };
      }
    }
  }

  const markdown = (await opts.gitStore.readFile(head, opts.path)) ?? '';
  const info = await opts.gitStore.commitInfo(head);
  seedFromCommit(doc, { docId: id, markdown, commit: head, author: info.author, generation: opts.generation });
  return { kind: 'seeded', commit: head };
}

export { sidecarYdocKey, sidecarJsonKey, type SidecarMeta };
