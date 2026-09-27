#!/usr/bin/env bash
# lib.sh: the only path from spike 4 scripts to GitHub.
#
# Enforces the charter's hard safety rules in code:
#   - repository fixed to skurella/phraise;
#   - writes only to git/{blobs,trees,commits,refs} and GraphQL createCommitOnBranch;
#   - refs only under refs/phraise-spike/ or refs/heads/spike-scratch/github-storage-*;
#   - at most MAX_WRITES writes in total, serial, at least MIN_GAP seconds apart;
#   - any 403 or 429 creates a STOP file and every later call refuses to run.
# The token is never read by these scripts: gh reads it from the keyring. Only
# response headers are recorded, never request headers.
#
# Usage: source lib.sh; set GATE=<name> before calls.

set -euo pipefail

REPO="skurella/phraise"
SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${PHRAISE_SPIKE_STATE:-$SPIKE_DIR/.state}"
EVIDENCE_DIR="${PHRAISE_SPIKE_EVIDENCE:-$SPIKE_DIR/evidence}"
MAX_WRITES=300
MIN_GAP=1.1
GATE="${GATE:-misc}"
REPO_NODE_ID="R_kgDOUtgoIw"   # node ID of skurella/phraise, checked 2026-09-27
# The only two GraphQL mutations allowed, matched by exact string.
GQL_COMMIT='mutation Commit($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid url } } }'
GQL_UPDATE_REFS='mutation Refs($input: UpdateRefsInput!) { updateRefs(input: $input) { clientMutationId } }'

mkdir -p "$STATE_DIR" "$EVIDENCE_DIR"
[[ -f "$STATE_DIR/writes" ]] || echo 0 > "$STATE_DIR/writes"
[[ -f "$STATE_DIR/last_write" ]] || echo 0 > "$STATE_DIR/last_write"

# Globals set by every call.
STATUS=""; BODY_FILE=""; HDR_FILE=""; DUR_MS=""

now() { perl -MTime::HiRes=time -e 'printf "%.3f\n", time'; }
log() { printf '[%s %s] %s\n' "$(date +%H:%M:%S)" "$GATE" "$*" >&2; }
die() { log "FATAL: $*"; exit 98; }
writes_used() { cat "$STATE_DIR/writes"; }

check_stop() {
  if [[ -e "$STATE_DIR/STOP" ]]; then
    log "STOP file present, refusing to call GitHub: $(cat "$STATE_DIR/STOP")"
    exit 99
  fi
}

ref_allowed() {
  local r="$1"
  [[ "$r" == *..* || "$r" == *"//"* ]] && return 1
  case "$r" in
    refs/phraise-spike/?*) return 0 ;;
    refs/heads/spike-scratch/github-storage-?*) return 0 ;;
  esac
  return 1
}

# Validate a write before it is sent. $1 method, $2 path, $3 input file or "".
validate_write() {
  local method="$1" path="$2" input="${3:-}"
  local base="repos/$REPO/git"
  case "$method" in
    POST)
      case "$path" in
        "$base/blobs"|"$base/trees"|"$base/commits") return 0 ;;
        "$base/refs")
          [[ -n "$input" ]] || die "POST refs without body"
          local r; r="$(jq -r '.ref // ""' "$input")"
          ref_allowed "$r" || die "ref not allowed: $r"
          return 0 ;;
        graphql)
          [[ -n "$input" ]] || die "graphql without body"
          local q; q="$(jq -r .query "$input")"
          if [[ "$q" == "$GQL_COMMIT" ]]; then
            local repo_nwo branch
            repo_nwo="$(jq -r '.variables.input.branch.repositoryNameWithOwner' "$input")"
            branch="$(jq -r '.variables.input.branch.branchName' "$input")"
            [[ "$repo_nwo" == "$REPO" ]] || die "graphql repo not allowed: $repo_nwo"
            ref_allowed "refs/heads/$branch" || die "graphql branch not allowed: $branch"
            return 0
          elif [[ "$q" == "$GQL_UPDATE_REFS" ]]; then
            [[ "$(jq -r '.variables.input.repositoryId' "$input")" == "$REPO_NODE_ID" ]] || die "updateRefs repo not allowed"
            local n r; n="$(jq '.variables.input.refUpdates | length' "$input")"
            (( n >= 1 )) || die "updateRefs without refUpdates"
            while IFS= read -r r; do ref_allowed "$r" || die "updateRefs ref not allowed: $r"; done \
              < <(jq -r '.variables.input.refUpdates[].name' "$input")
            return 0
          fi
          die "only the fixed createCommitOnBranch and updateRefs mutations are allowed" ;;
      esac ;;
    PATCH|DELETE)
      case "$path" in
        "$base/refs/"*)
          local r="refs/${path#"$base/refs/"}"
          ref_allowed "$r" || die "ref not allowed: $r"
          return 0 ;;
      esac ;;
  esac
  die "write not allowed: $method $path"
}

