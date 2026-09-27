// Brief 04, gate E part (a): "For a document edited by two users, list who
// wrote which ranges and when. State where the mapping from client
// identity to user is kept and how it survives reconnects." Same design
// question stack 13's src/attribution.ts answered (a Y.Map inside the
// document, hand-rolled JS objects for the entries) -- this file answers it
// for stack 14 using `@y/y`'s OWN native structure instead, per the brief:
// "Where @y/y offers a native structure for this (an IdMap/ContentMap of
// createContentAttribute('insert', user) and similar, built from each
// update's content ids), use it instead of a hand-rolled map, persist it,
// and say which you used and why."
//
// What's used, and why: `createContentIdsFromUpdate(update)` decodes an
// incoming update's structs into an `IdSet` of every content id it inserted
// (client -> clock ranges) without applying anything -- the exact
// "decode the update's structs" step stack 13's `Y.parseUpdateMeta` did,
// just via @y/y's newer primitive (yjs-attributing.md, the doc the brief
// names, uses exactly this `IdSet`/`IdMap` pair for its own worked
// attribution example). `createIdMapFromIdSet(idset, attrs)` then builds an
// `IdMap` -- content ids mapped to `ContentAttribute`s -- straight from
// that IdSet, tagging every range this update touched with
// `createContentAttribute('user', user)` and `createContentAttribute('at',
// serverReceivedAt)`. Successive updates are folded in with `mergeIdMaps`.
// The whole thing serializes with `encodeIdMap`/`decodeIdMap` (run-length
// encoded ids, de-duplicated attributes -- the doc's own "the above example
// encodes in 27 bytes" line), so it's PERSISTED the same way stack 13's
// Y.Map was: written into the document's own `phraise-attribution` Y.Map
// (one entry, the encoded IdMap bytes) and so it rides along with the
// existing SQLite persistence for free (gate G already proves that
// survives a restart) and replicates to every connected client automatically
// -- same trade-off stack 13's file documents (never shrinks; no compaction
// here either) and the same reasons for choosing it apply.
//
// What ISN'T covered by IdMap, and stays hand-rolled (small, and explicitly
// NOT the "attribution" data structure the brief asks to prefer a native
// type for): forged-client-ID collision detection. IdMap attributes content
// RANGES; it has no notion of "this client id already belongs to a
// different user" as a first-class concept. That check is derived here by
// reading the FIRST user attribute already on file for a given client
// (found by walking the persisted IdMap) before merging in a new update
// under a different asserted user, and any actual conflict is logged into
// a tiny separate list purely for the audit trail gate E's collision case
// checks -- not used to attribute any content.
import * as Y from 'yjs';
import {
  createContentIdsFromUpdate,
  createIdMap,
  createIdMapFromIdSet,
  createContentAttribute,
  mergeIdMaps,
  encodeIdMap,
  decodeIdMap,
  IdSet,
  type IdMap,
} from '@y/y';
import { ContentString, ContentType } from '@y/y';
import { FRAGMENT_NAME } from './yjs.js';

export const ATTRIBUTION_MAP_NAME = 'phraise-attribution';
const IDMAP_KEY = 'idmap';
const CONFLICTS_KEY = 'conflicts';

/** Same reasoning as stack 13's file: every document.transact() this module makes carries this origin so the relay's onChange hook can skip re-entering itself on its own writes. */
export const ATTRIBUTION_ORIGIN = Symbol('phraise-attribution');

export interface ConflictEntry {
  client: number;
  existingUser: string;
  attemptedUser: string;
  at: number;
}

type Attrs = { user: string; at: number };

// `@y/y`'s Doc has no more `getMap`/`getText`/`getXmlFragment` -- every
// shared type is fetched the same way (`doc.get(name)`, a unified `YNode`),
// and a node used as a plain attribute bag (what stack 13 used a Y.Map
// for) is read/written with `getAttr`/`setAttr`, not `.get`/`.set`.
function attributionNode(document: Y.Doc): ReturnType<Y.Doc['get']> {
  return document.get(ATTRIBUTION_MAP_NAME);
}

function loadIdMap(document: Y.Doc): IdMap<Attrs> {
  const bytes = attributionNode(document).getAttr(IDMAP_KEY) as Uint8Array | undefined;
  return bytes && bytes.length > 0 ? (decodeIdMap(bytes) as IdMap<Attrs>) : (createIdMap() as IdMap<Attrs>);
}

/** First `user` attribute already on file for `client` in `idmap`, if any (the ground truth an incoming update is checked against). */
function firstUserForClient(idmap: IdMap<Attrs>, client: number): string | undefined {
  const ranges = idmap.clients.get(client);
  if (!ranges) return undefined;
  const ids = ranges.getIds();
  for (const r of ids) {
    const u = r.attrs.find((a) => a.name === 'user');
    if (u) return u.val as unknown as string;
  }
  return undefined;
}

