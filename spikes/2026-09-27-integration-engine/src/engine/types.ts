// Shared engine-level types (new for this spike). `Author` is structurally
// identical to src/git's `Identity` ({name, email}) but declared
// independently: per plan section 2's dependency direction
// (`markdown` <- `crdt` <- `engine` <- {`relay`, `daemon`}; `git` is
// standalone), engine must not import git.
import type { ReviewReason } from '../crdt/index.js';

export interface Author {
  name: string;
  email: string;
}

/** `phraise` map's `base` entry: the commit (or rebase id) this document's live content was last forked from, and the git commit it corresponds to. */
export interface Base {
  id: string;
  commit: string;
}

export type AuthorKind = 'human' | 'git' | 'import' | 'seed' | 'generation';

/** `phraise-authors` map's per-clientId entry (plan section 4). */
export interface AuthorEntry {
  kind: AuthorKind;
  name: string;
  email?: string;
  /** Present for kind 'git'/'seed': the commit this peer's edits are attributed to. */
  commit?: string;
}

export interface RebaseRecord {
  id: string;
  baseId: string;
  baseCommit: string;
  targetCommit: string;
  author: Author;
  peer: number;
}

/**
 * `review` map's per-blockId entry (plan section 4). `rebaseId` is present
 * for the integration-scan reasons ('concurrent-edit',
 * 'deleted-upstream-edited-locally'); a 'serialization-best-effort' entry
 * (brief 07 task 4, written by `engine.renderForSave`) is not tied to any
 * rebase, so it has none.
 */
export interface ReviewEntry {
  rebaseId?: string;
  reason: ReviewReason;
}
