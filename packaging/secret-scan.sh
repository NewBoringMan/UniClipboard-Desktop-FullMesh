#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PATTERN='(BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{20,}|ASC_API_KEY_P8[[:space:]]*=[[:space:]]*[^$])'

if rg --hidden --glob '!.git/**' --glob '!**/node_modules/**' --glob '!**/target/**' \
  --glob '!dist/**' --glob '!**/*.lock' --glob '!packaging/secret-scan.sh' \
  --pcre2 "$PATTERN" "$ROOT"; then
  echo 'potential plaintext secret detected' >&2
  exit 1
fi
echo 'secret scan PASS'
