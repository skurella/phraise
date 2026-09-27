#!/usr/bin/env bash
# run-nondestructive.sh: every check in this spike that makes no write to GitHub.
#   1. offline allow-list self-test
#   2. read-only smoke: ETag 304 on main, GraphQL read
#   3. gate B snapshot of events, activity, Actions, notifications, hooks, rulesets
#   4. gate H retention check (API and git fetch of the probe ref)
#   5. cleanup dry run and an independent `git ls-remote` listing of spike refs
set -euo pipefail
cd "$(dirname "$0")"
echo "== selftest";   ./selftest.sh
echo "== smoke";      ./smoke.sh 2>/dev/null
echo "== gate B";     ./gate-b-side-effects.sh "check-$(date -u +%Y%m%dT%H%M%SZ)" 2>/dev/null
echo "== gate H";     ./check-retention-probe.sh 2>/dev/null
echo "== cleanup dry run"; ./cleanup.sh --dry-run 2>&1 | grep -E 'would delete|^refs/' || true
echo "== ls-remote (expect only the retention probe)"
git ls-remote https://github.com/skurella/phraise.git | grep -E 'phraise-spike|spike-scratch' || echo "(none)"
