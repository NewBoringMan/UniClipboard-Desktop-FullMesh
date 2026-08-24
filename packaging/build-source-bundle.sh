#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ $# -gt 0 ]]; then
  VERSION="$1"
else
  VERSION="$(tr -d '\r\n' < "$ROOT/VERSION")"
fi
OUT="$ROOT/dist/$VERSION/source"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$OUT" "$STAGE/UniClipboard-FullMesh/components"
git -C "$ROOT" archive --format=tar HEAD | tar -xf - -C "$STAGE/UniClipboard-FullMesh"
git -C "$ROOT" bundle create \
  "$STAGE/UniClipboard-FullMesh/components/integration-history.bundle" --all

VENDORED=0
for component in engine desktop mobile; do
  component_root="$(git -C "$ROOT/$component" rev-parse --show-toplevel)"
  if [[ "$component_root" == "$ROOT" ]]; then
    VENDORED=1
    continue
  fi
  commit="$(git -C "$ROOT/$component" rev-parse HEAD)"
  git -C "$ROOT/$component" archive --format=tar --prefix="components/$component/" "$commit" |
    tar -xf - -C "$STAGE/UniClipboard-FullMesh"
  git -C "$ROOT/$component" bundle create \
    "$STAGE/UniClipboard-FullMesh/components/$component-history.bundle" --all
done

if [[ "$VENDORED" == 0 ]]; then
  cat > "$STAGE/UniClipboard-FullMesh/SOURCE_BUNDLE_README.txt" <<'EOF'
UniClipboard FullMesh source bundle

1. Run: ./integration/scripts/bootstrap-source-bundle.sh
2. The command reconstructs engine/, desktop/, and mobile/ from the included
   Git history bundles and checks out the exact commits in upstreams.lock.json.
3. Run the build and test commands in docs/build/BUILDING.md.

No network access is required for step 1. The components/*/ directories are
plain source snapshots for inspection; the reconstructed repositories retain
their complete histories.
EOF
else
  cat > "$STAGE/UniClipboard-FullMesh/SOURCE_BUNDLE_README.txt" <<'EOF'
UniClipboard FullMesh vendored source snapshot

1. Engine, Desktop, and Mobile source trees are included directly in engine/,
   desktop/, and mobile/ and are verified by immutable Git tree identifiers.
2. Run the build and test commands in docs/build/BUILDING.md.
3. The canonical release source archive contains the original component Git
   history bundles; this CI snapshot intentionally contains source trees only.
EOF
fi

chmod 0755 "$STAGE/UniClipboard-FullMesh/integration/scripts/bootstrap-source-bundle.sh"

tar -C "$STAGE" -czf "$OUT/UniClipboard-FullMesh-$VERSION-source.tar.gz" UniClipboard-FullMesh
printf 'source bundle: %s\n' "$OUT/UniClipboard-FullMesh-$VERSION-source.tar.gz"
