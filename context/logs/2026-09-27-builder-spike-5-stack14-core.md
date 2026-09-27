# Log: builder, spike 5, stack 14 foundation (brief 02)

Status: in progress
Author: builder (Sonnet), model claude-sonnet-5
Updated: 2026-09-27
Brief: [brief 02](../plans/2026-09-27-spike-5-brief-02-stack14-core.md)
Plan: [spike 5 plan](../plans/2026-09-27-spike-5-plan.md)
Charter: [spike 5 charter](../plans/2026-09-27-spike-5-charter-collab-stack.md)

Time zone: local machine time (CEST, per `date`).

## 08:59 — task received

Read AGENTS.md, brief 02, the plan, and the charter's "Rules for every agent
in this spike" section. Read stack 13's README and its source (schema.ts,
parse.ts skimmed, yjs.ts, relay.ts, harness.ts, client.ts, gates/*,
gates/lib/*, scripts/gates.ts, package.json, tsconfig.json) to know exactly
what to copy vs rewrite. Read spike 2's Yjs 14 binding probe
(`test/yjs14-prosemirror.spec.ts` and its README) at the scratchpad ref path
the brief names (origin branch `spike/2026-09-27-crdt-rebase`, commit
`88bd85c`) for the `@y/prosemirror` API shape: `pmnodeToDelta`,
`ynodeToPmnode`, `syncPlugin()`, `configureYProsemirror({ ytype })`, every
shared type is a `Y.Node` via `doc.get('prosemirror')`.

Checked npm registry directly: `@y/y@14.0.0-rc.26`, `@y/prosemirror@2.0.0-13`,
`@y/protocols@1.0.6-rc.1` all resolve. `@y/websocket` only goes up to
`4.0.0-rc.2` on npm (brief says `4.0.0-rc.2` exists — confirmed).
`@hocuspocus/server@4.7.0` and `@hocuspocus/provider@4.7.0` both declare
`yjs: ^13.6.8` and `y-protocols: ^1.0.6` as **peerDependencies** (not regular
dependencies) — confirmed by `npm view ... peerDependencies`, and confirmed
the actual import in `node_modules/@hocuspocus/server/dist/hocuspocus-server.esm.js`
is `import { Doc, applyUpdate, encodeStateAsUpdate, mergeUpdates } from "yjs"`
(plus `Y.*` namespace uses for `snapshot`/`snapshotContainsUpdate`, per the
brief). This is the exact surface an npm `overrides` alias has to satisfy.

Plan: scaffold the directory, attempt relay path 2a (Hocuspocus + overrides)
first since the brief's stopping-point condition depends on trying all
three relay attempts in order.

## 09:04 — task 1 done: scaffold, copy, no-edit round trip

Created `spikes/2026-09-27-collab-stack-yjs14-rc/`. Copied unchanged from
stack 13 (origin: same as stack 13's own README states, i.e. branch
`spike/2026-09-27-markdown-round-trip` at `1e1f4a6`, copied via stack 13's
directory per the brief): `src/schema.ts`, `src/parse.ts`,
`src/serialize.ts`, `src/style.ts`, `src/compare.ts`, `fixtures/live.md`,
`corpus/manifest.json`, `corpus/specs.json`, `corpus/handwritten/*.md`,
`scripts/fetch-corpus.mjs`, `scripts/quick-roundtrip.ts`,
`gates/lib/edits.ts` (gate B's edit script, kept byte-identical in
substance per the brief). Wrote new `package.json` (pins:
`@y/y@14.0.0-rc.26`, `@y/prosemirror@2.0.0-13`, `@y/protocols@1.0.6-rc.1`,
no `@tiptap/y-tiptap`), `tsconfig.json`, `src/index.ts` (adjusted: no
`encodeLeafMarks`/`decodeLeafMarks` re-exports since there is no leaf-marks
workaround here), and a new `src/yjs.ts` (below).

`npm install`, `npm run fetch` (266 real corpus files), then
`npx tsx scripts/quick-roundtrip.ts`: **294/294 byte-identical** (266 real +
28 handwritten) -- matches stack 13's own figure, confirms the copied
parser/serializer core is intact in the new package.

Wrote `src/yjs.ts`: seed with `ytype.applyDelta(pmnodeToDelta(doc))` on
`ydoc.get('prosemirror')`, read with `ynodeToPmnode(ytype, schema)`. No
workaround code at all (unlike stack 13's `src/workarounds/`) -- per spike
2's binding probe (read before writing this, at the scratchpad ref path the
brief names), both of stack 13's losses (root `doc` attrs, marks on inline
atom nodes) are structurally fixed in this binding: every shared type is a
single `Y.Node`, and `nodeToDelta` attaches `marksToFormattingAttributes`
to every child's insert op unconditionally, not gated on `isText`.

## 09:07 — task 2, attempt (a): Hocuspocus 4.7 + npm overrides -- FAILS

`package.json` additions: `@hocuspocus/server@4.7.0`,
`@hocuspocus/provider@4.7.0`, `@hocuspocus/extension-sqlite@4.7.0`, plus
`"overrides": {"yjs": "npm:@y/y@14.0.0-rc.26", "y-protocols": "npm:@y/protocols@1.0.6-rc.1"}`.
First attempt included `yjs`/`y-protocols` as explicit direct dependencies
too (to mirror stack 13's import style) -- `npm install` refused outright:
`npm error code EOVERRIDE / Override for yjs@13.6.33 conflicts with direct
dependency`. Fix: removed both from `dependencies` entirely (they only need
to exist as peerDependencies of `@hocuspocus/server`/`@hocuspocus/provider`,
which is where the override actually applies); `npm install` then succeeded
cleanly (262 packages, no ERESOLVE).

Confirmed directly: `node_modules/yjs` and `node_modules/@y/y` are two
**physically separate** directories with byte-identical `package.json`
content (`diff` empty) -- `npm:` aliasing does not dedupe against the real
package name already present in the graph. A standalone probe
(`scratch/probe-alias.mjs`, kept for reference) importing both `yjs` and
`@y/y` in one process printed Yjs's own guard: `"Yjs was already imported.
This breaks constructor checks and will lead to issues!"` -- but a bare
headless `pmnodeToDelta`/`ynodeToPmnode` round trip through either copy's
`Y.Doc` still worked in that isolated probe.

Wrote `src/relay.ts` (Hocuspocus + SQLite, `file:` seeding only -- no
`plain:` control, per the brief) and `src/client.ts` (`syncPlugin()` +
`configureYProsemirror({ ytype })`, no workaround plugins), both disciplined
to import Yjs only via the bare `yjs` specifier (never `@y/y` directly) so
every Y.Doc instance Hocuspocus itself hands us stays on the one copy
Hocuspocus's own code uses -- see the header comments in both files for the
full reasoning.

Relay alone starts fine and serves `/state` (`relay-ready`, `GET
/state/file:live.md` -> HTTP 200). The moment a real client
(`createLiveClient`) connects and the provider's sync handshake actually
runs, it crashes:

```
Yjs was already imported. This breaks constructor checks and will lead to issues! - https://github.com/yjs/yjs/issues/438
FAILED RangeError: Maximum call stack size exceeded
    at writeAny (.../node_modules/yjs/node_modules/lib0/src/encoding.js:544:25)
    at writeAny (.../node_modules/yjs/node_modules/lib0/src/encoding.js:594:11)
    at writeAny (.../node_modules/yjs/node_modules/lib0/src/encoding.js:594:11)
    ... (repeats)
```

Root cause, confirmed directly: `node_modules/lib0` (top-level, used by
`@hocuspocus/common`/`server`/`provider`, all of which declare `lib0:
^0.2.117`) is **`0.2.118`**, while `node_modules/yjs` (the aliased `@y/y`
copy) and `node_modules/@y/prosemirror` each carry their own **nested**
`node_modules/lib0` at **`1.0.0-rc.33`** (satisfying `@y/y`'s own `lib0:
^1.0.0-rc.29`) -- two incompatible major versions of `lib0`'s
`encoding.js`/`writeAny` coexist in one process, and something in the
sync handshake ends up feeding a value with a circular reference (almost
certainly a raw Y object crossing the `yjs`/`@y/y` module-identity boundary
established above) into the wrong-major-version `writeAny`, which recurses
forever instead of hitting its normal base cases for that shape.

**Verdict: fails in a way not fixable in this spike's own code** -- it is a
transitive `lib0` major-version split baked into `@hocuspocus/common`'s and
`@y/y`'s own published `package.json` dependency ranges (`^0.2.117` vs
`^1.0.0-rc.29`), which no local override or narrow declaration in this
spike can reconcile; fixing it would mean patching or republishing
Hocuspocus's own dependency declarations. Per the brief, moving to attempt
(b). No relay process left running (`pkill -9 -f 'src/relay.ts'`, then
`lsof -nP -iTCP:4240-4269 -sTCP:LISTEN` empty -- confirmed).

## 09:25 -- task 2, attempt (b): minimal custom relay on ws + @y/protocols -- WORKS

Wrote `src/relay.ts` (the working relay from here on) and `src/client.ts`
(a hand-rolled provider), both speaking the same wire protocol as the
reference `y-websocket` server: `[messageType: varUint, ...]`, 0 = sync
(`@y/protocols/sync`), 1 = awareness (`@y/protocols/awareness`); both sides
send their own sync step 1 immediately on connect (symmetric handshake).
Persistence: one file per document, `<db-dir>/<encodeURIComponent(docName)>.yupdate`
holding `Y.encodeStateAsUpdate`, rewritten on every `Y.Doc` `update` event
(brief allows "file or SQLite"; chose file). Same `file:<relpath>` seeding
and `GET /state/<docName>` route as stack 13 and attempt (a). No `plain:`
control (no workaround to demonstrate the absence of).

Hit and fixed two real bugs before this worked:

1. Same duplicate-`lib0` problem as attempt (a), one level deeper: our own
   `relay.ts`/`client.ts` import bare `lib0/encoding`/`lib0/decoding`
   directly, which (before the fix below) resolved to the **top-level**
   `lib0@0.2.118` (needed by the Hocuspocus packages still in
   `package.json` for attempt (a)'s reference code) -- a different major
   version than the `lib0@1.0.0-rc.33` nested separately under
   `@y/protocols`, `@y/y`, `@y/prosemirror` and the aliased `yjs`, each of
   which resolves `lib0/encoding` from *its own* nested copy. Passing an
   Encoder/Decoder built by one major version into `@y/protocols`' own
   `writeSyncStep1`/`readSyncMessage` (built against the other) crashed
   with `RangeError: Maximum call stack size exceeded` in `writeAny` the
   moment a real client connected. Fixed by adding `"lib0": "1.0.0-rc.33"`
   as an explicit direct dependency in `package.json`: this makes the ROOT
   project's own resolution win the top-level `node_modules/lib0` slot,
   which then also satisfies (and so dedupes) every `@y/*` package's own
   `lib0` peer range -- confirmed directly (`ls node_modules/@y/*/node_modules`
   now empty for all four, only Hocuspocus's own nested copy remains at
   `0.2.x`). Kept `scratch/probe-alias.mjs` (a minimal standalone
   repro/probe of the "Yjs was already imported" cross-copy warning) for
   reference.

2. Real protocol bug in this spike's own relay/client code, not a
   dependency issue: both `send()` helpers wrote the one-byte
   `messageSync` wrapper into the reply `encoder` *before* calling
   `syncProtocol.readSyncMessage`, then guarded the send on
   `encoding.length(encoder) <= 0`. But `readSyncMessage` only ever writes
   a reply for an incoming **step 1** (replying with step 2); for step 2 or
   update messages it applies the change locally and writes nothing back
   -- so after the wrapper byte alone, length is 1, not 0, and the guard
   let a bare one-byte "messageSync, nothing else" message through. The
   peer's decoder then tried to read a *second* (inner) message-type byte
   from an already-exhausted 1-byte buffer and threw the same-looking
   `RangeError`-adjacent `Error: Unexpected end of array` (traced with
   temporary debug logging in both files, `PHRAISE_DEBUG_RELAY=1`, showing
   the exact offending message: `len=1 bytes=00` in both directions).
   Fixed by tightening both `send()` guards from `<= 0` to `<= 1`
   (comments explaining why are in both files now); debug logging removed
   afterward.

With both fixed: `scratch/smoke-two-clients.ts` (two clients, same
`file:live.md` document, concurrent connect) -- both synced, textContent
582 chars each, `badge.svg` kept its link mark. `npx tsx scripts/gates.ts
--quick`: **gate A PASS** (23.5ms median latency, matching stack 13's
~20ms order of magnitude), **gate B PASS** (editor1 = editor2 = relay,
every linked image kept its mark, Yjs update count stable at 23 after
settling), **gate C PASS** on the 5-file quick sample (path A 5/5, path B
5/5).

## Gate C, full corpus (266 files): path A perfect, path B has a real bug

`npx tsx scripts/gates.ts` (full, no `--quick`): gate A and B still PASS.
Gate C: **path A 266/266** (server-seeded, one fresh document per file --
matches how Phraise actually loads documents, D1). **Path B 234/266**
(client-loaded via `gates/lib/edits.ts`'s `replaceWholeDoc`, replaying a
single whole-document-replacing transaction into a *shared, reused* pair
of live clients across all 266 files in sequence, exactly as stack 13's
gate C path B does) -- 32 failures, all `byte mismatch` or a spike 1
serializer trace gap, appearing in streaks (e.g. files 64-66, 75, ... of
266) rather than every file, and **not reproducible in isolation**: taking
any single failing file with a *fresh* client pair (`scratch/debug-pathb-pair.ts`)
passes every time. Bisected to a genuine cross-document content bleed: with
a fresh pair, loading `npm-aws-sdk-readme.md` then `npm-axios-readme.md`
back to back reproduces it every time (`scratch/debug-pathb-pair.ts
npm-aws-sdk-readme.md npm-axios-readme.md`); the byte diff at offset 24412
of axios's own README shows its Sauce Labs badge link literally carrying
**aws-sdk's** `href` (`.../package/aws-sdk` where axios's original file has
`.../u/axios`) -- and the corruption is already present in `editor1` (the
one that dispatched the replace transaction) before any Yjs round trip, so
this is not a CRDT/network desync, and both editor1 and editor2 agree with
each other and disagree with the source file identically (same wrong
text), so it isn't the two peers diverging from each other either.

Traced (not patched -- an upstream RC bug, out of this brief's "no
workarounds" scope and its narrow-declaration budget) to
`node_modules/@y/prosemirror/src/sync-utils.js`'s `pmNodeDiff`/`pmDocDiff`
(`walkPairable`, ~line 629): when translating a transaction into a Y delta,
nodes from the *previous* and *next* document are paired up "with equal
canonical **names**" (node type only, not attrs/marks) at each tree
position, and a large single `ReplaceStep` spanning the whole document (as
`replaceWholeDoc` produces) goes through exactly this document-diffing path
rather than a plain per-step translation. Two badge-link `image` nodes at
the same tree position across two different real-world READMEs, differing
only in the `link` mark's `href`, appear to satisfy this pairing and the
`href` change is lost. Gate B's script (realistic incremental typing/paste/
split/join edits, never a whole-document replace) never exercises this path
and passed 266/266 including every link-mark case; this is specific to the
synthetic "replace the entire document in one transaction" edit shape the
plan's gate C path B calls for, not to normal live editing.

This is reported as-is (gate C: FAIL, with the precise cause), not worked
around -- consistent with the brief's "no workarounds" premise for this
stack and squarely a gate C/gate H (maturity) finding for the lead's
recommendation, not something to patch inside this spike.

## 09:29 -- task 2(c) and task 6: compat/ subpackage, Yjs 13 <-> Yjs 14 probe

Built `compat/` as its own subpackage (own `package.json`, `tsconfig.json`,
own `node_modules`, no npm `overrides`) so real `yjs@13.6.33` +
`y-prosemirror@1.3.7` and `@y/y@14.0.0-rc.26` + `@y/prosemirror@2.0.0-13`
can coexist unaliased -- confirmed both resolve to their real, unaliased
versions after `npm install` (`node_modules/yjs` is genuinely 13.6.33 here,
not the stack 13-style alias). Own tiny schema (`compat/src/schema.ts`,
not spike 1's, and not imported across spike/subpackage boundaries): `doc`
with root attr `frontmatter`, `paragraph`, `image(src, alt)` atom, `link`
mark -- same shape as spike 2's binding probe fixture, chosen because it
exercises both of stack 13's known losses at once. `compat/scripts/compat.ts`
(`npm run compat` from `compat/`) runs four checks:

1. **Yjs 13 encodes -> Yjs 14 applies -> `ynodeToPmnode` reads**: the
   132-byte update `Y14.applyUpdate` **does not throw**, and `ynodeToPmnode`
   **fully succeeds**, reconstructing the paragraph/text/image content
   correctly. `frontmatter` comes back `null` and the image has no `marks`
   at all -- but confirmed (separate direct check, full JSON dump) that
   this is **not a new loss from crossing versions**: y-prosemirror 1.3.7
   never wrote either in the first place (its `Y.XmlFragment` root has no
   attribute slot; its `createTypeFromElementNode` never serializes
   `node.marks` for atoms -- the same two losses stack 13 has throughout
   this spike). Whatever Yjs 13 actually wrote, Yjs 14 reads back
   correctly and completely.
2. **Yjs 14 encodes -> Yjs 13 applies -> `yXmlFragmentToProseMirrorRootNode`
   reads**: the 246-byte update **applies without throwing** on a real
   Yjs 13 `Y.Doc` (the raw update/struct wire format itself is evidently
   forward- *and* backward-compatible at the byte level), but reading it
   back through y-prosemirror 1.3.7's own type materialization **throws**:
   `Cannot read properties of undefined (reading 'right')` -- Yjs 13's
   `Y.XmlFragment` class expects its own specific type-registration shape
   when walking the applied structs, and whatever `@y/y` records instead
   doesn't produce a valid linked list for it to walk.
3. **Is a real Yjs 13 `Y.XmlFragment` readable by `@y/prosemirror` at all**
   (same runtime, no update round trip, isolating the API-shape question
   from the wire-encoding question): **no** -- `ynodeToPmnode` throws
   `ynode.toDeltaDeep is not a function`; a `Y.XmlFragment` instance simply
   doesn't have the methods `@y/prosemirror` expects of a `Y.Node`.
4. **Task 2(c)'s relay-level measurement**: can real Yjs 13's own
   `y-protocols/sync` code (what any real-Yjs-13 relay's handshake calls on
   every connection, per stack 13's and this stack's own `relay.ts`) do
   anything at all with a `@y/y` `Y.Doc`? `writeSyncStep1(encoder, y14Doc)`
   **did not throw**, producing a plausible 12-byte state-vector message --
   the low-level `doc.store` shape is evidently duck-type-compatible too.
   But this is a narrow result, not a working relay: a real relay's own
   bookkeeping (Hocuspocus's `document.isEmpty(fragmentName)` on every
   `onLoadDocument`, stack 13's and stack 14's own relay.ts both call
   exactly this) walks the high-level XML/Node type wrapper, which is
   exactly what check 3 shows throwing. Separately, and independent of the
   encoding question entirely: reading Hocuspocus's own source
   (`ClientConnection`, `dist/hocuspocus-server.esm.js`) shows it
   multiplexes **multiple documents over one WebSocket connection**, with
   every single message prefixed by a var-string document name read off the
   wire -- a fundamentally different framing from the plain per-connection,
   URL-path-addressed protocol this stack's own relay/client (and the
   reference `y-websocket`) speak. A stock Hocuspocus server could not
   understand this stack's client's messages even before any Yjs-version
   question arises.

**Verdict for gate H / the recommendation**: Yjs 13 -> Yjs 14 is a safe,
lossless *read* direction for whatever Yjs 13 actually captured (a real
migration path: re-seed a Yjs 14 doc from a Yjs 13 document's raw update
bytes and it comes out correct, modulo Yjs 13's own pre-existing losses,
which Yjs 14 would need to re-derive from the source Markdown anyway, not
from the old Yjs 13 document). Yjs 14 -> Yjs 13 does not work today (throws
on read, even though the raw bytes technically apply). Task 2(c) confirms
attempt (a)'s already-established verdict from a different angle: even
setting the `lib0` conflict aside, mixing real Yjs 13's relay-level code
with Yjs 14 objects breaks at the type-wrapper layer, and Hocuspocus's
own wire protocol is a poor fit for either version's plain client
independent of that.

`npx tsc --noEmit` in `compat/`: one error fixed (a `null` passed where
`Node.create`'s content parameter wants `undefined`, in the fixture
builder), clean after. `compat/` is excluded from the parent package's
`tsconfig.json` (own `tsconfig.json`, own root) so `npx tsc --noEmit` at
the top of the spike directory does not also try to typecheck it against
the parent's dependency graph (which has the `yjs`-alias override and would
see two conflicting `yjs` shapes).

## 09:34 -- task 8 (README, gate runner) and definition-of-done check

Wrote `scripts/gates.ts` (adapted from stack 13's: single gate B run, no
negative control; `--db` args are directories now, not SQLite files; gate
C's summary line adds the encoded-state-size total the brief asks for) and
`README.md` (goal, origin of copied code, layout, every relay attempt with
its outcome, gate results, compatibility probe results, known
limitations) -- both covering everything logged above.

Definition of done, run from a clean state:
- `npm ci`: clean (261 packages).
- `npm run fetch`: 266 real corpus files present (already fetched earlier
  in this session; re-verified idempotent).
- `npm run gates:quick`: **all PASS** (gate A 23.1ms median latency, gate B
  PASS with update count stable at 23, gate C PASS 5/5 both paths on the
  quick sample).
- `npm run gates` (full): gate A and B PASS; gate C FAIL as documented
  above (path A 266/266, path B 234/266, real upstream bug, not this
  spike's) -- re-run once more just now for a final, reproducible number:
  identical result (266/266, 234/266, same 30 failing files, 62.6s). This
  is `npm run gates`'s documented, expected outcome, not a flake -- it is
  intentionally left non-zero-exit (matches the charter's "definition of
  done is executable" and stack 13's own README precedent of an
  intentionally-nonzero `npm run gates` when a real finding, not a runner
  bug, causes it).
- `npx tsc --noEmit` at the top of the spike directory: clean (0 errors),
  including `src/relay-attempt-a-hocuspocus.ts` /
  `client-attempt-a-hocuspocus.ts` (compile fine; their failure is a
  runtime dependency-resolution issue, not a type error).
- `cd compat && npx tsc --noEmit`: clean (0 errors, after the one fix noted
  above).
- `lsof -nP -iTCP:4240-4269 -sTCP:LISTEN`: empty, checked directly after
  every relay-touching command in this brief, including the two crashes
  during debugging (attempt (a)'s Hocuspocus crash, the pre-fix "Unexpected
  end of array" crash) -- every relay process this session started is
  confirmed dead.

All eight ordered tasks in the brief done. Stopping point reached (task 7
done; not all three relay attempts failed, so the "log everything and hand
back" early-stop branch does not apply -- proceeded through task 8 as the
brief's primary path requires). Committing next, no push, no further
agents launched.
