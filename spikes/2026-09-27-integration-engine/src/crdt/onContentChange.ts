// Brief 09 defect 1 (third bullet): "cheap content detection on the relay."
// `relay/server.ts` used to compare `JSON.stringify(read(document).toJSON())`
// (a full document decode+serialize) before and after EVERY incoming
// update, just to decide whether to call `markEditor` -- O(document size)
// per keystroke. This replaces it with a check driven by the Yjs
// transaction itself: did it touch the `prosemirror` fragment (or anything
// nested under it), determined by walking each changed type's OWN parent
// chain up to the root -- no document read/serialization at all.
//
// Hocuspocus's own `onChange` hook payload (`onChangePayload`) does not
// carry the `Y.Transaction` (only `update`/`transactionOrigin`/`context`),
// so this listens directly on the Yjs `Doc`'s native `'update'` event
// instead, whose 4th argument IS the transaction (see
// `yjs/src/utils/Transaction.js`'s `cleanupTransactions`:
// `doc.emit('update', [encoder.toUint8Array(), transaction.origin, doc,
// transaction])`). `doc.emit` calls every registered `'update'` listener
// synchronously, in registration order, within the SAME call that Yjs's own
// transaction cleanup makes -- including Hocuspocus's own internal
// `Document.handleUpdate` listener (registered when the `Document` is
// constructed, i.e. before this module's listener, which the relay
// registers later in `onLoadDocument`). Hocuspocus's hook dispatch
// (`Hocuspocus.hooks`, `src/Hocuspocus.ts`) always starts its per-extension
// chain with `let chain = Promise.resolve(); chain = chain.then(() =>
// extension.onChange(payload))` -- a `.then()` off an already-resolved
// promise, which Node always defers to a microtask, EVEN for the very
// first extension. That guarantees every extension's `onChange` body
// (including the relay's own, in `server.ts`) starts running only after
// the current synchronous call stack -- which includes THIS module's
// `'update'` listener, since it runs synchronously inside the same
// `doc.emit` call -- has fully unwound. So keying the result by the exact
// `origin` object reference (a fresh object per inbound message; see
// `@hocuspocus/server/src/MessageReceiver.ts`'s `{ source: 'connection',
// connection }` literal, freshly constructed per message) and reading it
// back from `onChange` is race-free: the write always happens-before the
// read, regardless of what any extension awaits in between.
import * as Y from 'yjs';
import { FRAGMENT_NAME } from './codec.js';

/**
 * True if any type `transaction` touched (`transaction.changed`'s keys) is
 * the document's `prosemirror` fragment itself or nested under it. Walks
 * each changed type's own `_item.parent` chain up to a root-level type;
 * stops as soon as one reaches `fragment`. A type whose chain instead ends
 * at a different root-level shared type (`phraise`, `review`, `comments`,
 * `phraise-attribution`, ...) never reaches `fragment` and correctly
 * contributes nothing.
 */
export function transactionChangedContent(doc: Y.Doc, transaction: Y.Transaction): boolean {
  const fragment = doc.getXmlFragment(FRAGMENT_NAME);
  for (const type of transaction.changed.keys()) {
    let t: any = type;
    while (t) {
      if (t === fragment) return true;
      const item = t._item;
      t = item ? item.parent : null;
    }
  }
  return false;
}

/**
 * Registers a listener directly on `doc`'s native Yjs `'update'` event
 * (which carries the `Transaction`, unlike Hocuspocus's `onChange` hook
 * payload) and calls `fn(origin, changed)` for every update applied to
 * `doc` -- local or remote -- where `changed` is
 * `transactionChangedContent`'s result for that update's transaction.
 * Returns a detacher.
 */
export function onContentChange(doc: Y.Doc, fn: (origin: unknown, changed: boolean) => void): () => void {
  const handler = (_update: Uint8Array, origin: unknown, _sourceDoc: Y.Doc, transaction: Y.Transaction) => {
    fn(origin, transactionChangedContent(doc, transaction));
  };
  doc.on('update', handler);
  return () => doc.off('update', handler);
}