# Low-level call. $1 method, $2 path, $3 input file or "", rest extra -H headers.
# Sets STATUS, BODY_FILE, HDR_FILE, DUR_MS. Records one evidence line.
call() {
  check_stop
  local method="$1" path="$2" input="${3:-}"; shift 3 || shift $#
  local is_write=0 http_method="$method"
  if [[ "$method" == GQLREAD ]]; then
    http_method=POST; path=graphql
    jq -e '(.query | test("^ *(query|\\{)")) and (.query | test("mutation[ ({]") | not)' "$input" >/dev/null \
      || die "GQLREAD body is not a read-only query"
  elif [[ "$method" != GET ]]; then
    is_write=1
    validate_write "$method" "$path" "$input"
    local n; n="$(writes_used)"
    (( n < MAX_WRITES )) || die "write cap $MAX_WRITES reached"
    local last gap; last="$(cat "$STATE_DIR/last_write")"
    gap="$(perl -e "printf '%.3f', $MIN_GAP - ($(now) - $last)")"
    if perl -e "exit !($gap > 0)"; then sleep "$gap"; fi
    echo $((n + 1)) > "$STATE_DIR/writes"
  elif [[ "$path" != "repos/$REPO"* && "$path" != graphql && "$path" != rate_limit \
          && "$path" != notifications* && "$path" != user ]]; then
    die "read outside allowed paths: $path"
  fi
  local tmp; tmp="$(mktemp "$STATE_DIR/resp.XXXXXX")"
  HDR_FILE="$tmp.hdr"; BODY_FILE="$tmp.body"
  local args=(api -i -X "$http_method" "$path")
  [[ -n "$input" ]] && args+=(--input "$input")
  local h; for h in "$@"; do args+=(-H "$h"); done
  local t0 t1; t0="$(now)"
  gh "${args[@]}" > "$tmp" 2>/dev/null || true
  t1="$(now)"
  [[ "$is_write" == 1 ]] && echo "$t1" > "$STATE_DIR/last_write"
  DUR_MS="$(perl -e "printf '%d', ($t1 - $t0) * 1000")"
  # Split headers and body at the first blank line.
  perl -0777 -ne '($h,$b)=split(/\r?\n\r?\n/,$_,2); print $h' "$tmp" > "$HDR_FILE"
  perl -0777 -ne '($h,$b)=split(/\r?\n\r?\n/,$_,2); print $b // ""' "$tmp" > "$BODY_FILE"
  rm -f "$tmp"
  STATUS="$(head -1 "$HDR_FILE" | awk '{print $2}')"
  [[ -n "$STATUS" ]] || STATUS=000
  hdr() { grep -i "^$1:" "$HDR_FILE" | head -1 | cut -d' ' -f2- | tr -d '\r' || true; }
  jq -n -c --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg gate "$GATE" \
    --arg method "$method" --arg path "$path" --arg status "$STATUS" \
    --arg ms "$DUR_MS" --arg write "$is_write" --arg writes "$(writes_used)" \
    --arg limit "$(hdr X-Ratelimit-Limit)" --arg remaining "$(hdr X-Ratelimit-Remaining)" \
    --arg used "$(hdr X-Ratelimit-Used)" --arg resource "$(hdr X-Ratelimit-Resource)" \
    --arg reset "$(hdr X-Ratelimit-Reset)" --arg etag "$(hdr Etag)" \
    --arg reqid "$(hdr X-Github-Request-Id)" --arg retry "$(hdr Retry-After)" \
    '{ts:$ts,gate:$gate,method:$method,path:$path,status:($status|tonumber),ms:($ms|tonumber),
      write:($write=="1"),writes_total:($writes|tonumber),rl_limit:$limit,rl_remaining:$remaining,
      rl_used:$used,rl_resource:$resource,rl_reset:$reset,etag:$etag,request_id:$reqid,retry_after:$retry}' \
    >> "$EVIDENCE_DIR/calls.jsonl"
  if [[ "$STATUS" == 403 || "$STATUS" == 429 ]]; then
    echo "$(date -u +%FT%TZ) $STATUS on $method $path (gate $GATE)" > "$STATE_DIR/STOP"
    log "HTTP $STATUS on $method $path: stopping. Body: $(head -c 400 "$BODY_FILE")"
    exit 97
  fi
  log "$method $path -> $STATUS in ${DUR_MS}ms (writes $(writes_used), rl_used $(hdr X-Ratelimit-Used))"
}

