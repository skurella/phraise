# Stack 14 gate results

Generated 2026-09-27T13:18:20.452Z. Full run.

| Gate | Result | Numbers |
|---|---|---|
| A. Relay (custom / Hocuspocus) | PASS | custom: 23.2ms median; Hocuspocus: 22.8ms median -- no material difference (same jsdom-polling-interval caveat applies to both) |
| B. Schema fidelity (Hocuspocus) | PASS | editor1 = editor2 = relay; every linked image kept its mark; update count stable at 19; matches brief 02's custom-relay result (also PASS) |
| C. Corpus round trip (no workaround needed) | FAIL | path A (server-seeded): 266/266; path B (client-loaded): 234/266; 238.1s; encoded state (path A, summed): 18.74MB (task 6: matches brief 02's custom-relay figure of 18.70MB, confirmed) (spike 1's plain-y-prosemirror A3: 160/294; stack 13's gate C: 265/266 path A, 266/266 path B) |
| B3. Inline atom link edits | FAIL | 3. whole-document replace (url + href change): editor1=https://old.example editor2=https://old.example -- FAIL, expected per the brief: new url landed but the OLD mark/href was kept; 4. replace one image node (url + link differ): editor1=https://old.example editor2=https://old.example -- FAIL, expected per the brief: new url landed but the OLD mark/href was kept -- cases 3-4 are a known upstream @y/prosemirror mark-vs-attr co-change bug (see this file's header), not this spike's schema/binding code; cases 0-2 pass |
| D. Tiptap (custom extensions, no Tiptap collab package works with Yjs 14) | PASS | OK: Dedupe: exactly one resolved version of prosemirror-model and prosemirror-state; OK: Schema: Tiptap-generated schema equivalent to src/schema.ts; OK: Tiptap 3.31.3 has no Yjs-14-compatible collaboration package (checked npm); OK: Gate B's script run through two Tiptap editors: converge (editor1 = editor2 = relay); OK: Caret: awareness state present for both users; OK: Caret: each editor renders the other's caret decoration in the DOM; OK: Undo: alice's undo removes only her own change |
| E. Attribution (IdMap) + suggestion mode | PASS | OK: Listing: seed + alice + bob ranges walked from Yjs items (IdMap); OK: Collision: forged client ID flagged, not overwritten; OK: Reconnect: same Y.Doc + same clientID, ranges accumulate under it; OK: Reload: new Y.Doc + new clientID mapped to the same user, no conflict; OK: Restart: attribution IdMap survives a relay restart (same persistence as the document); overhead 10.7KB (207.8%) of 5.1KB; suggestion mode: OK: Alice's view of the suggestion doc shows y-attributed-* marks with bob as author; OK: Reject restores the suggested delete; accept keeps the suggested insert as real content; OK: Accepted insert reaches the live document; unresolved link suggestion stays pending (does not); OK: Serialization leak check: can a doc with a pending suggestion be serialized as-is? |
| G. Persistence and reconnect | PASS | OK: G1. Restart (SIGTERM): both providers reconnect, content intact, new edit propagates; OK: G2. Hard kill (SIGKILL) before the store debounce; OK: G2. Hard kill (SIGKILL) after the store debounce; OK: G3. Edits made while the relay is down converge once it restarts; OK: G4. Offline editor reconnects and converges |
| F. Rebase port (fork-at-snapshot, live) | PASS | OK: Rebase applied while alice online, bob offline; OK: Convergence: alice, bob and the relay have identical ProseMirror JSON; OK: Convergence: alice, bob and the relay have identical review state; OK: A: untouched-paragraph comment resolves via crdt on alice, bob and the relay; OK: B: rewritten-paragraph comment survives (anchor or quote) on alice, bob and the relay; OK: C: deleted-paragraph comment orphans, quote kept, negative control (harbor) not captured; OK: D: P and Q flagged concurrent-edit; offline (bob) and online (alice) upstream-conflicting text both survive; no unexpected flags; OK: D2: P2 (deleted upstream, edited offline by bob) resurrected exactly once, flagged, converged; OK: Every block nobody touched equals commit B, on alice, bob and the relay; OK: A retried rebase changes nothing; OK: Variant: alice types continuously while the rebase is applied; still converges |
| H. Maturity (Yjs 13/14 compatibility probe) | not run | see README / log: separate compat/ subpackage, brief 02 task 6 -- the orchestrator writes the fuller maturity account |

## Gate C failures

- `npm-axios-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-base64-js-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-bcryptjs-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-canvas-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-cesium-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-commitlint-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-compression-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-cors-readme.md`: pathA=true, pathB=false (serializeDoc: block 1 (paragraph) has no serialization that re-parses to the edited block)
- `npm-eventemitter3-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-express-validator-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-fastify-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-gatsby-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-graphql-request-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-hexo-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-karma-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-ky-readme.md`: pathA=true, pathB=false (serializeDoc: block 2 (paragraph) has no serialization that re-parses to the edited block)
- `npm-minimist-readme.md`: pathA=true, pathB=false (serializeDoc: block 1 (paragraph) has no serialization that re-parses to the edited block)
- `npm-mobx-readme.md`: pathA=true, pathB=false (serializeDoc: block 3 (paragraph) has no serialization that re-parses to the edited block)
- `npm-mqtt-readme.md`: pathA=true, pathB=false (serializeDoc: block 0 (heading) has no serialization that re-parses to the edited block)
- `npm-multer-readme.md`: pathA=true, pathB=false (serializeDoc: block 0 (heading) has no serialization that re-parses to the edited block)
- `npm-nanoclone-readme.md`: pathA=true, pathB=false (serializeDoc: block 1 (paragraph) has no serialization that re-parses to the edited block)
- `npm-nock-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-node-cron-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-nodemailer-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-nodemon-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-nunjucks-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-oclif-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-pino-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-recharts-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-sequelize-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-ts-node-readme.md`: pathA=true, pathB=false (byte mismatch (path B: editor 2))
- `npm-url-parse-readme.md`: pathA=true, pathB=false (serializeDoc: block 1 (paragraph) has no serialization that re-parses to the edited block)
