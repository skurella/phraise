# Stack 14: `@y/y` 14.0.0-rc.26 + `@y/prosemirror` 2.0.0-13, a custom relay

Status: brief 02 (gates A, B, C-equivalent, Yjs 13/14 compatibility probe) done. See
[the log](../../context/logs/2026-09-27-builder-spike-5-stack14-core.md) for the
full narrative, including the two real bugs found and fixed along the way and
one that was found and **not** fixed (a genuine upstream bug, out of scope).

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
`src/client.ts` differ). `src/index.ts` was adjusted (no
`encodeLeafMarks`/`decodeLeafMarks` re-exports -- there is no leaf-marks
workaround in this stack).

Spike 2's Yjs 14 binding probe (branch `spike/2026-09-27-crdt-rebase` at
`88bd85c`, directory `spikes/2026-09-27-crdt-rebase-binding-probe/`,
`test/yjs14-prosemirror.spec.ts` and its README) was read for the exact
`@y/prosemirror` API shape (`pmnodeToDelta`, `ynodeToPmnode`, `syncPlugin()`,
`configureYProsemirror({ ytype })`, every shared type is a `Y.Node` via
`doc.get('prosemirror')`) before writing `src/yjs.ts`, but no code from it
was copied (it uses its own tiny schema, not spike 1's).

## Layout

- `src/schema.ts`, `src/parse.ts`, `src/serialize.ts`, `src/style.ts`,
  `src/compare.ts`, `src/index.ts` -- spike 1's document model, unchanged.
- `src/yjs.ts` -- the Yjs boundary. **No workaround code at all**: seed with
  `ytype.applyDelta(pmnodeToDelta(doc))` on `ydoc.get('prosemirror')`, read
  with `ynodeToPmnode(ytype, schema)`. Both of stack 13's losses (root `doc`
  attrs, marks on inline atom nodes) are structurally fixed in this binding
  -- see the file's header for why.
- `src/relay.ts`, `src/client.ts` -- **attempt (b)**, the relay and client
  actually used by the gates (below): a minimal custom relay on `ws` and
  `@y/protocols`, and a small hand-rolled provider on the client side, both
  speaking the same wire protocol as the reference `y-websocket`
  implementation. See "Relay attempts" below for why, and why not Hocuspocus.
- `src/relay-attempt-a-hocuspocus.ts`, `src/client-attempt-a-hocuspocus.ts`
  -- **attempt (a)**, kept for reference/reproducibility, not used by the
  gate runner: Hocuspocus 4.7 + SQLite persistence with npm `overrides`
  aliasing `yjs`/`y-protocols` to `@y/y`/`@y/protocols`. Crashes the moment a
  real client connects (see below); not wired into `scripts/gates.ts`.
- `src/harness.ts` -- `startRelay()`/`stopRelay()`, identical in substance to
  stack 13's (spawns whichever `src/relay.ts` as a real child process).
- `gates/gateA.ts`, `gates/gateB.ts`, `gates/gateC.ts` -- the three gates,
  same shape as stack 13's; `gates/lib/edits.ts` (byte-identical to stack
  13's) and `gates/lib/equality.ts` (adapted: no codec/no-codec distinction,
  since there is no workaround and no `plain:` negative control here).
- `scripts/gates.ts` -- the gate runner, same shape as stack 13's.
- `compat/` -- a **separate subpackage** (own `package.json`, own
  `node_modules`, no npm `overrides`) for task 6's Yjs 13 / Yjs 14
  compatibility probe: real `yjs@13.6.33` + `y-prosemirror@1.3.7` alongside
  `@y/y` + `@y/prosemirror`, unaliased. `compat/scripts/compat.ts` (`npm run
  compat` from `compat/`) -- see "Compatibility probe" below.
- `scratch/` -- standalone debugging scripts written while chasing the two
  bugs below (`probe-alias.mjs`, `smoke-one-client.ts`,
  `smoke-two-clients.ts`, `debug-pathb-pair.ts`); not part of the gate
  runner, excluded from `tsconfig.json`, kept as reproducible evidence.

## Relay attempts (brief task 2)

