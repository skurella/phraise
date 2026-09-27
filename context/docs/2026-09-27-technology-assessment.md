# Technology assessment (researched 2026-09-27)

Status: active
Author: lead agent (Fable 5.1), from a research subagent report
Updated: 2026-09-27

Covers CRDT libraries, Markdown editors and round-tripping, structural merge, local sync daemon precedent, IDE APIs, and AI account login policy. Recommendations are consolidated in the architecture decisions doc.

## A. CRDT libraries

| | Yjs | Loro | Automerge |
|---|---|---|---|
| Version, Sept 2026 | 13.6.33 stable; 14.0.0-rc.26 | loro-crdt 1.16.3 | 3.5.0 |
| License | MIT | MIT | MIT |
| Backing | Kevin Jahns plus sponsors; v14 attribution funded by ZenDiS/DINUM for public-sector document suites | Small company, about two maintainers | Ink & Switch |
| Production users | AFFiNE, GitBook, Evernote, Linear, AWS SageMaker; ~920K weekly downloads | Latch.bio, Marimo (secondary sources) | Ink & Switch tools; ~85K weekly downloads |

**Rich text.** Loro implements Fugue plus Peritext with configurable mark expansion. Automerge has marks with explicit expand behaviour and block markers, but `updateSpans` does not yet update formatting spans. Yjs uses Quill-delta-style attributes with fixed behaviour; in practice y-prosemirror maps ProseMirror to `Y.XmlFragment` and is the most battle-tested path.

