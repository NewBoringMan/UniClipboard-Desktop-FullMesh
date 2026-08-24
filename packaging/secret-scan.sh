#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATTERN='(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{20,}|ASC_API_KEY_P8[[:space:]]*=[[:space:]]*[^$])'

if command -v rg >/dev/null 2>&1; then
  if rg --hidden --glob '!.git/**' --glob '!**/node_modules/**' --glob '!**/target/**' \
    --glob '!dist/**' --glob '!**/*.lock' --glob '!packaging/secret-scan.sh' \
    --pcre2 "$PATTERN" "$ROOT"; then
    echo 'potential plaintext secret detected' >&2
    exit 1
  fi
elif command -v grep >/dev/null 2>&1; then
  found=0
  while IFS= read -r -d '' file; do
    if grep -IEnE "$PATTERN" "$file"; then
      found=1
    fi
  done < <(
    find "$ROOT" \
      \( -path "$ROOT/.git" -o -path '*/node_modules' -o -path '*/target' -o -path "$ROOT/dist" \) -prune -o \
      -type f -not -name '*.lock' -not -path "$ROOT/packaging/secret-scan.sh" -print0
  )
  if [[ "$found" -ne 0 ]]; then
    echo 'potential plaintext secret detected' >&2
    exit 1
  fi
else
  echo 'secret scan requires rg or grep' >&2
  exit 2
fi
echo 'secret scan PASS'
