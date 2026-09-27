// Brief 03 task 6. Import of a saved text (the daemon's entry point,
// added later): parse, forkDiffMerge, register the peer as author kind
// `import`. Thin wrapper -- `forkDiffMerge` (brief 01/03) already owns the
// fork/diff/verify/repair/merge mechanics; this module's job is just the
// markdown-parse-and-author-registration step around it that a text import
// specifically needs (as opposed to, say, a rebase's target markdown, which
// registers author kind `git` instead -- see rebase.ts).
import { forkDiffMerge, setMeta, type CrdtDoc, type CrdtSnapshot, type ForkDiffMergeResult } from '../crdt/index.js';
import { parseMarkdown } from '../markdown/index.js';
import type { Author, AuthorEntry } from './types.js';

export const ORIGIN_IMPORT = 'phraise-import';

export interface ImportTextOptions {
  /** The snapshot the imported `text` was read/edited relative to (e.g. the daemon's last-known-good version, or a reported base -- gate J). */
  base: CrdtSnapshot;
  text: string;
  /** Deterministic peer id for this import (e.g. the daemon's own client id). A random one is used if omitted. */
  clientId?: number;
  author: Author;
}

export type ImportTextResult = ForkDiffMergeResult;

/** Import `text` (parsed, fork/diff/merge'd against `base`) into `doc`, registering `clientId` as author kind `import`. */
export function importText(doc: CrdtDoc, opts: ImportTextOptions): ImportTextResult {
  const target = parseMarkdown(opts.text).doc;
  const peer = opts.clientId ?? Math.floor(Math.random() * 0xffffffff);
  const result = forkDiffMerge(doc, opts.base, target, { clientId: peer, origin: ORIGIN_IMPORT });
  const authorEntry: AuthorEntry = { kind: 'import', name: opts.author.name, email: opts.author.email };
  setMeta(doc, 'phraise-authors', String(peer), authorEntry, ORIGIN_IMPORT);
  return result;
}