**Attribution.** None of the three embeds user identity. Yjs client IDs are random per session; Loro peer IDs and Automerge actor IDs are set by us. The server must record the ID-to-user mapping at authentication time.
- Yjs 14 adds an `AttributionManager` that decorates deltas with creator and timestamp, plus `acceptAllChanges` and `rejectAllChanges`; `@y/prosemirror` main renders version diffs and suggestion mode with accept/reject on Tiptap 3. The README warns a stock schema must be hardened for attributed rendering. See [attributing-content.md](https://github.com/yjs/yjs/blob/main/attributing-content.md).
- Loro records peer, counter, lamport, timestamp and optional message per change; `doc.diff(a, b)` and `applyDiff` are documented for PR-style review. No built-in "author of this character" query. Historical diff and `forkAt` had crash fixes as recently as 1.16.2.
- Automerge records actor, time and message per change, every character has an ID, `Automerge.diff` between heads is exact.

**History.** Yjs cannot garbage-collect tombstones, so documents grow with edits; snapshots require `gc=false`; no native fork. Loro has git-like DAG history: `checkout`, `fork`, `forkAt`, `diff`, `revertTo`, `applyDiff`, shallow snapshots. Automerge keeps full history, native branch and merge, and version 3 cut memory more than tenfold.

**Stable positions for comments.** Yjs `RelativePosition`, Loro `Cursor`, Automerge cursors are equivalent. All lose the anchor when the anchored text is deleted, so fallback re-anchoring is needed regardless.

**Editor bindings.** y-prosemirror 1.x is stable and Tiptap's official collaboration extensions sit on it. loro-prosemirror is 0.4.4 with mark-range bugs fixed in August 2026. automerge-prosemirror is self-described beta with no presence plugin.

**Servers.** Hocuspocus 4 stable since May 2026, MIT, editor-agnostic, SQLite and Redis extensions. y-sweet is Rust with S3 persistence. y-redis exists. PartyKit's successor on Cloudflare is `y-partyserver`. Loro ships `loro-websocket` with a simple server and Rust crates; no hosted service. Automerge's sync server is a demo app; Subduction is in progress.

**Recommendation.** Yjs plus y-prosemirror plus Tiptap plus Hocuspocus, designed for Yjs 14 attribution. Because Git is the canonical history, the CRDT is a session layer that can be re-seeded from each commit, which neutralizes Yjs's history growth. Loro is the fallback if native fork, diff and applyDiff become important. Automerge not recommended for a Tiptap UI in 2026.

## B. Markdown editors and round-tripping

No mainstream editor preserves source bytes. All parse to a model and re-serialize.

- Tiptap `@tiptap/markdown` (official, Tiptap 3.7): early release, tables limited to one node per cell, HTML goes through the HTML parser, comments lost. Community `tiptap-markdown` unmaintained.
- Milkdown 7.22: remark-based; documented round-trip losses such as autolink backslash doubling and dropped empty nodes; raw HTML kept as a text atom.
- MDXEditor: Lexical plus mdast, MDX-first; throws on unrecognized constructs unless a catch-all visitor is registered; source-mode fallback.
- BlockNote: states Markdown conversion is lossy; minimal subset.
- Lexical `@lexical/markdown`: transformer-based, not full CommonMark.
- MarkText: revived in 2026; own parser; normalizes. Typora: file to AST to re-serialized; export via pandoc; not lossless.

**Block-level source preservation exists as a technique in small projects, not as an editor feature.**
- [BlockMD](https://github.com/RuiquanQiao/BlockMD): remark locates blocks, untouched blocks emit `source.slice(start, end)` verbatim, edited blocks re-serialized; byte-identical on fixtures and real READMEs.
- [Loxel PR 261](https://github.com/bizimind/loxel/pull/261): aligns serializer output with the loaded baseline block by block via LCS.
- [markdown.mbt](https://github.com/mizchi/markdown.mbt): source-oriented CST retaining spans, incremental re-parse, passes all 652 CommonMark 0.31.2 examples, GFM, math, footnotes, wikilinks.
- [Lix plugin_markdown](https://github.com/opral/lix/releases/tag/plugin_markdown/v0.1.0): block rows with identity for change control; identity bugs open.

Parser building blocks with positions: comrak (Rust, `sourcepos` on every node), markdown-rs (every byte accounted for, but html and footnote nodes can lack position), remark/mdast (unist positions; `mdast-util-to-markdown` normalizes markers but style can be detected and fed back). tree-sitter-markdown's own README says it is not recommended where correctness matters. pandoc is lossy by design.

**Recommendation.** Build a block-preserving layer over Tiptap/ProseMirror: parse with positions, keep original bytes per block, re-serialize only edited blocks in the file's detected style, and represent raw HTML, MDX, front matter, math, footnote definitions, Mermaid and unrecognized constructs as opaque source blocks with preview and source editing.

## C. Structural merge and comment anchoring

- Mergiraf: no Markdown. difftastic: no Markdown, issue open since 2021.
- Semantic line breaks ([sembr.org](https://sembr.org/)): one sentence per line makes diffs and three-way merges far cleaner. Recommended as an opt-in for re-serialized paragraphs.
- No established prose three-way merge tool. Building blocks: Google diff-match-patch for word-level diff and fuzzy patch application; prose-diff and prosediff as viewers.
- Hypothes.is anchoring: three selectors per anchor, RangeSelector, TextPositionSelector, TextQuoteSelector with 32-character prefix and suffix, and a four-tier fallback ending in quote-only fuzzy match. Libraries: `dom-anchor-text-quote`, `anchor-quote` with a fuzziness budget. [Fuzzy anchoring](https://web.hypothes.is/blog/fuzzy-anchoring/).

**Recommendation for rebasing a live doc onto a new commit.** Block-level diff of old to new commit, word-level inside changed blocks, applied as CRDT operations so cursors and comments survive; fallback to quote selectors for comments whose anchor was deleted; orphan past the fuzziness budget; untouched blocks keep original bytes.

## D. Local sync daemon precedent and IDE APIs

- Obsidian Relay: Yjs docs materialized as `.md` in the vault, live cursors, offline merge, MIT plugin and y-sweet-fork server. Proof the daemon model works in production. Disk-versus-CRDT reconciliation undocumented.
- Ink & Switch Tiny Essay Editor: Automerge Markdown editor with comments used for an 11k-word essay with ~200k edits.
- Mutagen `two-way-safe` flags conflicts and never overwrites; Syncthing writes `<name>.sync-conflict-<date>-<modifiedBy>.<ext>`. Precedent for the last-resort case.
- VS Code Comments API: `createCommentController`, `commentingRangeProvider`, `createCommentThread(uri, range, comments)`. No remote cursor API; extensions use `TextEditorDecorationType`. Live Share is proprietary, VS Code only, not a base for FOSS.

## E. AI account login

- **Anthropic: explicitly not allowed.** The Claude Code legal page states OAuth is for native Anthropic applications only, third-party developers may not offer Claude.ai login or route requests through Free, Pro or Max credentials, and may not intermediate credentials or session tokens. Server-side enforcement since January 2026. The one carve-out is running the unmodified Claude Code binary with each end user signing in themselves. A planned Agent SDK subscription credit is paused with no date. [Source](https://code.claude.com/docs/en/legal-and-compliance)
- **OpenAI: tolerated in practice, no contractual right.** Leadership publicly embraced third-party harnesses on ChatGPT plans, but the ToS is silent and the option has disappeared from at least one third-party tool's login menu.
- **Alternatives, ranked by policy safety:** BYO API key stored locally in the daemon; expose Phraise as an MCP server, local stdio and remote HTTP, so the user's own agent on their own subscription edits the doc; spawn the unmodified `claude` binary or Codex app-server as a sidecar; Claude Agent SDK with an API key for a hosted assistant.