**(a) Hocuspocus 4.7 + npm `overrides` aliasing `yjs`/`y-protocols` to
`@y/y`/`@y/protocols` -- fails.** `npm install` needed `yjs`/`y-protocols`
removed from direct `dependencies` (an explicit direct dependency conflicts
with an `overrides` entry for the same name; they only need to exist as
Hocuspocus's own peerDependencies, which the override then redirects).
Install then succeeds, and the relay alone starts and serves `/state` fine
-- but the moment a real client connects and the sync handshake runs, it
crashes with `RangeError: Maximum call stack size exceeded` in
`lib0/encoding.js`'s `writeAny`. Root cause, confirmed directly: the
top-level `node_modules/lib0` (used by `@hocuspocus/common`/`server`/
`provider`, which declare `lib0: ^0.2.117`) is `0.2.118`, while the aliased
`yjs` (really `@y/y`) and `@y/prosemirror` each carry their **own nested**
`node_modules/lib0` at `1.0.0-rc.33` (satisfying `@y/y`'s `lib0:
^1.0.0-rc.29`) -- two incompatible major versions of `lib0`'s
`Encoder`/`Decoder` coexist in one process, and the sync handshake ends up
handing an object built by one to code built against the other. This is a
transitive dependency-range split baked into the packages' own published
`package.json`s, not fixable locally. Kept as
`src/relay-attempt-a-hocuspocus.ts` / `src/client-attempt-a-hocuspocus.ts`
for reference; `@hocuspocus/*` and the `overrides` block remain in
`package.json` so that code still resolves, but nothing in the gate runner
uses it.

**(b) A minimal custom relay on `ws` and `@y/protocols` -- works, used by
the gates.** `src/relay.ts` + `src/client.ts` (see "Layout" above). Two real
bugs found and fixed before this worked (full detail, including the exact
crashes and the debugging steps, in the log):

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
   `src/relay.ts` and `src/client.ts` (comments there explain why).

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
npm ci
npm run fetch        # corpus/fetched/ (gitignored), if missing
npm run gates:quick  # gates A, B, C on a 5-file corpus sample -- ~4s
npm run gates        # same, C over the full real corpus (266 files) -- ~65s
npx tsc --noEmit

cd compat && npm install && npm run compat && npx tsc --noEmit
```

Writes `results/gates.md` and `results/gates.json`. No relay process is left
running after any command, including a failing one -- same mechanism as
stack 13 (`src/harness.ts`'s `startRelay`/`stop()` in every gate's `finally`
block, plus a process-level exit hook); checked directly with
`lsof -nP -iTCP:4240-4269 -sTCP:LISTEN` after every run in this brief.

## Gates

- **A. Relay**: same script as stack 13's gate A (two live editors, each
  typing into a different paragraph, then 20 single-character round trips).
  **PASS**, median round-trip latency 23.0ms (stack 13: ~20-23ms; same
  polling-interval caveat as stack 13's gate A applies here too -- not a
  real network measurement).
- **B. Schema fidelity while editing**: the plan's identical scripted edit
  sequence (`gates/lib/edits.ts`, byte-identical to stack 13's) on
  `fixtures/live.md`, **with no workaround plugins at all** (there are
  none). **PASS**: editor1, editor2 and the relay's stored document are
  semantically equal and byte-identical on `serializeDoc`; every linked
  image (`badge.svg` across split/join, `logo.png`, `icon.png` -- a link
  mark added live mid-session -- and `pasted.png` from the paste step) kept
  its link mark. Unlike stack 13, there is no negative control to run (no
  workaround to demonstrate the absence of). Brief-specific extra check:
  the number of Yjs updates stops growing after settling -- **stable at 23**
  immediately after convergence and 500ms later.
- **C. Corpus round trip (no workaround needed)**: both of stack 13's gate C
  paths, over the full 266-file real corpus.
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
  relay/client code (path A, which never does this, is 266/266).
- Gate A's latency number is a polling artifact, not a real network
  measurement (identical caveat to stack 13's gate A).
- `src/relay-attempt-a-hocuspocus.ts` / `client-attempt-a-hocuspocus.ts` are
  reference-only: they compile (`npx tsc --noEmit` at the top level
  includes them and is clean) but are known to crash at runtime the moment
  a real client connects (see "Relay attempts (a)"); not exercised by
  `npm run gates`.
- Rows D through G ("later brief") and H ("Maturity") are reported as "not
  run" in `results/gates.md` per the brief -- H's fuller maturity write-up
  (release cadence, breaking changes, open issues) is the orchestrator's
  own primary-source gate per the plan; this brief's compat probe above
  covers the "documents written by 13 read by 14 and the reverse" half of
  it specifically, since task 6 assigned that measurement here.
