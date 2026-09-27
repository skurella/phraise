#!/usr/bin/env -S npx tsx
// Re-run one fuzz trial by (seed, trialIndex, granularity) and print its
// full result — the repro command every reported failure prints (brief 03:
// "a failing trial prints its seed and a one-line repro command").
//
// Usage: npx tsx scripts/fuzz-repro.ts --seed <n> --trial <n> --granularity <word|char|block|yprosemirror>
import type { Granularity } from "../src/diff.js";
import { runTrial } from "../src/fuzz/trial.js";

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || i + 1 >= process.argv.length) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing --${name}`);
  }
  return process.argv[i + 1];
}

const seed = Number(arg("seed"));
const trialIndex = Number(arg("trial"));
const granularity = arg("granularity", "word") as Granularity;

const result = runTrial({ seed, trialIndex, granularity });
console.log(JSON.stringify(result, null, 2));
process.exit(Object.keys(result.failures).length > 0 ? 1 : 0);
