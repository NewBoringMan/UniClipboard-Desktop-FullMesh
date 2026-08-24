# TLS files

Place the production mailbox certificate chain in `fullchain.pem` and its
private key in `privkey.pem`. Both PEM files are ignored by Git. Their DNS name
must match `MAILBOX_HOST`; never use testing keys in a production deployment.
