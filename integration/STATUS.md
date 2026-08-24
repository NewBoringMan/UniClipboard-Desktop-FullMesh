# Delivery status

Updated: 2026-08-23.

## Current stage

Local implementation and Linux/Android verification are complete. The Engine,
Desktop and Mobile integration commits are frozen in `upstreams.lock.json`.
Android's five testing packages and the exact Engine AAR are in the release
directory. Platform-native CI is implemented and is now the sole blocker for
Windows, macOS, Linux, iOS Simulator and multi-architecture Relay artifacts.

## Verified

- Handoff integrity: 283 lines, 12,935 bytes, SHA-256 `290646ad358110f0cef0a23b1c5c2a5badd972a23cd65a327b814ee94a5733f2`.
- Engine metadata, formatting and architecture checks pass.
- FullMesh Engine protocol, durable encrypted events, mailbox transport and
  binding changes pass the affected Rust suites; the legacy LAN suite passes
  179/179 and workspace check passes.
- Relay tests pass 11/11; the four-process idempotency/drain/restart scenario
  passes.
- Desktop tests pass 1,018/1,018 and the Windows installer contract passes 3/3.
- Mobile baseline passes 995/995; the changed release workflow suite passes
  20/20.
- Android arm64-v8a, armeabi-v7a, x86_64 and universal APK plus AAB all build,
  pass signing/package/SDK/ABI checks and contain the exact candidate Engine.
- The clean release source archive reconstructs all three component Git
  histories offline, verifies their immutable SHAs, and retains the root
  integration history as a fourth bundle.

## Active blockers and policy

- System package directories are read-only, so Tauri native GLib dependencies
  and platform SDKs cannot be installed locally. Corresponding checks must run
  on macOS/Linux/Windows CI.
- No dedicated authorized GitHub repository exists for this integration, so cross-platform jobs cannot yet be dispatched. Do not repurpose unrelated repositories.
- No production signing assets are available. All produced packages remain explicitly unsigned/ad-hoc testing artifacts until credentials are supplied.

## Decision log

1. Use the available cloud workspace because neither prescribed Mac path is available.
2. Preserve upstream histories as submodules and duplicate exact SHAs in a machine-readable lock file.
3. Treat the handoff as the frozen target even where an upstream ADR previously rejected relay blob staging; a bounded encrypted mailbox is a new explicit requirement and must be added with a documented architecture change.
4. Use `0.1.0-alpha.1` as the first FullMesh integration version until all release gates pass.
5. Default Android Cargo pipelining off because shared target directories caused
   intermittent missing-rlib failures; per-ABI isolated builds are verified.
6. Keep Android artifacts explicitly `test-signed`; production keystore access
   is not inferred from the upstream debug build.
