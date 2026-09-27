#!/usr/bin/env bash
# Gate H: leave one ref, refs/phraise-spike/retention-probe, pointing at an orphan commit
# (no parents, reachable from no branch) whose message carries its creation date.
# Idempotent: if the probe exists, only reports it. Writes: 4 on first run, 0 after.
# Check later with: ./check-retention-probe.sh
GATE=H
source "$(dirname "$0")/lib.sh"
REF=refs/phraise-spike/retention-probe

existing="$(ref_sha "$REF")"
if [[ -n "$existing" ]]; then
  log "probe already exists at $existing"
  get "repos/$REPO/git/commits/$existing"; jbody '.message'
  exit 0
fi

created="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
f="$(mktemp "$STATE_DIR/probe.XXXXXX")"
cat > "$f" <<EOF
# Phraise retention probe

Created: $created by spike 4 (GitHub storage mechanics).
Purpose: test whether GitHub keeps objects reachable only from a custom ref
outside refs/heads and refs/tags. This commit has no parent and is on no branch.
Do not delete before the retention check recorded in the spike 4 findings doc.
EOF
blob="$(blob_from_file "$f")"; rm -f "$f"
tf="$(jfile --arg b "$blob" '{tree:[{path:"RETENTION-PROBE.md",mode:"100644",type:"blob",sha:$b}]}')"
call POST "repos/$REPO/git/trees" "$tf"; expect 201; tree="$(jbody .sha)"; rm -f "$tf"
commit="$(commit_obj "phraise retention probe, created $created

Orphan commit reachable only from $REF.
Created by spike 4 on $created. Expected to exist at every later check." "$tree")"
ref_create "$REF" "$commit"; expect 201
log "probe created: ref $REF -> commit $commit, tree $tree, blob $blob, created $created"
printf '{"ref":"%s","commit":"%s","tree":"%s","blob":"%s","created":"%s"}\n' \
  "$REF" "$commit" "$tree" "$blob" "$created" > "$EVIDENCE_DIR/gate-h-probe.json"
