use super::hash::ContentHash;
use crate::{clipboard::system::SnapshotHash, ids::EventId, DeviceId};
use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};

pub const FULLMESH_EVENT_SCHEMA_VERSION: u16 = 1;
pub const FULLMESH_DEFAULT_TTL_MS: i64 = 5 * 60 * 1000;
pub const FULLMESH_MAX_TTL_MS: i64 = 24 * 60 * 60 * 1000;
pub const FULLMESH_MAX_HOPS: u8 = 8;
const FULLMESH_MAX_REPRESENTATIONS: usize = 64;
const FULLMESH_MAX_PAYLOAD_REFS: usize = 256;
const FULLMESH_MAX_TARGETS: usize = 256;

static LAST_ORIGIN_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Produce a process-monotonic sequence whose high digits are anchored to
/// wall-clock milliseconds. A restarted process normally starts above its
/// prior value while the atomic increment prevents same-millisecond ties.
/// Receivers still use UUIDv7 plus the persisted event row as the durable
/// replay boundary, so the sequence is ordering metadata rather than an
/// authentication primitive.
pub fn next_origin_sequence(now_ms: i64) -> u64 {
    let clock_floor = u64::try_from(now_ms.max(0))
        .unwrap_or_default()
        .saturating_mul(1_000_000);
    let mut observed = LAST_ORIGIN_SEQUENCE.load(Ordering::Relaxed);
    loop {
        let next = clock_floor.max(observed.saturating_add(1));
        match LAST_ORIGIN_SEQUENCE.compare_exchange_weak(
            observed,
            next,
            Ordering::SeqCst,
            Ordering::Relaxed,
        ) {
            Ok(_) => return next,
            Err(current) => observed = current,
        }
    }
}

/// One MIME representation advertised independently from its transport.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ClipboardMimeRepresentation {
    pub mime_type: String,
    pub size_bytes: u64,
}

/// Opaque payload/blob reference. The identifier and hash are already
/// content-addressed values; no file name or local path is allowed here.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ClipboardPayloadReference {
    pub blob_id: String,
    pub content_hash: Option<String>,
    pub size_bytes: u64,
}

/// Versioned FullMesh event envelope shared by every platform host.
///
/// Payload bytes remain outside this value. Direct QUIC, relay racing and the
/// encrypted mailbox therefore carry the same event identity and metadata
/// while choosing different transport mechanics.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ClipboardEventEnvelope {
    pub event_id: EventId,
    pub origin_device_id: DeviceId,
    pub origin_sequence: u64,
    pub created_at_ms: i64,
    pub expires_at_ms: i64,
    pub content_hash: String,
    pub mime_representations: Vec<ClipboardMimeRepresentation>,
    pub payload_references: Vec<ClipboardPayloadReference>,
    /// Empty means the current space's default eligible targets.
    pub target_device_ids: Vec<DeviceId>,
    pub hop_count: u8,
    pub schema_version: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ClipboardEventEnvelopeError {
    #[error("unsupported clipboard event schema version {0}")]
    UnsupportedSchema(u16),
    #[error("event_id must be UUIDv7")]
    InvalidEventId,
    #[error("origin sequence must be non-zero")]
    InvalidOriginSequence,
    #[error("event timestamps or ttl are invalid")]
    InvalidTimestamps,
    #[error("content hash is invalid")]
    InvalidContentHash,
    #[error("mime representation list is invalid")]
    InvalidRepresentations,
    #[error("payload reference list is invalid")]
    InvalidPayloadReferences,
    #[error("target list is invalid")]
    InvalidTargets,
    #[error("hop count exceeds the FullMesh limit")]
    HopLimitExceeded,
}

impl ClipboardEventEnvelope {
    pub fn new(
        origin_device_id: DeviceId,
        created_at_ms: i64,
        content_hash: impl Into<String>,
        mime_representations: Vec<ClipboardMimeRepresentation>,
        payload_references: Vec<ClipboardPayloadReference>,
        target_device_ids: Vec<DeviceId>,
    ) -> Self {
        let created_at_ms = created_at_ms.max(0);
        Self::new_with_sequence(
            origin_device_id,
            next_origin_sequence(created_at_ms),
            created_at_ms,
            content_hash,
            mime_representations,
            payload_references,
            target_device_ids,
        )
    }

