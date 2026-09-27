// Debugging gate E's collision test (kept for reference; see
// gates/gateE.ts's collision-test comment for the full account): a first
// attempt at forging a raw update under alice's real clientID started the
// forged doc's own clock for that client at 0, colliding with the clock
// range her real edits already occupy in the actual document. An update
// whose structs are already fully known produces an EMPTY outgoing update
// (nothing new to broadcast), so it never even reaches recordAttribution
// (which returns immediately on `inserts.isEmpty()`) -- no conflict was
// ever recorded, silently. This probe reproduces both the failing and the
// fixed version headlessly (no relay needed) to make the mechanism
// visible.
import * as Y from '@y/y';

const alice = new Y.Doc();
alice.get('scratch').insert(0, ['hello world real edit']);
console.log('alice clientID', alice.clientID, 'store clients', [...alice.store.clients.keys()]);
const aliceClient = alice.clientID;

console.log('--- attempt 1: fresh fake doc, clock starts at 0 (collides with the real range) ---');
{
  const fake = new Y.Doc();
  fake.clientID = aliceClient;
  let forged: Uint8Array | undefined;
  fake.on('update', (u: Uint8Array) => { forged = u; });
  (fake.get('forged-scratch') as any).insert(0, ['forged-by-mallory']);
  const meta = Y.createContentIdsFromUpdate(forged!);
  console.log('meta.inserts.isEmpty()', meta.inserts.isEmpty());
  meta.inserts.clients.forEach((ranges: any, client: number) => {
    console.log('client', client, 'ranges', ranges.getIds());
  });
  const relayDoc = new Y.Doc();
  Y.applyUpdate(relayDoc, Y.encodeStateAsUpdate(alice));
  Y.applyUpdate(relayDoc, forged!);
  console.log('forged-scratch content (attempt 1):', relayDoc.get('forged-scratch')?.toJSON?.(), '-- empty: the forged content never actually landed');
}

console.log('--- attempt 2: fake doc synced with alice\'s CURRENT state first, clock continues correctly ---');
{
  const fake = new Y.Doc();
  Y.applyUpdate(fake, Y.encodeStateAsUpdate(alice));
  fake.clientID = aliceClient;
  let forged: Uint8Array | undefined;
  fake.on('update', (u: Uint8Array) => { forged = u; });
  (fake.get('forged-scratch') as any).insert(0, ['forged-by-mallory']);
  const meta = Y.createContentIdsFromUpdate(forged!);
  console.log('meta.inserts.isEmpty()', meta.inserts.isEmpty());
  meta.inserts.clients.forEach((ranges: any, client: number) => {
    console.log('client', client, 'ranges', ranges.getIds());
  });
  const relayDoc = new Y.Doc();
  Y.applyUpdate(relayDoc, Y.encodeStateAsUpdate(alice));
  Y.applyUpdate(relayDoc, forged!);
  console.log('forged-scratch content (attempt 2):', relayDoc.get('forged-scratch')?.toJSON?.(), '-- present: the forgery genuinely lands now, so recordAttribution actually sees it and can flag the conflict');
}
