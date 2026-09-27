// Brief 05, gate I: the pending-write tracker's own logic, against a real
// Y.Doc (updates fired the normal way) and a fake, controllable `flush`
// (a deferred promise this test resolves by hand), so pending-count
// transitions can be asserted deterministically without any real
// IndexedDB or timing.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createPendingWriteTracker } from '../src/offline/pendingWrites.js';

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createPendingWriteTracker', () => {
  it('starts at 0 and is idle before any doc update', () => {
    const doc = new Y.Doc();
    const tracker = createPendingWriteTracker(doc, () => Promise.resolve(), () => {}, 'ignored-origin');
    expect(tracker.pendingCount()).toBe(0);
    expect(tracker.isIdle()).toBe(true);
    tracker.destroy();
  });

  it('increments on a local doc update, calls onChange, and decrements once the flush settles', async () => {
    const doc = new Y.Doc();
    const flushGate = deferred<void>();
    const changes: number[] = [];
    const tracker = createPendingWriteTracker(
      doc,
      () => flushGate.promise,
      () => changes.push(tracker.pendingCount()),
      'ignored-origin',
    );

    doc.getText('t').insert(0, 'a'); // a real local update, no origin set (defaults to null)

    expect(tracker.pendingCount()).toBe(1);
    expect(tracker.isIdle()).toBe(false);
    expect(changes).toEqual([1]);

    flushGate.resolve();
    await Promise.resolve(); // let the flush promise's .finally() run
    await Promise.resolve();

    expect(tracker.pendingCount()).toBe(0);
    expect(tracker.isIdle()).toBe(true);
    expect(changes).toEqual([1, 0]);
    tracker.destroy();
  });

  it('starts one flush per update and tracks them independently (two in flight at once)', async () => {
    const doc = new Y.Doc();
    const gates = [deferred<void>(), deferred<void>()];
    let call = 0;
    const tracker = createPendingWriteTracker(
      doc,
      () => gates[call++].promise,
      () => {},
      'ignored-origin',
    );

    doc.getText('t').insert(0, 'a');
    doc.getText('t').insert(0, 'b');
    expect(tracker.pendingCount()).toBe(2);

    gates[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(tracker.pendingCount()).toBe(1); // one of the two settled

    gates[1].resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(tracker.pendingCount()).toBe(0);
    tracker.destroy();
  });

  it('ignores an update whose origin is the one to ignore (the persistence layer replaying its own stored updates)', () => {
    const doc = new Y.Doc();
    let flushes = 0;
    const tracker = createPendingWriteTracker(
      doc,
      () => {
        flushes++;
        return Promise.resolve();
      },
      () => {},
      'the-persistence-instance',
    );

    doc.transact(() => {
      doc.getText('t').insert(0, 'replayed');
    }, 'the-persistence-instance');

    expect(flushes).toBe(0);
    expect(tracker.pendingCount()).toBe(0);
    tracker.destroy();
  });

  it('a flush that rejects still settles (does not leave pendingCount stuck)', async () => {
    const doc = new Y.Doc();
    const tracker = createPendingWriteTracker(doc, () => Promise.reject(new Error('write failed')), () => {}, 'ignored-origin');

    doc.getText('t').insert(0, 'a');
    expect(tracker.pendingCount()).toBe(1);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(tracker.pendingCount()).toBe(0);
    expect(tracker.isIdle()).toBe(true);
    tracker.destroy();
  });

  it('flushNow() starts an additional flush on demand', async () => {
    const doc = new Y.Doc();
    let flushes = 0;
    const gate = deferred<void>();
    const tracker = createPendingWriteTracker(
      doc,
      () => {
        flushes++;
        return gate.promise;
      },
      () => {},
      'ignored-origin',
    );

    const p = tracker.flushNow();
    expect(flushes).toBe(1);
    expect(tracker.pendingCount()).toBe(1);

    gate.resolve();
    await p;
    expect(tracker.pendingCount()).toBe(0);
    tracker.destroy();
  });

  it('destroy() stops listening: a later doc update starts no further flush', () => {
    const doc = new Y.Doc();
    let flushes = 0;
    const tracker = createPendingWriteTracker(
      doc,
      () => {
        flushes++;
        return Promise.resolve();
      },
      () => {},
      'ignored-origin',
    );
    tracker.destroy();

    doc.getText('t').insert(0, 'a');
    expect(flushes).toBe(0);
  });
});
