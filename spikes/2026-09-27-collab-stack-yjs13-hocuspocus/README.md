# Stack 13: Yjs 13.6.33 + @tiptap/y-tiptap + Hocuspocus 4.7

Status: brief 01 (gates A, B, C) done. See [the log](../../context/logs/2026-09-27-builder-spike-5-stack13-core.md)
for the full narrative, including bugs found and fixed along the way.

## Goal

Answer gates A, B and C of [the spike 5 charter](../../context/plans/2026-09-27-spike-5-charter-collab-stack.md)
for stack 13: Yjs 13 stable, `@tiptap/y-tiptap` as the ProseMirror binding,
Hocuspocus 4.7 as the relay with SQLite persistence, two live ProseMirror
`EditorView`s under jsdom connected over a real WebSocket, and spike 1's
schema, parser and serializer -- with both of stack 13's Yjs-13 binding
workarounds (root attrs, atom-node marks) implemented for *live* editing,
not just seeding/reading a `Y.Doc` headlessly (spike 1's `src/yjs.ts` only
covered the latter).

## Origin of copied code

`src/schema.ts`, `src/parse.ts`, `src/serialize.ts`, `src/style.ts`,
`src/compare.ts`, `src/yjs.ts`, `src/index.ts`, `scripts/fetch-corpus.mjs`,
`corpus/manifest.json`, `corpus/specs.json`, `corpus/handwritten/` are
copied from branch `spike/2026-09-27-markdown-round-trip` at commit
`1e1f4a6` (spike 1, directory `spikes/2026-09-27-markdown-core-remark-splice/`),
per the charter's reuse list. `src/yjs.ts`'s import was changed from
`y-prosemirror` to `@tiptap/y-tiptap` (a re-export-compatible fork; same
function names). `src/schema.ts` additionally gained `toDOM`/`parseDOM` on
every node and mark (see the comment at the top of that file) -- spike 1
never rendered a real `EditorView`, only parsed/serialized/compared doc
trees headlessly, so nothing there needed DOM rendering rules before now.

Spike 2's `test/y-prosemirror.spec.ts` (branch `spike/2026-09-27-crdt-rebase`,
directory `spikes/2026-09-27-crdt-rebase-binding-probe/`) was read for
design guidance on wiring a live `ySyncPlugin` editor under jsdom (per the
brief), but no code from it was copied.

## Layout

- `src/schema.ts`, `src/parse.ts`, `src/serialize.ts`, `src/style.ts`,
  `src/compare.ts`, `src/index.ts` -- spike 1's document model, unchanged
  except `schema.ts`'s DOM rules (above).
- `src/yjs.ts` -- spike 1's Yjs codec (seed/read a `Y.Doc`), retargeted at
  `@tiptap/y-tiptap`.
- `src/workarounds/rootAttrs.ts`, `src/workarounds/leafMarks.ts` -- the two
  live-editing workarounds (below).
- `src/relay.ts` -- the Hocuspocus relay (child process): `tsx src/relay.ts
  --port <n> --db <path> --seeds <dir>`. SQLite persistence; seeds a
  `file:<relpath>` document through the codec, or a `plain:<relpath>`
  document with no codec (negative control), the first time each is
  loaded; `GET /state/<docName>` returns the relay's raw Yjs update for
  that document.
