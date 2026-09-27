#!/usr/bin/env bash
# Gate E: ETag polling of a branch ref.
#   Part 1: does a 304 consume primary rate limit? 25 unconditional GETs vs 25 conditional GETs,
#           reading X-RateLimit-Used / -Reset on every response (buckets are keyed by reset time).
#   Part 2: delay from a write to the new head being visible to a poller, for two writers:
#           GraphQL createCommitOnBranch and a plain `git push` over the owner's SSH remote.
#           Each writer runs TRIALS times on scratch branch spike-scratch/github-storage-e.
# Writes: 1 (branch) + 2*TRIALS. Default TRIALS=3 -> 7.
GATE=E
source "$(dirname "$0")/lib.sh"
TRIALS="${TRIALS:-3}"
BR="spike-scratch/github-storage-e"; REF="refs/heads/$BR"
REFPATH="repos/$REPO/git/ref/heads/$BR"
OUT="$EVIDENCE_DIR/gate-e.json"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

[[ -z "$(ref_sha "$REF")" ]] || die "$REF exists; run cleanup.sh first"
H="$(ref_sha refs/heads/main)"
ref_create "$REF" "$H"; expect 201

# ---- Part 1: rate-limit cost of 304 ------------------------------------------------------
series() { # series <label> <n> [etag]: prints one JSON line per call
  local label="$1" n="$2" etag="${3:-}" i
  for i in $(seq 1 "$n"); do
    if [[ -n "$etag" ]]; then get "$REFPATH" "If-None-Match: $etag"; else get "$REFPATH"; fi
    jq -n -c --arg l "$label" --arg s "$STATUS" --arg u "$(header X-Ratelimit-Used)" \
      --arg r "$(header X-Ratelimit-Reset)" --arg rem "$(header X-Ratelimit-Remaining)" \
      '{series:$l,status:($s|tonumber),used:($u|tonumber),remaining:($rem|tonumber),reset:$r}'
    sleep 0.3
  done
}
get rate_limit; rl_before="$(jq -c .resources.core "$BODY_FILE")"
get "$REFPATH"; expect 200; ETAG="$(header Etag)"
s200="$(series unconditional 25 | jq -s -c .)"
s304="$(series conditional 25 "$ETAG" | jq -s -c .)"
get rate_limit; rl_after="$(jq -c .resources.core "$BODY_FILE")"
# Per bucket (same reset), how much did "used" rise across the series, and how many calls landed in it.
bucket_stats() { jq -c 'group_by(.reset) | map({reset:.[0].reset, calls:length, statuses:(map(.status)|unique),
  used_first:(.[0].used), used_last:(.[-1].used), rise:(.[-1].used - .[0].used)})' <<<"$1"; }

# ---- Part 2: write-to-visible delay --------------------------------------------------------
# poll_until <sha> <t_write_done>: poll the ref with ETag until it points at sha. Prints JSON.
poll_until() {
  local want="$1" t_done="$2" etag="" polls=0 n304=0 t_req got=""
  while :; do
    t_req="$(now)"
    if [[ -n "$etag" ]]; then get "$REFPATH" "If-None-Match: $etag"; else get "$REFPATH"; fi
    polls=$((polls + 1))
    if [[ "$STATUS" == 304 ]]; then n304=$((n304 + 1))
    elif [[ "$STATUS" == 200 ]]; then etag="$(header Etag)"; got="$(jbody .object.sha)"; fi
    if [[ "$got" == "$want" ]]; then
      jq -n -c --argjson polls "$polls" --argjson n304 "$n304" \
        --arg lo "$(perl -e "printf '%.3f', $t_req - $t_done")" --arg hi "$(perl -e "printf '%.3f', $(now) - $t_done")" \
        '{polls:$polls,n304:$n304,visible_after_s_lower:($lo|tonumber),visible_after_s_upper:($hi|tonumber)}'
      return 0
    fi
    (( polls < 240 )) || { echo '{"timeout":true}'; return 0; }
    sleep 0.2
  done
}
also_branches_api() { # seconds until GET branches/<br> shows sha, polled without ETag
  local want="$1" t_done="$2" i
  for i in $(seq 1 60); do
    get "repos/$REPO/branches/$BR"
    [[ "$(jbody .commit.sha)" == "$want" ]] && { perl -e "printf '%.3f', $(now) - $t_done"; return; }
    sleep 0.5
  done; echo -1
}

