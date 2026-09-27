#!/usr/bin/env npx tsx
// Spike 5, brief 02, task 6: does Yjs 13 read Yjs 14's documents, and the
// reverse? Also covers task 2's attempt (c) measurement ("stock Hocuspocus
// with real Yjs 13 relaying Yjs 14 clients ... record how it fails") at
// the level that actually matters: whether real Yjs 13's own sync-protocol
// code can do anything at all with a `@y/y` (Yjs 14) `Y.Doc`, since that is
// exactly what a real-Yjs-13 relay (Hocuspocus or plain y-websocket) would
// need to do internally to relay a Yjs 14 client (Hocuspocus additionally
// multiplexes multiple documents per WebSocket connection by a doc-name
// prefix on every message -- see the log for why that alone already rules
// out a stock Hocuspocus server ever speaking our stack 14 client's plain
// per-connection protocol, independent of the encoding question below).
//
// Run: npm run compat (from this compat/ subpackage -- its own
// node_modules, no npm `overrides`, so real yjs@13.6.33 and @y/y coexist
// unaliased).
import * as Y13 from 'yjs';
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import * as syncProtocol13 from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as Y14 from '@y/y';
import { pmnodeToDelta, ynodeToPmnode } from '@y/prosemirror';
import { buildFixtureDoc, schema } from '../src/schema.js';

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

function main() {
  const fixture = buildFixtureDoc();

  section('1. Yjs 13 encodes -> Yjs 14 applies -> @y/prosemirror reads');
  {
    const doc13 = new Y13.Doc();
    Y13.transact(doc13, () => {
      prosemirrorToYXmlFragment(fixture, doc13.getXmlFragment('prosemirror'));
    });
    const update = Y13.encodeStateAsUpdate(doc13);
    console.log(`Yjs 13 update: ${update.length} bytes.`);

    const doc14 = new Y14.Doc();
    try {
      Y14.applyUpdate(doc14, update);
      console.log('Y14.applyUpdate(yjs13-encoded bytes): did NOT throw.');
      try {
        const ytype = doc14.get('prosemirror');
        const rebuilt = ynodeToPmnode(ytype, schema);
        console.log('ynodeToPmnode succeeded:', JSON.stringify(rebuilt.toJSON()).slice(0, 200));
      } catch (e) {
        console.log('ynodeToPmnode THREW:', (e as Error).message);
      }
    } catch (e) {
      console.log('Y14.applyUpdate THREW:', (e as Error).stack?.split('\n').slice(0, 4).join('\n'));
    }
  }

  section('2. Yjs 14 encodes -> Yjs 13 applies -> y-prosemirror reads');
  {
    const doc14 = new Y14.Doc();
    const ytype14 = doc14.get('prosemirror');
    ytype14.applyDelta(pmnodeToDelta(fixture));
    const update = Y14.encodeStateAsUpdate(doc14);
    console.log(`Yjs 14 update: ${update.length} bytes.`);

    const doc13 = new Y13.Doc();
    try {
      Y13.applyUpdate(doc13, update);
      console.log('Y13.applyUpdate(yjs14-encoded bytes): did NOT throw.');
      try {
        const rebuilt = yXmlFragmentToProseMirrorRootNode(doc13.getXmlFragment('prosemirror'), schema);
        console.log('yXmlFragmentToProseMirrorRootNode succeeded:', JSON.stringify(rebuilt.toJSON()).slice(0, 200));
      } catch (e) {
        console.log('yXmlFragmentToProseMirrorRootNode THREW:', (e as Error).message);
      }
    } catch (e) {
      console.log('Y13.applyUpdate THREW:', (e as Error).stack?.split('\n').slice(0, 4).join('\n'));
    }
  }

  section('3. Is a Yjs 13 Y.XmlFragment-shaped document readable by @y/prosemirror at all?');
  {
    const doc13 = new Y13.Doc();
    Y13.transact(doc13, () => {
      prosemirrorToYXmlFragment(fixture, doc13.getXmlFragment('prosemirror'));
    });
    // Not going through an update at all this time -- same in-memory
    // Y.Doc instance, straight to @y/prosemirror's reader, to isolate
    // "is the SHAPE (Y.XmlFragment vs Y.Node) itself readable" from "does
    // the wire encoding survive a round trip" (section 1 already answers
    // the latter).
    try {
      const frag = doc13.getXmlFragment('prosemirror');
      const rebuilt = ynodeToPmnode(frag as unknown as Parameters<typeof ynodeToPmnode>[0], schema);
      console.log('ynodeToPmnode(a real Y.XmlFragment) succeeded (unexpected):', JSON.stringify(rebuilt.toJSON()).slice(0, 200));
    } catch (e) {
      console.log('ynodeToPmnode(a real Y.XmlFragment) THREW:', (e as Error).message);
    }
  }

  section('4. Task 2(c) measurement: can real Yjs 13 sync-protocol code do anything with a @y/y Doc?');
  {
    const doc14 = new Y14.Doc();
    const ytype14 = doc14.get('prosemirror');
    ytype14.applyDelta(pmnodeToDelta(fixture));
    const encoder = encoding.createEncoder();
    try {
      // This is exactly what a real-Yjs-13 relay's sync handshake does on
      // every new connection (see stack 13's and this stack's own
      // relay.ts): encode a step-1 message from the shared doc. A relay
      // that received a Yjs 14 client's raw bytes and tried to hand them to
      // its own (real Yjs 13) `Y.Doc`/`y-protocols` machinery would hit
      // this exact call somewhere in its request path.
      syncProtocol13.writeSyncStep1(encoder, doc14 as unknown as Y13.Doc);
      console.log('y-protocols(13).writeSyncStep1(a @y/y Doc): did NOT throw:', encoding.toUint8Array(encoder).length, 'bytes.');
    } catch (e) {
      console.log('y-protocols(13).writeSyncStep1(a @y/y Doc) THREW:', (e as Error).stack?.split('\n').slice(0, 4).join('\n'));
    }
  }
}

main();
