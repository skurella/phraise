Status: in progress
Author: builder (Sonnet 5)
Updated: 2026-09-27
Plan: [spike 7 plan](../plans/2026-09-27-spike-7-plan.md)
Brief: [brief 02 typing](../plans/2026-09-27-spike-7-brief-02-typing.md)

Time zone: local machine time (CEST, from `date`).

## 16:32 — task received

Read AGENTS.md, brief 02, the charter's "Rules for every agent in this spike",
the plan, and brief 01's builder log. Branch `spike/2026-09-27-web-editor`,
worktree clean, HEAD at `1343cac` (brief 02 charter/plan/brief already
committed by the orchestrator; foundation from brief 01 present at
`spikes/2026-09-27-web-editor-tiptap/`).

Read the brief's named inputs: `web/src/main.ts`, `e2e/fixtures.ts`,
`e2e/smoke.spec.ts`, `src/model/serialize.ts` (the `serializeDoc` ladder:
verbatim -> splice (text/link) -> textblock-splice -> re-serialize, with
`UnverifiedSerializationError` thrown by default when nothing verifies),
`src/collab/tiptapExtensions.ts` (the generic schema-to-extension converter;
confirms rule "no new nodes/marks, schema-free Extensions only").

Investigated ProseMirror mechanics before writing code (via throwaway probe
script, deleted before committing):
- Confirmed with `prosemirror-transform`'s `split()` source that a plain
  Enter split (`splitBlockAs`/`splitBlock`, the default Tiptap core Enter
  binding when no more specific extension claims it) copies the ORIGINAL
  top-level block's attrs (via `node.copy(after)`, same type+attrs) into
  BOTH resulting nodes -- confirms task 1's premise: the "after" (second)
  block needs its `src`/`gap` nulled explicitly; nothing else does this
  today.
- Confirmed `setNodeMarkup`/`setBlockType` (used by `textblockTypeInputRule`,
  e.g. `# ` -> heading) already resets unset attrs to schema defaults
  (`type.create(attrs, ...)` where `attrs` only carries the matched fields,
  e.g. `{level}` -- not `src`/`gap`), so heading/list/blockquote/code-fence
  input rules already produce fresh `src: null` on their own; only the
  plain-Enter top-level split needs a fix.
- Confirmed via `@tiptap/core`'s `get plugins()` (extensions reversed then
  stable-sorted by priority, all default 100) that user extensions' keymap
  plugins are tried BEFORE the built-in core `Keymap` extension's defaults
  (Enter/Backspace/Delete). This means a list-aware Enter handler that
  returns `false` when not applicable correctly falls through to core's
  `liftEmptyBlock` (already handles "Enter on empty item leaves the list"
  generically) and `splitBlock` (plain paragraphs).
- Confirmed `prosemirror-schema-list`'s `splitListItem` bails (returns
  `false`) on an empty TOP-LEVEL (non-nested) item, deferring to the next
  command in the Enter chain -- which is exactly core's `liftEmptyBlock`,
  already present. So only "Enter to add a non-empty item" needs new
  wiring; "leave the list on empty item" should already work via core.
- Probed `Node.slice()` shapes for gate B's copy scenarios: a selection
  inside one paragraph returns a flat inline Fragment (openStart=openEnd=0,
  no wrapping paragraph); a selection spanning two paragraphs returns a
  Fragment of the two paragraph nodes themselves (openStart=openEnd=1),
  each still carrying the ORIGINAL document's `src`/`gap` -- confirms the
  brief's "with `src` stripped so it re-serializes cleanly" instruction is
  necessary, not optional.

No dependencies need adding: `@tiptap/pm/{commands,keymap,inputrules,
schema-list,tables}` (thin wrappers over `prosemirror-*`, already
transitive deps of `@tiptap/core`/`@tiptap/pm`) cover every command needed
(`splitListItem`, `sinkListItem`, `liftListItem`, `toggleMark`). Decided
NOT to use `prosemirror-tables`' plugin machinery for table Tab/Shift-Tab:
it expects `tableRole` in every NodeSpec (via its own `tableNodes()`
helper), which spike 1's hand-built schema does not set, and adding it
would mean editing `src/model/schema.ts` -- out of a "schema-free
Extension" brief. Writing plain custom cell-to-cell navigation instead
(pure, in `src/editing/tableNav.ts`).

