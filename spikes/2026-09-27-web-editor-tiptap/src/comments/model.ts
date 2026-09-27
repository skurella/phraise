// Brief 06 (comments, gate F), task 1: the comment data model. A `Y.Map` of
// threads, in the same `Y.Doc` as the document but under its own top-level
// key -- outside `FRAGMENT_NAME`'s `Y.XmlFragment` -- so comments never
// affect the Markdown (`serializeDoc` only ever looks at the fragment).
//
// Each thread is itself a `Y.Map`, not a plain JSON value, specifically so
// its `messages` field can be a `Y.Array`: two replicas concurrently
// pushing a reply each keep both messages (Yjs's own array CRDT semantics
// -- concurrent inserts at the same position are ordered deterministically
// by client id, never dropped), which is what "concurrent replies must
// merge" (the brief's task 1) actually requires. `anchor` and the resolved
// fields are stored as plain values on the thread's own map: they are
// single-fact fields a user replaces wholesale (last-write-wins under
// Yjs's normal `Y.Map` semantics), not structures that need their own
// merge behaviour.
import * as Y from 'yjs';
import type { AnchorRecord } from './anchor.js';

export const THREADS_MAP_NAME = 'phraise-comments';

export interface Author {
  name: string;
}

export interface Message {
  id: string;
  author: string;
  text: string;
  /** Epoch ms. */
  time: number;
}

export interface ThreadSnapshot {
  id: string;
  anchor: AnchorRecord;
  createdBy: string;
  createdAt: number;
  messages: Message[];
  resolved: boolean;
  resolvedBy: string | null;
  resolvedAt: number | null;
}

type ThreadYMap = Y.Map<unknown>;

function randomId(prefix: string): string {
  // Not deterministic and not a CRDT id -- comments are keyed by this id
  // going forward, same convention as spike 2's `newCommentId`. Good enough
  // uniqueness for a spike: a per-process random suffix plus a wall-clock
  // component, no dependency needed.
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Generate a fresh thread id. Exported so callers (e.g. the sidebar,
 * building a pending composer before the thread exists) can allocate one
 * ahead of `createThread` if they need to reference it early. */
export function newThreadId(): string {
  return randomId('thread');
}

export function newMessageId(): string {
  return randomId('msg');
}

function threadsMap(ydoc: Y.Doc): Y.Map<ThreadYMap> {
  return ydoc.getMap<ThreadYMap>(THREADS_MAP_NAME);
}

/** Create a new thread with its first message, in one transaction. Returns
 * the new thread's id. */
export function createThread(ydoc: Y.Doc, anchor: AnchorRecord, author: string, body: string, time: number, id: string = newThreadId()): string {
  ydoc.transact(() => {
    const thread: ThreadYMap = new Y.Map();
    thread.set('id', id);
    thread.set('anchor', anchor);
    thread.set('createdBy', author);
    thread.set('createdAt', time);
    thread.set('resolved', false);
    thread.set('resolvedBy', null);
    thread.set('resolvedAt', null);
    const messages = new Y.Array<Message>();
    messages.push([{ id: newMessageId(), author, text: body, time }]);
    thread.set('messages', messages);
    threadsMap(ydoc).set(id, thread);
  });
  return id;
}

function requireThread(ydoc: Y.Doc, id: string): ThreadYMap {
  const thread = threadsMap(ydoc).get(id);
  if (!thread) throw new Error(`comments/model: no such thread ${id}`);
  return thread;
}

/** Append a reply. Concurrent replies from different replicas both survive
 * (`test/comments/model.spec.ts` proves this with two `Y.Doc`s exchanging
 * updates). */
export function addReply(ydoc: Y.Doc, threadId: string, author: string, text: string, time: number): void {
  const thread = requireThread(ydoc, threadId);
  const messages = thread.get('messages') as Y.Array<Message>;
  messages.push([{ id: newMessageId(), author, text, time }]);
}

export function setResolved(ydoc: Y.Doc, threadId: string, resolved: boolean, author: string, time: number): void {
  const thread = requireThread(ydoc, threadId);
  ydoc.transact(() => {
    thread.set('resolved', resolved);
    thread.set('resolvedBy', resolved ? author : null);
    thread.set('resolvedAt', resolved ? time : null);
  });
}

function snapshotThread(thread: ThreadYMap): ThreadSnapshot {
  const messages = thread.get('messages') as Y.Array<Message> | undefined;
  return {
    id: thread.get('id') as string,
    anchor: thread.get('anchor') as AnchorRecord,
    createdBy: thread.get('createdBy') as string,
    createdAt: thread.get('createdAt') as number,
    messages: messages ? messages.toArray() : [],
    resolved: Boolean(thread.get('resolved')),
    resolvedBy: (thread.get('resolvedBy') as string | null) ?? null,
    resolvedAt: (thread.get('resolvedAt') as number | null) ?? null,
  };
}

export function getThread(ydoc: Y.Doc, id: string): ThreadSnapshot | undefined {
  const thread = threadsMap(ydoc).get(id);
  return thread ? snapshotThread(thread) : undefined;
}

/** All threads, in no particular order (callers order by resolved anchor
 * position, creation time, etc. as their own presentation concern). */
export function listThreads(ydoc: Y.Doc): ThreadSnapshot[] {
  const out: ThreadSnapshot[] = [];
  threadsMap(ydoc).forEach((t) => out.push(snapshotThread(t)));
  return out;
}

/** Subscribe to any change under the threads map (a new thread, a reply, a
 * resolve/reopen) -- a deep observer, since replies live in a nested
 * `Y.Array` and edits there don't touch the outer map's own event. Returns
 * an unsubscribe function. */
export function observeThreads(ydoc: Y.Doc, callback: () => void): () => void {
  const map = threadsMap(ydoc);
  const handler = () => callback();
  map.observeDeep(handler);
  return () => map.unobserveDeep(handler);
}
