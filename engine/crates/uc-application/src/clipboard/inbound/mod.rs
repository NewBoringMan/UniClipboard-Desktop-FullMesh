use async_trait::async_trait;
use bytes::Bytes;
use thiserror::Error;
use uc_core::ids::{DeviceId, EventId};
use uc_observability_contract::FlowId;

use crate::clipboard::sync::apply_inbound::{
    ApplyInboundClipboardUseCase, ApplyInboundInput, ApplyOutcome,
};
use crate::clipboard::write::ClipboardWriteIntent;

pub(crate) mod mailbox;
mod runtime;

pub use mailbox::{MailboxClipboardReceiver, MergedClipboardReceiver};

pub use runtime::{
    ClipboardInboundEvent, ClipboardInboundEventAction, ClipboardInboundEventPort,
    ClipboardInboundRepresentationSummary, ClipboardInboundRuntime, ClipboardInboundRuntimeDeps,
    ClipboardInboundRuntimeError,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InboundClipboardApplyOutcome {
    Applied {
        entry_id: String,
    },
    /// Content already held locally; the existing entry was re-activated
    /// instead of duplicated. Mirrors [`ApplyOutcome::Resurfaced`].
    Resurfaced {
        snapshot_hash: String,
        existing_entry_id: String,
        os_write_succeeded: bool,
    },
    DuplicateSkipped {
        snapshot_hash: String,
        existing_entry_id: String,
    },
    ReplaySkipped {
        event_id: EventId,
    },
    DecodeFailed {
        reason: String,
    },
}

#[derive(Debug, Error)]
pub enum InboundClipboardApplyError {
    #[error("inbound clipboard apply failed: {0}")]
    Internal(String),
}

#[async_trait]
pub trait InboundClipboardApplyPort: Send + Sync {
    async fn apply(
        &self,
        input: InboundClipboardApplyInput,
    ) -> Result<InboundClipboardApplyOutcome, InboundClipboardApplyError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InboundClipboardApplyInput {
    pub from_device: String,
    pub event_id: Option<EventId>,
    pub snapshot_hash: String,
    pub plaintext: Bytes,
    pub flow_id: Option<FlowId>,
    /// See [`ApplyInboundInput::resurface_intent`] — only consulted when the
    /// delivery resolves to an already-held entry.
    pub resurface_intent: ClipboardWriteIntent,
}

#[async_trait]
impl InboundClipboardApplyPort for ApplyInboundClipboardUseCase {
    async fn apply(
        &self,
        input: InboundClipboardApplyInput,
    ) -> Result<InboundClipboardApplyOutcome, InboundClipboardApplyError> {
        let outcome = self
            .execute(ApplyInboundInput {
                from_device: DeviceId::new(input.from_device),
                event_id: input.event_id,
                snapshot_hash: input.snapshot_hash,
                plaintext: input.plaintext,
                flow_id: input.flow_id,
                resurface_intent: input.resurface_intent,
            })
            .await
            .map_err(|err| InboundClipboardApplyError::Internal(err.to_string()))?;
        Ok(apply_outcome_to_view(outcome))
    }
}

fn apply_outcome_to_view(outcome: ApplyOutcome) -> InboundClipboardApplyOutcome {
    match outcome {
        ApplyOutcome::Applied { entry_id } => InboundClipboardApplyOutcome::Applied {
            entry_id: entry_id.to_string(),
        },
        ApplyOutcome::Resurfaced {
            snapshot_hash,
            existing_entry_id,
            os_write_succeeded,
        } => InboundClipboardApplyOutcome::Resurfaced {
            snapshot_hash,
            existing_entry_id: existing_entry_id.to_string(),
            os_write_succeeded,
        },
        ApplyOutcome::DuplicateSkipped {
            snapshot_hash,
            existing_entry_id,
        } => InboundClipboardApplyOutcome::DuplicateSkipped {
            snapshot_hash,
            existing_entry_id: existing_entry_id.to_string(),
        },
        ApplyOutcome::ReplaySkipped { event_id } => {
            InboundClipboardApplyOutcome::ReplaySkipped { event_id }
        }
        ApplyOutcome::DecodeFailed { reason } => {
            InboundClipboardApplyOutcome::DecodeFailed { reason }
        }
    }
}
