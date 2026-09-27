# Log: lead, spike 3 handback

Author: lead agent (Fable 5.1)
Time zone: CEST. Every timestamp below is from `date` at the time of writing.
Related: [spike 3 charter](../plans/2026-09-27-spike-3-charter-daemon-file-sync.md), [spike 3 findings](../docs/2026-09-27-spike-3-findings-daemon-file-sync.md)

## 12:37 — Handback verified and accepted

Handback arrived at about 12:27. Six worker dispatches, about four hours forty minutes.

Independent verification by the lead, 12:29 to 12:36:
- `npm test`: 35 of 35 in 14 files.
- `npm run gates`: **exit 1.** Gates A, B, C, D, E, G, H pass. Gate F fails its threshold with 2 core failures in 3350, both in `handwritten/footnotes.md`, where half-typed indented text merges into a footnote continuation. Gate I fails its threshold at 298 of 300, seeds 439041158 and 439041369, category "resurrected". In the fuzz: exception 0, divergence 0, lost 0, echo 0.
- These are the numbers the orchestrator reported. Its handback gave the counts but did not say that the gate command exits with a failure. The lead's first summary to the owner repeated the counts without the word "fail"; corrected in the next message.
- No listeners left on ports 4100 to 4199. No spike 3 processes left running.
- The branch only adds files. Nothing tracked under `node_modules`.

Decisions recorded: D1a, D7a to D7g, S3-10. Rated hard: D1a (re-seeding becomes compaction with generations, the lead's own design, untested) and D7b (base inference). D7g records that the spike is accepted with two formally failing gates and why.

## Carried into the integration spike

1. Fix the footnote-continuation parser bug from spike 1.
2. Fix or bound the reappearing-text case on an exact tie in base inference.
3. Test D1a: an offline editor and a stopped daemon each returning across a re-seed.
4. Adopt spike 3's block alignment in the rebase.
5. Serializer: best effort instead of refusal, composition check, no numeric character references from concurrent formatting.
6. Memory on large documents; Windows; the MCP server with the comment store.
