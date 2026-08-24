# Gap matrix

Status values: `existing`, `partial`, `missing`, `blocked-external`.

| Requirement | Baseline | Gap / required action |
|---|---|---|
| Shared ClipboardEvent contract | existing | Versioned UUIDv7 envelope now carries origin sequence, timestamps/TTL, content hash, MIME/payload refs, targets, hop count and schema version; wire round-trip/tamper tests pass |
| Deduplication, loop guard, device sequence, convergence | existing | Encrypted durable event store, tombstones/replay window, atomic per-device sequence and active-state loop/convergence tests are implemented; four-process relay idempotency passes |
| MIME text/image/file model | existing | Unified MIME representations and transport-independent payload references are in Engine and its wire fixtures |
| QUIC/NAT/direct/relay | existing/partial | Iroh direct/relay plus direct/mailbox race policy is implemented; forced hosted-runner and true cross-network evidence remains |
| Short-TTL encrypted mailbox | existing | Authenticated ciphertext-only mailbox, TTL, quotas, leases, ack deletion, integrity, restart persistence and Engine client integration pass local tests |
| Opportunity forwarding | partial | Capability/presence work exists and correctness uses direct/relay/mailbox; hosted third-node-removal evidence remains |
| Presence semantics | existing | Paired/recent/connected/background-limited/offline states exist across relay, Engine contract and bindings; platform UI runner checks remain |
| Windows host | existing/partial | Native host/tray/autostart plus x64/arm64 NSIS, MSI, portable and testing MSIX pipelines exist; native Windows lifecycle execution remains |
| macOS host | existing/partial | Menu/tray, pasteboard, x64/arm64 DMG exist; add universal preference, sleep/network evidence and ad-hoc signature report |
| Linux host | existing/partial | AppImage/deb/rpm and Wayland work exist; add lifecycle, secret-service and explicit restriction evidence |
| Android host | existing/partial | Shared Engine and required integrations exist; all four APK variants and AAB are locally built/verified from the exact Engine; emulator UI lifecycle remains |
| iOS/iPadOS host | existing/partial | App Group/Share/Keyboard and Engine identity exist; build simulator and unsigned archive; production IPA/TestFlight requires Apple assets |
| HarmonyOS | partial | Engine HAR/N-API and probe exist; no product client—must remain labeled future platform, never app-complete |
| Relay deployment | existing/partial | Pinned Iroh config, mailbox container, dev/production Compose, TLS proxy, health, metrics, redaction and public/self-host guidance exist; dual-arch OCI build awaits CI |
| Diagnostics and policy UI | partial | Relay, permissions, trust and background diagnostics exist; reconcile route/presence wording and sensitive-app/TTL policies |
| Cross-network scenarios | partial | Four isolated producer processes and restart persistence pass; forced-UDP/Windows/Android and physical-device closure await platform CI/user acceptance |
| Unified release manifest/SBOM | partial | Deterministic staging, checksum/manifest verification, source archive and SPDX steps exist; final cross-run execution awaits cloud artifacts |
| Production signing | blocked-external | Finish unsigned/ad-hoc builds; later require platform signing assets listed in the signing report |
| Dedicated GitHub integration repository | blocked-external | Current connector has no UniClipboard repository and no repository-create API; local work continues until cloud CI is the sole blocker |
