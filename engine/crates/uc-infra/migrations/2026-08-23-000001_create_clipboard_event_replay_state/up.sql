CREATE TABLE clipboard_recent_event (
    event_id TEXT PRIMARY KEY NOT NULL,
    expires_at_ms BIGINT NOT NULL
);

CREATE INDEX idx_clipboard_recent_event_expiry
    ON clipboard_recent_event (expires_at_ms);

INSERT INTO clipboard_recent_event (event_id, expires_at_ms)
SELECT event_id, captured_at_ms + 86400000
FROM clipboard_event;

CREATE TABLE clipboard_origin_sequence (
    device_id TEXT PRIMARY KEY NOT NULL,
    last_sequence BIGINT NOT NULL CHECK (last_sequence > 0)
);
