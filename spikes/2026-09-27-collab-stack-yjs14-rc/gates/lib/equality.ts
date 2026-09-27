// The plan's equality check, common to gates A/B/C: "ProseMirror JSON of
// the whole doc including doc.attrs and marks on every inline leaf; plus
// serializeDoc of both sides succeeds and is byte-identical."
//
// Unlike stack 13's gates/lib/equality.ts, there is no codec/no-codec
// distinction here: stack 14 has no workaround plugins and no `plain:`
// negative control (see the brief and src/yjs.ts's header) -- the relay's
// raw stored state is decoded the same way every time, via
// `ynodeToPmnode`.
import * as Y from '@y/y';
import { ynodeToPmnode } from '@y/prosemirror';
import { Node as PMNode } from 'prosemirror-model';
import { schema } from '../../src/schema.js';
import { semanticEq } from '../../src/compare.js';
import { serializeDoc } from '../../src/serialize.js';
import { FRAGMENT_NAME } from '../../src/yjs.js';

/** Decode the relay's raw Yjs state bytes (from GET /state/<docName>) into a comparable PM doc. */
export function decodeRelayState(bytes: Uint8Array): PMNode {
  const scratch = new Y.Doc();
  if (bytes.length > 0) Y.applyUpdate(scratch, bytes);
  const ytype = scratch.get(FRAGMENT_NAME);
  return ynodeToPmnode(ytype, schema) as unknown as PMNode;
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
