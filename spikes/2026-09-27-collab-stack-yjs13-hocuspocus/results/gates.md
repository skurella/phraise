# Stack 13 gate results

Generated 2026-09-27T13:22:26.906Z. Full run.

| Gate | Result | Numbers |
|---|---|---|
| A. Relay | PASS | median round-trip latency (20 single-char edits): 22.6ms |
| B. Schema fidelity (with workarounds) | PASS | editor1 = editor2 = relay; every linked image kept its mark |
| B2. Negative control (plain:, must show the loss) | PASS | loss confirmed: icon.png's locally-added link mark was silently reverted by a later remote sync; pasted.png's link mark (from the paste) was silently reverted by a later remote sync |
| C. Workaround cost (corpus round trip) | PASS | path A (server-seeded): 266/266; path B (client-loaded): 266/266; 222.9s; encoded state (path A, summed): 17.21MB (spike 1's plain-y-prosemirror A3: 160/294; stack 14's same measure: 18.70MB) |
| B3. Inline atom link edits | PASS | all five cases showed the new value in both editors |
| D. Tiptap | PASS | OK: Dedupe: exactly one resolved version of prosemirror-model and prosemirror-state; OK: Schema: Tiptap-generated schema equivalent to src/schema.ts (17 nodes, 5 marks); OK: Gate B's script run through two Tiptap editors: converge (editor1 = editor2 = relay); OK: Caret: awareness state present for both users; OK: Caret: each editor renders the other's caret decoration in the DOM; OK: Undo: alice's undo removes only her own change |
| E. Attribution | PASS | OK: Listing: seed + alice + bob ranges walked from Yjs items; OK: Collision: forged client ID flagged, not overwritten; OK: Reconnect: same Y.Doc + same clientID, ranges accumulate under it; OK: Reload: new Y.Doc + new clientID mapped to the same user, no conflict; OK: Restart: attribution Y.Map survives a relay restart (same persistence as the document); overhead 11.2KB (257.3%) of 4.3KB |
| G. Persistence and reconnect | PASS | OK: G1. Restart (SIGTERM): both providers reconnect, content intact, new edit propagates; OK: G2. Hard kill (SIGKILL) before the store debounce; OK: G2. Hard kill (SIGKILL) after the store debounce; OK: G3. Edits made while the relay is down converge once it restarts; OK: G4. Offline editor reconnects and converges |
| F. Rebase port (live editors) | PASS | OK: Rebase applied while alice online, bob offline; OK: Convergence: alice, bob and the relay have identical ProseMirror JSON; OK: Convergence: alice, bob and the relay have identical review maps; OK: A: untouched-paragraph comment resolves via crdt on alice, bob and the relay; OK: B: rewritten-paragraph comment survives (anchor or quote) on alice, bob and the relay; OK: C: deleted-paragraph comment orphans, quote kept, negative control (harbor) not captured; OK: D: P and Q flagged concurrent-edit; offline (bob) and online (alice) upstream-conflicting text both survive; no unexpected flags; OK: D2: P2 (deleted upstream, edited offline by bob) resurrected exactly once, flagged, converged; OK: Every block nobody touched equals commit B, on alice, bob and the relay; OK: A retried rebase changes nothing |
| F (variant). Continuous typing during rebase | PASS | typingDone=true rebaseApplied=true converged=true intactRunOf40Xs=true |
| H. (orchestrator, primary sources) | not run | - |

## Gate C failures

None.
