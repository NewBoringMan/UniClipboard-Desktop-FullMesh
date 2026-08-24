#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ ! -d "$root_dir/components" ]]; then
  printf '%s\n' 'bootstrap-source-bundle: components/ is missing; run integration/scripts/bootstrap.sh in a Git checkout.' >&2
  exit 1
fi

for component in engine desktop mobile; do
  bundle="$root_dir/components/$component-history.bundle"
  destination="$root_dir/$component"
  commit="$(node -e 'const lock=require(process.argv[1]); const item=lock.components[process.argv[2]]; process.stdout.write(item.sourceCommit || item.commit)' "$root_dir/upstreams.lock.json" "$component")"

  if [[ ! -f "$bundle" ]]; then
    printf 'bootstrap-source-bundle: missing %s\n' "$bundle" >&2
    exit 1
  fi
  if [[ -d "$destination" ]] && [[ -z "$(find "$destination" -mindepth 1 -print -quit)" ]]; then
    # `git archive` may preserve an empty directory at each gitlink path.
    # Removing that known-empty directory is safe and lets `git clone` create
    # the repository in its canonical location.
    rmdir "$destination"
  elif [[ -e "$destination" ]]; then
    printf 'bootstrap-source-bundle: refusing to overwrite non-empty %s\n' "$destination" >&2
    exit 1
  fi

  git clone --quiet "$bundle" "$destination"
  git -C "$destination" checkout --quiet --detach "$commit"
done

"$root_dir/integration/scripts/verify-locks.sh"
printf '%s\n' 'Source bundle repositories reconstructed and verified without network access.'
