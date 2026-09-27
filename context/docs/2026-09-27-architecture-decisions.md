# Architecture decisions

Status: active. Decisions marked **locked** need an owner conversation to reverse. Decisions marked **default** are the lead's proposal and may be revised by spike results.
Author: lead agent (Fable 5.1), reviewed with owner on 2026-09-27
Updated: 2026-09-27, amended after spike 4

Supporting research: [landscape](2026-09-27-landscape.md), [GitHub constraints](2026-09-27-github-platform-constraints.md), [technology assessment](2026-09-27-technology-assessment.md).

## Mental model — locked

**Phraise is a shared, multi-user working tree for a branch.** Git already has committed history in branches and uncommitted edits in a per-clone working tree. Phraise makes the working tree shared and real-time. Drafts are a stash. Commits are explicit. Every product decision should be checkable against this sentence, and it explains the product to a developer in one breath.

## D1. Git is canonical; the CRDT is a session layer — locked

The CRDT document is never the only durable copy of anything. After each commit or rebase, a fresh CRDT doc is re-seeded from the committed Markdown, and old CRDT history is discarded. Consequences: Yjs's unbounded tombstone growth stops mattering; a lost server costs at most the unflushed edits; version history in the product UI is git history plus the current session's attributed edits.

## D2. A recoverable relay, not a stateless one — default

Real-time collaboration needs a server even for WebRTC signaling, so "no server" is not an option. The relay holds live docs in memory with a small update log in its own storage, and flushes each active draft to a hidden ref `refs/phraise/drafts/<branch>/<path-hash>` on a debounce, once per minute of activity at most, one ref per document and branch, overwritten not accumulated, deleted after the commit that consumes it.

Each flush writes two blobs: the rendered Markdown so anyone with plain git can read the draft, and the CRDT binary plus comments so a restart resumes with attribution intact. Real branches are never used for drafts: they pollute branch lists, trigger CI and PR tooling.

Enterprise story: self-host a single binary; every durable byte is reconstructible from the repo. Hidden-ref retention is implied by reachability rather than documented, so the ref is a cache, not the source of truth. Budget: at most one GitHub write per second per token, under 500 content-creating requests per hour.

### D2 amendments after spike 4 (2026-09-27)

Measured against real GitHub, see [spike 4 findings](2026-09-27-spike-4-findings-github-storage.md). Hidden refs behave as assumed: absent from the branches API, default clones, events and Actions, yet fetchable by refspec. Four amendments:

1. **Every draft write is a compare-and-swap.** The REST ref update does not check fast-forward on hidden refs: a stale writer silently overwrote a draft and got a 200. Use `git push --force-with-lease`, or GraphQL `updateRefs` with `beforeOid`. Never REST `PATCH` on a hidden ref. After any `updateRefs` error, re-read the ref, because a lost race and a server fault return the same message.
2. **`git push` is the flush transport.** One request per flush for any number of documents, atomic, two to three times faster at 2 MB, and outside the REST write budget. The REST inline-tree flush is the fallback. To be confirmed over HTTPS with an App installation token.
3. **One draft ref per branch, not per document:** `refs/phraise/drafts/<branch>`. The draft commit's tree mirrors the repo, with draft Markdown at its real path and Phraise's sidecar data under `.phraise/`. The draft commit is parented on the branch commit it is based on and is overwritten, not chained. This keeps ref advertisements small, records the base commit for rebase, and lets anyone inspect uncommitted work with plain `git diff <branch> refs/phraise/drafts/<branch>`. This is the lead's call and differs from the spike's parentless commits; the integration spike must validate it.
4. **Drafts in a public repo are public.** Anyone can list and fetch hidden refs, and deleted drafts stay readable by SHA for some time. Therefore on public repositories draft flushing to git is **off by default** and drafts live only in relay storage; a repo admin can opt in. On private repositories it is on by default. This weakens "every durable byte is reconstructible from the repo" for public repos, deliberately.

Open: whether Git Data writes count toward the 500 per hour content-creation limit. If they do, a REST-only flusher sustains about three active documents per user token, which is why amendment 2 matters. Retention is tracked by the probe ref `refs/phraise-spike/retention-probe`, to be checked at 1, 4 and 12 weeks.

## D3. Comments are our own data model — locked

GitHub PR review comments cannot anchor to lines outside diff hunks, to unchanged files, or survive pushes. Phraise stores comments itself. Each comment anchor carries two forms: a CRDT relative position for live editing, and Hypothesis-style selectors for recovery: exact quote, 32-character prefix and suffix, character offset. When the CRDT anchor dies, re-anchor fuzzily; past a threshold, mark orphaned and keep the quote. Comments persist in the drafts ref and, if the repo opts in, in a committed sidecar file. Mirroring comments into a PR review is a later one-way integration.

## D4. Block-preserving Markdown document model — locked

No existing editor round-trips losslessly; opening a file and changing one word must not rewrite the file. Every block node in the editor carries a `src` attribute holding the block's original bytes. At serialization time, `src` is re-parsed and compared structurally with the current node: equal means emit `src` verbatim, different means re-serialize in the file's detected style. Comparison at write time needs no dirty flags and is safe under concurrent edits.

