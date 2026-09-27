// DocSync: the pure, synchronous core (plan section 3). Wraps a live Y.Doc
// (gc: false -- forks need tombstones, `Y.createDocFromSnapshot` refuses a
// garbage-collected doc) and turns a saved file's text into attributed CRDT
// operations without reverting anything a remote peer did after the
// editor's base (plan 3.3), and renders the CRDT back to bytes (plan 3.5).
import * as Y from 'yjs';
import { yXmlFragmentToProseMirrorRootNode, updateYFragment } from 'y-prosemirror';
import type { Node as PMNode } from 'prosemirror-model';
import {
  parseMarkdown,
  parseMdast,
  serializeDoc,
  docToYDoc,
  yDocToDoc,
  encodeLeafMarks,
  semanticEq,
  schema,
  UnverifiedSerializationError,
} from '../md/index.js';
import { FRAGMENT_NAME, META_MAP_NAME } from '../md/yjs.js';
import { applyDiff, type DiffCounters } from './diff.js';
import { VersionRing, chooseBase, diffCost, hashText, type Version } from './versions.js';

/** Yjs transaction origin used for every mutation this module makes. */
export const ORIGIN_IMPORT = 'phraise-import';

const AUTHORS_MAP_NAME = 'phraise-authors';

export type AuthorKind = 'local' | 'remote' | 'git';

export interface Author {
  name: string;
  kind: AuthorKind;
}

export interface AuthorRecord extends Author {
  at: number;
}

export interface ImportOptions {
  author: Author;
  /** Force a specific base version instead of `chooseBase`'s pick (e.g. a persisted base on restart). */
  base?: Version;
}

export interface ImportNoop {
  kind: 'noop';
  base: Version;
  cost: number;
}

export interface ImportOk {
  kind: 'ok';
  base: Version;
  cost: number;
  forked: boolean;
  repaired: boolean;
  counters: DiffCounters;
  version: Version;
}

export type ImportResult = ImportNoop | ImportOk;

export interface RenderOptions {
  /**
   * Whole-document check (debug/gate mode): `parseMarkdown(out)` must be
   * semantically equal to the doc, because block serialization is verified
   * per block in isolation and some constructs are not compositional (an
   * unclosed fence that is no longer last swallows what follows). Throws
   * `UnverifiedSerializationError` on mismatch, same as a per-block
   * verification failure; the `candidate` field carries the full `out`
   * text the caller can still use to count this as a violation rather than
   * abort. Fixing such violations is a finding, not a precondition here.
   */
  wholeDocCheck?: boolean;
}

/** Reads the live/forked doc's PM view WITHOUT decoding leaf marks, so it lines
 * up with `encodeLeafMarks(newDoc)` for an apples-to-apples structural diff
 * against Y's actual on-the-wire encoding (inline leaves carry their marks
 * in the meta `leafMarks` attr, not as real PM marks, until decoded). */
function currentEncoded(ydoc: Y.Doc): PMNode {
  const meta = ydoc.getMap(META_MAP_NAME);
  const root = yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment(FRAGMENT_NAME), schema);
  return schema.node('doc', { lead: meta.get('lead') ?? '', eol: meta.get('eol') ?? '\n' }, root.content);
}

function nodeChildren(node: PMNode): PMNode[] {
  const out: PMNode[] = [];
  node.forEach((c) => out.push(c));
  return out;
}

export class DocSync {
  readonly doc: Y.Doc;
  private readonly ring = new VersionRing();

  constructor(doc: Y.Doc = new Y.Doc({ gc: false })) {
    if (doc.gc) {
      throw new Error('DocSync requires a Y.Doc created with { gc: false } (forks need tombstones)');
    }
    this.doc = doc;
  }

  get versions(): readonly Version[] {
    return this.ring.all();
  }

  get authors(): Record<string, AuthorRecord> {
    const out: Record<string, AuthorRecord> = {};
    this.doc.getMap(AUTHORS_MAP_NAME).forEach((v, k) => {
      out[k] = v as AuthorRecord;
    });
    return out;
  }

