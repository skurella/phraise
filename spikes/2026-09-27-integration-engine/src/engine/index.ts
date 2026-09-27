// Brief 03: the engine module's public surface. Rebase, import, needs-review
// and resurrection, comments, attribution listing, commit preparation --
// everything the relay (brief 04) and the daemon (later) call instead of
// touching crdt directly. See README.md for the module's shape and origin.
export type { Author, Base, AuthorKind, AuthorEntry, RebaseRecord, ReviewEntry } from './types.js';

export { hash32, seedPeerId, rebasePeerId, rebaseRecordId } from './ids.js';

export { seedFromCommit, getBase, getDocId, getGeneration, getSnapshotFor, base64FromSnapshot, snapshotFromBase64, type SeedOptions } from './seed.js';

export { rebase, baseConflicts, listRebaseRecords, ORIGIN_REBASE, type RebaseOptions, type RebaseResult } from './rebase.js';

export {
  attachIntegration,
  ackOwnRebase,
  listReview,
  clearReview,
  type AttachIntegrationOptions,
  type ReviewListEntry,
} from './integrate.js';

export {
  createComment,
  createCommentOnQuote,
  reply,
  setResolved,
  listComments,
  getComment,
  buildQuoteSelectors,
  fuzzyAnchor,
  newCommentId,
  COMMENTS_MAP,
  type CommentAuthor,
  type CommentRecord,
  type QuoteSelector,
  type Reply,
  type AnchorMethod,
  type ResolvedAnchor,
  type ListedComment,
  type CreateCommentOptions,
  type CreateCommentOnQuoteOptions,
} from './comments.js';

export { importText, ORIGIN_IMPORT, type ImportTextOptions, type ImportTextResult } from './import.js';

export { renderForSave, type RenderForSaveResult } from './renderForSave.js';

export {
  markEditor,
  editorsSinceCommit,
  prepareCommit,
  recordCommit,
  getLastCommit,
  type PrepareCommitResult,
  type RecordCommitOptions,
} from './commit.js';

export { listAttribution, type AttributionListItem } from './attribution.js';
