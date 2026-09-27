# Stack 13: Yjs 13.6.33 + @tiptap/y-tiptap + Hocuspocus 4.7

Status: brief 01 (gates A, B, C) and brief 03 (gates B3, D, E, G; the gate
C corpus-size addendum) done. See
[brief 01's log](../../context/logs/2026-09-27-builder-spike-5-stack13-core.md)
and [brief 03's log](../../context/logs/2026-09-27-builder-spike-5-stack13-deg.md)
for the full narrative, including bugs found and fixed along the way.
Gates F and H are later briefs' scope, not this package's.

## Goal

Answer gates A, B, B3, C, D, E and G of
[the spike 5 charter](../../context/plans/2026-09-27-spike-5-charter-collab-stack.md)
for stack 13: Yjs 13 stable, `@tiptap/y-tiptap` as the ProseMirror binding,
Hocuspocus 4.7 as the relay with SQLite persistence, two live ProseMirror
`EditorView`s (and, for gate D, two live Tiptap 3 `Editor`s) under jsdom
connected over a real WebSocket, and spike 1's schema, parser and
serializer -- with both of stack 13's Yjs-13 binding workarounds (root
attrs, atom-node marks) implemented for *live* editing, not just
seeding/reading a `Y.Doc` headlessly (spike 1's `src/yjs.ts` only covered
the latter).

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

Brief 03: `scratch/probe-atom-mark-change.ts` is the orchestrator's own
probe (spike 5), promoted into gate B3 (`gates/gateB3.ts`) per that brief's
task 1; kept in place as the brief asked. Everything else added in brief 03
(`src/attribution.ts`, `src/tiptapExtensions.ts`,
`src/tiptapWorkaroundsExtension.ts`, `src/tiptapClient.ts`,
`gates/gateD.ts`, `gates/gateE.ts`, `gates/gateG.ts`) is new code written
for this package, not copied from elsewhere.

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
- `gates/gateA.ts`, `gates/gateB.ts`, `gates/gateB3.ts`, `gates/gateC.ts`,
  `gates/gateD.ts`, `gates/gateE.ts`, `gates/gateG.ts` -- the gates;
  `gates/lib/edits.ts` (real-transaction helpers shared by the gates:
  typing, paste, split/join, mark, delete, whole-doc replace) and
  `gates/lib/equality.ts` (the plan's equality check).
- `src/attribution.ts` -- gate E: the client-ID-to-user/timestamp mapping
  (a `Y.Map` inside the document) and the ranges listing (below).
- `src/tiptapExtensions.ts` -- gate D: a generic converter from
  `src/schema.ts`'s ProseMirror `NodeSpec`/`MarkSpec`s to Tiptap 3
  `Node`/`Mark` extensions, plus `checkSchemaEquivalence()`.
- `src/tiptapWorkaroundsExtension.ts` -- gate D: the two workaround plugins
  wrapped as one Tiptap `Extension` (no rewrite needed -- see the file).
- `src/tiptapClient.ts` -- gate D: a Tiptap twin of `src/client.ts`,
  building a real Tiptap `Editor` (`@tiptap/extension-collaboration` +
  `@tiptap/extension-collaboration-caret` + the wrapped workarounds) on the
  same `HocuspocusProvider` wiring.
- `scratch/probe-atom-mark-change.ts` -- the orchestrator's probe that gate
  B3 promotes (kept per the brief).
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
npm run gates:quick  # A, B, B2, B3, C (5-file sample), D (no caret/undo), E (listing+collision only), G (G1 only) -- ~10s
npm run gates        # same gates in full: C over all 266 corpus files, D/E/G every scenario -- ~65s
npx tsc --noEmit
```

Writes `results/gates.md` and `results/gates.json`. As of this writing
every gate in this package passes on both `npm run gates:quick` and the
full `npm run gates` (exit 0); see "Known limitations" below for what was
found and fixed along the way and what remains a genuine, reported
constraint rather than a failure.

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
  `gates/gateC.ts`. Brief 03 addendum: path (a)'s encoded Yjs state
  (`encodeStateAsUpdate` bytes on the relay) is also summed across the
  corpus, the same measure stack 14 reports (18.70MB) -- here, ~17.2MB over
  the full 266-file corpus (17.19-17.20MB across repeated runs; each
  document gets a fresh random Yjs clientID per run, whose varint encoding
  length varies by a few bytes per file, so the total isn't bit-for-bit
  identical run to run -- noted so the number isn't read as more precise
  than it is).
- **B3. Inline atom link edits** (brief 03, promoted from the
  orchestrator's `scratch/probe-atom-mark-change.ts`): five cases through
  the live binding with both workaround plugins, checked in both editors --
  the initial linked state; changing a linked image's href; unlinking it;
  a whole-document replace where the image's url and href both change; and
  replacing one image node with one whose url and link differ. Each case
  resets to a pristine linked image first (via the same `replaceWholeDoc`
  trick gate C's path (b) uses), since cases 3 and 4 each rewrite the image
  wholesale and would otherwise just be re-testing the previous case's
  result under a different name.
- **D. Tiptap 3.31.3** (brief 03): `@tiptap/core`,
  `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-caret`,
  `@tiptap/pm` (all 3.31.3, exact) with `@tiptap/y-tiptap` 3.0.9 -- the same
  binding stack 13's raw ProseMirror editors already use, so it's one
  binding under test everywhere, per the plan. `src/tiptapExtensions.ts`
  converts every node/mark of `src/schema.ts` generically (name, content,
  group, inline, atom, marks, code, attrs-with-defaults, parseDOM, toDOM)
  into Tiptap extensions; `checkSchemaEquivalence()` confirms the resulting
  Tiptap schema matches on every one of those fields for all 17 nodes and 5
  marks (toDOM/parseDOM are proven equivalent by rendering, not by function
  identity -- see the file's comment for why a reference check would always
  fail). `src/tiptapWorkaroundsExtension.ts` wraps the two workaround
  plugins in a Tiptap `Extension` verbatim (a Tiptap Extension's
  `addProseMirrorPlugins()` has the same contract as raw ProseMirror, so no
  rewrite was needed). Then: two Tiptap editors run gate B's own script
  (reusing `editor.view`, `@tiptap/pm`'s escape hatch to the real
  `EditorView`, and `gates/lib/edits.ts`'s helpers unchanged) and converge;
  each sees the other's caret (awareness state present, decoration rendered
  in the DOM -- sequentially, see "Known limitations"); undo in one editor
  undoes only its own change (Tiptap's Collaboration extension wires
  `@tiptap/y-tiptap`'s `yUndoPlugin` itself). `npm ls prosemirror-model
  prosemirror-state` (checked both manually and by this gate itself,
  parsing `npm ls --json` so a future dependency bump that reintroduces a
  duplicate would fail the gate): exactly one resolved version of each,
  everywhere, including under `@tiptap/pm` -- confirmed by reading
  `@tiptap/core`'s and `@tiptap/extension-collaboration`'s own
  `package.json`s, neither has any direct `prosemirror-*` dependency at
  all, only a peer dependency on `@tiptap/pm`, which itself resolves to the
  same already-installed packages. **Nothing had to be replaced by a custom
  extension** beyond the workarounds themselves (which the brief already
  asks to wrap): Collaboration and CollaborationCaret worked unmodified.
- **E. Attribution** (brief 03): see "Attribution design" below for where
  the mapping lives and why. Tested: listing visible ranges (user, time,
  text) for a document edited by alice, bob and the initial seed; a forged
  client-ID collision, flagged rather than silently overwriting the ground
  truth; a provider reconnect (same `Y.Doc`, same client ID, ranges
  accumulate under it); a page reload (a new `Y.Doc`, so a new client ID,
  mapped to the same user with no conflict); the mapping surviving a relay
  restart; and its byte cost.
- **G. Persistence and reconnect** (brief 03): G1 a graceful restart
  (SIGTERM) after the store debounce, both providers reconnect on their
  own, content intact, a new edit propagates; G2 a hard kill (SIGKILL),
  once before and once after the debounce, reporting sqlite size at each
  point and confirming the surviving client's own in-memory state is what
  actually repopulates the fresh relay, not anything the debounce did or
  didn't flush; G3 both editors edit while the relay is fully stopped,
  then converge once it restarts; G4 one editor goes offline
  mid-session, both sides make overlapping edits (including a genuine
  same-node conflict -- see "Known limitations"), the offline editor
  reconnects, and all three converge.

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
check run through the changed live stack, at **266/266 on both paths** in
every run observed except one rare flake (see "Known limitations") on
the full real corpus -- comfortably ahead of spike 1's own
plain-y-prosemirror measurement (160/294, no codec at all). Brief 01's
narrative here originally reported 265/266 on path (a), one file
(`npm-bull-readme.md`) losing `doc.attrs.lead` through the live relay path
only, cause not isolated within that brief's budget. The orchestrator
found and fixed the actual bug (commit `39a8f10`): `rootAttrsPlugin`'s
`appendTransaction` compared `doc.attrs` against the map on *every*
transaction and would write the editor's still-default attrs back over a
just-synced map value whenever a remote update's fragment-observer fired
before its map-observer for the same transaction -- exactly what happened
for this one file's `lead`. Fixed by only writing local->map when the
transaction actually changed `doc.attrs` itself, and never for the plugin's
own map->doc transaction. Corrected here per brief 03's instruction; the
full history is in both builders' logs.

## Attribution design (gate E)

Where the mapping lives: a `Y.Map` (`phraise-attribution`) **inside the
document itself**, not a relay-side SQLite table, populated from the
relay's `onAuthenticate` (records `context.user = token`, per D5) and
`onChange` hooks (`src/attribution.ts`'s `recordAttribution`, called from
`src/relay.ts`). For each incoming update, `Y.parseUpdateMeta(update)`
decodes which Yjs client IDs it touches and their `[from, to)` clock
ranges -- without applying anything -- and each range is recorded against
`context.user` at the server's receive time.

Chosen over a relay-side table because: (1) it needs zero extra
persistence wiring -- it rides the same SQLite extension that already
persists the whole `Y.Doc`, so gate G's restart proof covers it for free;
(2) it replicates to every connected client automatically, which a future
"show who wrote this" UI needs anyway, with no separate fetch; (3) its cost
is directly comparable to the document's own cost, both measured the same
way (`encodeStateAsUpdate` bytes). The real, named trade-off: it never
shrinks -- every `onChange` appends a new range tuple, with nothing to
compact or garbage-collect old ranges the way a side table could be
periodically vacuumed or indexed by time; not implemented here, out of
scope for a spike.

Measured cost: diffing two otherwise-identical relay runs (one with
attribution recording, one with `--no-attribution`) of the same small
two-user edit script: **roughly 1KB, 20-25% of the ~4.2KB baseline document**
(980B/22.1% and 1.1KB/26.3% observed across repeated runs -- again, random
per-run clientIDs shift the exact byte counts a little, see the gate C note
above). That percentage is high here only because the baseline document is
tiny; the marginal cost per range is fixed (a `[client, from, to,
timestamp]` tuple) regardless of document size, so the relative overhead
shrinks for any real-sized document.

Listing (`listAttributedRanges`): walks the document's `XmlFragment` tree
exactly as the binding itself would render it, but for each `Y.XmlText`
follows its own internal item chain (`_start`/`.right`, the same linked
list `ySyncPlugin` walks to build text) to find every visible
(non-deleted) `ContentString` run and look up who wrote it; inline atoms
(images etc, stored as child `Y.XmlElement`s) are attributed by the ID of
the `Item` that placed them in their parent. Content written by the
relay's own seed transaction (before any client has connected, so no
`context.user` exists) is attributed to a literal `'seed'` pseudo-user,
satisfying "a document edited by alice and bob (plus the seed)" directly.

A client ID already mapped to a different user (a forged or colliding ID)
is **flagged**, into a second `Y.Map` (`phraise-attribution-conflicts`),
rather than silently reassigning authorship -- the original mapping is
left untouched. Testing this surfaced a real, useful finding: a second
`HocuspocusProvider` simply forced to another user's real client ID
**cannot** be used to test this, because Yjs's own client-side defense
(`yjs.cjs`'s `transactionCleanup`: "Changed the client-id because another
client seems to be using it") reassigns a doc's own client ID the instant
it *receives* a remote update under an ID matching its own -- which
happens during that second client's very first sync, before it could ever
send anything under the forged ID. The test instead has the malicious
client (already synced, already authenticated) apply a raw update crafted
with someone else's real client ID directly onto its own live `Y.Doc` via
`Y.applyUpdate` (bypassing any polite client library's sync dance
entirely -- what an actual attacker forging protocol bytes would do);
`HocuspocusProvider` forwards any update whose origin isn't its own
internal marker, so this reaches the relay over the attacker's own
authenticated connection and gets flagged correctly. A side effect worth
noting: applying that forged update also makes the *real* owner's own
live client, on receiving the rebroadcast, trigger that same Yjs
self-defense and silently reassign its own client ID mid-session with no
error or event exposed for it -- gate E's check captures the real owner's
client ID *before* the forgery for exactly this reason.

Reconnects: a provider reconnect (`websocketProvider.disconnect()` then
`.connect()`) keeps the same `Y.Doc` and client ID -- ranges keep
accumulating under the one mapping. A page reload (a brand new
`createLiveClient()` call, same token) is a new `Y.Doc` and a new,
unrelated client ID, mapped to the same user with no conflict (multiple
client IDs can map to one user peacefully). A relay restart between edits:
the mapping survives, since it's part of the document (see above) --
though the relay's own `GET /state/<docName>` debug endpoint only reflects
documents already resident in its in-process map, so a check right after a
fresh restart needs a client to reconnect first (which triggers
`onLoadDocument`/the SQLite restore) before `/state` shows anything; a bare
`fetchState` immediately after restart reads back 0 bytes even though
SQLite already has the row. Confirmed directly with a throwaway isolation
script (deleted once confirmed, per this package's convention -- see the
session log) before building gate G and gate E's restart check around it.

## Known limitations

- **jsdom has neither `Range` nor `Element`'s `getClientRects`/
  `getBoundingClientRect` at all** (confirmed: `'getClientRects' in
  Range.prototype` is `false`). `prosemirror-view`'s `scrollToSelection`
  calls this unconditionally on focus/selection change, which gate D's
  caret test needs (a real `.focus()`), so `src/tiptapClient.ts` shims both
  methods to return empty/zeroed rects -- the same class of narrow,
  documented gap as brief 01's dummy-`ClipboardEvent` shim for
  `view.pasteHTML`, scoped to the one file that needs it.
- **A live Tiptap editor's doc uses a genuinely different Schema
  *instance*** than `src/schema.ts`'s canonical `schema`, even though
  `checkSchemaEquivalence()` proves it's structurally identical --
  `getSchema()` always builds a fresh one from the extensions array
  (confirmed by reading `@tiptap/core`'s `ExtensionManager` source: no
  override hook exists to reuse an external `Schema` object). This broke
  two layers of this package's own comparison code, in order of
  discovery: `compare.ts`'s `semanticEq` compared `NodeType`/`MarkType` by
  reference (fixed: compare by name instead, strictly more permissive only
  in exactly the case that used to be a false positive); and
  `serialize.ts`'s splice-candidate ladder leans on ProseMirror's own
  native `Fragment.findDiffStart`/`Node.eq()`, which are reference-based
  internally and are library code, not this package's to patch (fixed at
  the call site: `gates/gateD.ts`'s `canonicalize()` round-trips a
  Tiptap-schema doc through JSON into the canonical schema before handing
  it to `serializeDoc`/`semanticEq`, which the equivalence check is what
  makes lossless). Anyone building on this package should assume the same
  applies to any other code that assumes one shared `Schema` instance.
- **Caret decorations were tested sequentially, not simultaneously**: this
  whole package's gates share ONE process-wide jsdom window/document
  (`global-jsdom/register`, since brief 01), which can only focus one
  element at a time; `@tiptap/y-tiptap`'s cursor plugin only broadcasts a
  cursor into awareness when `editorView.hasFocus()` (confirmed by reading
  its source) and clears it on blur, so focusing bob's editor blurs (and
  un-broadcasts) alice's. Gate D's check focuses alice first and confirms
  bob's DOM shows her caret, then focuses bob and confirms alice's DOM
  shows his -- proving the rendering works in both directions, just not at
  the same instant. This is a harness limitation (one shared jsdom
  document), not a Tiptap/y-tiptap one: a real deployment is one browser
  tab per user, where simultaneous focus is the normal case.
- **G4's genuine CRDT-defined "loss"**: when both sides concurrently change
  the *same* image's link to different hrefs while one editor is offline,
  the merged document ends up with exactly one of the two hrefs, identical
  on editor1, editor2 and the relay (gate G asserts convergence, not which
  side wins -- this gate doesn't assert or rely on a specific tie-breaking
  rule, only that all three peers agree), and the losing side's specific
  href value is genuinely gone. That is what "nothing is lost except what
  CRDT semantics define" means concretely: last-write-wins on a single
  node's attribute, not corruption and not silently duplicated state.
  Concurrent *text* insertions into the same paragraph, by contrast, are
  never lost -- Yjs interleaves them by position instead of picking a
  winner.
- A delete that merges a plain `paragraph` into the opaque `raw_block` a
  footnote definition becomes has no splice candidate in spike 1's
  serializer (confirmed: both editor1's and the relay's `serializeDoc`
  fail identically, so it is not data loss, just an unverified
  reserialization). Gate B's script avoids this specific boundary
  deliberately; it's a spike 1 serializer gap, not this brief's to fix.
- Gate A's latency number is a polling artifact (see above), not a real
  network measurement.
- **Gate C's full-corpus run is not perfectly deterministic**: one run of
  the complete `npm run gates` pipeline (all gates, in sequence) showed
  path A at 265/266 (the same `npm-bull-readme.md`/`lead` symptom the
  "Workaround costs" section above describes as fixed) once; three
  standalone re-runs of gate C alone, and a subsequent second full-pipeline
  run, all showed 266/266. Consistent with a rare timing-sensitive race
  (candidate mechanism, not confirmed: `src/attribution.ts`'s `onChange`
  hook now runs -- and writes an extra, separate transaction/update -- for
  every document in every gate, including gate A/B/B2's own relays,
  something that didn't happen before brief 03; this plausibly shifts
  Hocuspocus's update-batching/observer-notification timing just enough to
  occasionally reopen the exact race the orchestrator's `rootAttrsPlugin`
  fix (commit `39a8f10`) was defending against, though the 3 standalone
  gate-C-only reruns -- which also have the attribution hook active --
  did not reproduce it, so this is not confirmed). Not chased further
  within a "two genuinely different attempts" budget (isolated rerun,
  and a second full-pipeline rerun); logged here and in the session log
  as a real, rare, cause-unconfirmed flake for the orchestrator's own full
  run to watch for, rather than assumed fixed.
- Hocuspocus's `onStoreDocument` debounce defaults to 2000ms/10000ms
  (`debounce`/`maxDebounce`, found by reading
  `@hocuspocus/server`'s `defaultConfiguration` directly, not
  documentation); gate G and gate E's restart check override these to
  200ms/500ms (`src/relay.ts --debounce/--maxDebounce`) so their
  restart/kill scenarios don't need multi-second real waits. Production
  would keep the defaults or tune them for its own write-volume/durability
  trade-off.
