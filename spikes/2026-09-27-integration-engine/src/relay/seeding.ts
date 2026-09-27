// New for this spike (brief 04, src/relay/). "Seeding on first open" (plan
// section 6) and "Restore" (plan section 5, brief line 29): a document with
// no persisted state (SQLite had nothing for it) is restored from the
// draft ref's sidecar if the draft's base equals the branch head; otherwise
// it is seeded, deterministically, from the branch head commit.
import { seedFromCommit, getBase } from '../engine/index.js';
import { applyUpdate, type CrdtDoc } from '../crdt/index.js';
import type { GitStore } from '../git/index.js';
import { docId as makeDocId } from './docName.js';

export interface SeedOrRestoreOpts {
  branch: string;
  path: string;
  generation: number;
  gitStore: GitStore;
}

export type SeedOrRestoreResult = { kind: 'restored'; base: string } | { kind: 'seeded'; commit: string };

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
    return { kind: 'seeded', commit: base.commit };
  }

  const id = makeDocId(opts.branch, opts.path);
  const head = await opts.gitStore.remoteHead(opts.branch);
  if (!head) throw new Error(`seedOrRestore: branch "${opts.branch}" not found on remote`);
  await opts.gitStore.fetch(opts.branch);

  const draft = await opts.gitStore.readDraft(opts.branch);
  if (draft && draft.base === head) {
    const ydocBytes = draft.sidecar[sidecarYdocKey(opts.path)];
    const jsonBytes = draft.sidecar[sidecarJsonKey(opts.path)];
    if (ydocBytes && jsonBytes) {
      const meta = JSON.parse(Buffer.from(jsonBytes).toString('utf8')) as SidecarMeta;
      if (meta.docId === id && meta.generation === opts.generation) {
        applyUpdate(doc, ydocBytes);
        return { kind: 'restored', base: meta.base };
      }
    }
  }

  const markdown = (await opts.gitStore.readFile(head, opts.path)) ?? '';
  const info = await opts.gitStore.commitInfo(head);
  seedFromCommit(doc, { docId: id, markdown, commit: head, author: info.author, generation: opts.generation });
  return { kind: 'seeded', commit: head };
}

export { sidecarYdocKey, sidecarJsonKey, type SidecarMeta };
