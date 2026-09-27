# Log: builder, spike 5, brief 01 (stack 13 core)

Status: done (handback)
Author: builder (Sonnet 5)
Updated: 2026-09-27
Plan: [spike 5 plan](../plans/2026-09-27-spike-5-plan.md)
Brief: [brief 01](../plans/2026-09-27-spike-5-brief-01-stack13-core.md)

Local timezone: CEST (machine local time; confirmed via `date` at session start: `Sun Sep 27 07:55:28 CEST 2026`).

## 07:55 — task received
Read AGENTS.md, brief 01, plan, charter. Starting scaffold in spikes/2026-09-27-collab-stack-yjs13-hocuspocus/.

## 08:20 — tasks 2-4 done: relay, live client, workarounds
- src/relay.ts: Hocuspocus 4.7 Server bound to 127.0.0.1, SQLite persistence
  (@hocuspocus/extension-sqlite), a custom "phraise-seed" extension whose
  onLoadDocument runs after SQLite's (extension array order; confirmed by
  reading @hocuspocus/server's hooks() -- extensions chain sequentially over
  the same payload/document) and seeds file:<relpath> via docToYDoc (codec)
  or plain:<relpath> via bare prosemirrorToYXmlFragment (negative control)
  only when document.isEmpty(FRAGMENT_NAME). onAuthenticate stores the token
  as context.user. GET /state/<docName> on the same port returns
  Y.encodeStateAsUpdate; since Hocuspocus's requestHandler always writes its
  own 200 after onRequest resolves (and throwing there risks an unhandled
  rejection since the http listener doesn't await it), the hook instead
  writes+ends the real response then monkey-patches response.writeHead/end
  to no-ops so the framework's own follow-up write is harmless.
- src/harness.ts: startRelay()/stopRelay(), spawns
  `node --import tsx/esm src/relay.ts ...` directly (NOT the tsx CLI
  bin/cli.mjs, which re-execs a second node process internally --
  confirmed with lsof: killing the CLI's own pid left the real relay
  process listening). Process-exit/SIGINT/SIGTERM/uncaughtException hooks
  kill every live relay.
- src/client.ts: createLiveClient() -- Y.Doc + HocuspocusProviderWebsocket
  (ws polyfill) + HocuspocusProvider + ProseMirror EditorView under jsdom
  with ySyncPlugin (@tiptap/y-tiptap) + optional workaround plugins.
  Two bugs found and fixed by reading node_modules source directly:
  (1) passing an explicit websocketProvider (needed for WebSocketPolyfill)
  leaves HocuspocusProvider's manageSocket=false, which skips its own
  attach() call in the constructor -- provider never wires up any
  listeners (no auth, no sync, isSynced stuck false) until attach() is
  called explicitly. (2) createLiveClient must await the provider's first
  sync BEFORE calling initProseMirrorDoc/building the EditorView: a fresh
  Y.Doc has no content until the first server round trip, and
  ySyncPlugin's view() hook only force-rerenders from Y content when no
  mapping was supplied -- passing initProseMirrorDoc's (empty) mapping
  suppresses that rerender, so the editor was left permanently empty.
  Fixed by making createLiveClient async and awaiting sync first.
  Both confirmed via scripts/debug-client.ts against a live relay.
- src/schema.ts: added toDOM/parseDOM to every node and mark (spike 1 never
  rendered a real EditorView). Needed because EditorView threw
  "node.type.spec.toDOM is not a function" as soon as real seeded content
  arrived. Carries no semantic weight (semanticEq never looks at DOM);
  parseDOM only needs to be good enough for view.pasteHTML in gate B.
- scripts/smoke-relay.ts, scripts/smoke-client.ts, scripts/debug-*.ts,
  scripts/dump-doc.ts: manual verification scripts (not part of npm run
  gates). smoke-client.ts confirms: two live clients + relay, root attrs
  workaround restores doc.attrs on both from the seeded phraise-doc Y.Map,
  editor A's typed edit is observed by editor B, relay /state has content.
- Re-verified after schema changes: quick-roundtrip.ts still 294/294;
  fixtures/live.md (front matter, leading blank line, linked badge image,
  a link mixing text+image, inline HTML, footnote, hard break, HTML block,
  nested lists, table, fenced code) round-trips byte-identical and has
  non-default lead + 2 linked images.
- npx tsc --noEmit clean throughout.

## 08:47 — tasks 5-7 in progress: gates A, B, C
Wrote gates/gateA.ts, gates/gateB.ts, gates/gateC.ts, gates/lib/edits.ts
(shared real-transaction helpers: insertText, pasteHTMLAt, splitBlockAt,
joinBackwardAt, addMarkAt, deleteRange, findPos, replaceWholeDoc),
gates/lib/equality.ts (checkEquality/decodeRelayState/linkedImages, reusing
compare.ts's semanticEq and serialize.ts's serializeDoc directly).

Bugs found and fixed while getting gate A working (isolated with
throwaway debug scripts, all since deleted; findings folded into code
comments):
- pasteHTML needs a dummy ClipboardEvent (jsdom has no constructor for
  one); prosemirror-view only forwards it to an unused handlePaste prop.
- **Plugin order bug in the workarounds themselves**: with
  [ySyncPlugin, rootAttrsPlugin, leafMarksPlugin], rootAttrsPlugin's
  view() hook can dispatch a transaction before leafMarksPlugin's own
  view() hook has restored marks; ProseMirror runs every plugin's
  appendTransaction on any dispatch regardless of whether that plugin's
  view() has run yet, so leafMarksPlugin's "local edit" branch fired
  first and overwrote the leafMarks attr with the (still empty) live
  marks, destroying the encoded marks before they were ever read.
  Fixed by reordering to
  [ySyncPlugin, leafMarksPlugin, rootAttrsPlugin] in src/client.ts, with
  the reasoning recorded as a comment there -- this is a genuine,
  reportable cost/constraint of the workaround (plugin registration order
  matters).
- fixtures/live.md's front matter was silently mis-parsed (thematicBreak +
  2 headings, not yaml) because remark-frontmatter requires the `---` at
  byte offset 0; a leading blank line (added for a non-default `lead`)
  broke that. Confirmed with a standalone remark-frontmatter probe.
  Front matter and "leading blank line" are mutually exclusive under this
  parser; dropped front matter from the fixture, kept the leading blank
  line (doc.attrs.lead = '\n'), documented as a fixture deviation.
