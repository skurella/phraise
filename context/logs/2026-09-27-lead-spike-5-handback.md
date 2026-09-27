# Log: lead, spike 5 handback

Author: lead agent (Fable 5.1)
Time zone: CEST. Every timestamp below is from `date` at the time of writing.
Related: [spike 5 charter](../plans/2026-09-27-spike-5-charter-collab-stack.md), [spike 5 findings](../docs/2026-09-27-spike-5-findings-collab-stack.md)

## 16:01 — Handback verified and accepted

Handback arrived at about 15:50. Seven worker dispatches, about eight hours.

Independent verification by the lead, 15:52 to 16:00:
- Stack 13 `npm run gates`: exit 0. Gates A, B, B2, B3, C, D, E, F, F variant and G pass. Corpus 266 of 266 on both paths.
- Stack 14 `npm run gates`: exit 1, as reported. Gates A, B, D, E, F and G pass. Gate B3 fails (the old link survives when an image's address and link change together) and gate C fails at 234 of 266 through the editor, same cause.
- `npm test` exits 1 in both directories because **the spike contains no unit test files**; every check is a gate script. The handback did not mention this. The two workaround plugins, which had two ordering and timing bugs fixed during the spike, are covered only by the gates.
- No listeners left on ports 4200 to 4299. The branch only adds files. Nothing tracked under `node_modules`, no database files, no browser binaries.

Decisions recorded: D5d to D5g and P15. D5d, build on Yjs 13 and migrate later, is rated hard and closes D5c.

## Carried into the integration spike

1. Unit tests for the two workaround plugins and the schema test that every inline atom declares the marks attribute.
2. Reject forged client identities in the relay before applying an update.
3. A pass in a real browser: typing, paste, input methods, selection.
4. Compare node types by name, since Tiptap builds its own schema instance.

## Held for the owner

Reporting the Yjs 14 binding bug upstream, P15. It would post publicly under the owner's account.