- `src/harness.ts` -- `startRelay()`/`stopRelay()`: spawns/kills the relay
  as a real child process (`node --import tsx/esm src/relay.ts ...`, not
  the `tsx` CLI binary -- see the comment in this file for why: the CLI
  re-execs a second Node process that survives killing the CLI's own pid).
- `src/client.ts` -- `createLiveClient()`: a `Y.Doc`, a `HocuspocusProvider`
  over `ws` (with its own `HocuspocusProviderWebsocket` so a
  `WebSocketPolyfill` can be supplied -- jsdom has no real `WebSocket`),
  and a real ProseMirror `EditorView` with `ySyncPlugin` plus, by default,
  both workaround plugins. Async: it awaits the provider's first sync
  before building the editor (see the comment there for why that order
  matters).
- `gates/gateA.ts`, `gates/gateB.ts`, `gates/gateC.ts` -- the three gates;
  `gates/lib/edits.ts` (real-transaction helpers shared by the gates:
  typing, paste, split/join, mark, delete, whole-doc replace) and
  `gates/lib/equality.ts` (the plan's equality check).
- `scripts/gates.ts` -- the gate runner (below).
- `scripts/quick-roundtrip.ts`, `scripts/check-fixture.ts`,
  `scripts/smoke-relay.ts`, `scripts/smoke-client.ts` -- small standalone
  verification scripts, not part of `npm run gates`.
- `fixtures/live.md` -- the plan's common gate fixture: a leading blank
  line (non-default `lead`), a linked badge image, a link mixing text and
  an image, inline HTML, a footnote reference/definition, a hard break, an
  HTML block, nested lists, a table, a fenced code block, and an unlinked
  image for gate B to add a link mark to. **Deviation from the plan**: no
  YAML front matter. `remark-frontmatter` requires `---` at byte offset 0;
  the leading blank line the plan also asks for (so `lead` is non-default)
  moves the file's first real content off offset 0, which silently turns
  the intended front matter into a thematic break plus two headings
  instead (confirmed with a standalone `remark-frontmatter` probe). The
  two requirements are mutually exclusive under this parser; front matter
  itself is still exercised by spike 1's own corpus (gate C, below) and by
  the `<div>` HTML block already in this fixture, so it was dropped here
  rather than silently mis-testing it.

## Running

```bash
npm ci
npm run fetch        # corpus/fetched/ (gitignored), if missing
npm run gates:quick  # gates A, B, B2 (negative control), C on 5 corpus files -- ~2s
npm run gates        # same, C over the full real corpus (266 files) -- ~60s
npx tsc --noEmit
```

Writes `results/gates.md` and `results/gates.json`. Non-zero exit if any
gate fails -- as of this writing that includes gate C's full run (one
corpus file, see "Known limitations" below), so `npm run gates` itself
exits 1 even though `npm run gates:quick` is clean; this is intentional
(the failure is real and reported), not a bug in the runner.

No relay process is left running after any command, including a failing
one: every gate goes through `src/harness.ts`'s `startRelay`/`stop()`,
which is called from a `finally` block in every gate function, and a
process-level exit/SIGINT/SIGTERM/uncaughtException hook kills any relay
still alive as a last resort. Checked directly after every run in this
brief with `lsof -nP -iTCP:4210-4239 -sTCP:LISTEN`.

## Gates

- **A. Relay**: two live editors connected to one relay type into
  different paragraphs and each sees the other's text; round-trip latency
  is the median of 20 single-character edits, measured by polling (every
  20ms) until the peer's text grows by one character -- the ~20ms result
  this produces is dominated by that poll interval, not real network
  latency (a caveat, not a real number to design around).
- **B. Schema fidelity while editing**: the plan's scripted edit sequence
  (type a word character by character; paste HTML with bold text and a
  linked image; split the paragraph holding the linked badge right before
  it and join it back; add a link mark to an unlinked image; delete a
  range spanning two blocks; a second editor types concurrently into a
  different paragraph) on `fixtures/live.md`, with both workaround plugins.
  Pass means editor 1, editor 2 and the relay's stored document are
  semantically equal (`compare.ts`'s `semanticEq`, which already compares
  `doc.attrs` and marks on every inline leaf -- meta attrs like `src`/`gap`
  are the only thing it ignores) and `serializeDoc` succeeds and matches
  on both sides. Also run on a `plain:` document with **no** workaround
  plugins: the negative control, which must show loss -- and does, in two
  ways: badge.svg/logo.png never regain the link mark spike 1's gate A3
  already showed y-tiptap drops on read, and (more interesting) a link
  mark added *live*, mid-session (to the unlinked image, and to the pasted
  image) survives locally right up until the next remote change forces a
  resync from Yjs content that never carried it -- exactly the "the live
  ySyncPlugin still drops leaf marks created during editing" gap
  `src/yjs.ts`'s header names as out of its own scope.
- **C. Workaround cost**: at least 50 (here: all 266) real corpus files,
  two paths -- (a) server-seeded through the codec, read by a live editor;
  (b) parsed locally and loaded into editor 1 through a transaction that
  replaces the whole document and sets its attrs (so the live
  `ySyncPlugin` write path, not the seed path, is what reaches Yjs), read
  by editor 2 and the relay. `serializeDoc` must reproduce the original
  file byte-for-byte on both. Path (b) reuses one pair of connected
  editors across every file (only path (a) needs a fresh seeded document,
  and so a fresh client, per file); see the comment at the top of
  `gates/gateC.ts`.

## Workaround costs

| Workaround | File | Lines (non-comment) | What it costs |
|---|---|---|---|
| Root attrs | `src/workarounds/rootAttrs.ts` | 101 (66) | A sibling `Y.Map` kept in sync with `doc.attrs` in both directions, compare-before-write on each side so the two directions converge without a loop (no meta-tagging needed). Constraint: covers exactly the attrs `Transform.setDocAttribute` can set -- true of any doc attr, so no schema constraint beyond "root attrs are plain, JSON-serializable values" (already true of spike 1's `lead`/`eol`). |
| Leaf marks | `src/workarounds/leafMarks.ts` | 128 (87) | A plugin that mirrors real marks on atom nodes (image, hard_break, raw_inline) into the existing `leafMarks` node attr (local edits) and restores them from it (remote changes and the initial render, detected via `@tiptap/y-tiptap`'s own `ySyncPluginKey.getState(state).isChangeOrigin`). Constraint: **plugin registration order** -- it must run before `rootAttrsPlugin` in the plugins array, or `rootAttrsPlugin`'s own `view()`-hook dispatch triggers this plugin's "local edit" branch before its own initial restore has happened, wiping the leafMarks attr with the (still-empty) live marks. This is a real, non-obvious cost: the two workarounds are not independent of each other's wiring order. Schema constraint: a `leafMarks` string attr must exist on every node type whose marks the binding would otherwise drop; a new inline-atom node type that omits it silently reopens the loss for that type only. |

Both workarounds together: 229 lines (153 non-comment), zero changes to
`@tiptap/y-tiptap` itself (no upstream patch needed, matching the plan's
preference).

Spike 1's serializer round-trip gate: unaffected by the workarounds
themselves (they touch live editing only); gate C above is the equivalent
check run through the changed live stack, at 265/266 (path a) and 266/266
(path b) on the full real corpus -- both comfortably ahead of spike 1's
own plain-y-prosemirror measurement (160/294, no codec at all).

## Known limitations

- **One corpus file, one attr, cause not isolated**: `npm-bull-readme.md`
  loses `doc.attrs.lead` (only) through the live relay path (path a),
  and only there. Three independent checks all showed the correct value:
  an offline `docToYDoc`/`yDocToDoc` round trip on this exact parsed
  document; a raw `y-protocols/sync` two-message simulation (client
  `writeSyncStep1` -> server `readSyncMessage` reply -> client
  `readSyncMessage`) against the identical seeded `Y.Doc`; and relay-side
  reads of the `phraise-doc` Y.Map immediately after seeding and again in
  `afterLoadDocument`. The client (and the relay's own `/state` readback)
  reads the schema default instead, so the discrepancy is somewhere in
  Hocuspocus's real connection/broadcast machinery for this one file, not
  in the codec, in Yjs/y-protocols itself, or in a timing race (an extra
  300ms wait after sync didn't change the result). Not chased further
  within this brief's two-genuinely-different-attempts budget; logged in
  full in the session log.
- A delete that merges a plain `paragraph` into the opaque `raw_block` a
  footnote definition becomes has no splice candidate in spike 1's
  serializer (confirmed: both editor1's and the relay's `serializeDoc`
  fail identically, so it is not data loss, just an unverified
  reserialization). Gate B's script avoids this specific boundary
  deliberately; it's a spike 1 serializer gap, not this brief's to fix.
- Gate A's latency number is a polling artifact (see above), not a real
  network measurement.