get()  { call GET "$1" "" "${@:2}"; }
# gql_read <query string> [variables json]
gql_read() {
  local vars='{}'; [[ $# -ge 2 ]] && vars="$2"
  local f; f="$(jfile --arg q "$1" --argjson v "$vars" '{query:$q,variables:$v}')"
  call GQLREAD graphql "$f"; rm -f "$f"
}
body() { cat "$BODY_FILE"; }
jbody() { jq -r "$1" "$BODY_FILE"; }
header() { grep -i "^$1:" "$HDR_FILE" | head -1 | cut -d' ' -f2- | tr -d '\r' || true; }
expect() { local want="$1"; [[ "$STATUS" == "$want" ]] || die "expected $want, got $STATUS: $(head -c 400 "$BODY_FILE")"; }

# Write a JSON document produced by jq to a temp file and return its path.
jfile() { local f; f="$(mktemp "$STATE_DIR/in.XXXXXX")"; jq -n "$@" > "$f"; echo "$f"; }

# --- Git Data helpers ---------------------------------------------------------

# blob_from_file <path> -> sha. Always base64, which is safe for text and binary.
blob_from_file() {
  local f; f="$(mktemp "$STATE_DIR/in.XXXXXX")"
  { printf '{"encoding":"base64","content":"'; base64 < "$1" | tr -d '\n'; printf '"}'; } > "$f"
  call POST "repos/$REPO/git/blobs" "$f"; expect 201; rm -f "$f"; jbody .sha
}

# tree_two <md_sha> <bin_sha> -> sha. A tree with draft.md and draft.crdt.
tree_two() {
  local f; f="$(jfile --arg a "$1" --arg b "$2" \
    '{tree:[{path:"draft.md",mode:"100644",type:"blob",sha:$a},{path:"draft.crdt",mode:"100644",type:"blob",sha:$b}]}')"
  call POST "repos/$REPO/git/trees" "$f"; expect 201; rm -f "$f"; jbody .sha
}

# commit_obj <message> <tree> [parent...] -> sha
commit_obj() {
  local msg="$1" tree="$2"; shift 2
  local parents; parents="$(printf '%s\n' "$@" | jq -R . | jq -s 'map(select(length>0))')"
  local f; f="$(jfile --arg m "$msg" --arg t "$tree" --argjson p "$parents" '{message:$m,tree:$t,parents:$p}')"
  call POST "repos/$REPO/git/commits" "$f"; expect 201; rm -f "$f"; jbody .sha
}

# ref_create <full ref> <sha>; sets STATUS
ref_create() {
  local f; f="$(jfile --arg r "$1" --arg s "$2" '{ref:$r,sha:$s}')"
  call POST "repos/$REPO/git/refs" "$f"; rm -f "$f"
}

# ref_update <full ref> <sha> <force true|false>; sets STATUS
ref_update() {
  local f; f="$(jfile --arg s "$2" --argjson force "$3" '{sha:$s,force:$force}')"
  call PATCH "repos/$REPO/git/refs/${1#refs/}" "$f"; rm -f "$f"
}

# ref_delete <full ref>; sets STATUS
ref_delete() { call DELETE "repos/$REPO/git/refs/${1#refs/}" ""; }

# ref_sha <full ref> -> sha or empty
ref_sha() {
  get "repos/$REPO/git/ref/${1#refs/}"
  if [[ "$STATUS" == 200 ]]; then jbody '.object.sha'; else echo ""; fi
}

# The only GraphQL mutation allowed: createCommitOnBranch.
# gql_commit <branch> <expectedHeadOid> <headline> <body> <path> <file with contents>
gql_commit() {
  local f; f="$(mktemp "$STATE_DIR/in.XXXXXX")"
  jq -n --arg repo "$REPO" --arg b "$1" --arg oid "$2" --arg h "$3" --arg bd "$4" \
        --arg p "$5" --rawfile c <(base64 < "$6" | tr -d '\n') \
    --arg q "$GQL_COMMIT" '{query:$q,
      variables:{input:{branch:{repositoryNameWithOwner:$repo,branchName:$b},expectedHeadOid:$oid,
        message:{headline:$h,body:$bd},fileChanges:{additions:[{path:$p,contents:$c}]}}}}' > "$f"
  call POST graphql "$f"; rm -f "$f"
}

# CAS update of any allowed ref via GraphQL updateRefs.
# gql_update_ref <full ref> <beforeOid> <afterOid> <force true|false>
gql_update_ref() {
  local f; f="$(jfile --arg q "$GQL_UPDATE_REFS" --arg id "$REPO_NODE_ID" --arg n "$1" \
    --arg b "$2" --arg a "$3" --argjson force "$4" \
    '{query:$q,variables:{input:{repositoryId:$id,refUpdates:[{name:$n,beforeOid:$b,afterOid:$a,force:$force}]}}}')"
  call POST graphql "$f"; rm -f "$f"
}