# Local clone for the git-push writer, over the owner's configured SSH remote.
git clone -q --single-branch --branch "$BR" "git@github.com:$REPO.git" "$WORK/c"
git -C "$WORK/c" config user.name "$(git config --global user.name || echo 'Phraise spike')"
git -C "$WORK/c" config user.email "$(git config --global user.email || echo 'spike@example.com')"

# A git push is a write outside gh api: it goes through the same counter and spacing.
external_write() {
  check_stop; ref_allowed "$1" || die "push to $1 not allowed"
  local n; n="$(writes_used)"; (( n < MAX_WRITES )) || die "write cap reached"
  local last gap; last="$(cat "$STATE_DIR/last_write")"
  gap="$(perl -e "printf '%.3f', $MIN_GAP - ($(now) - $last)")"
  if perl -e "exit !($gap > 0)"; then sleep "$gap"; fi
  echo $((n + 1)) > "$STATE_DIR/writes"
}

trials="[]"
head="$H"
for t in $(seq 1 "$TRIALS"); do
  # Writer 1: GraphQL
  echo "trial $t graphql $(date -u +%FT%TZ)" > "$WORK/f"
  gql_commit "$BR" "$head" "Spike 4 gate E: graphql trial $t" "" "spike-4-scratch/poll.md" "$WORK/f"
  t_done="$(now)"; head="$(jbody '.data.createCommitOnBranch.commit.oid')"
  [[ "$head" =~ ^[0-9a-f]{40}$ ]] || die "graphql commit failed: $(body)"
  r="$(poll_until "$head" "$t_done")"; b="$(also_branches_api "$head" "$t_done")"
  trials="$(jq -c --argjson r "$r" --arg b "$b" --arg t "$t" '. + [{writer:"graphql",trial:($t|tonumber)} + $r + {branches_api_s:($b|tonumber)}]' <<<"$trials")"
  sleep 3

  # Writer 2: git push over SSH
  git -C "$WORK/c" fetch -q origin "$BR"
  git -C "$WORK/c" reset -q --hard "origin/$BR"
  git -C "$WORK/c" commit -q --allow-empty -m "Spike 4 gate E: git push trial $t"
  external_write "$REF"
  git -C "$WORK/c" push -q origin "HEAD:$REF"
  t_done="$(now)"; echo "$t_done" > "$STATE_DIR/last_write"
  head="$(git -C "$WORK/c" rev-parse HEAD)"
  log "git push trial $t -> $head (writes $(writes_used))"
  r="$(poll_until "$head" "$t_done")"; b="$(also_branches_api "$head" "$t_done")"
  trials="$(jq -c --argjson r "$r" --arg b "$b" --arg t "$t" '. + [{writer:"git-push",trial:($t|tonumber)} + $r + {branches_api_s:($b|tonumber)}]' <<<"$trials")"
  sleep 3
done

jq -n --argjson rl_before "$rl_before" --argjson rl_after "$rl_after" \
  --argjson s200 "$(bucket_stats "$s200")" --argjson s304 "$(bucket_stats "$s304")" \
  --argjson raw200 "$s200" --argjson raw304 "$s304" --argjson trials "$trials" \
  '{rate_limit_endpoint:{before:$rl_before,after:$rl_after},
    unconditional_by_bucket:$s200, conditional_by_bucket:$s304, delay_trials:$trials,
    raw:{unconditional:$raw200, conditional:$raw304}}' > "$OUT"
jq -c '.rate_limit_endpoint, .unconditional_by_bucket, .conditional_by_bucket, .delay_trials[]' "$OUT"
