# Stack 14: `@y/y` 14.0.0-rc.26 + `@y/prosemirror` 2.0.0-13, on Hocuspocus

> **Orchestrator note (final, 2026-09-27).** Findings: [spike 5 findings](../../context/docs/2026-09-27-spike-5-findings-collab-stack.md).
> Two corrections to the builder narrative below. (1) B3's failure is not
> confined to whole-document replaces: case 4, replacing one image node with
> one whose `url` and link both differ (what an "edit image" dialog does), also
> keeps the old link, in the editor that made the edit too
> (`scratch/probe-atom-mark-change.ts`). (2) Gate C path B now waits for full
> editor convergence before comparing; its 234/266 is unchanged, so every
> failure there is this binding bug, not timing.

Status: brief 06 (gate F: spike 2's rebase port, live editors + relay) done,
on top of brief 04 (Hocuspocus relay, gates B3, G, E, D) and brief 02 (gates
A, B, C-equivalent, Yjs 13/14 compatibility probe). See
[brief 02's log](../../context/logs/2026-09-27-builder-spike-5-stack14-core.md),
[brief 04's log](../../context/logs/2026-09-27-builder-spike-5-stack14-deg.md)
and [brief 06's log](../../context/logs/2026-09-27-builder-spike-5-stack14-rebase.md)
for the full narrative.

**Relay decision (brief 04, task 1): Hocuspocus 4.7 now works and is the
primary relay.** Brief 02's attempt (a) (Hocuspocus + npm `overrides`
aliasing `yjs`/`y-protocols` to `@y/y`/`@y/protocols`) crashed the moment a
real client connected, root-caused to two incompatible `lib0` major
versions coexisting in one process (Hocuspocus's own `^0.2.117` vs `@y/y`'s
`^1.0.0-rc.29`) -- an `npm:`-aliased package installs under the overridden
name's own directory, physically separate on disk from the real scoped
package despite identical content, so Yjs's cross-import guard still fires
and the two `lib0` copies never dedupe. **Fix**: `scripts/postinstall-dedupe.mjs`,
run as this package's own `postinstall`, replaces `node_modules/yjs` and
`node_modules/y-protocols` with **symlinks** to `node_modules/@y/y` and
`node_modules/@y/protocols` after every install, plus a `"lib0": "$lib0"`
override (npm's "resolve every dependent's range against the root's own
version" syntax) so Hocuspocus's own nested `lib0` copy is forced onto the
project's single `lib0@1.0.0-rc.33`. Confirmed directly: exactly one `lib0`
directory exists anywhere under `node_modules` after install, `(await
import('yjs')).Doc === (await import('@y/y')).Doc`, and a real client can
connect, sync and edit without crashing
(`scratch/tmp-hp-dedupe-test.ts`, removed once the finding was logged --
its result is what this paragraph reports). `src/relay-hocuspocus.ts` /
`src/client-hocuspocus.ts` (promoted from brief 02's
`relay-attempt-a-hocuspocus.ts` / `client-attempt-a-hocuspocus.ts`, renamed)
are now what every gate below uses. The brief 02 custom relay is kept as
`src/relay-custom.ts` / `src/client-custom.ts`, selectable via
`startRelay({ relay: 'custom' })` -- gate A runs on both (see "Gates"
below); every other gate runs on Hocuspocus only, per the brief.

## Goal

Answer gates A, B and a C-equivalent of [the spike 5 charter](../../context/plans/2026-09-27-spike-5-charter-collab-stack.md)
for stack 14: the Yjs 14 release candidate (`@y/y`) with its own ProseMirror
binding (`@y/prosemirror`), a relay that actually works with them, two live
ProseMirror `EditorView`s under jsdom connected over a real WebSocket, and
spike 1's schema, parser and serializer -- **with no workarounds** (unlike
stack 13, which needs two for live editing). Also establishes whether Yjs 13
and Yjs 14 documents are readable by each other.

## Origin of copied code

Per [brief 02](../../context/plans/2026-09-27-spike-5-brief-02-stack14-core.md),
copied from stack 13's own directory
(`spikes/2026-09-27-collab-stack-yjs13-hocuspocus/`, itself copied from branch
`spike/2026-09-27-markdown-round-trip` at `1e1f4a6`, spike 1, directory
`spikes/2026-09-27-markdown-core-remark-splice/`), **unchanged**:
`src/schema.ts`, `src/parse.ts`, `src/serialize.ts`, `src/style.ts`,
`src/compare.ts`, `fixtures/live.md`, `corpus/manifest.json`,
`corpus/specs.json`, `corpus/handwritten/*.md`, `scripts/fetch-corpus.mjs`,
`scripts/quick-roundtrip.ts`, `gates/lib/edits.ts` (gate B's edit script,
kept byte-identical in substance, per the brief -- only the binding calls in
the client differ, in what was then `src/client.ts` and is now
`src/client-hocuspocus.ts`/`src/client-custom.ts`). `src/index.ts` was
adjusted (no `encodeLeafMarks`/`decodeLeafMarks` re-exports -- there is no
leaf-marks workaround in this stack). **Brief 04 addendum**: `src/schema.ts`
is no longer byte-identical to spike 1's -- it gained the four canonical
`y-attributed-*` marks gate E part (b) needs (additive only; see that
gate's README entry below for exactly what was added and why).

Spike 2's Yjs 14 binding probe (branch `spike/2026-09-27-crdt-rebase` at
`88bd85c`, directory `spikes/2026-09-27-crdt-rebase-binding-probe/`,
`test/yjs14-prosemirror.spec.ts` and its README) was read for the exact
`@y/prosemirror` API shape (`pmnodeToDelta`, `ynodeToPmnode`, `syncPlugin()`,
`configureYProsemirror({ ytype })`, every shared type is a `Y.Node` via
`doc.get('prosemirror')`) before writing `src/yjs.ts`, but no code from it
was copied (it uses its own tiny schema, not spike 1's).

**Brief 06 (gate F) addendum**: `src/rebase/schema.ts`, `ids.ts`,
`markdown.ts` copied **unchanged** from stack 13's own `src/rebase/`
(itself spike 2's, branch `spike/2026-09-27-crdt-rebase` at `88bd85c`) --
pure ProseMirror schema / deterministic hashing / markdown-it parser, no
Yjs API surface at all. `text.ts`, `seed.ts`, `diff.ts`, `rebase.ts`,
`integrate.ts`, `comments.ts`, `replica.ts`, `liveIntegration.ts`,
`liveClient.ts` are ported (not copied unchanged) from stack 13's own
`src/rebase/` onto `@y/y`'s unified `Y.Node` API -- see "Gates" below (gate
F entry) for the full account of what changed and why, and line-count
comparisons against both spike 2's original and stack 13's port.
`gates/gateF.ts` is likewise ported from stack 13's own gate F.

## Layout

- `src/schema.ts`, `src/parse.ts`, `src/serialize.ts`, `src/style.ts`,
  `src/compare.ts`, `src/index.ts` -- spike 1's document model, unchanged.
- `src/yjs.ts` -- the Yjs boundary. **No workaround code at all**: seed with
  `ytype.applyDelta(pmnodeToDelta(doc))` on `ydoc.get('prosemirror')`, read
  with `ynodeToPmnode(ytype, schema)`. Both of stack 13's losses (root `doc`
  attrs, marks on inline atom nodes) are structurally fixed in this binding
  -- see the file's header for why.
- `src/relay-hocuspocus.ts`, `src/client-hocuspocus.ts` -- **the primary
  relay from brief 04 on** (renamed/promoted from brief 02's
  `relay-attempt-a-hocuspocus.ts` / `client-attempt-a-hocuspocus.ts`):
  Hocuspocus 4.7 + SQLite persistence, npm `overrides` aliasing
  `yjs`/`y-protocols`/`lib0`, PLUS the `postinstall` symlink dedupe that
  actually makes it work (see "Relay decision" above). Used by gates
  B3/D/E/G and by gate A/B/C's default. Extended this brief with
  `onAuthenticate`/`onChange` attribution wiring (`src/attribution.ts`),
  `--debounce`/`--maxDebounce`/`--no-attribution` flags, and a SIGTERM
  handler (`flushPendingStores`) for gate G's graceful-restart scenario.
- `src/relay-custom.ts`, `src/client-custom.ts` -- brief 02's **attempt
  (b)**, renamed (unchanged in substance): a minimal custom relay on `ws`
  and `@y/protocols`, kept as the `relay: 'custom'` alternative (gate A
  runs on both -- see "Relay decision" above).
- `src/harness.ts` -- `startRelay()`/`stopRelay()`; extended this brief with
  a `relay: 'hocuspocus' | 'custom'` flavor (default `'hocuspocus'`) that
  picks which of the two relay scripts above to spawn, plus
  `debounce`/`maxDebounce`/`noAttribution` passthrough for the Hocuspocus
  flavor.
- `src/attribution.ts` -- gate E part (a)'s design: `@y/y`'s own
  `IdMap`/`createContentAttribute`, not a hand-rolled map (see the
  "Gates" section's E entry for the full account and why).
- `src/tiptapExtensions.ts` -- the generic schema-to-Tiptap-extensions
  converter (copied unchanged in substance from stack 13's; it's
  schema-agnostic).
- `src/tiptapClient.ts` -- gate D's Tiptap 3 live client: custom
  `Extension.create()` wrappers around `@y/prosemirror`'s
  `syncPlugin`/`yCursorPlugin`/`yUndoPlugin` (see the "Gates" section's D
  entry for line counts and why Tiptap's own collaboration extensions
  cannot be used here).
- `gates/gateA.ts`, `gates/gateB.ts`, `gates/gateC.ts` -- the three gates
  from brief 02, extended this brief: `gateA.ts` takes a `relay` flavor
  param (runs on both); `gateB.ts`/`gateC.ts` now default to the Hocuspocus
  client. `gates/lib/edits.ts` (byte-identical to stack 13's) and
  `gates/lib/equality.ts` (adapted: no codec/no-codec distinction, since
  there is no workaround and no `plain:` negative control here).
- `gates/gateB3.ts`, `gates/gateD.ts`, `gates/gateE.ts` (+
  `gates/gateE-suggestion.ts`), `gates/gateG.ts` -- this brief's four new
  gates; see "Gates" below for each.
- `scripts/postinstall-dedupe.mjs` -- this brief's fix for the Hocuspocus
  dedupe problem (see "Relay decision" above); runs as this package's own
  `postinstall`.
- `scripts/gates.ts` -- the gate runner, extended with rows B3, D, E, G and
  gate A's both-relays comparison.
- `compat/` -- a **separate subpackage** (own `package.json`, own
  `node_modules`, no npm `overrides`) for task 6's Yjs 13 / Yjs 14
  compatibility probe: real `yjs@13.6.33` + `y-prosemirror@1.3.7` alongside
  `@y/y` + `@y/prosemirror`, unaliased. `compat/scripts/compat.ts` (`npm run
  compat` from `compat/`) -- see "Compatibility probe" below. Unchanged
  this brief.
- `scratch/` -- standalone debugging scripts (brief 02's
  `probe-alias.mjs`, `smoke-one-client.ts`, `smoke-two-clients.ts`,
  `debug-pathb-pair.ts`; brief 04's `probe-atom-mark-change.ts` (gate
  B3's basis), `probe-collision.ts` and `probe-suggestion-mode.ts`; brief
  06's `probe-rebase-primitives.ts`, both showing a failed first attempt
  and the fix); not part of the gate runner, excluded from
  `tsconfig.json`, kept as reproducible evidence.
- `src/rebase/` -- brief 06 (gate F): spike 2's rebase (fork-at-snapshot,
  deterministic client IDs, comment anchors, needs-review/resurrection),
  ported from stack 13's own `src/rebase/` onto `@y/y`'s unified `Y.Node`.
  `schema.ts`/`ids.ts`/`markdown.ts` unchanged; `diff.ts` (task 2) does NOT
  reimplement spike 2's hand-rolled diff -- it calls `lib0/delta`'s own
  public `diff()` on `@y/prosemirror`'s `docToDelta` snapshots instead (see
  the file's header and "Gates" below for the full account); every other
  file is a mechanical-plus port to `Y.Node`/`doc.get(name)`/
  `setAttr`/`getAttr` in place of `Y.XmlElement`/`Y.XmlText`/`Y.Map`.
  `gates/` holds spike 2's own headless gates (A-D2, idempotent -- its own
  lettering, distinct from this package's A-G table), run via `npm run
  rebase:baseline` (not part of `npm run gates`, same as stack 13).
- `src/rebase/liveIntegration.ts`, `liveClient.ts` -- the live-editing half
  of brief 06: the `beforeTransaction`/`afterTransaction` integration hook,
  and a live client for spike 2's schema/fragment using this stack's own
  `@y/prosemirror` binding (`syncPlugin`/`configureYProsemirror`) instead
  of stack 13's `@tiptap/y-tiptap`.
- `gates/gateF.ts`, `scripts/run-gate-f.ts` -- gate F itself (ported from
  stack 13's own gate F); see "Gates" below.
- `scripts/rebase-baseline.ts` -- runs spike 2's own headless gates
  (`npm run rebase:baseline`).

## Relay decision detail (brief 04 task 1; brief 02 task 2's attempts)

**Brief 02's attempt (a): Hocuspocus 4.7 + npm `overrides` aliasing
`yjs`/`y-protocols` to `@y/y`/`@y/protocols` -- crashed then, fixed now.**
`npm install` needed `yjs`/`y-protocols` removed from direct
`dependencies` (an explicit direct dependency conflicts with an
`overrides` entry for the same name; they only need to exist as
Hocuspocus's own peerDependencies, which the override then redirects).
Install then succeeded, and the relay alone started and served `/state`
fine -- but the moment a real client connected and the sync handshake ran,
it crashed with `RangeError: Maximum call stack size exceeded` in
`lib0/encoding.js`'s `writeAny`. Root cause, confirmed directly then: the
top-level `node_modules/lib0` (used by `@hocuspocus/common`/`server`/
`provider`, which declare `lib0: ^0.2.117`) was `0.2.118`, while the
aliased `yjs` (really `@y/y`) and `@y/prosemirror` each carried their
**own nested** `node_modules/lib0` at `1.0.0-rc.33` -- two incompatible
major versions of `lib0`'s `Encoder`/`Decoder` coexisting in one process.
**This brief's fix**: `scripts/postinstall-dedupe.mjs` (see "Relay
decision" at the top of this README) replaces the override-installed
directories with symlinks to the real `@y/*` packages, so there is exactly
one copy of each on disk. Confirmed working end to end: gates A, B, C, B3,
D, E and G all pass against Hocuspocus (except the two documented upstream
issues below).

**Brief 02's attempt (b): a minimal custom relay on `ws` and
`@y/protocols`.** `src/relay-custom.ts` + `src/client-custom.ts` (renamed
this brief, unchanged in substance -- see "Layout" above). Kept as the
`relay: 'custom'` alternative per this brief's task 1. Two real bugs found
and fixed while building it (full detail, including the exact crashes and
the debugging steps, in the brief 02 log):

1. The **same duplicate-`lib0` problem as attempt (a)**, one level deeper:
   this stack's own code imports bare `lib0/encoding`/`lib0/decoding`
   directly, which resolved to the wrong (top-level, `0.2.118`) copy while
   `@y/protocols` internally resolves its own (nested, `1.0.0-rc.33`) copy.
   Fixed by adding `"lib0": "1.0.0-rc.33"` as an explicit direct dependency
   in `package.json`: the root project's own dependency wins the top-level
   `node_modules/lib0` slot, which then satisfies (and dedupes) every
   `@y/*` package's own peer range too -- confirmed directly, all four
   `@y/*`-family packages' nested `lib0` copies disappeared after
   reinstalling, only Hocuspocus's own (now-nested) `0.2.x` copy remains.
2. A real protocol bug in this spike's own code: both `send()` helpers
   guarded on `encoding.length(encoder) <= 0`, but the caller always writes
   the one-byte `messageSync` wrapper *before* checking whether
   `readSyncMessage` wrote an actual reply (it only does for an incoming
   step 1; step 2 / update get no reply). A bare "wrapper byte, nothing
   else" message slipped through and crashed the *peer's* decoder trying to
   read a second message type from an exhausted 1-byte buffer -- the same
   error as (a) coincidentally looks like (`Unexpected end of array` /
   `Maximum call stack`, both lib0 `error.create()`-produced errors whose
   `.stack` is frozen at module-load time, which is genuinely confusing
   until you know that). Fixed by tightening the guard to `<= 1` in both
   `src/relay-custom.ts` and `src/client-custom.ts` (renamed this brief;
   comments there explain why).

**(c) Stock Hocuspocus with real Yjs 13 relaying Yjs 14 clients --
measured, not built, per the brief ("expected to fail; record how").** See
"Compatibility probe" below, check 4: real Yjs 13's own `y-protocols/sync`
code can produce a plausible-looking state-vector message from a `@y/y`
`Y.Doc` (the low-level `doc.store` shape is duck-type-compatible that far),
but a real relay's own bookkeeping needs the high-level XML/Node type
wrapper (e.g. `document.isEmpty(fragmentName)`, which every relay in this
spike calls on every `onLoadDocument`), and that throws (compatibility
probe check 3). Independently, reading Hocuspocus's own source
(`ClientConnection` in `@hocuspocus/server`'s dist) shows it multiplexes
**multiple documents over one WebSocket connection**, every message
prefixed by a var-string document name read off the wire -- a different
wire framing entirely from the plain per-connection, URL-path-addressed
protocol this stack's relay/client (and the reference `y-websocket`) speak,
so a stock Hocuspocus server could not understand this stack's client's
messages even before any Yjs-version question arises.

## Running

```bash
npm ci                # runs postinstall-dedupe.mjs automatically
npm run fetch         # corpus/fetched/ (gitignored), if missing
npm run gates:quick   # A (both relays), B, C (5-file sample), B3, D, E, G (short), F -- ~20s
npm run gates         # same, full corpus for C, full D/E/G scenarios, F -- ~95s
npm run rebase:baseline  # spike 2's own headless gates (A-D2, idempotent), brief 06 task 3
npx tsc --noEmit

cd compat && npm install && npm run compat && npx tsc --noEmit
```

Writes `results/gates.md` and `results/gates.json`. No relay process is left
running after any command, including a failing one -- same mechanism as
stack 13 (`src/harness.ts`'s `startRelay`/`stop()` in every gate's `finally`
block, plus a process-level exit hook); checked directly with
`lsof -nP -iTCP:4240-4269 -sTCP:LISTEN` after every run in this brief.

## Gates

- **A. Relay**, run on BOTH relay flavors (brief 04 task 1): same script as
  stack 13's gate A (two live editors, each typing into a different
  paragraph, then 20 single-character round trips). **PASS on both** --
  custom relay ~23ms median round-trip latency, Hocuspocus ~22-23ms median
  -- no material difference (same polling-interval caveat as stack 13's
  gate A applies to both -- not a real network measurement).
- **B. Schema fidelity while editing** (now against Hocuspocus): the plan's
  identical scripted edit sequence (`gates/lib/edits.ts`, byte-identical to
  stack 13's) on `fixtures/live.md`, **with no workaround plugins at all**
  (there are none). **PASS**: editor1, editor2 and the relay's stored
  document are
  semantically equal and byte-identical on `serializeDoc`; every linked
  image (`badge.svg` across split/join, `logo.png`, `icon.png` -- a link
  mark added live mid-session -- and `pasted.png` from the paste step) kept
  its link mark. Unlike stack 13, there is no negative control to run (no
  workaround to demonstrate the absence of). Brief-specific extra check:
  the number of Yjs updates stops growing after settling -- **stable at 23**
  immediately after convergence and 500ms later.
- **C. Corpus round trip (no workaround needed)**, now against Hocuspocus,
  both of stack 13's gate C paths, over the full 266-file real corpus.
  Task 6: encoded state size confirmed to match brief 02's custom-relay
  figure (18.70MB then, 18.73-18.74MB here across runs -- the same order,
  small run-to-run variance from timestamp-bearing bytes, not a relay
  difference).
  - **Path A (server-seeded, fresh document per file): 266/266.** This is
    how Phraise actually loads documents (D1: re-seed from commits), and
    it's perfect.
  - **Path B (client-loaded via a single whole-document-replacing
    transaction, one *reused* pair of live clients across all 266 files,
    exactly as the plan and stack 13's gate C specify): 234/266.** Traced
    (not patched -- see below) to a real, reproducible bug in
    `@y/prosemirror`'s document-diffing path
    (`node_modules/@y/prosemirror/src/sync-utils.js`'s `pmNodeDiff`/
    `pmDocDiff`, `walkPairable`): when a transaction's `ReplaceStep` spans
    the *entire* document, the binding translates it via a tree-diff
    between the previous and next document rather than a plain per-step
    translation, and that diff pairs nodes "with equal canonical name"
    (node type only, not attrs/marks) at each tree position. Two npm READMEs
    in the corpus (`npm-aws-sdk-readme.md` then `npm-axios-readme.md`, back
    to back on a *fresh* client pair -- reproduced in isolation,
    `scratch/debug-pathb-pair.ts`) both have a Sauce Labs badge `image` node
    at the same tree position with only its `link` mark's `href` differing;
    the diff treats them as unchanged and axios's editor ends up with
    aws-sdk's href baked into its own README's serialization -- confirmed
    already present in the editor that dispatched the transaction, before
    any Yjs round trip, so this is not a CRDT desync between peers (both
    editors agree with each other, and disagree with the source file,
    identically). Gate B's realistic incremental-edit script (typing,
    paste, split/join, a live-added mark, a cross-block delete -- never a
    whole-document replace) passed 266/266 including every link-mark case;
    this is specific to the synthetic "replace the whole document in one
    transaction" edit shape gate C's path B calls for, not to normal live
    editing. Encoded state size (path A, summed over the corpus): 18.70MB.
    Full failure list in `results/gates.md`.

  Compare: spike 1's own plain-y-prosemirror measurement, 160/294; stack
  13's gate C (with its two workarounds): 265/266 path A, 266/266 path B.

- **B3. Inline atom link edits** (brief 04 task 2): five cases from
  `scratch/probe-atom-mark-change.ts`, run live against Hocuspocus. **FAIL,
  as the brief expects**: cases 0-2 (initial state, an image link's own
  href change, unlinking it) pass; cases 3-4 (a whole-document replace, and
  a single-node `replaceWith`, each changing an image's own `url` attr
  together with its `link` mark's `href` in the same edit) both fail --
  the new `url` lands but the OLD mark is kept. Root cause, as far as this
  brief's budget allows finding it cheaply (a local, reverted
  `node_modules` instrumentation confirmed the branch taken, see the log):
  the failing cases DO take the "structural window" `delta.diff` path in
  `@y/prosemirror`'s `sync-utils.js` `pmNodeDiff` (not the "modify in
  place" fast path that skips marks by construction), so the mark loss
  happens one layer deeper, inside `lib0`'s own generic `delta.diff`
  (`node_modules/lib0/src/delta/delta.js:4473`) -- not fully bisected
  further (diminishing returns for a spike-level finding). Reported as-is,
  not worked around, per the brief.

- **D. Tiptap 3**: **PASS.** Checked npm directly before writing any code:
  `@tiptap/extension-collaboration@3.31.3`'s own `peerDependencies` are
  `{ yjs: '^13', '@tiptap/y-tiptap': '^3.0.7' }` -- hard-pinned to Yjs 13,
  same as stack 13 uses. No `@y/tiptap`, `@tiptap/y-prosemirror` or
  `@y/y-tiptap` package exists on npm (all 404). So Tiptap 3.31.3 **core**
  (`@tiptap/core`, `@tiptap/pm`, exact same version as stack 13) works
  fine, but its own collaboration/cursor/undo extensions cannot be used at
  all here. **What replaced them** (`src/tiptapClient.ts`, ~35 lines total):
  three thin `Extension.create()` wrappers around `@y/prosemirror`'s own
  `syncPlugin()` (~10 lines), `yCursorPlugin(awareness)` (~8 lines), and
  `yUndoPlugin(undoManager)` plus Mod-Z/Mod-Y/Mod-Shift-Z keyboard
  shortcuts calling `undoCommand`/`redoCommand` directly (~14 lines) --
  the same pattern the upstream Tiptap 3 demo the brief names uses, for the
  same reason (its own comment: "we deliberately do NOT use
  `@tiptap/extension-collaboration`: it wraps the OLD y-prosemirror
  ySyncPlugin and is incompatible with the new attribution binding"). All
  checks pass: single `prosemirror-model`/`prosemirror-state` instance
  (`npm ls`), the generic schema converter's Tiptap-generated schema is
  equivalent to `src/schema.ts`, gate B's script converges through two live
  Tiptap editors (editor1 = editor2 = relay, every linked image keeps its
  mark), each editor renders the other's caret, and alice's undo removes
  only her own change.

- **E. Attribution**, two parts (brief 04 task 4). **PASS.**

  **(a) Server-side mapping**, ported to `@y/y`'s own `IdMap`/
  `createContentAttribute` (`src/attribution.ts`) instead of a hand-rolled
  map, per the brief: `createContentIdsFromUpdate(update)` decodes an
  incoming update's content ids into an `IdSet` (the modern equivalent of
  stack 13's `Y.parseUpdateMeta`, from `yjs-attributing.md`'s own worked
  example), `createIdMapFromIdSet(idset, [createContentAttribute('user',
  user), createContentAttribute('at', serverReceivedAt)])` tags every
  range, and `mergeIdMaps` folds each update in; `encodeIdMap`/`decodeIdMap`
  persist it inside the document's own `phraise-attribution` node (via
  `getAttr`/`setAttr` -- `@y/y`'s `Doc` has no more `getMap`/`getText`,
  every shared type comes from `.get(name)`), so it rides the existing
  SQLite persistence for free, same as stack 13's design and for the same
  reasons. What stays hand-rolled, and why: forged-client-ID collision
  detection (a first-writer-wins audit log `IdMap` has no first-class
  notion of) -- derived by reading the first `user` attribute already on
  file for a client before merging a new update under a different user.
  Same listing/reconnect/reload/restart/size checks as stack 13, all pass;
  attribution overhead ~25-30% of document size on the small test fixture
  (absolute bytes are tiny either way at this corpus size).

  One real bug found and fixed while building the collision test (kept as
  `scratch/probe-collision.ts`): forging a raw update under alice's real
  clientID by starting a brand-new empty `Y.Doc` and reassigning its
  clientID makes that doc's own clock for the client start at 0, which
  **collides** with the clock range alice's real edits already occupy in
  the actual document -- Yjs treats a fully-already-known struct as
  redundant and produces an **empty** outgoing update (nothing new to
  broadcast), so the forgery silently never reaches `recordAttribution` at
  all (which returns immediately on an empty content-id set). Fixed by
  syncing the forging doc with alice's current full state first (a real
  attacker who can read the synced document has this too), so its clock
  bookkeeping continues genuinely new values -- a real,
  indistinguishable-from-legitimate forged continuation, which the
  collision check then correctly flags.

  **(b) Suggestion mode** (`gates/gateE-suggestion.ts`), following the
  upstream demo: a second `Y.Doc` (`suggestionDoc`, seeded from the live
  doc), bound with `Y.createDiffRenderer(ydoc, suggestionDoc, {
  attributions })` and `configureYProsemirror({ ytype, renderer })`; alice
  edits the live document directly; bob works in suggestion mode: inserts
  text, deletes a word, adds a link to an image. **Works, with one real
  gotcha needing a second attempt** (both kept in
  `scratch/probe-suggestion-mode.ts`): tagging the `attributions` ContentMap
  with `createContentAttribute('insert'/'delete', 'bob')` **after** bob's
  edits already happened came back with `userIds: []` every time --
  `DiffRenderer` reads the ContentMap fresh inside its own
  `beforeObserverCalls` listener **at the time of each transaction**, not
  once at construction, permanently baking in whatever attribution existed
  in the map at that exact moment; populating it afterward was too late.
  Fixed by registering our OWN `beforeObserverCalls` listener on
  `suggestionDoc` **before** constructing the `DiffRenderer` (whose
  constructor attaches its own listener for the same event) -- Yjs fires
  same-event listeners in registration order, so tagging the map with
  `tr.insertSet`/`tr.deleteSet` from our listener always runs first. With
  that fix: alice's view of the suggestion doc shows `y-attributed-insert`/
  `-delete`/`-format` marks with `userIds: ["bob"]`; `acceptChanges`/
  `rejectChanges` behave correctly (reject restores the deleted word,
  accept keeps the insert as real content, using real doc positions -- an
  earlier `textContent.indexOf`-based position calc under-counted after the
  image atom and produced a wrong accept range, fixed too); only the
  explicitly accepted insert reaches the live document, the untouched
  link-format suggestion correctly stays pending.

  **Schema hardening** (`src/schema.ts`): the four canonical marks
  (`y-attributed-insert`/`-delete`/`-format`/`-attrs`) were added, since
  ATTRIBUTION.md is explicit they are not configurable and must be declared
  by name. **Scope note**: this test's scenario is entirely inline (insert
  text, delete a word, add a link mark to an image inside one existing
  paragraph) and never suggests a whole block insert/delete, so no node's
  `marks:` content expression needed to change -- every node with inline
  content (`paragraph`, `heading`, `table_cell`) already defaults to
  "allow all marks" with no explicit `marks:` field. A real Phraise
  integration that also suggests whole-block changes would additionally
  need the container relaxations and `--attributed` variants ATTRIBUTION.md
  describes (`doc`, `blockquote`, `bullet_list`, `ordered_list`, `table`,
  `table_row` currently omit `marks:`, which ProseMirror resolves to "no
  marks on my block children") -- not implemented here, out of scope for
  what gate E's scenario exercises. `y-attributed-attrs` (the node-attr
  variant) was added for completeness but never exercised by this scenario
  either.

  **Serialization leak**: confirmed real. `serializeDoc` (spike 1's
  serializer) **throws** `Cannot handle unknown node \`y-attributed-format\``
  on ANY document that still carries an unresolved `y-attributed-*` mark --
  the serializer has no notion of these marks at all and cannot skip them.
  A real integration **must** strip every `y-attributed-*` mark before
  calling `serializeDoc`, or resolve (accept/reject) every suggestion
  first; there is no automatic exclusion.

  **Is suggestion mode usable for Phraise?** For the inline case (text
  insert/delete/format inside existing blocks), yes, with modest
  integration cost: the four marks in the schema, a `beforeObserverCalls`
  listener ordered before the renderer's own to populate attribution, and a
  mark-stripping pass before serialization. For whole-block suggestions
  (suggesting to delete/insert an entire paragraph, list item, table row,
  etc.), the container relaxation and `--attributed` variant work described
  above and in ATTRIBUTION.md is real, non-trivial additional schema work
  this brief did not need to do and did not do.

- **G. Persistence and reconnect**: same four scenarios as stack 13's gate
  G, against Hocuspocus. **PASS, all four.** G1 (SIGTERM restart): content
  intact, new edits propagate after reconnect. G2 (SIGKILL, before and
  after the debounce): the live client's own memory always retains its
  edit; the relay has it too once a reconnect resyncs it, regardless of
  whether the debounced SQLite write landed before the kill. G3 (edits
  made while the relay is fully down): both editors keep accepting local
  transactions with no connection at all, and converge with the relay once
  it restarts. G4 (an editor goes offline mid-session, both sides edit the
  same paragraph AND the same image's link concurrently, then it
  reconnects): both text insertions survive (CRDT interleaves rather than
  drops concurrent inserts), the same-node link conflict resolves
  deterministically to one of the two concurrent writes (not corrupted or
  duplicated), and all three (editor1, editor2, relay) converge.

- **F. Rebase port** (brief 06): spike 2's own rebase scenario
  (`src/rebase/gates/scenario.ts`'s `MD_A` -> `MD_B`, alice online, bob
  offline, three comments planted at commit A) run on the real stack --
  a live Hocuspocus relay (`rebase:` documents, `POST /rebase/<docName>`)
  and two live ProseMirror `EditorView`s (`src/rebase/liveClient.ts`) --
  instead of spike 2's in-memory `Replica` harness. **PASS, every
  sub-check, on the first attempt** (`npx tsx scripts/run-gate-f.ts`, ports
  4257/4258): rebase applied while alice is online and bob is offline;
  alice/bob/relay converge on ProseMirror JSON and on `review` state; the
  untouched-paragraph comment resolves via CRDT; the rewritten-paragraph
  comment ("plan for the rollout") resolves via CRDT (this stack's
  `lib0`-diff keeps the CRDT anchor for any text unchanged between commits,
  same effect as stack 13's word-granularity mode); the deleted-paragraph
  comment orphans with its quote kept exact and the negative control (a
  similar "harbor" paragraph) is not falsely captured; both P (bob,
  offline) and Q (alice, online) are flagged `concurrent-edit` with no
  unexpected flags elsewhere; P2 (deleted upstream, edited offline by bob)
  is resurrected exactly once, flagged `deleted-upstream-edited-locally`;
  every untouched block equals commit B verbatim on all three peers; a
  retried identical POST is a true no-op (`{"applied":false,"reason":
  "already at target"}`, byte-identical PM JSON and review state before and
  after). The continuous-typing variant (alice fires 40 single-character
  inserts with the rebase POST fired mid-burst) also passes: all 40 land as
  one intact run, the rebase still applies, and all three still converge.

  **Do fork-at-snapshot and deterministic client IDs exist on Yjs 14, and
  what had to change** (the charter's own question for this gate):
  **yes, unchanged.** `Y.createDocFromSnapshot`, `Y.snapshot`,
  `Y.encodeSnapshot`/`decodeSnapshot`, and an assignable `Doc.clientID` all
  exist on `@y/y` with the same signatures as Yjs 13 (`Y.Snapshot`'s shape
  is the same `{sv, ds}`, `ds` now an `IdSet` instead of a `DeleteSet`) --
  confirmed empirically (`scratch/probe-rebase-primitives.ts`) before
  porting `rebase.ts`, not assumed from stack 13's port. What DID have to
  change, beyond the mechanical `Y.Node`-for-`Y.XmlElement`/`Y.XmlText`/
  `Y.Map` substitution every ported file needed:
  1. **Task 2's diff emitter is not a retargeted port of spike 2's
     hand-rolled LCS+Dice-similarity diff at all.** `@y/prosemirror`'s own
     binding calls a private function, `pmDocDiff`, to do this exact job on
     every keystroke -- not exported from the package's public API (its
     `package.json` "exports" field blocks reaching into the internal
     module, checked before relying on either). Per the brief's own named
     fallback, `diff.ts` instead calls `lib0/delta`'s own public `diff()`
     on the two documents' canonical `docToDelta()` snapshots. This is not
     a downgrade: reading `lib0/delta/delta.js` confirms `diff()` already
     recurses into matched children via `modify` and aligns text at
     line/word(`patience.smartSplitRegex`)/char granularity -- the exact
     same call `pmDocDiff` itself delegates to internally for any
     non-trivial window. So the brief's "preferred" (word-level, per-block,
     binding-shaped encoding) and "fallback" (`delta.diff` against
     `pmnodeToDelta(pmB)`) approaches turn out to be the SAME mechanism
     once `pmDocDiff`'s private wrapper is unavailable -- **task 2 needed
     one attempt, not two.** `diff.ts` shrank from 428 lines (spike 2
     original / stack 13's port, unchanged) to **58 lines**.
  2. **`Y.isDeleted(ds, id)` has no Yjs14 equivalent.** `@y/y`'s own
     (unexported) `isVisible(item, snapshot)` uses `snapshot.ds.hasId(item.id)`
     (an `IdSet` method) instead -- confirmed by reading `ynode.js` directly.
     `isVisibleAt` (`integrate.ts`) is a verified hand-port of that exact
     logic under a different name.
  3. **A textblock's own content IS its text**, not a nested child type.
     Spike 2's schema has no inline atoms, so in Yjs 14's unified model a
     paragraph/heading/code_block `Y.Node`'s own item chain holds
     `ContentString` (text) and `ContentFormat` (mark boundary) items
     directly -- there is no nested `Y.XmlText` to find. This actually
     SIMPLIFIES `text.ts` and `comments.ts` (one less indirection) but means
     `integrate.ts`'s block-signature/content functions at an arbitrary
     point in time (`blockDeltaAt`) have to be hand-rolled: `Y.Node#toDelta()`
     has no raw-`Snapshot` parameter (its `itemsToRender: IdSet` option is
     for attribution/diff rendering, not point-in-time reconstruction), and
     this file needs three different snapshots (base, target, pre-merge P)
     on the same live tree. `blockDeltaAt` mirrors Yjs's own internal
     `Text#toDelta(snapshot)` algorithm (walk the item chain, track a
     running format map from visible `ContentFormat` markers, emit merged
     runs for visible `ContentString` items) -- structurally verified by
     reading `@y/y`'s own `isVisible`/`Item`/`ContentFormat` source, not
     assumed.
  4. **Resurrection uses `Y.Node`'s built-in content-copy pattern instead
     of stack 13's hand-rolled op-by-op tree rebuild.** A brand new
     detached `Y.Node`, given content via `applyDelta` while still detached
     (deferred to Yjs's own `_prelim` mechanism until the node is inserted
     somewhere -- verified empirically, including a first attempt that read
     the still-detached node back too early and wrongly saw it as empty,
     logged in the probe script), reads back correctly once inserted into
     the live ancestor.
  5. `RelativePosition`/`AbsolutePosition` (`createRelativePositionFromTypeIndex`,
     `createAbsolutePositionFromRelativePosition`) work **unchanged** on a
     `Y.Node` -- same signature, same `_start`/`.right` walk internally
     (confirmed by reading `RelativePosition.js`).
  6. `Y.Map` (stack 13's `PHRAISE_MAP`/`AUTHORS_MAP`/`REVIEW_MAP`/
     `COMMENTS_MAP`) becomes a `Y.Node` used purely as an attr bag
     (`setAttr`/`getAttr`/`getAttrs(snapshot)`/`forEachAttr`) -- the same
     pattern `src/attribution.ts` (brief 04) already established.
     `getAttrs(snapshot)` usefully takes a raw `Y.Snapshot` directly (unlike
     `toDelta`), confirmed empirically.
  7. Same design as stack 13: the per-replica "P = state just before this
     batch" step is the Y.Doc's own `beforeTransaction`/`afterTransaction`
     events (`liveIntegration.ts`), confirmed unchanged on `@y/y`'s `Doc`;
     the relay is a replica too and needed the same relay-ack-immediately
     fix stack 13 found by running its own gate F live (full trace in its
     brief-05 log) -- ported here proactively into `relay-hocuspocus.ts`'s
     `/rebase` route rather than rediscovered by reproducing the bug fresh,
     then re-verified end-to-end by this gate passing outright (gate F's
     own D check -- "no unexpected flags" -- is exactly what would have
     caught a missing fix).
  8. `gc:false` is required on both the relay (`yDocOptions`) and every
     live client's `Y.Doc`, same as stack 13 -- checked first that no
     existing gate (A/B/C/B3/D/E/G) depends on GC being on before applying
     it relay-wide.
  9. No `y-prosemirror` -> binding-library import retargeting was needed in
     `seed.ts`/`diff.ts` (unlike stack 13's `@tiptap/y-tiptap` retarget):
     this stack's own binding, `@y/prosemirror`, was used directly.

  **Line counts, `src/rebase/` total** (spike 2 original -> stack 13's port
  -> stack 14's port): schema/ids/markdown unchanged throughout (116+27+103).
  `text.ts` 89 -> 89 -> 93. `diff.ts` 428 -> 428 -> **58**. `seed.ts` 80 ->
  80 -> 76. `rebase.ts` 143 -> 143 -> 138. `integrate.ts` 280 -> 280 -> 306
  (the hand-rolled `blockDeltaAt` point-in-time reconstruction). `comments.ts`
  316 -> 316 -> 286 (simpler: no nested XmlText indirection). `replica.ts`
  355 -> 355 -> 274. `liveIntegration.ts`/`liveClient.ts` (stack 13 only,
  brief 05) 101+106 -> this stack's 79+99. **Total: stack 13's port 2144
  lines -> stack 14's port 1655 lines** (~23% fewer, almost entirely
  `diff.ts`'s simplification). `gates/gateF.ts`: stack 13's 424 lines ->
  this stack's 394 (same scenario/checks, fewer lines from the simpler
  `review`-state read and no `granularity` parameter threading).

  Delivery-model note (same as stack 13, stated plainly): Hocuspocus's real
  y-protocols sync is bidirectional and automatic on (re)connect -- there
  is no "deliver one update at a time" hook, so gate F does not repeat
  spike 2's own gate D permutation/shuffle sweep; that sweep already ran
  headlessly against this exact port (`npm run rebase:baseline`, 6
  permutations + 50 shuffles, all converged) before gate F ever started a
  relay.

## Compatibility probe (brief task 6 / task 2's attempt (c))

`compat/scripts/compat.ts` (`npm run compat` from `compat/`, a separate
subpackage with real, unaliased `yjs@13.6.33` and `@y/y@14.0.0-rc.26` side
by side):

1. **Yjs 13 encodes -> Yjs 14 applies -> `ynodeToPmnode` reads**: applies
   without throwing; reads back **fully and correctly** (content, structure
   all correct). `frontmatter` (root attr) comes back `null` and the
   fixture's `image` has no `marks` -- confirmed, separately, that this is
   **not a new loss from crossing versions**: y-prosemirror 1.3.7 never
   wrote either to begin with (the same two losses stack 13 has throughout
   this spike). Whatever Yjs 13 actually captured, Yjs 14 reads back intact.
2. **Yjs 14 encodes -> Yjs 13 applies -> `yXmlFragmentToProseMirrorRootNode`
   reads**: the raw update **applies without throwing** on a real Yjs 13
   `Y.Doc` (the low-level struct/item wire format is evidently compatible
   both directions), but reading it back through y-prosemirror 1.3.7
   **throws**: `Cannot read properties of undefined (reading 'right')`.
3. **Is a real Yjs 13 `Y.XmlFragment` readable by `@y/prosemirror` at all**
   (no update round trip, same runtime): **no** --
   `ynode.toDeltaDeep is not a function`; the class simply lacks the
   methods `@y/prosemirror` expects of a `Y.Node`.
4. Real Yjs 13's `y-protocols/sync`'s `writeSyncStep1` **does not throw**
   against a `@y/y` `Y.Doc` (12 plausible bytes) -- see "Relay attempts (c)"
   above for why this alone still doesn't add up to a working relay.

**Reading direction matters**: Yjs 13 -> Yjs 14 is safe and lossless for
whatever Yjs 13 actually wrote (a real, low-risk migration path: re-seed a
Yjs 14 document straight from a Yjs 13 document's raw update bytes). Yjs 14
-> Yjs 13 does not work today. Both directions apply the raw bytes without
throwing (the update/struct format itself is compatible); only the
high-level type wrapper (`Y.XmlFragment` vs `Y.Node`) is not.

## Known limitations

- Gate C path B: see above -- 234/266, root-caused to an upstream
  `@y/prosemirror` diffing bug specific to whole-document-replacing
  transactions, not to this spike's schema/parser/serializer or its own
  relay/client code (path A, which never does this, is 266/266). Unchanged
  by the relay switch to Hocuspocus (confirmed: same 234/266, same failure
  list, this brief).
- Gate B3: cases 3-4 FAIL as the brief expects (an upstream
  `@y/prosemirror` mark-vs-attr co-change bug, not this spike's code) --
  see the "Gates" section's B3 entry for the root-cause account.
- Gate A's latency number is a polling artifact, not a real network
  measurement (identical caveat to stack 13's gate A, and to both relay
  flavors here).
- A cosmetic side effect of the schema hardening added for gate E part (b):
  every gate now logs `[y/prosemirror] a view-side change removed the
  render-only attribution format "y-attributed-attrs"; it was swallowed`
  once, and `[y/prosemirror] these node types do not allow the attribution
  marks this binding renders: ...` when a renderer is configured (gate E
  only) -- both are the binding's own bind-time/runtime audits reacting to
  the four marks now being declared in the schema at all, regardless of
  whether a gate touches attribution. Confirmed harmless: every other gate
  (A, B, C, B3, D, G) passes identically with or without these warnings
  present, since none of them ever populate a `y-attributed-*` mark.
- Gate E part (b)'s schema hardening is scoped to what its own inline-only
  scenario needs (the four marks; no container relaxation, no
  `--attributed` variants) -- see that gate's own entry above for exactly
  what a whole-block suggestion scenario would additionally require.
- `src/relay-custom.ts` / `client-custom.ts` (brief 02's attempt (b),
  renamed) remain fully working and are still exercised (gate A only, per
  the brief's "alternative behind a flag").
- Row H ("Maturity") is reported as "not run" in `results/gates.md` -- it
  is the orchestrator's own primary-source gate per the plan (release
  cadence, breaking changes, open issues); this brief's (and brief 02's)
  compat probe above covers the "documents written by 13 read by 14 and the
  reverse" half of it specifically. Row F ("later brief") is no longer
  "not run" -- brief 06 implemented it; see the "Gates" section's F entry.
- Brief 06's gate B (spike 2's own headless gates, `npm run rebase:baseline`,
  distinct lettering from this package's own A-G table) is adapted, not
  ported verbatim, from stack 13's own gate B: stack 13 forced three diff
  granularities (word/char/block) to show word/char preserve a comment's
  CRDT anchor while block (a no-diffing whole-text replace) destroys it.
  This stack's `diff.ts` has one algorithm (`lib0/delta`'s own diff) with
  no granularity knob, so there is no way to force "destroy the anchor"
  that way -- adapted to verify what's left to test (the anchor SURVIVES an
  in-place rewrite); the "anchor breaks, falls back to fuzzy" case is still
  covered, by that same headless suite's gate C (a whole paragraph deleted,
  a strictly harder version of the same loss) and by gate F's live C check.
