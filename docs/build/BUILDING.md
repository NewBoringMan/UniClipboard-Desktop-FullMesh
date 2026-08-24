# Reproducible build guide

## Common setup

Clone with submodules, run `integration/scripts/bootstrap.sh`, and verify no lock drift. Version `0.1.0-alpha.1` pins Engine/Desktop Rust 1.95.0, Mobile Node 22.22.1 and Android Java 17. Never place signing files in the repository.

When starting from the release source archive instead of a Git checkout, run
`integration/scripts/bootstrap-source-bundle.sh`. It reconstructs all three
component repositories from the included Git history bundles without network
access, checks out the immutable commits in `upstreams.lock.json`, and runs the
same lock verification used by CI. The command refuses to overwrite existing
component directories.

## Engine

```bash
cd engine
cargo metadata --locked --format-version 1
cargo fmt --check
node scripts/architecture/check-engine-repository.mjs
cargo test --workspace --locked
```

Use the repository release workflow to build AAR, XCFramework and HarmonyOS artifacts. Verify every artifact against its release manifest before adoption.

## Desktop

Install the OS packages listed in `desktop/CONTRIBUTING.md`, then:

```bash
cd desktop
bun install --frozen-lockfile
bun run format:check
bun run lint
bun test --run
bun run build
```

Native Tauri packages must be built on their target OS. The release matrix produces Windows x64/arm64, macOS Intel/Apple Silicon, and Linux x86_64/aarch64 artifacts. Platform lifecycle smoke tests install, launch, upgrade and uninstall the package on the same runner.

## Mobile

```bash
cd mobile
npm ci
npm run core:prepare
npm run core:verify
npm run plugin:build
npm run check:ci
npm run release:validate
```

Android Gradle builds run on Linux with Java 17 and the Android SDK. iOS simulator tests and archives run on macOS/Xcode. A production Android keystore or Apple provisioning profile is optional for test builds but mandatory for a production-signed release.

## Relay and unified release

Relay tests, multi-process integration tests, SBOM generation and the final manifest are run by the root workflows. `dist/<version>/manifest.json` is authoritative; verify `dist/<version>/checksums/SHA256SUMS` before installation.

For an offline source-lock inventory before platform CI, run
`node packaging/generate-source-sbom.mjs`. This records Cargo, npm and Bun
locked packages in SPDX 2.3 plus a tabular license inventory. The release
workflow additionally generates a filesystem/binary SPDX document after all
native artifacts have been collected.

## Signing status

- Windows: unsigned testing packages until an Authenticode certificate is configured.
- macOS: ad-hoc testing packages until Developer ID and notarization credentials are configured.
- Android: test-signed packages until the dedicated release keystore is configured.
- iOS: simulator/unsigned archive until Team ID, certificates, App IDs/App Group, provisioning and APNs entitlements are configured.
- HarmonyOS: unsigned probe/HAR only until DevEco and signing material are configured; this is not a finished product app.
