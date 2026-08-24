#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if git -C "$root_dir" ls-tree -r HEAD | awk '$1 == "160000" { found=1 } END { exit !found }'; then
  git -C "$root_dir" submodule sync --recursive
  git -C "$root_dir" submodule update --init --recursive
  printf '%s\n' 'Submodules are initialized at the locked commits.'
else
  printf '%s\n' 'Vendored component trees are present; submodule initialization is not required.'
fi
"$root_dir/integration/scripts/verify-locks.sh"