- Gate B's own script had two self-inflicted bugs: the "delete range
  spanning two blocks" step originally targeted the same paragraph the
  paste step had just extended, so "last few chars" landed inside the
  pasted image and deleted it; and its first target boundary (paragraph
  -> footnote-definition raw_block) hit a genuine spike-1 serializer
  limitation (re-serializing a paragraph merged into an opaque raw_block
  has no splice candidate -- verified this is not data loss: both
  editor1's and the relay's serializeDoc failed identically). Retargeted
  the delete at a boundary between two plain paragraphs; logged the
  raw_block-merge limitation separately rather than working around it
  (it's spike 1's serializer, not this brief's scope).
- The negative control (plain:, no workaround plugins) initially reported
  "no loss detected" because comparing editor1/editor2/relay pairwise
  proves nothing when all three go through the identical lossy path --
  fixed to compare against what the script itself did (badge/logo must
  have started linked and lost it; icon/pasted must have been linked
  right after their own edits and then lost that mark once a remote
  change forced a resync from Yjs content that never carried it).

Gate A: PASS. Two editors converge on each other's typed text; median
round-trip latency over 20 single-char edits ~22ms (this harness polls
every 20ms, so the number is dominated by poll resolution, not real
network latency -- noted in gates.md).

Gate B: PASS with workarounds (editor1/editor2/relay semantically equal,
serializeDoc byte-identical, every linked image -- badge.svg, logo.png,
the newly-linked icon.png, and the pasted-in image -- keeps its link
mark). Negative control (plain:) correctly shows the loss.

Gate C (in progress): server-seeded (path a) and client-loaded (path b)
against the real corpus. 5-file and 50-file samples: 100% both paths.
Full 266-file real corpus: path A 265/266, path B 266/266, ~62s. One
file (npm-bull-readme.md) loses doc.attrs.lead specifically through the
live relay path only. Investigated with three independent methods: (1)
offline docToYDoc+yDocToDoc round trip on this exact parsed doc: correct;
(2) a raw y-protocols/sync two-message simulation (client syncStep1 ->
server reply -> client apply) using the identical seeded Y.Doc: correct;
(3) relay-side debug prints at onLoadDocument, immediately after
docToYDoc, and at afterLoadDocument: all show the correct value
server-side. The client (and the relay's own /state readback) reads the
wrong (default) value regardless. Root cause not isolated within two
genuinely different debugging approaches beyond this (offline codec,
protocol simulation, three server-side checkpoints all clean) --
logging as a real, quantified, unresolved-cause finding per the charter's
"blocker after two genuinely different attempts" rule, rather than
spending further budget chasing one 1/266 case. Numbers (265/266,
266/266) still comfortably beat spike 1's plain-y-prosemirror A3
(160/294) and are reported as-is in results/gates.md.

## 08:53 — task 8 done: gate runner, README, final verification
Wrote scripts/gates.ts (npm run gates / gates:quick), gates/lib/edits.ts,
gates/lib/equality.ts. Wrote spikes/2026-09-27-collab-stack-yjs13-hocuspocus/README.md
(goal, origin, layout, how to run, gate descriptions, workaround costs
table, known limitations).

Final verification from a clean state:
- `npm ci`: clean (256 packages).
- `npm run fetch`: 266 real + 655 commonmark + 672 gfm (already fetched,
  skipped/verified by hash).
- `npm run gates:quick`: PASS (gate A, B, B2 negative control, C on 5
  files, all pass). ~2s.
- `npm run gates` (full, all 266 real corpus files for gate C): gate A
  PASS, gate B PASS, gate B2 (negative control) PASS, gate C FAIL (265/266
  path A, 266/266 path B; ~61s) -- the one known, investigated-but-
  unresolved npm-bull-readme.md anomaly (see README "Known limitations"
  and the entry above). Exit code 1 reflects this honestly; gates.md/
  gates.json committed with the full-run numbers.
- `npx tsc --noEmit`: clean throughout every step above.
- `lsof -nP -iTCP:4210-4239 -sTCP:LISTEN`: no listeners after gates:quick,
  after the full gates run, and after every earlier smoke/debug session in
  this log -- checked directly each time, not assumed.

Workaround costs (also in the README): rootAttrs.ts 101 lines (66
non-comment), leafMarks.ts 128 lines (87 non-comment). Schema constraints:
root attrs limited to what `Transform.setDocAttribute` can set (no
constraint beyond "JSON-serializable", already true of lead/eol); every
inline-atom node type needs its own `leafMarks` string attr, and (a real,
non-obvious cost) leafMarksPlugin must be registered before rootAttrsPlugin
in the plugins array or the latter's view()-hook dispatch clobbers the
former's not-yet-applied initial restore.

Cleaned up all throwaway debug-*.ts / connect-*.ts / dump-doc.ts / try-*.ts
scripts once their findings were folded into code comments and this log;
kept scripts/check-fixture.ts, quick-roundtrip.ts, smoke-relay.ts,
smoke-client.ts as small standalone verification scripts (README says so
explicitly, matching spike 1's own "tools/" convention).

Stopping point reached (brief: task 7 done / stopping point is "task 7
done"; task 8, the gate runner, is also done). Handing back.