    /// Construct an event with a sequence allocated by the durable event-state
    /// repository. Platform hosts use this path; [`Self::new`] remains useful
    /// for isolated domain tests that intentionally have no persistence port.
    pub fn new_with_sequence(
        origin_device_id: DeviceId,
        origin_sequence: u64,
        created_at_ms: i64,
        content_hash: impl Into<String>,
        mime_representations: Vec<ClipboardMimeRepresentation>,
        payload_references: Vec<ClipboardPayloadReference>,
        target_device_ids: Vec<DeviceId>,
    ) -> Self {
        let created_at_ms = created_at_ms.max(0);
        Self {
            event_id: EventId::new(),
            origin_device_id,
            origin_sequence,
            created_at_ms,
            expires_at_ms: created_at_ms.saturating_add(FULLMESH_DEFAULT_TTL_MS),
            content_hash: content_hash.into(),
            mime_representations,
            payload_references,
            target_device_ids,
            hop_count: 0,
            schema_version: FULLMESH_EVENT_SCHEMA_VERSION,
        }
    }

    pub fn validate(&self) -> Result<(), ClipboardEventEnvelopeError> {
        if self.schema_version != FULLMESH_EVENT_SCHEMA_VERSION {
            return Err(ClipboardEventEnvelopeError::UnsupportedSchema(
                self.schema_version,
            ));
        }
        let event_uuid = uuid::Uuid::parse_str(self.event_id.as_ref())
            .map_err(|_| ClipboardEventEnvelopeError::InvalidEventId)?;
        if event_uuid.get_version() != Some(uuid::Version::SortRand) {
            return Err(ClipboardEventEnvelopeError::InvalidEventId);
        }
        if self.origin_sequence == 0 {
            return Err(ClipboardEventEnvelopeError::InvalidOriginSequence);
        }
        let ttl = self.expires_at_ms.saturating_sub(self.created_at_ms);
        if self.created_at_ms < 0 || ttl <= 0 || ttl > FULLMESH_MAX_TTL_MS {
            return Err(ClipboardEventEnvelopeError::InvalidTimestamps);
        }
        let legacy_hex_hash = self.content_hash.len() == 64
            && self
                .content_hash
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit());
        if SnapshotHash::parse(&self.content_hash).is_none() && !legacy_hex_hash {
            return Err(ClipboardEventEnvelopeError::InvalidContentHash);
        }
        if self.mime_representations.is_empty()
            || self.mime_representations.len() > FULLMESH_MAX_REPRESENTATIONS
            || self.mime_representations.iter().any(|representation| {
                representation.mime_type.len() > 255
                    || !representation.mime_type.contains('/')
                    || representation.mime_type.chars().any(char::is_whitespace)
            })
        {
            return Err(ClipboardEventEnvelopeError::InvalidRepresentations);
        }
        if self.payload_references.len() > FULLMESH_MAX_PAYLOAD_REFS
            || self.payload_references.iter().any(|reference| {
                reference.blob_id.is_empty()
                    || reference.blob_id.len() > 512
                    || reference
                        .content_hash
                        .as_ref()
                        .is_some_and(|hash| hash.len() > 512)
            })
        {
            return Err(ClipboardEventEnvelopeError::InvalidPayloadReferences);
        }
        let unique_targets: HashSet<_> = self.target_device_ids.iter().collect();
        if self.target_device_ids.len() > FULLMESH_MAX_TARGETS
            || unique_targets.len() != self.target_device_ids.len()
        {
            return Err(ClipboardEventEnvelopeError::InvalidTargets);
        }
        if self.hop_count > FULLMESH_MAX_HOPS {
            return Err(ClipboardEventEnvelopeError::HopLimitExceeded);
        }
        Ok(())
    }

    pub fn is_expired_at(&self, now_ms: i64) -> bool {
        now_ms >= self.expires_at_ms
    }

    pub fn targets(&self, device_id: &DeviceId) -> bool {
        self.target_device_ids.is_empty() || self.target_device_ids.contains(device_id)
    }

    pub fn increment_hop(&mut self) -> Result<(), ClipboardEventEnvelopeError> {
        if self.hop_count >= FULLMESH_MAX_HOPS {
            return Err(ClipboardEventEnvelopeError::HopLimitExceeded);
        }
        self.hop_count += 1;
        Ok(())
    }
}