Plan: pure/testable logic in `src/editing/` (fresh-src plugin, paste
markdown-or-not rule + slice conversion, copy slice-to-markdown, input-rule
patterns, table navigation); Tiptap wiring (keyboard shortcuts, input
rules, paste/copy DOM event handlers, the link-field popup) in
`web/src/editing/`, one file per concern, per the brief. Starting with the
fresh-src plugin and its unit test.

## 17:17 — task 1 (fresh-src plugin) and pure modules done, gate A typing passing

`src/editing/freshSrc.ts`: an `appendTransaction` plugin (plus a thin
`Extension` wrapper, matching `tiptapWorkaroundsExtension.ts`'s convention)
that detects a "pure top-level split" step shape (`ReplaceStep` with
`from === to`, `slice.openStart === slice.openEnd >= 1`, split position at
depth 1) and nulls `src`/`gap` on the resulting "after" (second) top-level
node only. Deliberately narrow (matches only that exact step shape) so it
never touches paste/remote-edit content with real, meaningful `src`.
5 unit tests in `test/freshSrc.spec.ts` (top-level split, heading split,
join leaves the surviving block alone, nested list-item split untouched,
a paste-shaped replace untouched) using REAL `prosemirror-commands`/
`prosemirror-schema-list` commands, not hand-built transactions.

Two bugs found and fixed while writing this:
1. Computed the "after" node's position via `step.getMap().map(step.from, 1)`
   first, which lands INSIDE the after-node's content (past both the
   closing and opening tokens the split inserts), not at its own boundary.
   Fixed: for a depth-D symmetric split, the boundary is `step.from + D`
   (an interior position of the inserted span that `StepMap.map()` cannot
   return directly).
