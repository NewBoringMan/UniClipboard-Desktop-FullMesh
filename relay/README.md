# Relay, rendezvous and encrypted mailbox

This directory deploys two independent services:

1. The official Iroh `iroh-relay` binary, pinned to `1.0.0-rc.1`, provides blind relay and QUIC address discovery/rendezvous. The public Iroh preset remains the zero-configuration client default; a custom relay URL is an operator or diagnostic setting, never an IP field in onboarding.
2. The FullMesh control plane provides authenticated presence and a short-TTL mailbox. It stores only client-produced ciphertext plus expiry, byte count, content digest and lease metadata. It has no Engine MasterKey and no decryption endpoint.

## Local test

```bash
npm test
node scripts/generate-auth-entry.mjs
cp config/auth.example.json config/auth.json
# Replace the example document with serverDocument from the command.
docker compose up --build
```

The development Iroh relay listens on HTTP port 3340 and intentionally has no QUIC address-discovery listener because that requires TLS. The mailbox listens on 8787. Never expose this development composition to the internet.

## Production

1. Copy `config/iroh-relay.production.example.toml` to `config/iroh-relay.production.toml`.
2. Set a real Iroh DNS hostname in its TOML and set `MAILBOX_HOST` for the
   bundled Caddy TLS proxy. Put the matching certificate and private key at
   `config/tls/fullchain.pem` and `config/tls/privkey.pem`; obtain them with the
   operator's existing ACME/DNS process. Open TCP 80/443 and UDP 7824 for Iroh
   plus TCP 8443 for the mailbox proxy. The mailbox URL is
   `https://$MAILBOX_HOST:8443`. Keep metrics on loopback.
3. Generate one high-entropy mailbox token per space, store only its SHA-256 value in `config/auth.json`, and deliver the plaintext token to enrolled clients through the end-to-end encrypted membership flow. Clients derive non-guessable per-device mailbox IDs from that token and the stable device ID. The TLS service sees the bearer token while authenticating a request, but never stores or logs it and never receives the stable device ID or Engine MasterKey.
4. The bundled Caddy proxy loads the mounted TLS certificate, enforces an 11 MB
   body limit and discards access logs so URL paths and authorization headers
   are not retained. Operators with an existing proxy may omit this service and
   apply the equivalent controls there.
5. Run `docker compose -f compose.production.yaml up -d --build`.

Iroh's upstream relay is the same implementation used for its public relays and exposes the relay server over HTTP/HTTPS, optional QUIC address discovery and metrics. The pinned configuration fields were verified against the `iroh-relay 1.0.0-rc.1` source.

## Mailbox protocol

- `POST /v1/mailboxes/{opaque-id}/events`: `application/octet-stream`, bearer token, `X-UniClipboard-Event-Id`, `X-UniClipboard-Ttl-Seconds`. Repeated event IDs are idempotent.
- `GET /v1/mailboxes/{opaque-id}/events/next`: leases the oldest available ciphertext and returns a receipt. An interrupted download becomes eligible after the lease timeout.
- `DELETE /v1/mailboxes/{opaque-id}/events/receipts/{receipt}`: acknowledges a completed download and permanently deletes ciphertext.
- `PUT /v1/presence/{opaque-id}`: publishes one of paired, recently-reachable, connected, background-limited or offline with a short TTL.
- `GET /v1/presence`: lists presence only for the authenticated caller's space.
- `GET /healthz`, `/readyz`, `/metrics`: health and unlabeled aggregate Prometheus metrics.

The server uses hashed directory names, atomic writes, file mode 0600, per-mailbox serialization, integrity checks, quotas, token-bucket rate limiting, expiry-on-access, download leases and acknowledgement deletion. Logs contain only request ID, method, route class, status, response size and duration.
