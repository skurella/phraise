# Stack 14 gate results

Generated 2026-09-27T09:34:28.390Z. Quick run (gate C sampled at 5 files; short D/E/G).

| Gate | Result | Numbers |
|---|---|---|
| A. Relay (custom / Hocuspocus) | PASS | custom: 23.1ms median; Hocuspocus: 22.7ms median -- no material difference (same jsdom-polling-interval caveat applies to both) |
| B. Schema fidelity (Hocuspocus) | PASS | editor1 = editor2 = relay; every linked image kept its mark; update count stable at 19; matches brief 02's custom-relay result (also PASS) |
| C. Corpus round trip (no workaround needed) | PASS | path A (server-seeded): 5/5; path B (client-loaded): 5/5; 1.2s; encoded state (path A, summed): 367.1KB (spike 1's plain-y-prosemirror A3: 160/294; stack 13's gate C: 265/266 path A, 266/266 path B) |
| B3. Inline atom link edits | FAIL | 3. whole-document replace (url + href change): editor1=https://old.example editor2=https://old.example -- FAIL, expected per the brief: new url landed but the OLD mark/href was kept; 4. replace one image node (url + link differ): editor1=https://old.example editor2=https://old.example -- FAIL, expected per the brief: new url landed but the OLD mark/href was kept -- cases 3-4 are a known upstream @y/prosemirror mark-vs-attr co-change bug (see this file's header), not this spike's schema/binding code; cases 0-2 pass |
| D. Tiptap (custom extensions, no Tiptap collab package works with Yjs 14) | PASS | OK: Dedupe: exactly one resolved version of prosemirror-model and prosemirror-state; OK: Schema: Tiptap-generated schema equivalent to src/schema.ts; OK: Tiptap 3.31.3 has no Yjs-14-compatible collaboration package (checked npm); OK: Gate B's script run through two Tiptap editors: converge (editor1 = editor2 = relay) |
| E. Attribution (IdMap) + suggestion mode | PASS | OK: Listing: seed + alice + bob ranges walked from Yjs items (IdMap); OK: Collision: forged client ID flagged, not overwritten; suggestion mode: OK: Alice's view of the suggestion doc shows y-attributed-* marks with bob as author; OK: Reject restores the suggested delete; accept keeps the suggested insert as real content; OK: Accepted insert reaches the live document; unresolved link suggestion stays pending (does not); OK: Serialization leak check: can a doc with a pending suggestion be serialized as-is? |
| G. Persistence and reconnect | PASS | OK: G1. Restart (SIGTERM): both providers reconnect, content intact, new edit propagates |
| F. (later brief) | not run | - |
| H. Maturity (Yjs 13/14 compatibility probe) | not run | see README / log: separate compat/ subpackage, brief 02 task 6 -- the orchestrator writes the fuller maturity account |

## Gate C failures

None.
