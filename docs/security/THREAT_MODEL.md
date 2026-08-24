# FullMesh threat model

## Protected assets and trust boundary

Clipboard text, images, filenames, file bytes, device secrets, space membership keys and policy settings are sensitive. Engine clients encrypt payloads and sensitive metadata before data leaves a trusted device. A relay or mailbox operator is outside the trusted boundary and never receives a MasterKey.

## Adversaries

- A passive network observer may learn server IPs, timing and traffic volume. TLS/QUIC hides contents but not all traffic analysis.
- A malicious relay/mailbox operator may retain, reorder, replay or drop ciphertext and may observe opaque routing identifiers, sizes and timing.
- An unauthenticated internet client may attempt enumeration, storage exhaustion, oversized uploads or request floods.
- A compromised enrolled device has the keys and can read content legitimately addressed to its space; server controls cannot repair endpoint compromise.
- A local attacker with host filesystem access may read the relay data volume or configuration.

## Controls

- AEAD and versioned Engine envelopes provide confidentiality/integrity; event IDs, monotonic device sequences, expiry and persistent recent-event windows reject replay and duplicates.
- Mailbox bearer tokens are high entropy and scoped per space. The service stores only SHA-256 token verifiers and compares them in constant time. Clients derive per-device routing IDs with HMAC-SHA-256 over the stable device ID, so the operator sees only an opaque mailbox identifier.
- Opaque mailbox/space IDs, TLS, per-mailbox quotas, payload caps, bounded TTL, rate limiting, short download leases and acknowledgement deletion reduce exposure and abuse.
- Atomic mode-0600 writes and ciphertext SHA-256 checks detect local corruption. Container runs non-root, read-only, with all Linux capabilities dropped.
- Logs and metrics omit URL identifiers, authorization data, event IDs, payloads, filenames, paths and per-device labels.
- Direct and relay delivery are independently authenticated end to end. Receiving the same event on multiple paths is safe because clients deduplicate by event ID.

## Residual risk

Availability is not guaranteed: relay infrastructure can drop or delay traffic, iOS may not execute background work, and a user force-quit prevents opportunistic wake. Metadata traffic analysis remains possible. A self-host operator must protect auth configuration, volumes, TLS keys and metrics. Production should rotate enrollment tokens after device removal and bound retention below the configured 24-hour maximum.