2. In a REAL editor (not the unit tests' isolated single-step transactions),
   Tiptap's own `commands.splitBlock` conditionally calls
   `tr.deleteSelection()` first and may add more steps than the raw
   `prosemirror-commands` version I unit-tested against; confirmed by
   dumping real step JSON via a throwaway console.error probe (deleted
   before committing) that the actual split step's shape was still exactly
   what my filter expects once the position math above was fixed -- the
   plugin's step-iteration-by-index (not by assuming step 0) already
   handled the extra steps correctly.

Other pure modules, each with unit tests in `test/`:
- `src/editing/copyMarkdown.ts` (`sliceToMarkdown`): builds a fresh `doc`
  from a selection's `Slice`, stripping top-level `src`/`gap` (confirmed via
  a throwaway probe that `doc.slice()` returns a flat inline Fragment for a
  same-paragraph selection, and a Fragment of the STALE original blocks for
  a cross-paragraph one), then serializes. Strips exactly one trailing eol
  (serializeDoc's whole-file convention, wrong for a copied fragment).
- `src/editing/pasteMarkdown.ts` (`looksLikeMarkdown`,
  `buildMarkdownPasteContent`): the Markdown-or-not paste rule (block/inline
  marker regexes) and the inline-vs-block decision (single-line,
  single-paragraph parse result -> inline splice; anything else -> block
  content), documented in the file's own comment.
- `src/editing/inputRulePatterns.ts`: heading/bullet/ordered/blockquote
  regexes + attr extractors, and code-fence/thematic-break "full paragraph
  text" matchers (these two fire on Enter, not as real `InputRule`s -- see
  `web/src/editing/enterConversions.ts`'s comment for why).
- `src/editing/tableNav.ts`: `findNextCell`/`findPreviousCell` cell-to-cell
  position arithmetic (not `prosemirror-tables`: that package needs
  `tableRole` on every NodeSpec, which would mean editing the shared schema).

`npx vitest run`: 8 files, 67 tests, all passing after this point.

Tiptap wiring, `web/src/editing/`: `enterConversions.ts` (fence/thematic
break on Enter, plus their own structural Backspace-undo reconstructed from
the node's own hint attrs -- no transient state needed), `listKeymap.ts`
(Enter/Tab/Shift-Tab via `@tiptap/core`'s own generic `splitListItem`/
`sinkListItem`/`liftListItem` commands -- confirmed these are always
available, from core's always-present `Commands` extension, no custom
implementation needed), `markShortcuts.ts` (Mod-B/I/E via generic
`toggleMark`), `tableKeymap.ts` (Tab/Shift-Tab wiring `tableNav.ts`),
`linkShortcut.ts` (Mod-K popup, plain DOM, no `window.prompt`),
`inputRulesExtension.ts` (heading/list/blockquote via real
`wrappingInputRule`/`textblockTypeInputRule`, so Backspace-undo is free),
`pasteRule.ts` (`handlePaste`: only intervenes when `looksLikeMarkdown`;
otherwise returns `false` and lets ProseMirror's own default paste pipeline
handle text/html via the schema's existing `parseDOM`), `copyRule.ts`
(`handleDOMEvents.copy`/`.cut`: writes `text/plain`/`text/html`, calls
`sliceToMarkdown` with the LIVE editor schema directly rather than
converting -- safe because `semanticEq` compares by node-type NAME, not
reference, a fix already landed in an earlier brief; documented in the
file's comment). Wired into `web/src/main.ts`'s extensions array, with a
comment explaining the ordering dependency (extensions are reversed before
becoming plugins, so a LATER extension's keymap binding is tried FIRST;
`TableKeymap` after `ListKeymap` after `EnterConversions` so Tab/Enter try
the more specific context first and fall through correctly).

`npx tsc --noEmit` and `vite build`: both clean after every wiring change.

Gate A fixtures written under `e2e/fixtures/` (`typing.md`, `shortcuts.md`,
`lists.md`, `table.md`) plus gate B's (`input-rules.md`, `paste.md`,
`copy.md`) -- each round-trips byte-for-byte through `parseMarkdown`+
`serializeDoc` (checked with a throwaway probe script before writing tests
against them).

`e2e/gateA-typing.spec.ts`: all 5 scenarios from the brief's first bullet,
all passing, each asserting the FULL serialized Markdown. Two real
Playwright/browser timing races found and fixed (both confirmed by
dumping `state.selection` after each step via throwaway debug specs,
deleted before committing):
1. A plain `.click()` resolves as soon as the DOM mouse event is
   dispatched, before ProseMirror's `EditorView` has necessarily read the
   new DOM selection back into `state.selection` -- a `Home` sent
   immediately after landed on the OLD selection (the doc's initial
   default position). Fixed by polling for `state.selection.$from.parent
   .textContent` to match the clicked paragraph before sending any more
   keys.
2. A tight loop of `page.keyboard.press('ArrowRight')` with no delay
   between presses outran the browser's own native caret movement in this
   headless Chromium -- most presses were lost, so `Enter` ended up
   splitting at the wrong offset. Fixed by polling for
   `state.selection.$from.parentOffset` to reach the intended offset after
   the loop, in the same `placeCaret` helper both fixes live in.
Real cross-block `Shift+ArrowRight` (for "select across two paragraphs")
had the same race even worse (selection extended far past the intended
range); for that one test, the SELECTION itself is set via the editor's
own `setTextSelection` command (computed from the live doc's real text
positions) and only the actual thing being tested -- typing over an
existing selection -- uses a real keyboard event (`page.keyboard.type`).

One real (non-test-bug) behaviour discovered and asserted, not guessed:
Delete at the end of a paragraph immediately before a list does not merge
text into the list (different node types cannot join); ProseMirror's
`joinForward` instead lifts the list's first item out as its own new
top-level paragraph, leaving the list with one fewer item -- matches
Google Docs' own behaviour for the same gesture. Asserted as the expected
output rather than loosened to a `toContain` check.

Next: gate A shortcuts/lists/tables, then gate B.

## 17:31 — gate A shortcuts and lists done

`e2e/gateA-shortcuts.spec.ts`: all 5 scenarios pass (Mod-B on + off, Mod-I,
Mod-E, Mod-K apply, Mod-K Escape-cancels). One expectation bug found by
running it, not guessed: with no existing emphasis elsewhere in the
document to detect a style from, the serializer falls back to the SCHEMA's
own default emphasis marker (`*`, from `src/model/schema.ts`'s `em`
NodeSpec), not `_`.

`e2e/gateA-lists.spec.ts`: all 6 scenarios pass (Enter adds an item in both
bullet and ordered lists with correct renumbering, Enter on an empty item
leaves the list, Tab nests, Shift-Tab lifts). Two more real findings:
- "Enter on an empty item leaves the list" lifts the item out as a
  genuinely EMPTY top-level paragraph. An empty paragraph has no Markdown
  representation at all (blank text parses to zero blocks, not one empty
  paragraph), so `serializeDoc` correctly throws `UnverifiedSerializationError`
  right at that point -- by design, not a bug (Phraise never writes a file
  whose meaning differs from the document). Since a real user always keeps
  typing right after leaving a list this way, the test types into the new
  paragraph before checking the Markdown, which is both the realistic
  end-to-end behaviour and sidesteps the unrepresentable intermediate state.
- A second real Playwright/browser timing issue, worse than the
  ArrowRight-loop race: `page.keyboard.down('Shift')` + `press('End')` +
  `up('Shift')` to select "to end of line" extended the selection far past
  the current line (confirmed by logging `state.selection.{from,to}`: it
  extended ~60 positions past a 10-character line, deleting into a
  following ordered list on Backspace and losing real content). Switched to
  one `Backspace` per character from the line's end instead of
  Shift+End+Backspace; this is the second scenario (after gate A typing's
  cross-block Shift-ArrowRight) where multi-key Shift-based selection
  extension proved unreliable in this headless Chromium and was replaced
  with a more granular/explicit approach.

`npx tsc --noEmit`: clean throughout.

Next: gate A tables, then gate B (input rules, paste, copy).

## 17:35 — gate A complete: 22/22 tests passing

`e2e/gateA-table.spec.ts`: all 5 scenarios pass on first run (click+type,
Tab within a row, Tab wrapping to the next row, Shift-Tab, Tab in the very
last cell is a no-op with no tab character inserted and no content change).

Ran all of gate A together (`gateA-typing`, `gateA-shortcuts`,
`gateA-lists`, `gateA-table`, plus brief 01's `smoke.spec.ts`) with
Playwright's default parallel workers: 22/22 passing, confirming tests are
properly isolated (each gets its own server/temp dir via `fixtures.ts`).

Gate A done. Moving to gate B: input rules (heading/list/blockquote/fence/
thematic-break, with Backspace-undo), paste (Markdown-or-not, inline vs
block), copy (Markdown + HTML to the clipboard).

## 17:45 — gate B input rules: 16/16 passing

`e2e/gateB-inputrules.spec.ts` + `e2e/fixtures/input-rules-last.md` (a
second small fixture where "placeholder" is the LAST block, needed for one
scenario -- see below). All headings 1-6, `- `/`* `/`1. `/`> `, bare fence,
fence with `lang: js`, thematic break, and three Backspace-undo scenarios.

Two things found by running, not guessed:
- Backspace-undo of a heading/fence/thematic-break restores LITERAL text
  that starts with `#`/backtick/`-` -- ambiguous with the construct it just
  came from on reparse -- so the serializer correctly escapes the leading
  character (`\#`, `` \`\`\` ``, `\---`). Fixed the test expectations to
  match the real (correct) escaped output rather than assuming the raw
  original text came back unchanged.
- The thematic-break Backspace-undo (in `enterConversions.ts`) only
  reconstructs the rule when the cursor lands in a freshly-created EMPTY
  paragraph right after it. With `input-rules.md`'s existing trailing
  "Neighbour after." paragraph, the cursor instead lands at the start of
  THAT (non-empty, pre-existing) paragraph, so Backspace there is an
  ordinary join/select against the rule, not an undo -- a real, deliberate
  scope edge (documented in `enterConversions.ts`'s comment), not a bug.
  Exercised the actual undo path with the new `input-rules-last.md` fixture
  instead (placeholder as the last block, so a fresh empty paragraph really
  does get created and the cursor lands there).

Next: gate B paste and copy.

## 17:32 — gate B paste: 5/5 passing, one real bug found and fixed

`e2e/gateB-paste.spec.ts`: Markdown text/plain (heading+list+bold+link,
a table, a fenced code block) becomes rich block content; a single-line
fragment pasted mid-paragraph stays inline; text/html from "another app"
(no Markdown markers in its text/plain sibling) goes through the schema's
`parseDOM` (a real `<strong>` becomes a real bold mark). Dispatches a real
`ClipboardEvent`+`DataTransfer` rather than driving Mod-V (documented in
the file's own comment: simulating "content that arrived from another
app" has no real external clipboard to Mod-C from in this harness, so this
was the right choice from the start, not a fallback after Mod-V failed).

Real bug found by running the three block-content paste tests (not
guessed): the pasted content's LAST top-level block glued directly onto
whatever real content followed it, with no blank line at all
("...[link](url).Neighbour after." instead of two separate paragraphs).
Cause: `parseMarkdown` sets a block's own `gap` from whatever trailing
text followed it in the source; for the LAST block of an isolated pasted
snippet, that is usually `''` (empty string) -- not `null` -- since the
snippet has no further content of its own. `serializeDoc` treats any
non-null `gap` (including `''`) as the real separator to emit verbatim, so
it glued the paste onto the next real block with zero separation. Fixed in
`src/editing/pasteMarkdown.ts`'s `buildMarkdownPasteContent`: null the last
child's `gap` (only the last -- gaps between the OTHER pasted blocks are
real and meaningful) before returning the fragment, so the real document's
own default separator (`serializeDoc`'s `gap == null ->
eol`/`eol+eol` fallback) applies once it is inserted. New unit test in
`test/pasteMarkdown.spec.ts` locks this in.

Next: gate B copy.

## 17:41 — gate B copy: 2/2 passing, a second real gap found in freshSrc and fixed generically

`e2e/gateB-copy.spec.ts`: real Mod-C, reads the clipboard (`text/plain`
Markdown via `navigator.clipboard.readText()`, `text/html` via
`navigator.clipboard.read()`), real Mod-V into a second/third paragraph,
checks the resulting Markdown. `clipboard-read`/`clipboard-write` granted
via `page.context().grantPermissions(...)`; real clipboard shortcuts DID
work in this headless Chromium for copy/paste (unlike some Shift-based
selection gestures elsewhere in gate A/B), so no ClipboardEvent fallback
was needed here.

Real bug #2 found by running the cross-paragraph copy+paste test (not
guessed): pasting new content right after "target" (the last block in
`copy.md`, so its own `gap` was `'\n'`, the file's trailing-newline
convention, not the between-blocks `'\n\n'` convention) glued the newly
pasted second paragraph onto it with only a single newline, not a blank
line. Root cause, confirmed by dumping the real paste transaction's step
JSON: pasting rich content at a caret inside an existing top-level block
produces the EXACT SAME step shape `freshSrc.ts` already detects for a
plain Enter split (`ReplaceStep` with `from === to`, symmetrically open by
one level) -- paste-fitting is structurally a split with real content
inserted in the middle, not a different mechanism. The existing plugin
only fixed the NEW ("after") half; the SURVIVING ("before") half's stale
`gap` (tuned for whatever HAD been after it, not what's there now) was
left untouched.

Fixed generically in `src/editing/freshSrc.ts`, not as a paste-specific
patch (paste is only one way to trigger this shape; ProseMirror's own
default HTML-paste path, a real `pasteRule.ts` insertion, and potentially
future remote-collaborator content-insertions all share it): whenever the
existing split-shape detection fires, the plugin now ALSO nulls the
SURVIVING half's `gap` (never its `src` -- the text up to the split point
is unchanged and still verifies against it). Reasoned through why this is
safe for the plain Enter-split case the existing tests already cover
(`gate A`'s "Enter splits ... Backspace ... byte-identical" and the unit
tests): when the original `gap` already matched the file's own default
separator convention (the overwhelmingly common case), nulling it and
letting `serializeDoc`'s own default-separator fallback re-derive it
produces byte-identical output either way. Added a new unit test
(`test/freshSrc.spec.ts`, "nulls a stale trailing gap ... paste-at-end
shape") reproducing the bug at the plugin level directly, plus updated the
existing split test's expectation (the surviving half's `gap` is now
`null`, not preserved verbatim) to match the corrected, intentional
behaviour.

Re-ran vitest (69/69) and the FULL Playwright suite (all of gate A, all
of gate B, brief 01's smoke test): 45/45 passing, no regressions from
either freshSrc change.

Gate A and gate B are both fully green. Next: `npm run gates` end to end,
`npx tsc --noEmit`, port cleanup check, README update, commit.

## 17:42 — definition of done, README, commit

Full definition-of-done list, from a state with everything built:
- `npx vitest run` -> 8 files, 69 tests, all passing.
- `npm run gates` -> builds, runs gates A (22 tests) and B (23 tests) in
  Chromium, 45/45 passing, gate table printed (A: PASS, B: PASS, C-K: not
  run), `results/gates.md`/`gates.json` written, exit 0.
- `lsof -nP -iTCP:4400-4499 -sTCP:LISTEN` -> empty after the gates run.
- `npx tsc --noEmit` -> clean.
- No `fixme`s were needed: every scenario in the brief's scope has a
  passing test with a real, verified assertion (not loosened placeholders)
  once the actual observed behaviour was understood.

Updated `README.md`: status/goal for brief 02, new `src/editing/`/
`web/src/editing/` layout entries, the new `e2e/` spec files and fixtures,
updated test/gate counts, a note on Mod-E's own-choice status, and two new
"notes for the next brief" entries (the Playwright click/keypress timing
races and their fix pattern; the `gap`-invalidation finding in
`freshSrc.ts`, in case gate C/D/E's edits hit the same "stale separator"
symptom).

Committing now (paths staged explicitly, no `-A`/`.`): the new
`src/editing/`, `web/src/editing/`, `test/*.spec.ts` (freshSrc,
pasteMarkdown, copyMarkdown, inputRulePatterns, tableNav), `e2e/gateA-*.
spec.ts`, `e2e/gateB-*.spec.ts`, `e2e/fixtures/`, the `web/src/main.ts`
wiring change, and `README.md`; plus this log. Not pushing (brief says
commit only).

## Handback summary

Gate A: 22/22 passing (typing 5, shortcuts 5, lists 6, tables 5). Gate B:
23/23 passing (input rules 16, paste 5, copy 2). `npm test` 69/69. `npx
tsc --noEmit` clean. No `test.fixme`s needed.

Verified by: running every test, not guessing at expected output --
several initial guesses at expected Markdown were wrong (emphasis marker
default, mdast-util-to-markdown's trailing-space escaping,
`joinForward`'s lift-out-of-list behaviour, Backspace-undo's own escaping)
and were corrected against the real, observed `window.phraise.markdown()`
output rather than adjusted to match a guess.

Serializer surprises:
- A genuinely NEW top-level block from a split takes the fresh (`src:
  null`) path by construction (`freshSrc.ts`), so it always re-serializes
  via the mdast-based ladder rung, verified.
- "Enter on an empty list item to leave the list" lifts the item out as a
  genuinely EMPTY top-level paragraph -- `serializeDoc` would correctly
  throw `UnverifiedSerializationError` there (an empty paragraph has no
  Markdown representation at all), which is by design, not a bug; the test
  types into the new paragraph first, matching how a real user actually
  uses this affordance.
- Found and fixed for real (not from the brief's own list, discovered
  while testing paste/copy): a survivor block's stale `gap` (tuned for
  whatever used to follow it, e.g. the file's own trailing bytes if it was
  the last block) needs invalidating whenever new content is inserted
  right after it -- same step shape as a plain Enter split. Fixed
  generically in `freshSrc.ts`, not as a paste-specific patch.

Paste rule chosen (`src/editing/pasteMarkdown.ts`'s `looksLikeMarkdown`):
recognized block markers (heading/list/blockquote/fence/table/thematic
break) anywhere on a line, or inline markers (bold/italic/strike/code/
link) anywhere in the text; otherwise treated as literal plain text (same
resolution every Markdown editor in the wild makes for this ambiguity).

Paths: log
`context/logs/2026-09-27-builder-spike-7-typing.md`;
README `spikes/2026-09-27-web-editor-tiptap/README.md`.
