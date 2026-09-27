# Stack 13 gate results

Generated 2026-09-27T10:36:18.700Z. Quick run (gate C sampled at 5 files).

| Gate | Result | Numbers |
|---|---|---|
| A. Relay | PASS | median round-trip latency (20 single-char edits): 22.3ms |
| B. Schema fidelity (with workarounds) | PASS | editor1 = editor2 = relay; every linked image kept its mark |
| B2. Negative control (plain:, must show the loss) | PASS | loss confirmed: icon.png's locally-added link mark was silently reverted by a later remote sync; pasted.png's link mark (from the paste) was silently reverted by a later remote sync |
| C. Workaround cost (corpus round trip) | PASS | path A (server-seeded): 5/5; path B (client-loaded): 5/5; 1.2s; encoded state (path A, summed): 342.1KB (spike 1's plain-y-prosemirror A3: 160/294; stack 14's same measure: 18.70MB) |
| B3. Inline atom link edits | PASS | all five cases showed the new value in both editors |
| D. Tiptap | PASS | OK: Dedupe: exactly one resolved version of prosemirror-model and prosemirror-state; OK: Schema: Tiptap-generated schema equivalent to src/schema.ts (17 nodes, 5 marks); OK: Gate B's script run through two Tiptap editors: converge (editor1 = editor2 = relay) |
| E. Attribution | PASS | OK: Listing: seed + alice + bob ranges walked from Yjs items; OK: Collision: forged client ID flagged, not overwritten |
| G. Persistence and reconnect | PASS | OK: G1. Restart (SIGTERM): both providers reconnect, content intact, new edit propagates |
| F. Rebase port (live editors) | PASS | OK: Rebase applied while alice online, bob offline; OK: Convergence: alice, bob and the relay have identical ProseMirror JSON; OK: Convergence: alice, bob and the relay have identical review maps; OK: A: untouched-paragraph comment resolves via crdt on alice, bob and the relay; OK: B: rewritten-paragraph comment survives (anchor or quote) on alice, bob and the relay; OK: C: deleted-paragraph comment orphans, quote kept, negative control (harbor) not captured; OK: D: P and Q flagged concurrent-edit; offline (bob) and online (alice) upstream-conflicting text both survive; no unexpected flags; OK: D2: P2 (deleted upstream, edited offline by bob) resurrected exactly once, flagged, converged; OK: Every block nobody touched equals commit B, on alice, bob and the relay; OK: A retried rebase changes nothing |
| F (variant). Continuous typing during rebase | PASS | typingDone=true rebaseApplied=true converged=true intactRunOf40Xs=true |
| H. (orchestrator, primary sources) | not run | - |

## Gate C failures

None.
