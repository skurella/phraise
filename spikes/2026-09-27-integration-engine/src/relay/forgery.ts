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
// query -- `payload` is a state vector, not an update; carries no structs
// under anyone's clientID, so it is never a forgery vector and is always
// allowed), syncStep2 = 1, update = 2 (`payload` is a real Yjs update in
// both cases, decodable by `inspectUpdate`).
//
// Brief 06 task 1 (closing the milestone-1 review's blocker): the earlier
// version of this file exempted SYNC_STEP2 entirely from the forgery
// check, reasoning that a client's first sync message legitimately resends
// its own full local state (which can include other users' structs this
// replica already received directly from them, e.g. after a relay
// restart). The review (context/logs/2026-09-27-reviewer-spike-6-m1.md)
// found the live bypass this actually opens: `@hocuspocus/server` and
// `y-protocols/sync` route SYNC_STEP2 and SYNC_UPDATE through the exact
// same `Y.applyUpdate` + broadcast path (`readUpdate` IS `readSyncStep2`),
// and nothing stops an already-authenticated connection from sending a
// SYNC_STEP2-tagged message at any time, not just as a first message -- so
// a forger only had to tag its forged update as SYNC_STEP2 instead of
// SYNC_UPDATE to bypass this file entirely.
//
// Fix: run the SAME per-client-range check for SYNC_STEP2 and SYNC_UPDATE
// alike. What used to be a message-type exemption is now two much
// narrower, per-range escapes:
//
//  1. "the relay already holds every clock in that range"
//     (`crdt.knownClock(doc, clientId) >= range.to`): applying this range
//     again is a genuine Yjs no-op (it introduces nothing new), so it is
//     harmless by construction regardless of who's replaying it or why.
//     This is what makes an honest reconnect-after-restart's SYNC_STEP2
//     (full local state, including other users' structs this replica
//     already has) pass without a special case for the message type.
//     Mallory's forged range is never already-known (it is new data), so
//     this escape never fires for an actual forgery.
//
//  2. "the document is in a recovery window" (`opts.recoveryWindow`,
//     relay-side bookkeeping in `state.ts`, not part of the replicated
//     document): opened for a configurable time (default 60s) after a
//     document is freshly seeded or restored from a draft because this
//     relay process had no local state for it (first-ever open, or local
//     storage lost). During the window, a range that fails escape 1 (truly
//     new data under someone else's mapped id) is still accepted, not
//     re-attributed, and counted separately (`relayedDuringRecovery`) --
//     this is the residual: a client that reconnects while the relay has
//     no memory of a document legitimately carries other users' NEW (to
//     this fresh relay state) structs in its first sync, and rejecting
//     those would make an ordinary reconnect-after-relay-restart
//     indistinguishable from an attack. A forgery timed to land inside
//     this same window, against the same freshly (re)loaded document,
//     inside those first `recoveryWindowMs` milliseconds, is not caught by
//     this file -- documented in src/relay/README.md as an accepted,
//     time-bounded residual, traded for not breaking legitimate recovery.
//
// Unmapped ids are, as before, left alone here: they get mapped to `user`
// later, when this same update reaches the relay's `onChange` hook and
// calls `crdt.recordAttribution` (first-writer-wins).
import { inspectUpdate, knownClock, authorOf, getMeta, type CrdtDoc } from '../crdt/index.js';

export const SYNC_STEP1 = 0;
export const SYNC_STEP2 = 1;
export const SYNC_UPDATE = 2;

export class ForgedIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForgedIdentityError';
  }
}

export interface CheckForgeryOptions {
  /** True if `doc` is currently inside its recovery window (see the module header comment and `state.ts`'s `RelayState.inRecoveryWindow`). */
  inRecoveryWindow: boolean;
  /** Called once per range accepted only because of the recovery window (for `RelayCounters.relayedDuringRecovery`). */
  onRelayedDuringRecovery?: (range: { clientId: number; from: number; to: number }) => void;
}

/**
 * Throws `ForgedIdentityError` if `payload` (`type === SYNC_STEP2` or
 * `SYNC_UPDATE`) touches a client id that is either already mapped (in
 * `phraise-attribution`) to a user other than `user`, or already registered
 * in `phraise-authors` as a seed/git/import/generation peer (a live human
 * connection can never legitimately produce ops under one of those
 * deterministic ids) -- UNLESS the relay already holds every clock in that
 * range (a harmless no-op once applied), or `doc` is in its recovery
 * window (accepted and counted, not rejected; see the module header
 * comment for the residual this trades away).
 */
export function checkForgery(doc: CrdtDoc, type: number, payload: Uint8Array, user: string, opts: CheckForgeryOptions): void {
  if (type !== SYNC_STEP2 && type !== SYNC_UPDATE) return;
  for (const range of inspectUpdate(payload)) {
    const peerEntry = getMeta(doc, 'phraise-authors', String(range.clientId));
    const mappedUser = authorOf(doc, range.clientId);
    const isForeign = peerEntry !== undefined || (mappedUser !== undefined && mappedUser !== user);
    if (!isForeign) continue;

    if (knownClock(doc, range.clientId) >= range.to) continue; // already known: applying it again adds nothing

    if (opts.inRecoveryWindow) {
      opts.onRelayedDuringRecovery?.(range);
      continue;
    }

    const reason =
      peerEntry !== undefined
        ? `client ${range.clientId} is a registered seed/git/import/generation peer, not a live user`
        : `client ${range.clientId} is already mapped to "${mappedUser}", not "${user}"`;
    throw new ForgedIdentityError(`forged client identity: ${reason} (attempted by "${user}", message type ${type})`);
  }
}
