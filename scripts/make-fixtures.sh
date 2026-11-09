#!/usr/bin/env bash
# Creates synthetic Git repositories and stores their `git log --graph` output
# (same format as GitService.getLogChunk) as test/fixtures/*.log.
# Usage: bash scripts/make-fixtures.sh
set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
out_dir="$root_dir/test/fixtures"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
mkdir -p "$out_dir"

# Fixed identity and timestamps so the hashes are reproducible.
export GIT_AUTHOR_NAME="Fixture" GIT_AUTHOR_EMAIL="fixture@example.invalid"
export GIT_COMMITTER_NAME="Fixture" GIT_COMMITTER_EMAIL="fixture@example.invalid"
tick=0

# Create a new repository and change into it.
new_repo() {
  tick=0
  rm -rf "$work_dir/$1"
  git init -q -b main "$work_dir/$1"
  cd "$work_dir/$1"
  git config commit.gpgsign false
}

# Commit with a running timestamp (one minute per commit).
commit() {
  tick=$((tick + 1))
  local date
  date="2026-01-01T00:$(printf '%02d' "$tick"):00+00:00"
  GIT_AUTHOR_DATE="$date" GIT_COMMITTER_DATE="$date" git commit -q --allow-empty -m "$1"
}

# Merge without fast-forward, with a running timestamp.
merge() {
  tick=$((tick + 1))
  local date
  date="2026-01-01T00:$(printf '%02d' "$tick"):00+00:00"
  GIT_AUTHOR_DATE="$date" GIT_COMMITTER_DATE="$date" git merge -q --no-ff -m "$2" "$1"
}

# Write the log in the format of GitService.getLogChunk (--all, --date-order).
dump() {
  git log -n 200 --skip 0 --graph --date=iso-strict --decorate=short \
    '--pretty=format:%x1d%H%x1f%h%x1f%P%x1f%an%x1f%ad%x1f%s%x1f%D%x1e' \
    --date-order --all > "$out_dir/$1.log"
}

# 1) Linear history.
new_repo linear
for i in 1 2 3 4 5; do commit "c$i"; done
dump linear

# 2) Feature branch merged back into main.
new_repo feature-merge
commit "a"; commit "b"
git checkout -q -b feature
commit "f1"; commit "f2"
git checkout -q main
commit "c"
merge feature "merge feature"
commit "d"
dump feature-merge

# 3) Two open branches from the same base commit (not merged).
new_repo parallel-branches
commit "base"
git checkout -q -b left; commit "l1"; commit "l2"
git checkout -q main; git checkout -q -b right; commit "r1"
git checkout -q main; commit "m1"
dump parallel-branches

# 4) Several branches merged one after another (lane shifts).
new_repo staggered-merges
commit "root"
git checkout -q -b one; commit "o1"
git checkout -q main; git checkout -q -b two; commit "t1"; commit "t2"
git checkout -q main; git checkout -q -b three; commit "h1"
git checkout -q main; commit "m1"
merge one "merge one"
commit "m2"
merge two "merge two"
merge three "merge three"
commit "m3"
dump staggered-merges

echo "Fixtures written to $out_dir"
