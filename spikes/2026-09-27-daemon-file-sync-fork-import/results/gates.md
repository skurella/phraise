# Gate results

Generated: 2026-09-27T10:27:02.785Z

| Gate | Requirement | Result | Numbers |
|---|---|---|---|
| A | Remote edit reaches the file; untouched blocks stay byte-identical. Latency median/p95. | PASS | trials=200, completed=200, medianMs=44, p95Ms=57, maxMs=63 |
| B | File edit reaches the remote client confined to the edited block, attributed to the local user, per save style. | PASS | perStyle=100, in-place.medianMs=110, in-place.p95Ms=121, in-place.completed=100, rename-over.medianMs=110, rename-over.p95Ms=124, rename-over.completed=100, truncate-then-write.medianMs=110, truncate-then-write.p95Ms=124, truncate-then-write.completed=100 |
| C | No echo: the daemon's own writes never come back as edits, under rapid alternating edits. | PASS | rounds=200, echoCount=0, importOfDaemonBytesCount=0 |
| D | Stale save does not revert remote edits made after its base. | PASS | cases=50, passed=50, casesWith60ExtraRemoteEdits=10 |
| E | Concurrent local and remote edits converge; nothing lost; file equals render. | PASS | cases=50, passed=50 |
| F | Imported save reproduces saved bytes exactly (core); daemon does not re-fight the editor. | FAIL | corpusFiles=294, passRate=1.00, coarseTextblocks=30, repairs=0, forks=0, coreFailures=2 |
| G | git commit harmless; branch/reset/stash detach; index.lock detected; reattach works; no local-attributed import while detached. | PASS | rows=8, passed=8 |
| H | Restart merges from a persisted base; missing state yields a conflict copy, nothing overwritten. | PASS | cases=4, passed=4 |
| I | 300 seeded trials interleaving saves/remote edits/restarts/delays: no exception, convergence, no lost text, no echo. | FAIL | trials=300, passed=298, exception=0, divergence=0, fileNotRender=0, lost=0, deleteVsEdit=41, resurrected=3, echo=0, detach=0, wholeDocMismatch=0, ambiguousDelete=11, degradedFinal=5, duplicated=0, degradedExports=31, entityEscapeTrials=7, baseMisjudged=22, forks=913, coarseTextblocks=1, repairs=0, noops=18 |
| J | 240 KB file measured before and after the verification cache; target (reported, not gated): fresh-save import + export under 500ms median. | PASS | before.parseMarkdownMs=1308.37, after.parseMarkdownMs=169.25, before.serializeDocMs=1264.29, after.serializeDocMs=169.62, before.docToYDocMs=9.02, after.docToYDocMs=6.87, before.yDocToDocMs=2.98, after.yDocToDocMs=2.83, before.importFreshMs=1496.01, after.importFreshMs=214.79, before.importStaleForkedMs=1465.38, after.importStaleForkedMs=250.55, before.importPlusExportMs=3203.32, after.importPlusExportMs=539.89, before.renderDetailedMs=1738.20, after.renderDetailedMs=319.84, before.encodeStateAsUpdateMs=4.97, after.encodeStateAsUpdateMs=4.32, before.ydocBinBytes=845087, after.ydocBinBytes=845087, before.chooseBase8Ms=41.42, after.chooseBase8Ms=43.41, before.gateALatencyMedianMs=1750, after.gateALatencyMedianMs=383, before.gateBLatencyMedianMs=1922, after.gateBLatencyMedianMs=625, before.peakRssMb=646.73, after.peakRssMb=730.78, target.importPlusExportUnder500ms=false |

## Failures

### Gate F
- gates/f-roundtrip.ts: 2 core round-trip failures (see results/f-roundtrip.json)

### Gate I
- seed 439041158: resurrected
- seed 439041369: resurrected

