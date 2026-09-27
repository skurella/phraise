// New for this spike (brief 04, src/relay/). Forged-identity rejection
// (plan section 6, charter gate B): before Hocuspocus applies an incoming
// Yjs update message, decode its client ids with `crdt.inspectUpdate` and
// reject a forged one.
//
// Hook chosen: `beforeSync(connection, {type, payload})`. Found by reading
// `node_modules/@hocuspocus/server`'s own source
// (packages/server/src/MessageReceiver.ts's `readSyncMessage`):
// `beforeSync` runs synchronously before the `syncStep1/syncStep2/update`
// switch that would call `y-protocols/sync`'s `readSyncStep2`/`readUpdate`
// (the calls that actually mutate the document and queue a broadcast), and
// `payload` is already `message.peekVarUint8Array()` -- a NON-consuming
// peek, so throwing here changes nothing about the decoder state visible
// to anything else. `beforeHandleMessage` was the other candidate hook,
// but it only hands over the entire still-undecoded framed message (a
// document-name-prefixed blob); `beforeSync` already hands over exactly
// the piece we need (message type + raw bytes), so it needs no protocol
// parsing of our own.
//
// Throwing inside `beforeSync` propagates up through `readSyncMessage` ->
// `MessageReceiver.apply` -> `Connection.processMessages`'s own try/catch
// (packages/server/src/Connection.ts), which closes the connection with
// `ResetConnection` and clears the rest of that connection's message
// queue -- so one throw gives us all three of "not applied" (the switch
// branch that calls `readSyncStep2`/`readUpdate` never runs), "not
// broadcast" (nothing was ever written to the document, so there is
// nothing to broadcast), and "connection closed", with no extra plumbing.
//
// y-protocols/sync's message type tags: syncStep1 = 0 (a state-vector
// query -- `payload` is a state vector, not an update; never a forgery
// vector, always allowed), syncStep2 = 1, update = 2 (`payload` is a real
// Yjs update in both cases, decodable by `inspectUpdate`).
//
// Residual (documented per the brief): syncStep2 is a client's FULL local
// state, sent either on first connect or after the relay has forgotten a
// document (restored fresh from a draft/commit) -- it legitimately
// contains structs under other users' client ids that this replica
// already received directly from them at some point in the past. Rejecting
// syncStep2 on "mapped to a different user" would make an ordinary
// reconnect-after-relay-restart indistinguishable from an attack, so this
// check applies ONLY to `SYNC_UPDATE` (type 2): an incremental update can
// only legitimately extend the sender's OWN client id's own append-only
// item sequence (Yjs assigns clocks per `doc.clientID` at item-creation
// time; nothing about the ordinary editing API lets a client append items
// under someone else's id), so any id it touches that is already known to
// belong to someone else is definitely forged, not a stale-relay artifact.
// This leaves a real gap -- a forged syncStep2 is not caught here -- traded
// for not breaking legitimate reconnects; recorded as a decision in the
// findings doc.
import { inspectUpdate, authorOf, getMeta, type CrdtDoc } from '../crdt/index.js';

export const SYNC_STEP1 = 0;
export const SYNC_STEP2 = 1;
export const SYNC_UPDATE = 2;

export class ForgedIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForgedIdentityError';
  }
}

/**
 * Throws `ForgedIdentityError` if `payload` (an update, `type ===
 * SYNC_UPDATE` only) touches a client id that is either already mapped (in
 * `phraise-attribution`) to a user other than `user`, or already registered
 * in `phraise-authors` as a seed/git/import/generation peer (a live human
 * connection can never legitimately produce ops under one of those
 * deterministic ids). Unmapped ids are left alone here: they get mapped to
 * `user` later, when this same update reaches the relay's `onChange` hook
 * and calls `crdt.recordAttribution` (first-writer-wins).
 */
export function checkForgery(doc: CrdtDoc, type: number, payload: Uint8Array, user: string): void {
  if (type !== SYNC_UPDATE) return;
  for (const range of inspectUpdate(payload)) {
    const peerEntry = getMeta(doc, 'phraise-authors', String(range.clientId));
    if (peerEntry !== undefined) {
      throw new ForgedIdentityError(
        `forged client identity: client ${range.clientId} is a registered seed/git/import/generation peer, not a live user (attempted by "${user}")`,
      );
    }
    const mappedUser = authorOf(doc, range.clientId);
    if (mappedUser !== undefined && mappedUser !== user) {
      throw new ForgedIdentityError(
        `forged client identity: client ${range.clientId} is already mapped to "${mappedUser}", not "${user}"`,
      );
    }
  }
}
