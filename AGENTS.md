# UniClipboard FullMesh integration instructions

This repository integrates three independently versioned upstream repositories. The handoff specification in `docs/spec/UniClipboard_FullMesh_Codex_Handoff.md` is authoritative.

## Invariants

- Preserve `engine/`, `desktop/`, and `mobile/` as Git submodules and pin immutable commits in `upstreams.lock.json`.
- Shared protocol, encryption, identity, membership, deduplication, and transport policy belong in Engine. Platform hosts must not fork protocol logic.
- Clipboard payloads and sensitive persisted metadata are end-to-end encrypted. Relay services never receive a MasterKey.
- Logs must not contain clipboard contents, filenames, full paths, passwords, keys, or tokens.
- Direct connectivity is preferred, but correctness must not depend on LAN reachability or another personal device remaining online.
- Never commit signing secrets. Unsigned/ad-hoc artifacts must be named and documented as testing artifacts.
- Keep `docs/verification/REQUIREMENTS_MATRIX.md` and `integration/STATUS.md` current with commands and evidence.
- Read the nearest component `AGENTS.md`, `CONTEXT.md`, and contribution rules before editing a submodule.

## Validation

Run `integration/scripts/verify-locks.sh` before committing. Run the relevant component checks and record the exact command and result in `docs/verification/`.

