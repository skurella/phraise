// Brief 06 (comments, gate F), task 1: the comment data model, unit-tested
// headless with two `Y.Doc`s exchanging updates -- no ProseMirror, no
// EditorView, no relay. Proves the CRDT merge property the brief asks for
// ("concurrent replies must merge") and the basic thread lifecycle
// (create, reply, resolve, reopen).
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createThread, addReply, setResolved, getThread, listThreads, observeThreads } from '../../src/comments/model.js';
import type { AnchorRecord } from '../../src/comments/anchor.js';

const DUMMY_ANCHOR: AnchorRecord = {
  start: { type: null, tname: 'prosemirror', item: null },
  end: { type: null, tname: 'prosemirror', item: null },
  quote: { exact: 'quoted text', prefix: 'before ', suffix: ' after' },
  offsetStart: 10,
  offsetEnd: 21,
};

/** Sync `a` and `b` to the same state, both directions (a real relay would
 * do this incrementally; a spike-scale test can just exchange full state). */
function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

describe('comments/model: thread lifecycle', () => {
  it('creates a thread with its first message', () => {
    const ydoc = new Y.Doc();
    const id = createThread(ydoc, DUMMY_ANCHOR, 'Alice', 'first comment', 1000);
    const thread = getThread(ydoc, id);
    expect(thread).toBeDefined();
    expect(thread!.createdBy).toBe('Alice');
    expect(thread!.messages).toHaveLength(1);
    expect(thread!.messages[0]).toMatchObject({ author: 'Alice', text: 'first comment', time: 1000 });
    expect(thread!.resolved).toBe(false);
  });

  it('appends replies in order', () => {
    const ydoc = new Y.Doc();
    const id = createThread(ydoc, DUMMY_ANCHOR, 'Alice', 'first comment', 1000);
    addReply(ydoc, id, 'Bob', 'a reply', 2000);
    addReply(ydoc, id, 'Alice', 'another reply', 3000);
    const thread = getThread(ydoc, id)!;
    expect(thread.messages.map((m) => m.text)).toEqual(['first comment', 'a reply', 'another reply']);
  });

  it('resolves and reopens, recording who and when', () => {
    const ydoc = new Y.Doc();
    const id = createThread(ydoc, DUMMY_ANCHOR, 'Alice', 'first comment', 1000);
    setResolved(ydoc, id, true, 'Bob', 5000);
    let thread = getThread(ydoc, id)!;
    expect(thread.resolved).toBe(true);
    expect(thread.resolvedBy).toBe('Bob');
    expect(thread.resolvedAt).toBe(5000);

    setResolved(ydoc, id, false, 'Alice', 6000);
    thread = getThread(ydoc, id)!;
    expect(thread.resolved).toBe(false);
    expect(thread.resolvedBy).toBeNull();
    expect(thread.resolvedAt).toBeNull();
  });

  it('lists every thread', () => {
    const ydoc = new Y.Doc();
    createThread(ydoc, DUMMY_ANCHOR, 'Alice', 'one', 1000);
    createThread(ydoc, DUMMY_ANCHOR, 'Bob', 'two', 2000);
    expect(listThreads(ydoc)).toHaveLength(2);
  });

  it('observeThreads fires for a new thread, a reply, and a resolve', () => {
    const ydoc = new Y.Doc();
    let fired = 0;
    const unobserve = observeThreads(ydoc, () => fired++);
    const id = createThread(ydoc, DUMMY_ANCHOR, 'Alice', 'one', 1000);
    expect(fired).toBeGreaterThan(0);
    const afterCreate = fired;
    addReply(ydoc, id, 'Bob', 'reply', 2000);
    expect(fired).toBeGreaterThan(afterCreate);
    const afterReply = fired;
    setResolved(ydoc, id, true, 'Bob', 3000);
    expect(fired).toBeGreaterThan(afterReply);
    unobserve();
  });
});

describe('comments/model: concurrent merge across two replicas', () => {
  it('two concurrent replies from different replicas both survive and merge in a stable order', () => {
    const alice = new Y.Doc();
    const id = createThread(alice, DUMMY_ANCHOR, 'Alice', 'first comment', 1000);
    const bob = new Y.Doc();
    Y.applyUpdate(bob, Y.encodeStateAsUpdate(alice));

    // Alice and Bob each reply, offline from each other (no sync between).
    addReply(alice, id, 'Alice', "Alice's reply", 2000);
    addReply(bob, id, 'Bob', "Bob's reply", 2000);

    sync(alice, bob);

    const aliceThread = getThread(alice, id)!;
    const bobThread = getThread(bob, id)!;
    // Both replicas converge on the SAME set of messages (byte-identical
    // ordering, since Yjs orders concurrent array insertions deterministically
    // by client id, not by which replica applied the update first).
    expect(aliceThread.messages.map((m) => m.text).sort()).toEqual(["Alice's reply", "Bob's reply", 'first comment'].sort());
    expect(aliceThread.messages).toEqual(bobThread.messages);
    // Neither reply was dropped.
    expect(aliceThread.messages).toHaveLength(3);
  });

  it('a reply made while offline is not lost when the thread was also resolved concurrently elsewhere', () => {
    const alice = new Y.Doc();
    const id = createThread(alice, DUMMY_ANCHOR, 'Alice', 'first comment', 1000);
    const bob = new Y.Doc();
    Y.applyUpdate(bob, Y.encodeStateAsUpdate(alice));

    addReply(bob, id, 'Bob', 'one more thing', 2000);
    setResolved(alice, id, true, 'Alice', 2500);

    sync(alice, bob);

    const aliceThread = getThread(alice, id)!;
    const bobThread = getThread(bob, id)!;
    expect(aliceThread.messages.map((m) => m.text)).toContain('one more thing');
    expect(bobThread.messages).toEqual(aliceThread.messages);
    // The resolve is a plain last-write-wins field (not a merge-required
    // structure); both replicas converge on the SAME resolved state either
    // way -- this only asserts convergence, not which write "won".
    expect(aliceThread.resolved).toBe(bobThread.resolved);
  });

  it('two Y.Docs seeded independently and then synced converge on an identical thread map', () => {
    const alice = new Y.Doc();
    const bob = new Y.Doc();
    const idA = createThread(alice, DUMMY_ANCHOR, 'Alice', 'from alice', 1000);
    const idB = createThread(bob, DUMMY_ANCHOR, 'Bob', 'from bob', 1000);

    sync(alice, bob);

    expect(listThreads(alice)).toHaveLength(2);
    expect(listThreads(bob)).toHaveLength(2);
    expect(getThread(alice, idA)).toBeDefined();
    expect(getThread(alice, idB)).toBeDefined();
    expect(getThread(bob, idA)).toBeDefined();
    expect(getThread(bob, idB)).toBeDefined();
  });
});