/// Event representing a user-initiated action on clipboard content.
#[derive(Debug, Clone, PartialEq)]
pub enum ClipboardContentActionEvent {
    /// User requested an action on clipboard content identified by hash.
    UserRequested {
        content_hash: ContentHash,
        action: ClipboardContentAction,
    },
}

/// Actions that can be performed on clipboard content.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClipboardContentAction {
    /// Copy content from history to system clipboard.
    CopyToSystemClipboard,
    /// Delete content from history.
    Delete,
    /// Pin content to prevent automatic deletion.
    Pin,
    /// Unpin previously pinned content.
    Unpin,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClipboardEvent {
    pub event_id: EventId,
    pub captured_at_ms: i64,
    pub source_device: DeviceId,
    pub snapshot_hash: SnapshotHash,
}

impl ClipboardEvent {
    pub fn new(
        event_id: EventId,
        captured_at_ms: i64,
        source_device: DeviceId,
        snapshot_hash: SnapshotHash,
    ) -> Self {
        Self {
            event_id,
            captured_at_ms,
            source_device,
            snapshot_hash,
        }
    }
}

#[cfg(test)]
mod fullmesh_tests {
    use super::*;

    fn valid_envelope() -> ClipboardEventEnvelope {
        let now = 1_700_000_000_000;
        ClipboardEventEnvelope {
            event_id: EventId::new(),
            origin_device_id: DeviceId::new("device-a"),
            origin_sequence: next_origin_sequence(now),
            created_at_ms: now,
            expires_at_ms: now + FULLMESH_DEFAULT_TTL_MS,
            content_hash: format!("blake3v1:{}", "11".repeat(32)),
            mime_representations: vec![ClipboardMimeRepresentation {
                mime_type: "text/plain".to_owned(),
                size_bytes: 5,
            }],
            payload_references: Vec::new(),
            target_device_ids: Vec::new(),
            hop_count: 0,
            schema_version: FULLMESH_EVENT_SCHEMA_VERSION,
        }
    }

    #[test]
    fn generated_event_ids_are_uuid_v7_and_sequences_are_monotonic() {
        let first_id = EventId::new();
        let parsed = uuid::Uuid::parse_str(first_id.as_ref()).unwrap();
        assert_eq!(parsed.get_version(), Some(uuid::Version::SortRand));
        let first = next_origin_sequence(1_700_000_000_000);
        let second = next_origin_sequence(1_700_000_000_000);
        assert!(second > first);
    }

    #[test]
    fn envelope_validates_ttl_targets_and_hop_limit() {
        let mut envelope = valid_envelope();
        assert_eq!(envelope.validate(), Ok(()));
        assert!(!envelope.is_expired_at(envelope.created_at_ms));
        assert!(envelope.is_expired_at(envelope.expires_at_ms));
        for _ in 0..FULLMESH_MAX_HOPS {
            envelope.increment_hop().unwrap();
        }
        assert_eq!(
            envelope.increment_hop(),
            Err(ClipboardEventEnvelopeError::HopLimitExceeded)
        );
    }

    #[test]
    fn envelope_rejects_replayed_target_and_invalid_hash() {
        let mut envelope = valid_envelope();
        let target = DeviceId::new("device-b");
        envelope.target_device_ids = vec![target, target];
        assert_eq!(
            envelope.validate(),
            Err(ClipboardEventEnvelopeError::InvalidTargets)
        );
        envelope.target_device_ids.clear();
        envelope.content_hash = "not-a-content-hash".to_owned();
        assert_eq!(
            envelope.validate(),
            Err(ClipboardEventEnvelopeError::InvalidContentHash)
        );
    }
}