  /** Seed an empty doc from text: the fresh-save special case's starting point. */
  adopt(text: string): Version {
    const parsed = parseMarkdown(text);
    docToYDoc(parsed.doc, this.doc);
    const snapshot = Y.snapshot(this.doc);
    return this.ring.push({ text, hash: hashText(text), snapshot, origin: 'adopt', at: Date.now() });
  }

  /**
   * Put a persisted version back into the ring after a restart, as an anchor
   * (origin `restore`): the file side certainly had it. Without this the ring
   * is empty after a restart and the next save has no base candidates.
   */
  restore(v: Pick<Version, 'text' | 'snapshot'>): Version {
    return this.ring.push({ text: v.text, hash: hashText(v.text), snapshot: v.snapshot, origin: 'restore', at: Date.now() });
  }

  /** The base candidates of the next save (plan 3.2): what a restart must persist. */
  candidates(): Version[] {
    return this.ring.candidates();
  }

  /**
   * Put persisted candidates back after a restart, oldest first, keeping their
   * origins so the anchor stays the anchor. Persisting only the latest version
   * was not enough: an editor holding an older buffer then had its save diffed
   * against a newer base, which deleted the remote edits in between (gate I
   * fuzz, seed 439041105).
   */
  restoreVersions(list: ReadonlyArray<Pick<Version, 'text' | 'snapshot' | 'origin' | 'at'>>): Version[] {
    return list.map((v) => this.ring.push({ text: v.text, hash: hashText(v.text), snapshot: v.snapshot, origin: v.origin, at: v.at }));
  }

  /** Record a `write` version: the file side certainly has this text, snapshot taken at render time. */
  recordWrite(text: string): Version {
    const snapshot = Y.snapshot(this.doc);
    return this.ring.push({ text, hash: hashText(text), snapshot, origin: 'write', at: Date.now() });
  }

  /**
   * What the daemon writes (orchestrator addition after the gate I fuzz).
   * Never throws for content reasons:
   *
   * - A block no serialization verifies for (spike 1's refusal) is written as
   *   the serializer's best effort and listed in `degraded`. Refusing froze the
   *   file for good once, for example, a remote peer deleted the definition a
   *   reference link used (fuzz seeds 439041107, 439041115). The best effort
   *   keeps all text; it can lose markup in that block.
   * - Block serialization is verified per block in isolation, which is not
   *   compositional: a block that was last keeps its end-of-file gap (one line
   *   break) when a block is appended after it, and the two paragraphs merge
   *   (seed 439041129); an unclosed fence swallows what follows. A cheap check
   *   compares the number of top-level blocks the output parses to; on a
   *   mismatch, the first differing boundary is repaired by giving the block
   *   before it a blank-line gap, then by dropping that block's `src` so it is
   *   re-serialized (which closes a fence), up to 8 times.
   */
  renderDetailed(): { text: string; degraded: number[]; boundaryRepairs: number; composed: boolean } {
    let doc = yDocToDoc(this.doc);
    const degraded: number[] = [];
    const serialize = (d: PMNode) => {
      degraded.length = 0;
      let index = -1;
      return serializeDoc(d, {
        onUnverified: 'emit',
        trace: (info) => {
          index++;
          if (info.kind === 'unverified') degraded.push(index);
        },
      });
    };
    let out = serialize(doc);
    let boundaryRepairs = 0;
    const blankGap = doc.attrs.eol === '\r\n' ? '\r\n\r\n' : '\n\n';
    const tried = new Set<string>();
    while (parseMdast(out).children.length !== doc.childCount && boundaryRepairs < 8) {
      const reparsed = parseMarkdown(out).doc;
      let i = 0;
      while (i < doc.childCount && i < reparsed.childCount && semanticEq(doc.child(i), reparsed.child(i))) i++;
      // Block i is the first that re-parses differently: either it swallowed
      // what follows (fix its own gap or source) or it was swallowed by the
      // block before (fix that one's). Try the cheapest change first.
      let at = -1;
      let replacement: PMNode | undefined;
      for (const [kind, k] of [
        ['gap', i],
        ['gap', i - 1],
        ['src', i - 1],
        ['src', i],
      ] as const) {
        if (k < 0 || k >= doc.childCount || tried.has(`${kind}:${k}`)) continue;
        const node = doc.child(k);
        tried.add(`${kind}:${k}`);
        if (kind === 'gap' && k < doc.childCount - 1 && !/\r?\n[ \t]*\r?\n/.test((node.attrs.gap as string | null) ?? '')) {
          replacement = node.type.create({ ...node.attrs, gap: blankGap }, node.content, node.marks);
        } else if (kind === 'src' && node.attrs.src != null) {
          replacement = node.type.create({ ...node.attrs, src: null }, node.content, node.marks);
        } else {
          continue;
        }
        at = k;
        break;
      }
      if (!replacement) break;
      const children: PMNode[] = [];
      doc.forEach((c, _o, idx) => children.push(idx === at ? replacement : c));
      doc = doc.type.create(doc.attrs, children, doc.marks);
      out = serialize(doc);
      boundaryRepairs++;
    }
    const composed = parseMdast(out).children.length === doc.childCount;
    return { text: out, degraded: [...degraded], boundaryRepairs, composed };
  }

