# Stack 13 gate results

Generated 2026-09-27T06:52:50.024Z. Full run.

| Gate | Result | Numbers |
|---|---|---|
| A. Relay | PASS | median round-trip latency (20 single-char edits): 23.3ms |
| B. Schema fidelity (with workarounds) | PASS | editor1 = editor2 = relay; every linked image kept its mark |
| B2. Negative control (plain:, must show the loss) | PASS | loss confirmed: icon.png's locally-added link mark was silently reverted by a later remote sync; pasted.png's link mark (from the paste) was silently reverted by a later remote sync |
| C. Workaround cost (corpus round trip) | FAIL | path A (server-seeded): 265/266; path B (client-loaded): 266/266; 61.1s (spike 1's plain-y-prosemirror A3: 160/294) |
| D. (later brief) | not run | - |
| E. (later brief) | not run | - |
| F. (later brief) | not run | - |
| G. (later brief) | not run | - |
| H. (later brief) | not run | - |

## Gate C failures

- `npm-bull-readme.md`: pathA=false (byte mismatch (path A: server-seeded)), pathB=true
