// Reviewer probe (brief 05, priority 4): is gate E's "non-default files
// pass" count ever satisfied vacuously -- i.e. a file counted as
// "non-default" (contributing to the >=10 threshold) whose *only* detected
// non-default convention is one that conventionsMatch() never actually
// checks (strong marker, ordered-list delimiter, fence length, per-level
// heading style, list-item indent width)?
import { parseMarkdown } from '../src/index.js';
import { runGateE } from '../gates/gateE.js';
import type { ParsedFile } from '../gates/lib/parsedFile.js';

const cases: { id: string; md: string }[] = [
  {
    id: 'strong-underscore-only',
    // Only non-default field should be `strong` ('_'); everything else
    // (bullet '-', emphasis '*', fence '`', heading atx, rule '-', eol \n)
    // stays default. No list, no fence, no heading, no rule, no multiline
    // paragraph -> scanApplicable's `checked` list should end up empty.
    md: 'This has __bold__ text but nothing else unusual.\n',
  },
  {
    id: 'ordered-delim-paren-only',
    md: '1) first\n2) second\n3) third\n',
  },
  {
    id: 'list-item-tab-indent-only',
    md: '- item one\n    continuation indented four spaces\n',
  },
];

for (const c of cases) {
  const { doc } = parseMarkdown(c.md);
  const pf: ParsedFile = { file: { id: c.id, set: 'handwritten', md: c.md }, doc } as any;
  const result = runGateE([pf]);
  const r = result.files[0];
  console.log(`\n=== ${c.id} ===`);
  console.log('nonDefaultFields:', r.nonDefaultFields);
  console.log('isNonDefault (counts toward >=10 threshold):', r.isNonDefault);
  console.log('checkedConventions (what was actually verified):', r.checkedConventions);
  console.log('pass:', r.pass, r.checkedConventions.length === 0 ? '  <-- VACUOUS: pass=true with nothing checked' : '');
}
