# UniClipboard FullMesh

UniClipboard FullMesh integrates the UniClipboard Engine, desktop client, and mobile client into a reproducible cross-platform release. It targets Windows, macOS, Linux, Android, iOS/iPadOS, a blind relay, and an encrypted short-TTL mailbox. Direct QUIC connectivity is preferred; a relay path keeps synchronization working when NAT or policy blocks direct traffic.

## Status

The frozen upstream baseline and active delivery status are recorded in [`docs/audit/BASELINE.md`](docs/audit/BASELINE.md) and [`integration/STATUS.md`](integration/STATUS.md). A capability is considered complete only when its row in [`docs/verification/REQUIREMENTS_MATRIX.md`](docs/verification/REQUIREMENTS_MATRIX.md) links implementation, verification, evidence, and deliverables.

The exact FullMesh Android AAR and five test-signed Android packages have been
built and verified locally. Windows, macOS, Linux, iOS Simulator and relay OCI
artifacts are built by the checked-in native runner matrix in the dedicated
delivery repository.

## Bootstrap

```bash
git clone --recurse-submodules https://github.com/NewBoringMan/UniClipboard-FullMesh.git UniClipboard-FullMesh
cd UniClipboard-FullMesh
./integration/scripts/bootstrap.sh
./integration/scripts/verify-locks.sh
```

Toolchains are component-specific: Engine and Desktop use Rust 1.95.0; Mobile uses Node 22.22.1 and Java 17. Native platform SDK requirements and release commands are in [`docs/build/BUILDING.md`](docs/build/BUILDING.md); install, upgrade and removal steps are in [`docs/build/INSTALLING.md`](docs/build/INSTALLING.md).

## Security and licensing

Clipboard data remains end-to-end encrypted; relay infrastructure receives ciphertext and limited routing metadata only. Never place signing keys in this repository. Direct derivatives of the desktop AGPL code remain AGPL-3.0 compatible. Individual upstream components retain their own license notices.
