# Local verification evidence — 2026-08-23

Environment: Linux x86_64 cloud workspace, Rust 1.95.0, Node 22/24 test tools,
Java 17.0.19, Android SDK 36, build-tools 36.0.0, NDK 27.1.12297006 and Gradle
9.3.1. Platform-native Windows, macOS, iOS Simulator and ARM64 Linux gates are
defined in `.github/workflows/fullmesh-ci.yml` but have not run because no
authorized dedicated GitHub integration repository is currently available.

## Shared Engine

- `cargo check --workspace --locked --offline`: passed.
- `cargo fmt --check`: passed.
- `node scripts/architecture/check-engine-repository.mjs`: passed, including six
  architecture rules and negative fixtures.
- `cargo test -p uc-mobile-lan --locked --offline`: 179 passed.
- Changed package suites passed: uc-core 203, uc-application 839,
  uc-observability-contract 47, uc-infra 566 and uc-engine 107 tests.
- FullMesh coverage includes UUIDv7/versioned envelopes, monotonic sequence,
  serialization/tamper rejection, encrypted SQLite event persistence,
  tombstone/replay recovery, direct/mailbox race and credentials/log redaction.
- Android native libraries compiled independently with Cargo pipelining disabled:

| ABI | ELF | Unstripped build SHA-256 |
|---|---|---|
| armeabi-v7a | ELF32 ARM EABI5 | `7eac386730186487c0cc62b1e36dd5388b726798cb8dfa266f4b55f84c21c275` |
| arm64-v8a | ELF64 AArch64 | `9d3ed2fe8a512c8b3af008359308f0daa795546bd2549679c3eff94af4698e74` |
| x86_64 | ELF64 AMD x86-64 | `48117a81cbe9ac43a70d64349477bd73ff434995c281f36fbc9fa999904fee47` |

The candidate AAR SHA-256 is
`b96059f04830d7313d325e8b90fb8b16dee200b1061db0b6c68ce0334ec36b9c`.
Its `provenance.json` records the bytecode source, final release commit and all
three native library hashes. ZIP integrity and its internal ABI set passed.

## Relay and integration

- `npm test` under `relay/`: 11 tests passed.
- `node integration/tests/relay-multiprocess.mjs`: four isolated producers,
  common-event idempotency, drain/ack deletion and process restart persistence
  passed.
- The suites cover auth, quotas, rate limit, TTL, leases, SHA corruption,
  presence states, metrics and sensitive-log redaction.
- A local OCI build was not possible because the sandbox cannot start Docker;
  the dual `linux/amd64,linux/arm64` Buildx gate is in CI.
- The release source archive was extracted into a fresh temporary directory.
  `integration/scripts/bootstrap-source-bundle.sh` reconstructed Engine,
  Desktop and Mobile exclusively from the included Git bundles, checked out
  the exact lock-file commits and passed `verify-locks.sh`; all reconstructed
  worktrees were clean. The integration history bundle also passed
  `git bundle verify`. The temporary test directories were removed afterward.
- `integration/tests/release-contract.mjs` and `packaging/secret-scan.sh`
  passed. The source-lock SPDX document parses as SPDX 2.3 and inventories
  3,919 locked dependency packages.

## Desktop

- `vitest run`: 154 suites and 1,018 tests passed.
- Windows FullMesh packaging contract: 3/3 passed after MSIX lifecycle support.
- Lint passed with two pre-existing Fast Refresh warnings and zero errors;
  TypeScript and production Vite build passed.
- `check-engine-repository.mjs` and locked Cargo metadata passed against Engine
  `0095e11322e3dfdb4fa136632346ce6b12114856`.
- Native Linux Cargo compilation reached `glib-sys` and stopped only because the
  local sandbox lacks the system `pkg-config`/GLib development metadata. The CI
  Linux image installs these packages; no product assertion failed locally.

## Mobile and Android packages

- Full mobile baseline: 141 suites and 995 Jest tests passed.
- Post-change release workflow suite: 20/20 passed; TypeScript and changed-file
  formatting checks passed.
- `scripts/build-android-release.sh`: passed after a clean retry; AAB, universal
  APK and three ABI APKs built from Maven dependency
  `app.uniclipboard:uniclipboard-engine:1.1.0-rc.6-fullmesh.1`.
- `scripts/verify-android-release.sh`: passed package ID, version, min SDK 24,
  target SDK 36, exact ABI directories, v2 APK signature, AAB JAR signature and
  exact Engine payload comparison for every APK/AAB.

| Package | Bytes | SHA-256 |
|---|---:|---|
| arm64-v8a APK | 90,816,278 | `ca6b0790c4e5b5581b2948efa123e798bc79f31631475ad80d74f7d92cac2f8d` |
| armeabi-v7a APK | 73,988,932 | `6d667887f956380c446766bd03913e8e92084978ccf29f3b8dd02327475f9b91` |
| x86_64 APK | 97,782,167 | `acd0bfb60ae334fd9175c051d14063daea72e163727e24032127a874b218282d` |
| universal APK | 184,212,457 | `b8a7e5a483601774dc55838492e31d0eafa0f102ac57ba0c052f0f3e893b038c` |
| universal AAB | 137,095,136 | `f380896a3965404ad786423e5859a85a639ae958a7715fbe44b2fabb23871032` |

All APKs use the explicit Android Debug testing certificate (DN `CN=Android
Debug, OU=Android, O=Unknown, L=Unknown, ST=Unknown, C=US`, certificate SHA-256
`fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`).
They are not production signed. No emulator system image is installed locally;
install/launch/uninstall is a required Android CI gate.

## Gates awaiting the dedicated cloud repository

- Windows x64 native install/launch/uninstall and all Windows ARM64 builds.
- macOS Intel/Apple Silicon app/DMG build, ad-hoc signature and launch checks.
- Linux native x86_64/aarch64 packages and lifecycle checks.
- Android x86_64 emulator install/launch/uninstall.
- Exact Engine XCFramework plus iOS app/share/keyboard Simulator build.
- Multi-architecture Relay OCI image and SBOM.
- Final cross-run artifact collection, release manifest and GitHub release.

Production signing and true-device scenarios are separate external conditions,
listed in `SIGNING_REQUIREMENTS.md` and `TRUE_DEVICE_ACCEPTANCE.md`.
