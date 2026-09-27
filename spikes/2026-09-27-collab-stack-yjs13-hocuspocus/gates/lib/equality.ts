// The plan's equality check, common to gates A/B/C: "ProseMirror JSON of
// the whole doc including doc.attrs and marks on every inline leaf; plus
// serializeDoc of both sides succeeds and is byte-identical."
//
// semanticEq (src/compare.ts) already ignores only meta attrs (src, gap,
// refType, leafMarks, *Hint) -- doc.attrs (lead/eol) and marks on every
// node, including inline leaves, are real semantic attrs it does compare.
import * as Y from 'yjs';
import { Node as PMNode } from 'prosemirror-model';
import { yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap';
import { schema } from '../../src/schema.js';
import { semanticEq } from '../../src/compare.js';
import { serializeDoc } from '../../src/serialize.js';
import { yDocToDoc, FRAGMENT_NAME } from '../../src/yjs.js';

/**
 * Decode the relay's raw Yjs state bytes (from GET /state/<docName>) into a
 * comparable PM doc.
 *
 * `codec: true` (the `file:` documents) mirrors yjs.ts's own read path:
 * root attrs from the phraise-doc Y.Map, leaf marks restored from the
 * leafMarks node attr (which the live workaround plugins keep in sync, so
 * this reads back exactly what the editors would render).
 *
 * `codec: false` (the `plain:` negative control) reads the bare
 * y-tiptap/y-prosemirror fragment with no side channel at all -- root
 * attrs default, leaf marks absent -- which is the point: it must show the
 * same loss spike 1's gate A3 measured.
 */
export function decodeRelayState(bytes: Uint8Array, opts: { codec: boolean }): PMNode {
  const scratch = new Y.Doc();
  if (bytes.length > 0) Y.applyUpdate(scratch, bytes);
  if (opts.codec) return yDocToDoc(scratch);
  return yXmlFragmentToProseMirrorRootNode(scratch.getXmlFragment(FRAGMENT_NAME), schema);
}

export interface EqualityResult {
  equal: boolean;
  reasons: string[];
  serializedEditor1?: string;
  serializedRelay?: string;
}

export interface EqualityInputs {
  editor1: PMNode;
  editor2: PMNode;
  relay: PMNode;
}

export function checkEquality({ editor1, editor2, relay }: EqualityInputs): EqualityResult {
  const reasons: string[] = [];

  if (!semanticEq(editor1, editor2)) reasons.push('editor1 and editor2 are not semantically equal');
  if (!semanticEq(editor1, relay)) reasons.push('editor1 and the relay-stored document are not semantically equal');

  let serializedEditor1: string | undefined;
  let serializedRelay: string | undefined;
  try {
    serializedEditor1 = serializeDoc(editor1);
  } catch (e) {
    reasons.push(`serializeDoc(editor1) failed: ${(e as Error).message}`);
  }
  try {
    serializedRelay = serializeDoc(relay);
  } catch (e) {
    reasons.push(`serializeDoc(relay) failed: ${(e as Error).message}`);
  }
  if (serializedEditor1 !== undefined && serializedRelay !== undefined && serializedEditor1 !== serializedRelay) {
    reasons.push('serializeDoc(editor1) !== serializeDoc(relay)');
  }

  return { equal: reasons.length === 0, reasons, serializedEditor1, serializedRelay };
}

/** List every linked image (an `image` node carrying a `link` mark) in `doc`. */
export function linkedImages(doc: PMNode): { url: string; href: string }[] {
  const out: { url: string; href: string }[] = [];
  doc.descendants((node) => {
    if (node.type.name !== 'image') return;
    const link = node.marks.find((m) => m.type.name === 'link');
    if (link) out.push({ url: node.attrs.url, href: link.attrs.href });
  });
  return out;
}
