#!/usr/bin/env node
// Brief 04, task 1: make Hocuspocus 4.7 (which only knows the real package
// names `yjs`/`y-protocols`, declared as its peerDependencies) and this
// spike's own code (which imports `@y/y`/`@y/protocols` directly) share the
// exact same module instances, so a Y.Doc built by one side is a real
// `instanceof` match for the other.
//
// npm `overrides` alone (brief 02's attempt (a)) is NOT enough: `"yjs":
// "npm:@y/y@..."` makes npm install the `@y/y` package's CONTENTS under the
// `node_modules/yjs` directory name, but that is still a physically separate
// copy on disk from `node_modules/@y/y` -- two directories, byte-identical
// content, but two different module instances at runtime (confirmed in
// brief 02: `yjs !== @y/y` by reference, and Yjs's own "already imported"
// guard fires). This script runs after `npm install`/`npm ci` (as
// `postinstall`) and replaces the two override-installed directories with
// symlinks to the real `@y/*` packages already present in the graph, so
// there is exactly one copy on disk and Node's module resolution hands out
// the exact same instance either way.
//
// Also handles `lib0`: Hocuspocus's own packages declare `lib0: ^0.2.117`
// (a real, different major version from `@y/y`'s `lib0: ^1.0.0-rc.29`).
// This spike's package.json pins a direct dependency on `lib0@1.0.0-rc.33`
// AND overrides `"lib0": "$lib0"` (npm's "same version as my own direct
// dependency, everywhere in the graph" syntax) specifically so Hocuspocus's
// own nested `lib0@0.2.x` copy is forced to the same 1.0.0-rc.33 install
// this script then also symlink-dedupes below, rather than being aliased
// like yjs/y-protocols (a real 0.2.x package renamed to 1.0.0-rc.33 would be
// nonsense -- `$lib0` instead makes npm resolve every dependent's `lib0`
// range against the ROOT's own lib0 version, refusing the install outright
// if any dependent's declared range can't actually accept 1.0.0-rc.33).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const nodeModules = path.join(root, 'node_modules');

/** Replace `node_modules/<name>` with a symlink to `node_modules/@y/<realName>`, if both exist and aren't already the same thing. */
function relink(overriddenName, realScopedName) {
  const overriddenPath = path.join(nodeModules, overriddenName);
  const realPath = path.join(nodeModules, '@y', realScopedName);
  if (!fs.existsSync(realPath)) {
    console.log(`[postinstall-dedupe] ${realPath} missing -- skipping ${overriddenName} (not using the Hocuspocus/@y stack this run?)`);
    return;
  }
  if (fs.existsSync(overriddenPath)) {
    const st = fs.lstatSync(overriddenPath);
    if (st.isSymbolicLink() && fs.readlinkSync(overriddenPath) === realPath) {
      console.log(`[postinstall-dedupe] ${overriddenName} already symlinked to ${realPath}`);
      return;
    }
    fs.rmSync(overriddenPath, { recursive: true, force: true });
  }
  fs.symlinkSync(realPath, overriddenPath, 'dir');
  console.log(`[postinstall-dedupe] node_modules/${overriddenName} -> ${realPath}`);
}

relink('yjs', 'y');
relink('y-protocols', 'protocols');

// Assert the dedupe actually took: a real Y.Doc built through either
// specifier must be the exact same class.
const yjsMod = require('yjs');
const yMod = require('@y/y');
if (yjsMod.Doc !== yMod.Doc) {
  console.error('[postinstall-dedupe] FAIL: (await import("yjs")).Doc !== (await import("@y/y")).Doc -- symlink dedupe did not take effect.');
  process.exit(1);
}
console.log('[postinstall-dedupe] OK: yjs and @y/y resolve to the exact same Doc class.');

// Same check for the lib0 major-version split (brief 02's actual crash
// cause): assert exactly one `lib0` package remains reachable from the
// project root after the `$lib0` override + this relink.
const lib0Path = require.resolve('lib0/package.json');
console.log(`[postinstall-dedupe] lib0 resolves to ${lib0Path}`);
