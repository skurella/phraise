// Gate E: style detection. Threshold: at least 10 corpus files (real +
// handwritten) with non-default conventions pass the forced-reserialize
// check.
import { detectStyle, parseMdast, serializeDoc, type Style, type TraceInfo } from '../src/index.js';
import type { ParsedFile } from './lib/parsedFile.js';

// Mirrors the fallback values `majority()` uses in src/style.ts when a file
// has no votes for a convention.
const DEFAULT_STYLE: Style = {
  bullet: '-',
  bulletOrdered: '.',
  emphasis: '*',
  strong: '*',
  fence: '`',
  fenceLen: 3,
  headingStyle1: 'atx',
  headingStyle2: 'atx',
  setext: false,
  closeAtx: false,
  rule: '-',
  ruleRepetition: 3,
  listItemIndent: 'one',
  eol: '\n',
};

function isNonDefault(style: Style): string[] {
  const diffs: string[] = [];
  for (const k of Object.keys(DEFAULT_STYLE) as (keyof Style)[]) {
    if (style[k] !== DEFAULT_STYLE[k]) diffs.push(k);
  }
  return diffs;
}

interface Applicable {
  bulletList: boolean;
  emphasis: boolean;
  fence: boolean;
  heading1or2: boolean;
  rule: boolean;
  multiline: boolean;
}

function scanApplicable(mdast: any, text: string): Applicable {
  const a: Applicable = {
    bulletList: false,
    emphasis: false,
    fence: false,
    heading1or2: false,
    rule: false,
    multiline: text.split(/\r\n|\n/).length > 1,
  };
  const walk = (node: any) => {
    if (node.type === 'list' && !node.ordered) a.bulletList = true;
    if (node.type === 'emphasis') a.emphasis = true;
    if (node.type === 'code' && node.position) {
      const raw = text.slice(node.position.start.offset, node.position.end.offset);
      if (/^[`~]/.test(raw)) a.fence = true;
    }
    if (node.type === 'heading' && (node.depth === 1 || node.depth === 2)) a.heading1or2 = true;
    if (node.type === 'thematicBreak') a.rule = true;
    for (const c of node.children ?? []) walk(c);
  };
  walk(mdast);
  return a;
}

/** Which of the file's applicable conventions the forced re-serialization preserved. */
function conventionsMatch(style: Style, forcedStyle: Style, applicable: Applicable): { pass: boolean; checked: string[] } {
  const checked: string[] = [];
  let pass = true;
  if (applicable.bulletList) {
    checked.push('bullet');
    if (style.bullet !== forcedStyle.bullet) pass = false;
  }
  if (applicable.emphasis) {
    checked.push('emphasis');
    if (style.emphasis !== forcedStyle.emphasis) pass = false;
  }
  if (applicable.fence) {
    checked.push('fence');
    if (style.fence !== forcedStyle.fence) pass = false;
  }
  if (applicable.heading1or2) {
    checked.push('heading(setext/closeAtx)');
    if (style.setext !== forcedStyle.setext || style.closeAtx !== forcedStyle.closeAtx) pass = false;
  }
  if (applicable.rule) {
    checked.push('rule');
    if (style.rule !== forcedStyle.rule || style.ruleRepetition !== forcedStyle.ruleRepetition) pass = false;
  }
  if (applicable.multiline) {
    checked.push('eol');
    if (style.eol !== forcedStyle.eol) pass = false;
  }
  return { pass, checked };
}

export interface GateEFileResult {
  id: string;
  nonDefaultFields: string[];
  isNonDefault: boolean;
  checkedConventions: string[];
  pass: boolean;
  style: Style;
}

export interface GateEResult {
  files: GateEFileResult[];
  nonDefaultPassCount: number;
  // Per-block forced-reserialization metrics (informational), hints on/off.
  hintsOnByteIdenticalRate: number;
  hintsOffByteIdenticalRate: number;
  hintsOnVerificationRate: number;
  hintsOffVerificationRate: number;
  blocksMeasured: number;
}

export function runGateE(files: ParsedFile[]): GateEResult {
  const results: GateEFileResult[] = [];

  let blocksMeasured = 0;
  let hintsOnByteIdentical = 0;
  let hintsOffByteIdentical = 0;
  let hintsOnVerified = 0;
  let hintsOffVerified = 0;

  for (const pf of files) {
    if (pf.error) continue;
    const { file, doc } = pf;
    const mdast = parseMdast(file.md);
    const style = detectStyle(file.md, mdast);
    const nonDefaultFields = isNonDefault(style);

    let forced = '';
    try {
      forced = serializeDoc(doc, { forceReserialize: true, useHints: false });
    } catch {
      results.push({ id: file.id, nonDefaultFields, isNonDefault: nonDefaultFields.length > 0, checkedConventions: [], pass: false, style });
      continue;
    }
    const forcedMdast = parseMdast(forced);
    const forcedStyle = detectStyle(forced, forcedMdast);
    const applicable = scanApplicable(mdast, file.md);
    const { pass, checked } = conventionsMatch(style, forcedStyle, applicable);

    results.push({
      id: file.id,
      nonDefaultFields,
      isNonDefault: nonDefaultFields.length > 0,
      checkedConventions: checked,
      pass,
      style,
    });

    // Informational per-block metrics: hints on and off.
    const srcById = new Map<number, string>();
    let idx = 0;
    doc.forEach((b) => srcById.set(idx++, (b.attrs.src as string) ?? ''));

    for (const useHints of [true, false]) {
      let i = 0;
      try {
        serializeDoc(doc, {
          forceReserialize: true,
          useHints,
          trace: (info: TraceInfo) => {
            blocksMeasured += useHints ? 0 : 1; // count each block once (on the useHints=false pass)
            const src = srcById.get(i) ?? '';
            const identical = info.text === src;
            const verified = info.kind === 're-serialize';
            if (useHints) {
              if (identical) hintsOnByteIdentical++;
              if (verified) hintsOnVerified++;
            } else {
              if (identical) hintsOffByteIdentical++;
              if (verified) hintsOffVerified++;
            }
            i++;
          },
        });
      } catch {
        // leave counts as-is; a file whose forced reserialize throws simply
        // contributes fewer measured blocks.
      }
    }
  }

  const nonDefaultPassCount = results.filter((r) => r.isNonDefault && r.pass).length;

  return {
    files: results,
    nonDefaultPassCount,
    hintsOnByteIdenticalRate: blocksMeasured ? hintsOnByteIdentical / blocksMeasured : 0,
    hintsOffByteIdenticalRate: blocksMeasured ? hintsOffByteIdentical / blocksMeasured : 0,
    hintsOnVerificationRate: blocksMeasured ? hintsOnVerified / blocksMeasured : 0,
    hintsOffVerificationRate: blocksMeasured ? hintsOffVerified / blocksMeasured : 0,
    blocksMeasured,
  };
}
