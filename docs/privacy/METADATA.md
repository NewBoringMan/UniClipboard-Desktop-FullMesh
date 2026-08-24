# Relay metadata and privacy

The blind relay observes endpoint connection timing, source network address, chosen relay, byte volume and encrypted flow duration. The mailbox additionally observes an opaque mailbox identifier in the request path, token verifier match, ciphertext byte count, ciphertext digest, event-ID digest, creation/expiry time and download lease state.

It does not need clipboard content, MIME types, filenames, full paths, device display names, account email, MasterKey or plaintext event IDs. Presence exposes opaque enrolled mailbox IDs, coarse state, boolean routing capabilities and short timestamps only to authenticated members of the same opaque space.

Operators must disable reverse-proxy URL and authorization logging, use aggregate metrics without device labels, retain service logs only for the documented operational window, and delete mailbox volumes when retiring the service. Download acknowledgement deletes the message immediately; otherwise expiry removes it on the next access or maintenance scan.

