# Gate results

Generated: 2026-09-27T09:49:11.831Z (--quick)

| Gate | Requirement | Result | Numbers |
|---|---|---|---|
| A | Remote edit reaches the file; untouched blocks stay byte-identical. Latency median/p95. | PASS | trials=20, completed=20, medianMs=43, p95Ms=59, maxMs=59 |
| B | File edit reaches the remote client confined to the edited block, attributed to the local user, per save style. | PASS | perStyle=10, in-place.medianMs=108, in-place.p95Ms=572, in-place.completed=10, rename-over.medianMs=108, rename-over.p95Ms=146, rename-over.completed=10, truncate-then-write.medianMs=109, truncate-then-write.p95Ms=135, truncate-then-write.completed=10 |
| C | No echo: the daemon's own writes never come back as edits, under rapid alternating edits. | PASS | rounds=20, echoCount=0, importOfDaemonBytesCount=0 |
| D | Stale save does not revert remote edits made after its base. | PASS | cases=10, passed=10 |
| E | Concurrent local and remote edits converge; nothing lost; file equals render. | PASS | cases=10, passed=10 |
| F | Imported save reproduces saved bytes exactly (core); daemon does not re-fight the editor. | PASS | corpusFiles=30, passRate=1, coarseTextblocks=7, repairs=0, forks=0, coreFailures=0 |
| G | git commit harmless; branch/reset/stash detach; index.lock detected; reattach works; no local-attributed import while detached. | PASS | rows=8, passed=8 |
| H | Restart merges from a persisted base; missing state yields a conflict copy, nothing overwritten. | PASS | cases=4, passed=4 |
| I | 30 seeded trials interleaving saves/remote edits/restarts/delays: no exception, convergence, no lost text, no echo. | PASS | trials=30, passed=30, exception=0, divergence=0, fileNotRender=0, lost=0, deleteVsEdit=3, resurrected=0, echo=0, detach=0, wholeDocMismatch=0, ambiguousDelete=0, degradedFinal=0, duplicated=0, degradedExports=6, baseMisjudged=0, forks=93, coarseTextblocks=1, repairs=0, noops=1 |
| J | 240 KB file: fresh-save import + resulting export under 500ms median; before/after and end-to-end latencies reported. | PASS | before.parseMarkdownMs=1308.37, after.parseMarkdownMs=147.16, before.serializeDocMs=1264.29, after.serializeDocMs=142.10, before.docToYDocMs=9.02, after.docToYDocMs=6.48, before.yDocToDocMs=2.98, after.yDocToDocMs=2.61, before.importFreshMs=1496.01, after.importFreshMs=189.44, before.importStaleForkedMs=1465.38, after.importStaleForkedMs=201.79, before.importPlusExportMs=3203.32, after.importPlusExportMs=497.93, before.renderDetailedMs=1738.20, after.renderDetailedMs=296.73, before.encodeStateAsUpdateMs=4.97, after.encodeStateAsUpdateMs=4.08, before.ydocBinBytes=845087, after.ydocBinBytes=823957, before.chooseBase8Ms=41.42, after.chooseBase8Ms=37.76, before.gateALatencyMedianMs=1750, after.gateALatencyMedianMs=352, before.gateBLatencyMedianMs=1922, after.gateBLatencyMedianMs=588, before.peakRssMb=646.73, after.peakRssMb=590.61 |