/**
 * Record one incoming update's attribution: decode its content ids
 * (`createContentIdsFromUpdate`), tag every client's ranges it inserted
 * with `user`/`at` `ContentAttribute`s (skipping any client id already
 * attributed to a DIFFERENT user -- first writer wins, flagged into the
 * conflicts list instead), and merge the result into the persisted IdMap.
 */
export function recordAttribution(document: Y.Doc, update: Uint8Array, user: string, serverReceivedAt: number): void {
  const { inserts } = createContentIdsFromUpdate(update);
  if (inserts.isEmpty()) return;

  document.transact(() => {
    const existing = loadIdMap(document);
    const node = attributionNode(document);
    const conflictLog = (node.getAttr(CONFLICTS_KEY) as Record<string, ConflictEntry[]> | undefined) ?? {};

    // Split this update's own content ids into "accepted" (client id not
    // already owned by someone else) and "conflicting" (flagged, not merged).
    const accepted = new IdSet();
    inserts.clients.forEach((ranges: { getIds(): { clock: number; len: number }[] }, client: number) => {
      const owner = firstUserForClient(existing, client);
      if (owner !== undefined && owner !== user) {
        const key = String(client);
        const log = conflictLog[key] ?? [];
        log.push({ client, existingUser: owner, attemptedUser: user, at: serverReceivedAt });
        conflictLog[key] = log;
        return; // ground truth kept: this client's ranges are not merged under the new user
      }
      for (const range of ranges.getIds()) accepted.add(client, range.clock, range.len);
    });

    if (!accepted.isEmpty()) {
      const tagged = createIdMapFromIdSet(accepted, [createContentAttribute('user', user), createContentAttribute('at', serverReceivedAt)]);
      const merged = mergeIdMaps([existing as IdMap<unknown>, tagged as IdMap<unknown>]);
      node.setAttr(IDMAP_KEY, encodeIdMap(merged));
    }
    node.setAttr(CONFLICTS_KEY, conflictLog);
  }, ATTRIBUTION_ORIGIN);
}

/** Every conflict flagged so far for `client` (empty if none). */
export function conflictsForClient(document: Y.Doc, client: number): ConflictEntry[] {
  const conflictLog = (attributionNode(document).getAttr(CONFLICTS_KEY) as Record<string, ConflictEntry[]> | undefined) ?? {};
  return conflictLog[String(client)] ?? [];
}

/** The user currently on file for `client` (the ground truth a collision check reads), or undefined if never seen. */
export function userForClient(document: Y.Doc, client: number): string | undefined {
  return firstUserForClient(loadIdMap(document), client);
}

function findUser(idmap: IdMap<Attrs>, client: number, clock: number): { user: string; at: number } {
  const ranges = idmap.clients.get(client);
  if (ranges) {
    for (const r of ranges.getIds()) {
      if (clock >= r.clock && clock < r.clock + r.len) {
        const user = (r.attrs.find((a) => a.name === 'user')?.val as unknown as string) ?? 'unknown';
        const at = (r.attrs.find((a) => a.name === 'at')?.val as unknown as number) ?? 0;
        return { user, at };
      }
    }
  }
  return { user: 'unknown', at: 0 };
}

export interface AttributedRange {
  user: string;
  at: number;
  text: string;
}

/**
 * "For a document edited by alice and bob (plus the seed), list visible
 * ranges with user, time and text, by walking the Yjs items." Same shape
 * as stack 13's walker, adapted to @y/y's unified Node/Item model: every
 * child is an `Item` whose `.content` is either a `ContentString` (a text
 * run) or a `ContentType` (a nested Y.Node, e.g. an `image` atom or a
 * `paragraph`) -- there is no more separate Y.Text/Y.XmlElement class to
 * distinguish, `instanceof` on `.content` does the job instead.
 */
export function listAttributedRanges(document: Y.Doc): AttributedRange[] {
  const idmap = loadIdMap(document);
  const out: AttributedRange[] = [];
  let curr: { user: string; at: number } | undefined;
  let buf = '';

  function flush() {
    if (curr && buf.length > 0) out.push({ user: curr.user, at: curr.at, text: buf });
    buf = '';
  }

  function push(who: { user: string; at: number }, text: string) {
    if (!curr || curr.user !== who.user || curr.at !== who.at) flush();
    curr = who;
    buf += text;
  }

  function visitNode(node: { _start: unknown }) {
    let item = (node as { _start: any })._start;
    while (item) {
      if (!item.deleted) {
        if (item.content instanceof ContentString) {
          push(findUser(idmap, item.id.client, item.id.clock), item.content.str as string);
        } else if (item.content instanceof ContentType) {
          flush();
          push(findUser(idmap, item.id.client, item.id.clock), `<${item.content.type.name}>`);
          flush();
          visitNode(item.content.type);
        }
      }
      item = item.right;
    }
  }

  const root = document.get(FRAGMENT_NAME) as unknown as { _start: unknown };
  visitNode(root);
  flush();
  return out;
}