Raw HTML, MDX, front matter, math, footnote definitions, link reference definitions, Mermaid fences and anything unrecognized become opaque source blocks with a rendered preview and a source editor. CommonMark has no invalid input, so "not valid Markdown" reduces to "constructs we do not render", and those round-trip byte for byte.

Semantic line breaks, one sentence per line, are a repo-level opt-in for re-serialized paragraphs. They make merges cleaner but reformat touched paragraphs on first edit.

## D5. Yjs, y-prosemirror, Tiptap, Hocuspocus — default

The only production-proven ProseMirror binding; Hocuspocus 4 is a mature MIT server; Yjs 14 brings attribution, suggestion mode and version diffs. Record the Yjs client ID to user and timestamp mapping at the server's authentication hook from day one, since no CRDT embeds identity. Harden the editor schema for attributed rendering. Loro is the named fallback if native fork, diff and applyDiff prove more valuable than binding maturity. Revisit only if spike 2 shows Yjs cannot express the rebase operation cleanly.

## D6. External commits, offline returns and merges are one operation — locked

An external commit is another peer's edits. Compute a block-level diff from the doc's base commit to the new head, then a word-level diff inside changed blocks, and apply it as CRDT operations attributed to a synthetic peer named after the git author. The CRDT merge preserves cursors, comments and concurrent unsynced edits. CRDTs never hard-conflict, so Phraise never blocks with a merge dialog. Blocks edited on both sides are flagged "needs review" with a side-by-side view. Offline reconnection is the same path through the CRDT's own merge. The doc's base commit advances after each rebase.

Commit is: rebase if the head moved, serialize, write blob, tree and commit via the user's GitHub token so GitHub attributes it to them, and add `Co-authored-by` trailers for everyone who edited since the last commit.

## D7. The local daemon is the integration surface — locked

A CLI daemon materializes a live draft into the checked-out file in a working tree, watches it, and diffs changes back into attributed CRDT operations. This gives VS Code, Typora, Claude Code, Cursor and every other file-based tool full integration for free. The MCP server sits on the daemon and adds what files cannot express: list, reply to and resolve comments; presence; commit. The VS Code extension adds only presence cursors via decorations and comment threads via the Comments API. Irrecoverable divergence between disk and CRDT writes a conflict copy and never overwrites.

## D8. No "log in with your AI subscription" — locked

Anthropic explicitly forbids third-party Claude.ai login and routing through subscription credentials, with server-side enforcement since January 2026. OpenAI tolerates it without a contractual right. Phraise offers BYO API key, the MCP server so users bring their own agent, and optionally spawning the unmodified `claude` binary as a sidecar. Revisit if Anthropic ships the paused Agent SDK subscription credit.

## D9. GitHub App with user-to-server tokens — locked

Attributed commits and comments, fine-grained permissions, higher limits. Org installs need an owner, which is standard friction. GitHub Enterprise Server has rate limits off by default, so self-hosted enterprise is the easy case. Push webhooks plus ETag reconciliation detect external commits.

### D9 amendments after spike 4 (2026-09-27)

- **Commit through GraphQL `createCommitOnBranch`** with the user's token: one call, user authorship, parsed `Co-authored-by` trailers, a verified GitHub signature, and a clean `STALE_DATA` error when the head moved. REST Git Data only when a merge commit or an explicit author is needed.
- **Flush drafts with the App installation token**, not the user's token. Drafts need no attribution and should not spend the user's budget.
- **Poll the branch ref with ETag.** A 304 costs no rate limit and new heads were visible within a second, so polling can be frequent on active branches. Webhooks remain the primary signal once an App exists.
- **Read rate-limit budgets from response headers**, per reset bucket. The `/rate_limit` endpoint reported zero use throughout the spike.
- Still unverified: everything with App tokens. Needs the owner to create a GitHub App; steps are in the spike 4 findings. Re-run gates C to F with a user-to-server token and gates A and G with an installation token before locking.

## D10. Language and repo layout — default, pending spike results

**Repo layout, locked by owner on 2026-09-27:** no main source tree yet. All development happens in `spikes/<date>-<component>-<approach>/`, each self-contained. Multiple approaches per component are encouraged and losers are discarded with a findings doc. A production tree is opened only after an integration spike shows the idea is feasible and key risks are resolved.

**Language, default:** TypeScript, because Yjs, Tiptap and Hocuspocus are JavaScript and the daemon, MCP server and VS Code extension will share the document model. Eventual package split, for orientation only, not to be created yet: `markdown-core` (parse with positions, block-preserving serializer, structural compare), `doc-model` (ProseMirror schema, Yjs bridge, comment anchors), `github` (App auth, refs, blobs, commits, webhooks, with recorded fixtures), `relay` (Hocuspocus server, draft flush, rebase), `web` (Tiptap editor app), `daemon` (file materialization, watcher, MCP), `vscode` (extension). A Rust or wasm parser such as comrak or markdown.mbt is an option if spike 1 shows remark's positions are insufficient.

## Deferred

- Mermaid graphical authoring and comments on diagram elements: anchor to node IDs in the Mermaid source; render as an interactive opaque block. After the core loop.
- Plugins and widgets such as people and status selectors: likely Markdown directives or inline HTML with a rendering registry. After the core loop.
- Licensing of a hosted offering versus the MIT core: owner decision, not urgent.
