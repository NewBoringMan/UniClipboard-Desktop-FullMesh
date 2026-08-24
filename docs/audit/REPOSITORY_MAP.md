# Repository map

| Path | Ownership and purpose | Primary verification |
|---|---|---|
| `engine/` | Shared protocol, encryption, identity/membership, persistence, Iroh transport, relay integration, clipboard domain/application layers, UniFFI/N-API bindings | Cargo workspace tests, architecture checker, binding builds |
| `desktop/` | Tauri desktop UI and platform host; daemon, tray, autostart, native clipboard, updater and desktop packaging | Bun frontend checks, Cargo workspace tests, platform build/e2e workflows |
| `mobile/` | Expo/React Native host; Android and iOS native modules/extensions and mobile release workflows | ESLint/Prettier/TypeScript/Jest, Gradle tests, Xcode tests/archive |
| `relay/` | Blind relay/rendezvous/presence/mailbox service, container and deployment configuration | Service unit/integration tests, abuse/TTL tests, container health tests |
| `integration/` | Version locks, bootstrap, protocol contracts, multi-process tests and release orchestration | Lock verifier, compatibility and isolated-node scenarios |
| `packaging/` | Signing templates, package normalization, checksums, SBOM and installer smoke tests | Per-platform package/install/upgrade/uninstall jobs |
| `docs/` | Architecture, audit, security, privacy, operations, build and evidence | Link/schema checks and evidence review |
| `dist/` | Generated immutable versioned releases; never hand-authored | Manifest schema, SHA-256 and artifact existence checks |

## Component instruction boundaries

- Engine root and several crates contain nested `AGENTS.md`; architecture changes also require an entry in `engine/docs/architecture/architecture-bible.md`.
- Desktop has root plus `src`, `src-tauri`, crates, apps and docs instructions. Non-trivial changes must preserve its VISION and architecture boundaries.
- Mobile root instructions require Expo SDK 56 conventions, platform-specific UI modules instead of shared `Platform.OS` branches, and App Group-compatible iOS storage.

The integration repository owns orchestration only. A fix that belongs to shared protocol or cryptography must be committed in Engine, then adopted by Desktop and Mobile through a new pinned Engine release.

