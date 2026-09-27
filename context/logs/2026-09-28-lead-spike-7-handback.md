# Log: lead, spike 7 handback

Author: lead agent (Fable 5.1)
Time zone: CEST. Every timestamp below is from `date` at the time of writing.
Related: [spike 7 charter](../plans/2026-09-27-spike-7-charter-web-editor.md), [spike 7 findings](../docs/2026-09-27-spike-7-findings-web-editor.md)

## 00:28 — Handback verified and accepted

Handback arrived at about 00:24 on 2026-09-28. Eight worker dispatches of about fourteen, about eight hours twenty minutes.

Independent verification by the lead, 00:26 to 00:27:
- `npm test`: 187 of 187 in 26 files.
- `npm run gates`: exit 0. Every Chromium gate A to K passed, no Chromium failures.
- WebKit, reported beside the verdict: 2 failures in this run. One is in gate D, the caret test the third workaround exists for. The other is in **gate A**, "Enter on an empty bullet-list item leaves the list". The handback said WebKit passes gates A and C fully; in this run it did not pass A. The flake is not confined to gates B and D.
- No listeners left on ports 4400 to 4499. The branch only adds files. No dependencies or browser binaries tracked. Ten screenshots, the largest 186 KB.
- The lead read five screenshots: README, design doc with table and code, comment thread, source blocks, unverifiable-block card. No Markdown syntax is visible in normal content. Source blocks carry plain-language labels. The unverifiable-block card shows escaped Markdown, which a non-technical user cannot judge.

Decisions recorded: D11a to D11g and P18.

## Carried forward

1. Product features before anyone non-technical can use it: toolbar and menus, table rows and columns, image insertion, link hover card.
2. Serialization off the main thread for large documents.
3. The unverifiable-block card should show a rendered before and after.
4. WebKit caret flake and Firefox, which does not launch on this machine.
5. The lost keystroke during a remote composition, seen once in 360 runs.
6. A test with a real display and a real input method.

## Held for the owner

Reporting the y-tiptap caret regression upstream, P18, together with P15. Both would post publicly under the owner's account.