  /** `render()` per plan 3.5: `serializeDoc(yDocToDoc(live))`. */
  render(opts: RenderOptions = {}): string {
    const doc = yDocToDoc(this.doc);
    let out: string;
    try {
      out = serializeDoc(doc);
    } catch (err) {
      if (process.env.PHRAISE_DEBUG && err instanceof UnverifiedSerializationError && err.blockIndex >= 0) {
        console.error(`UNVERIFIED-BLOCK ${JSON.stringify(doc.child(err.blockIndex).toJSON())}`);
      }
      throw err;
    }
    if (opts.wholeDocCheck) {
      const reparsed = parseMarkdown(out).doc;
      if (!semanticEq(doc, reparsed)) {
        throw new UnverifiedSerializationError(-1, 'doc', out);
      }
    }
    return out;
  }

  /** `importText` per plan 3.3. */
  importText(text: string, opts: ImportOptions): ImportResult {
    const candidates = this.ring.candidates();
    const base = opts.base ?? chooseBase(text, candidates).base;
    const cost = diffCost(base.text, text);
    if (cost === 0) {
      return { kind: 'noop', base, cost };
    }

    const parsed = parseMarkdown(text);
    const newDocEncoded = encodeLeafMarks(parsed.doc);

    const liveSnapshot = Y.snapshot(this.doc);
    const forked = !Y.equalSnapshots(liveSnapshot, base.snapshot);

    let target: Y.Doc;
    let clientId: number;
    let svBeforeDiff: Uint8Array | undefined;

    if (forked) {
      target = Y.createDocFromSnapshot(this.doc, base.snapshot, new Y.Doc({ gc: false }));
      clientId = Math.floor(Math.random() * 0xffffffff);
      target.clientID = clientId;
      svBeforeDiff = Y.encodeStateVector(target);
      if (process.env.PHRAISE_DEBUG) (target as any).__toksBefore = new Set(target.getXmlFragment(FRAGMENT_NAME).toString().match(/ZZTOK\w+/g) ?? []);
    } else {
      target = this.doc;
      clientId = this.doc.clientID;
    }

    let counters!: DiffCounters;
    target.transact(() => {
      // Only write map entries that change, so a save that touches one block
      // produces operations only inside that block (gate B).
      const authors = target.getMap(AUTHORS_MAP_NAME);
      const known = authors.get(String(clientId)) as AuthorRecord | undefined;
      if (!known || known.name !== opts.author.name || known.kind !== opts.author.kind) {
        authors.set(String(clientId), { name: opts.author.name, kind: opts.author.kind, at: Date.now() });
      }

      const meta = target.getMap(META_MAP_NAME);
      const lead = newDocEncoded.attrs.lead ?? '';
      const eol = newDocEncoded.attrs.eol ?? '\n';
      if (meta.get('lead') !== lead) meta.set('lead', lead);
      if (meta.get('eol') !== eol) meta.set('eol', eol);

      const fragment = target.getXmlFragment(FRAGMENT_NAME);
      const aChildren = nodeChildren(currentEncoded(target));
      const bChildren = nodeChildren(newDocEncoded);
      counters = applyDiff(fragment, aChildren, bChildren);
      if (process.env.PHRAISE_DEBUG) console.error(`    applyDiff: ${JSON.stringify(counters)}`);
    }, ORIGIN_IMPORT);

    // Verify: JSON of yDocToDoc(target) equals JSON of newDoc, meta attrs
    // included (stricter than semanticEq, which ignores meta attrs -- this
    // check is specifically meant to catch attr-sync bugs the diff might
    // have introduced).
    const resultDoc = yDocToDoc(target);
    let repaired = false;
    if (JSON.stringify(resultDoc.toJSON()) !== JSON.stringify(parsed.doc.toJSON())) {
      repaired = true;
      target.transact(() => {
        const fragment = target.getXmlFragment(FRAGMENT_NAME);
        updateYFragment(target, fragment, newDocEncoded, { mapping: new Map(), isOMark: new Map() } as any);
      }, ORIGIN_IMPORT);
    }

    if (forked) {
      const update = Y.encodeStateAsUpdate(target, svBeforeDiff!);
      const toks = (d: Y.Doc) => new Set(d.getXmlFragment(FRAGMENT_NAME).toString().match(/ZZTOK\w+/g) ?? []);
      const before = process.env.PHRAISE_DEBUG ? toks(this.doc) : undefined;
      Y.applyUpdate(this.doc, update, ORIGIN_IMPORT);
      if (before) {
        const after = toks(this.doc);
        const gone = [...before].filter((t) => !after.has(t));
        if (gone.length) {
          // Find the (now deleted) items holding each vanished token's text.
          const found: string[] = [];
          const walk = (t: any, path: string) => {
            if (t instanceof Y.XmlText) {
              const items: any[] = [];
              for (let it = (t as any)._start; it; it = it.right) items.push(it);
              const all = items.map((it) => (typeof it.content?.str === 'string' ? it.content.str : '')).join('');
              for (const g of gone) {
                const at = all.indexOf(g.slice(5, 12));
                if (at < 0) continue;
                let pos = 0;
                const parts: string[] = [];
                for (const it of items) {
                  const str = typeof it.content?.str === 'string' ? it.content.str : '';
                  if (pos + str.length > at - 8 && pos < at + g.length) parts.push(`${it.id.client}:${it.id.clock}+${it.length}${it.deleted ? 'D' : ''}=${JSON.stringify(str)}`);
                  pos += str.length;
                }
                found.push(`${g} in ${path} (text deleted=${(t as any)._item?.deleted}): ${parts.join(' ')}`);
              }
            } else if (t) {
              let k = 0;
              for (let it = t._start; it; it = it.right, k++) {
                const ty = (it.content as any)?.type;
                if (ty) walk(ty, `${path}/${k}${it.deleted ? 'D' : ''}`);
              }
            }
          };
          walk(this.doc.getXmlFragment(FRAGMENT_NAME), '');
          const dec = Y.decodeUpdate(update);
          const ds: string[] = [];
          dec.ds.clients.forEach((ranges: any[], client: number) => ranges.forEach((r) => ds.push(`${client}:${r.clock}+${r.len}`)));
          console.error(`    ITEMS ${found.join(' || ')}`);
          console.error(`    UPDATE-DS ${ds.join(' ')} forkClient=${target.clientID} base=${base.origin}`);
          console.error(`    BASE-SV ${JSON.stringify([...base.snapshot.sv.entries()])}`);
        }
        if (gone.length) console.error(`    MERGE REMOVED ${gone.join(' ')}; fork had them before diff: ${gone.map((t) => (target as any).__toksBefore?.has(t))}; saved text has them: ${gone.map((t) => text.includes(t))}`);
      }
    }

    const snapshot = Y.snapshot(target);
    const version = this.ring.push({ text, hash: hashText(text), snapshot, origin: 'import', at: Date.now() });

    return { kind: 'ok', base, cost, forked, repaired, counters, version };
  }
}
