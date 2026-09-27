// Plan section 3 point 3 (relay per-update hook): `recordAttribution`/
// `listAttributedRanges`, brief 03 task 1 ("inspectUpdate exists; add
// recordAttribution(doc, update, user, at) and listAttributedRanges(doc)
// from spike 5's attribution.ts"). Ported from spike 5
// (collab-stack-yjs13-hocuspocus, branch spike/2026-09-27-collab-stack,
// commit eeb3fe2, src/attribution.ts), retargeted from that file's own
// `PM_FRAGMENT`/`'pm'` naming to this spike's `FRAGMENT_NAME`/`'prosemirror'`
// (codec.ts). The walk itself (visitContainer/visitXmlText) is already
// schema-agnostic -- it recurses into any Y.XmlElement, so it needs no
// change for the full schema's textblocks-with-multiple-runs-and-atoms.
import * as Y from 'yjs';
import { FRAGMENT_NAME } from './codec.js';

export const ATTRIBUTION_MAP_NAME = 'phraise-attribution';
export const ATTRIBUTION_CONFLICTS_MAP_NAME = 'phraise-attribution-conflicts';

/** Transaction origin `recordAttribution` writes with; a caller's own remote-batch hook should skip re-entering on updates carrying it (see spike 5's header comment on the Hocuspocus onChange loop this avoids). */
export const ATTRIBUTION_ORIGIN = 'phraise-attribution';

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
 * update touches (via `Y.parseUpdateMeta`, same primitive `inspectUpdate`
 * uses), note the [from, to) clock range and `user` at `at`. A client ID
 * already mapped to a DIFFERENT user is a forged or colliding ID: flagged
 * into `ATTRIBUTION_CONFLICTS_MAP_NAME`, original mapping left untouched
 * (first writer wins).
 */
export function recordAttribution(doc: Y.Doc, update: Uint8Array, user: string, at: number): void {
  const meta = Y.parseUpdateMeta(update);
  if (meta.to.size === 0) return;
  doc.transact(() => {
    const attrMap = doc.getMap<AttributionEntry>(ATTRIBUTION_MAP_NAME);
    const conflictsMap = doc.getMap<ConflictEntry[]>(ATTRIBUTION_CONFLICTS_MAP_NAME);
    for (const [client, toClock] of meta.to) {
      const fromClock = meta.from.get(client) ?? toClock;
      const key = String(client);
      const existing = attrMap.get(key);
      if (existing && existing.user !== user) {
        const log = conflictsMap.get(key) ?? [];
        log.push({ client, existingUser: existing.user, attemptedUser: user, at });
        conflictsMap.set(key, log);
        continue;
      }
      const entry: AttributionEntry = existing ? { user: existing.user, ranges: [...existing.ranges] } : { user, ranges: [] };
      entry.ranges.push([fromClock, toClock, at]);
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
  /** Server/local receive time (ms epoch) of the range's edit, or 0 for "unknown". */
  at: number;
  text: string;
}

/**
 * List visible ranges with user, time and text, by walking the Yjs items.
 * Walks the document's XmlFragment tree following each Y.XmlText's own
 * internal item chain (the same linked list ySyncPlugin itself walks to
 * build text) to find every visible (non-deleted) ContentString run, and
 * looks up who wrote it. Adjacent runs by the same (user, time) are merged
 * into one range. Inline atoms (images etc, their own Y.XmlElements) are
 * attributed as one range each, keyed by the id of the Item that placed
 * them in their parent.
 */
export function listAttributedRanges(doc: Y.Doc): AttributedRange[] {
  const attrMap = doc.getMap<AttributionEntry>(ATTRIBUTION_MAP_NAME);
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

  function visitXmlText(yText: Y.XmlText) {
    let n: any = (yText as any)._start;
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

  visitContainer(doc.getXmlFragment(FRAGMENT_NAME));
  flush();
  return out;
}
