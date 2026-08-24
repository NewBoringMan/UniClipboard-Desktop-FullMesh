# Baseline audit

Audit date: 2026-08-23 (Asia/Taipei). The handoff file was read in full: 283 lines, 12,935 bytes, SHA-256 `290646ad358110f0cef0a23b1c5c2a5badd972a23cd65a327b814ee94a5733f2`. Sections 0 through 11 and the final completion definition are present.

## Frozen repositories

| Component | Default branch / HEAD | Exact tag | Stable release | License | Submodule / LFS |
|---|---|---|---|---|---|
| Engine | `main` / `31c149c5bfb8a8edfe80c94944c8255157a3a3af` | `v1.1.0-rc.5` | none published | Apache-2.0 | none / none |
| Desktop | `main` / `71000a0e2baf43eec0b0d80ec3244824735c0096` | `v1.0.0-alpha.7` | `v0.19.1` | AGPL-3.0-only | none / none |
| Mobile | `main` / `8bc87851e7d587c04726d209a92547ce7913fb7e` | `v2.0.0.179-alpha.3` | `v1.3.0.165` | MIT | none / none |

The integration repository records these commits as Git submodules and duplicates the immutable identifiers in `upstreams.lock.json`.

## Stable-to-main delta

- Desktop main is 103 commits beyond `v0.19.1` (1,558 changed files, approximately +60,428/-194,312). The delta includes extraction of the shared Engine, durable membership/admission, P2P and relay settings, daemon/CLI, Wayland work, and current packaging.
- Mobile main is 138 commits beyond `v1.3.0.165` (827 changed files, approximately +54,939/-49,899). The delta includes shared Engine adoption, Spaces/device trust, iOS extensions, Android foreground/Shizuku integrations, relay settings, and diagnostics.
- Engine `main` is exactly tagged `v1.1.0-rc.5`.

## Existing capability

- Engine already contains Iroh/QUIC networking, relay support, encrypted storage, device membership, clipboard capture/materialization, Android UniFFI AAR, iOS XCFramework, HarmonyOS HAR/N-API, and host probes.
- Desktop already contains a Tauri host, tray/daemon/autostart, native clipboard integration, P2P settings, updater, X11/Wayland handling, Windows/macOS/Linux packaging workflows, and x64/arm64 release jobs.
- Mobile is an Expo/React Native host using the pinned shared Engine. It contains Android foreground service, Shizuku, Quick Settings, Process Text and Share flows, plus iOS App Group, Share Extension, keyboard, history and receiving flows. Legacy LAN compatibility is not the primary route.

## Existing published artifacts

- Engine `v1.1.0-rc.5`: Android AAR (arm64-v8a and x86_64 runtime libraries), iOS XCFramework (device arm64, simulator arm64/x86_64), HarmonyOS HAR/HAP probe and OHOS library, source archive, symbols, dependency-license archive, and release manifest.
- Desktop `v1.0.0-alpha.7`: Windows x64/arm64 setup EXE and portable ZIP; macOS arm64/x64 DMG and app archives; Linux x86_64/aarch64 AppImage, deb and rpm; CLI archives; checksums and minisign signature. MSIX/MSI are not published.
- Mobile `v2.0.0.179-alpha.3`: one arm64-v8a APK. armeabi-v7a, x86_64, universal APK and AAB are not published.

## Toolchains and signing

- Engine and Desktop pin Rust 1.95.0 with rustfmt and clippy. Desktop workflows currently install the latest Bun rather than a fixed version.
- Mobile pins Node 22.22.1 through `.nvmrc`, requires Node `>=22.22.1 <23`, Java 17 for Android, Xcode/macOS runners for iOS, and Ruby for App Store release-note validation.
- Production Authenticode, Apple Developer ID/notarization, Android release keystore, Apple provisioning/APNs, and HarmonyOS signing credentials are not available in the current environment. CI must fail explicitly or emit `unsigned-testing` / ad-hoc artifacts; it must never silently present them as production-signed.

## Baseline verification

| Scope | Command | Result |
|---|---|---|
| Engine metadata | `cargo metadata --locked --format-version 1` | pass |
| Engine formatting | `cargo fmt --check` | pass |
| Engine architecture guard | `node scripts/architecture/check-engine-repository.mjs` | pass, including six OpenMLS checks and negative fixtures |
| Engine workspace tests | `cargo test --workspace --locked` | 837 passed, one environment failure: sandbox denies Unix-domain socket creation in a special-file rejection test; no product assertion failed |
| Mobile install | `npm ci` | pass, 1,359 packages |
| Mobile plugin build | `npm run plugin:build` | pass |
| Mobile lint/format/types | `npm run check:quality` | pass with zero lint errors and 329 upstream warnings |
| Mobile Jest | `npm test -- --runInBand` | 141 suites, 995 tests passed |
| Mobile coverage | `npm run test:coverage -- --runInBand` | 141 suites, 995 tests passed; statements 40.03%, branches 32.91%, functions 35.06%, lines 40.73% |
| Mobile Engine artifacts | `npm run core:prepare && npm run core:verify` | downloaded and SHA-256 verified `v1.1.0-rc.5`; pass |
| Full mobile CI wrapper | `npm run check:ci` | local environment blocked only at missing Ruby after quality and Jest passed; to be run on CI |

The sandbox does not permit package-manager writes to system directories, so native desktop libraries and Ruby are delegated to platform CI rather than mocked locally.

