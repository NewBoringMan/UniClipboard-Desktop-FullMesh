//! Ciphertext-only, bounded store-and-forward transport for clipboard events.

use async_trait::async_trait;
use bytes::Bytes;

use crate::ids::{DeviceId, EventId};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MailboxUploadOutcome {
    Stored,
    Duplicate,
}

#[derive(Debug, Clone)]
pub struct ClipboardMailboxLease {
    pub receipt: String,
    pub ciphertext: Bytes,
    pub expires_at_ms: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum ClipboardMailboxError {
    #[error("mailbox is not configured")]
    NotConfigured,
    #[error("mailbox authentication failed")]
    Unauthorized,
    #[error("mailbox quota or rate limit was exceeded")]
    Capacity,
    #[error("mailbox request was invalid")]
    InvalidRequest,
    #[error("mailbox is temporarily unavailable")]
    Unavailable,
    #[error("mailbox response was invalid")]
    InvalidResponse,
}

/// The application supplies only already-encrypted opaque bytes. Concrete
/// adapters derive per-device mailbox identifiers without exposing device IDs
/// in request paths and never receive a space MasterKey.
#[async_trait]
pub trait ClipboardMailboxPort: Send + Sync {
    async fn upload(
        &self,
        target: &DeviceId,
        event_id: &EventId,
        ttl_seconds: u32,
        ciphertext: Bytes,
    ) -> Result<MailboxUploadOutcome, ClipboardMailboxError>;

    async fn lease_next(
        &self,
        local_device: &DeviceId,
    ) -> Result<Option<ClipboardMailboxLease>, ClipboardMailboxError>;

    async fn acknowledge(
        &self,
        local_device: &DeviceId,
        receipt: &str,
    ) -> Result<(), ClipboardMailboxError>;
}
