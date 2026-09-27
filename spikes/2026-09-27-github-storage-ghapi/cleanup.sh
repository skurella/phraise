#!/usr/bin/env bash
# cleanup.sh: delete every ref this spike may have created, except the retention probe.
#   refs/phraise-spike/*                       (except refs/phraise-spike/retention-probe)
#   refs/heads/spike-scratch/github-storage-*
# Lists what it deletes into evidence/cleanup.jsonl, then lists what remains.
# Pass --dry-run to list only.
GATE=cleanup
source "$(dirname "$0")/lib.sh"
KEEP=refs/phraise-spike/retention-probe
DRY=0; [[ "${1:-}" == --dry-run ]] && DRY=1

list() {
  get "repos/$REPO/git/matching-refs/phraise-spike/"; expect 200; jq -r '.[] | .ref + " " + .object.sha' "$BODY_FILE"
  get "repos/$REPO/git/matching-refs/heads/spike-scratch/github-storage-"; expect 200; jq -r '.[] | .ref + " " + .object.sha' "$BODY_FILE"
}
while read -r ref sha; do
  [[ -z "$ref" || "$ref" == "$KEEP" ]] && continue
  ref_allowed "$ref" || { log "skipping ref outside allow-list: $ref"; continue; }
  if [[ $DRY == 1 ]]; then log "would delete $ref ($sha)"; continue; fi
  ref_delete "$ref"
  jq -n -c --arg r "$ref" --arg s "$sha" --arg st "$STATUS" --arg at "$(date -u +%FT%TZ)" \
    '{deleted:$r,was:$s,status:($st|tonumber),at:$at}' | tee -a "$EVIDENCE_DIR/cleanup.jsonl"
done < <(list)
echo "remaining:"; list
