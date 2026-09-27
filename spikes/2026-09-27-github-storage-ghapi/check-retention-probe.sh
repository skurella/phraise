#!/usr/bin/env bash
# Read-only retention check for gate H. Run in later weeks. Exit 0 if the probe ref,
# its orphan commit and its blob are all still served by the API and by git fetch.
GATE=H-check
source "$(dirname "$0")/lib.sh"
REF=refs/phraise-spike/retention-probe
sha="$(ref_sha "$REF")"
[[ -n "$sha" ]] || { echo "RETENTION: ref missing (HTTP $STATUS)"; exit 1; }
get "repos/$REPO/git/commits/$sha"; expect 200
echo "ref -> $sha; message: $(jbody '.message' | head -1)"
tree="$(jbody .tree.sha)"
get "repos/$REPO/git/trees/$tree"; expect 200
blob="$(jbody '.tree[0].sha')"
get "repos/$REPO/git/blobs/$blob"; expect 200
echo "blob content:"; jbody .content | base64 -d
tmp="$(mktemp -d)"
( cd "$tmp" && git init -q && git fetch -q "https://github.com/$REPO.git" "$REF:refs/probe" \
  && git log -1 --format='fetched via git: %H %cI' refs/probe )
rm -rf "$tmp"
echo "RETENTION: OK on $(date -u +%FT%TZ)"
