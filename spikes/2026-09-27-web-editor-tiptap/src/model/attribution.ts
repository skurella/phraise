// Brief 03, gate E: attribution. Maps Yjs client IDs to users and server
// receive times, from the relay's onChange hook, and lists visible ranges
// by walking the Yjs items -- per the charter: "record the Yjs client ID to
// user and timestamp mapping at the server's authentication hook from day
// one" (D5) and "list visible ranges with user, time and text".
//
// Where the mapping lives: a Y.Map INSIDE the document (`phraise-attribution`),
// not a relay-side SQLite table. Chosen because:
//   1. Zero extra persistence wiring -- it rides along with the existing
//      SQLite extension that already persists the whole Y.Doc (gate G already
//      proves that survives a restart); a side table would need its own
//      schema, its own write path in onChange, and its own crash-consistency
//      story with the doc store.
//   2. It replicates to every connected client for free (same sync protocol
//      as the document content), which a future "show who wrote this" UI
//      needs anyway -- a side table would need a separate fetch/RPC.
//   3. It is measured directly (gate E) as a fraction of `encodeStateAsUpdate`
//      bytes, so its cost is visible in the same place the document's own
//      cost is measured.
// Trade-off (the real cost, stated plainly): it never shrinks. Every onChange
// appends a new [from, to, at] range tuple for whichever client made the
// edit; nothing ever compacts or garbage-collects old ranges, unlike a side
// table you could periodically vacuum or index by time. For a spike this is
// fine; a production version would want to merge adjacent ranges from the
// same client at least (not implemented here -- out of scope for this gate).
import * as Y from 'yjs';
import { FRAGMENT_NAME } from './yjs.js';

export const ATTRIBUTION_MAP_NAME = 'phraise-attribution';
export const ATTRIBUTION_CONFLICTS_MAP_NAME = 'phraise-attribution-conflicts';

/**
 * Passed as the `origin` of every transaction this module makes on the
 * document. The relay's onChange hook must check `transactionOrigin ===
 * ATTRIBUTION_ORIGIN` and skip re-entering `recordAttribution` for updates
 * carrying it -- otherwise the metadata write it makes would itself trigger
 * another onChange, which would write more metadata, forever (Hocuspocus's
 * onChange fires for every update to the Y.Doc, including ones the server
 * itself makes via `document.transact()`, not just ones from a client
 * message -- confirmed by reading `handleDocumentUpdate` in
 * @hocuspocus/server's source, which is bound to the *Doc's* own `update`
 * event with no filtering by source).
 */
export const ATTRIBUTION_ORIGIN = Symbol('phraise-attribution');

export interface AttributionEntry {
  user: string;
  /** [fromClock, toClockExclusive, serverReceivedAtMs][], oldest first. */
  ranges: [number, number, number][];
}

export interface ConflictEntry {
  client: number;
  existingUser: string;
  attemptedUser: string;
  at: number;
}

/**
 * Record one incoming update's attribution: for each Yjs client ID the
 * update touches (via `Y.parseUpdateMeta`, which walks the update's structs
 * without applying anything -- exactly the "decode the update's structs"
 * the brief asks for), note the [from, to) clock range and `user` at
 * `serverReceivedAt`.
 *
 * A client ID already mapped to a DIFFERENT user is a forged or colliding
 * ID: flagged into ATTRIBUTION_CONFLICTS_MAP_NAME, and the original mapping
 * is left untouched (first writer wins; this never silently reassigns
 * authorship of a client ID already seen).
 */
export function recordAttribution(document: Y.Doc, update: Uint8Array, user: string, serverReceivedAt: number): void {
  const meta = Y.parseUpdateMeta(update);
  if (meta.to.size === 0) return;
  document.transact(() => {
    const attrMap = document.getMap<AttributionEntry>(ATTRIBUTION_MAP_NAME);
    const conflictsMap = document.getMap<ConflictEntry[]>(ATTRIBUTION_CONFLICTS_MAP_NAME);
    for (const [client, toClock] of meta.to) {
      const fromClock = meta.from.get(client) ?? toClock;
      const key = String(client);
      const existing = attrMap.get(key);
      if (existing && existing.user !== user) {
        const log = conflictsMap.get(key) ?? [];
        log.push({ client, existingUser: existing.user, attemptedUser: user, at: serverReceivedAt });
        conflictsMap.set(key, log);
        continue;
      }
      const entry: AttributionEntry = existing ? { user: existing.user, ranges: [...existing.ranges] } : { user, ranges: [] };
      entry.ranges.push([fromClock, toClock, serverReceivedAt]);
      attrMap.set(key, entry);
    }
  }, ATTRIBUTION_ORIGIN);
}

function findUser(attrMap: Y.Map<AttributionEntry>, client: number, clock: number): { user: string; at: number } {
  const entry = attrMap.get(String(client));
  if (entry) {
    for (const [from, to, at] of entry.ranges) {
      if (clock >= from && clock < to) return { user: entry.user, at };
    }
  }
  return { user: 'unknown', at: 0 };
}

export interface AttributedRange {
  user: string;
  /** Server receive time (ms epoch) of the range's edit, or 0 for "unknown". */
  at: number;
  text: string;
}

/**
 * "For a document edited by alice and bob (plus the seed), list visible
 * ranges with user, time and text, by walking the Yjs items."
 *
 * Walks the document's XmlFragment tree exactly as y-tiptap/y-prosemirror
 * would render it, but instead of building a ProseMirror node, follows each
 * Y.XmlText's own internal item chain (`_start`/`.right`, the same linked
 * list ySyncPlugin itself walks to build text) to find every *visible*
 * (non-deleted) ContentString run, and looks up who wrote it. Adjacent runs
 * by the same (user, time) are merged into one range for readability.
 * Inline atoms (images etc, stored as child Y.XmlElements rather than text
 * runs) are attributed as one range each, keyed by the id of the Item that
 * placed them in their parent.
 */
export function listAttributedRanges(document: Y.Doc): AttributedRange[] {
  const attrMap = document.getMap<AttributionEntry>(ATTRIBUTION_MAP_NAME);
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

  function visitXmlText(ytext: Y.XmlText) {
    let n: any = (ytext as any)._start;
    while (n) {
      if (!n.deleted && n.content && n.content.constructor?.name === 'ContentString') {
        push(findUser(attrMap, n.id.client, n.id.clock), n.content.str as string);
      }
      n = n.right;
    }
  }

  function visitContainer(el: Y.XmlFragment | Y.XmlElement) {
    for (const child of el.toArray()) {
      if (child instanceof Y.XmlText) {
        visitXmlText(child);
      } else if (child instanceof Y.XmlElement) {
        const item = (child as unknown as { _item: Y.Item | null })._item;
        if (item && !item.deleted) {
          flush();
          push(findUser(attrMap, item.id.client, item.id.clock), `<${child.nodeName}>`);
          flush();
        }
        visitContainer(child);
      }
    }
  }

  visitContainer(document.getXmlFragment(FRAGMENT_NAME));
  flush();
  return out;
}
