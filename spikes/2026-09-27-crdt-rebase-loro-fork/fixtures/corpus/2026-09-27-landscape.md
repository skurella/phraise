# Competitive landscape (researched 2026-09-27)

Status: active
Author: lead agent (Fable 5.1), from a research subagent report
Updated: 2026-09-27

Question asked: does a product already deliver WYSIWYG editing, real-time multi-user collaboration with attribution, inline comments and offline mode over Markdown files in a Git repository, on arbitrary files and branches, with explicit commits?

## Verdict

No credible direct competitor. Two 2026 prototypes match the spec almost feature for feature but have no traction, license or business. The commercial products closest to us each solve half: GitBook, Mintlify and Dhub constrain the repo to a docs structure; HackMD, Overleaf and Obsidian Relay make the note the primary object and Git an export target. Git-backed CMSes commit on every save and lack real-time editing. Real-time tools lack Git or have timer-based auto-commit.

Differentiation whitespace: offline-first, byte-exact Markdown round trip, comments that survive external commits, and explicit-commit UX with collaborative staging.

## Ranked matches

| # | Product | License / status | Real-time | WYSIWYG | Comments | Offline | Arbitrary file and branch | Commit model |
|---|---|---|---|---|---|---|---|---|
| 1 | [Graft](https://github.com/tkjaer/graft) | No license, solo side project, 7 stars, Feb 2026 | Yjs, cursors | Tiptap + CodeMirror split | Yes, plus suggestions; JSON on orphan `graft-comments` branch, 50-char context + fuzzy re-anchor | No | Any GitHub file or PR URL; default branch read-only | Explicit commit to branch; optional y-websocket/Redis sync server |
| 2 | [Colibri / tuneithub.com](https://news.ycombinator.com/item?id=47221706) | Hosted; "open source" claim but stub repo, Mar 2026 | Yes | Rich text | Annotations | Unknown | Public repos only, via URL rewrite | Writes back as a PR |
| 3 | [Mintlify editor](https://www.mintlify.com/docs/editor) | Proprietary SaaS | Live cursors, visual and source modes | Yes | Comments and suggestions | No | Only docs in a Mintlify site repo; branch selector | Auto-commit to feature branch ~15 s after idle, then PR |
| 4 | [GitBook](https://www.gitbook.com/features/git-sync) | Proprietary SaaS | Inside change requests | Block editor, GitBook-flavored Markdown | On change requests | No | Needs `.gitbook.yaml` / `SUMMARY.md` structure | Change request merge |
| 5 | [md4lp](https://github.com/md4lp/md4lp) | Apache-2.0, 1 star, 2026 | No, single writer lock | Byte-exact round trip | On Git sidecar refs, fuzzy re-anchor | No | Any repo/branch via isomorphic-git | Autosave to `drafts/<user>/<path>` branch, explicit publish with diff3 |
| 6 | [Dhub](https://dhub.dev) | Closed SaaS | Yes | Notion-like MD/MDX | Undocumented | Undocumented | Any MD/MDX in a GitHub repo via GitHub App | Explicit push or PR |
| 7 | [HackMD](https://hackmd.io/s/link-with-github) | Proprietary | Multi-cursor | No, split pane | Threads | Partial | Any file on any branch via GitHub App | Named versions pushed as commits, selective pull |
| 8 | [Keystatic Cloud](https://keystatic.com/docs/cloud) | MIT core | Experimental multiplayer | Structured fields | No | No | Schema'd collections only | Commit per save |
| 9 | [CollabMD](https://github.com/andes90/collabmd) | MIT, 277 stars | Yjs, presence | Source plus preview | Source-anchored threads | Files on disk | Local folder on the server | Writes to disk continuously, stage/commit UI |
| 10 | [Obsidian Relay](https://relay.md) | Plugin MIT, server is y-sweet fork, control plane proprietary | CRDT, cursors, offline merge | Obsidian live preview | Beta, CriticMarkup | Yes | Local vault only | Obsidian Git timer, 5 min |

## Further afield

- **Perchpad**: every project is a real git repo but auto-commits every 60 s. The anti-pattern.
- **Moxn**: git-like branches and merge requests over Yjs/Tiptap with comments, own store. Good UX reference for staged edits and section-level merge.
- **Tina, Decap, Sveltia, Pages CMS, Front Matter**: branch and PR editorial workflows, commit per save, no real-time. Decap's `cms/*` branches plus one PR per entry is the single-user version of the "dedicated branch" idea.
- **CloudCannon**: multiple users in an editing session, changes staged until explicit save, branch-backed workspaces. Site CMS oriented.
- **ReadMe, Fern**: bi-directional sync or CLI only, no real-time co-editing.
- **Outline, Docmost, AFFiNE, AppFlowy**: no Git backend; open discussions only.
- **Overleaf**: real-time, comments, track changes, git bridge. Its docs warn that git pushes displace comments and tracked changes and recommend not mixing them. That is the failure mode we must design against.
- **Wiki.js, Gollum, GitLab and Gitea wikis**: commit per save, no real-time. GitLab real-time editing is an incubation epic with no phase-one date.
- **GitHub**: no real-time editing on github.com or github.dev; Codespaces collaborate only via VS Live Share; GitHub Next "Collaborative Workspaces" never shipped.
- **Ink & Switch** ([Upwelling](https://www.inkandswitch.com/upwelling/), [Patchwork](https://www.inkandswitch.com/project/patchwork/), Peritext): research prototypes on Automerge. Lessons: writers dislike being watched and want private drafts; visualize diffs in prose; group edits into reviewable units; lightweight branch UI; make history legible and discussable. No Git integration.
- **Typst.app**: real-time plus git sync, but Typst. **Stashpad Docs**: winding down. **Zed**: code collab only.

## Key takeaways for Phraise

1. The Yjs session plus GitHub Contents API plus sidecar ref for comments plus explicit commit architecture has been built twice in 2026 by individuals. It is straightforward. The hard parts are the ones nobody finished: lossless round trip, comment survival across commits, offline, and a daemon for local tools.
2. HackMD's named-version-to-commit and Moxn's staged-edit model are the UX reference points for explicit commit.
3. Overleaf's documented failure is our acceptance test: comments must survive an external commit.
