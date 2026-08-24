//! Mailbox source and receiver merging for the shared inbound pipeline.

use bytes::Bytes;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::broadcast;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, warn};

use uc_core::clipboard::ClipboardEventEnvelope;
use uc_core::ids::DeviceId;
use uc_core::ports::security::{TransferCipherError, TransferCipherPort};
use uc_core::ports::{
    ClipboardHeader, ClipboardMailboxPort, ClipboardReceiverPort, DeviceIdentityPort,
    InboundClipboard, InboundClipboardReceipt,
};

const MAILBOX_FRAME_VERSION: u8 = 1;
const MAILBOX_CHANNEL_CAPACITY: usize = 64;
const MAX_MAILBOX_FRAME_BYTES: usize = 12 * 1024 * 1024;
const EMPTY_POLL_DELAY: Duration = Duration::from_secs(2);
const ERROR_POLL_DELAY: Duration = Duration::from_secs(5);
const APPLICATION_SETTLEMENT_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, thiserror::Error)]
pub(crate) enum MailboxFrameEncodeError {
    #[error("FullMesh event envelope is missing")]
    MissingEvent,
    #[error("mailbox frame codec failed")]
    Codec(#[from] postcard::Error),
}

#[derive(Debug, Serialize, Deserialize)]
pub(crate) struct MailboxFrameV1 {
    version: u8,
    sender_device_id: String,
    header: MailboxHeaderV1,
    #[serde(with = "serde_bytes")]
    ciphertext: Vec<u8>,
}

#[derive(Debug, Serialize, Deserialize)]
struct MailboxHeaderV1 {
    version: u8,
    snapshot_hash: String,
    captured_at_ms: i64,
    origin_device_id: String,
    origin_device_name: String,
    payload_version: u8,
    flow_id: Option<String>,
    event: ClipboardEventEnvelope,
}

impl MailboxFrameV1 {
    pub(crate) fn encode(
        sender_device_id: &DeviceId,
        header: &ClipboardHeader,
        ciphertext: &Bytes,
    ) -> Result<Vec<u8>, MailboxFrameEncodeError> {
        let event = header
            .event
            .clone()
            .ok_or(MailboxFrameEncodeError::MissingEvent)?;
        let frame = Self {
            version: MAILBOX_FRAME_VERSION,
            sender_device_id: sender_device_id.as_str().to_owned(),
            header: MailboxHeaderV1 {
                version: header.version,
                snapshot_hash: header.snapshot_hash.clone(),
                captured_at_ms: header.captured_at_ms,
                origin_device_id: header.origin_device_id.clone(),
                origin_device_name: header.origin_device_name.clone(),
                payload_version: header.payload_version,
                flow_id: header.flow_id.clone(),
                event,
            },
            ciphertext: ciphertext.to_vec(),
        };
        Ok(postcard::to_allocvec(&frame)?)
    }

    fn decode(bytes: &[u8]) -> Option<(DeviceId, ClipboardHeader, Bytes)> {
        if bytes.len() > MAX_MAILBOX_FRAME_BYTES {
            return None;
        }
        let frame: Self = postcard::from_bytes(bytes).ok()?;
        if frame.version != MAILBOX_FRAME_VERSION {
            return None;
        }
        let sender = DeviceId::try_new(frame.sender_device_id)?;
        if frame.header.origin_device_id != sender.as_str()
            || frame.header.event.origin_device_id != sender
            || frame.header.event.content_hash != frame.header.snapshot_hash
            || frame.header.event.validate().is_err()
        {
            return None;
        }
        Some((
            sender,
            ClipboardHeader {
                version: frame.header.version,
                snapshot_hash: frame.header.snapshot_hash,
                captured_at_ms: frame.header.captured_at_ms,
                origin_device_id: frame.header.origin_device_id,
                origin_device_name: frame.header.origin_device_name,
                payload_version: frame.header.payload_version,
                flow_id: frame.header.flow_id,
                event: Some(frame.header.event),
            },
            Bytes::from(frame.ciphertext),
        ))
    }
}

/// Polls leased ciphertext, decrypts only the outer mailbox wrapper, then
/// emits the original inner ciphertext through the ordinary inbound port.
pub struct MailboxClipboardReceiver {
    event_tx: broadcast::Sender<InboundClipboard>,
    cancel: CancellationToken,
    task: Mutex<Option<JoinHandle<()>>>,
}

impl MailboxClipboardReceiver {
    pub fn start(
        mailbox: Arc<dyn ClipboardMailboxPort>,
        transfer_cipher: Arc<dyn TransferCipherPort>,
        device_identity: Arc<dyn DeviceIdentityPort>,
    ) -> Self {
        let (event_tx, _) = broadcast::channel(MAILBOX_CHANNEL_CAPACITY);
        let cancel = CancellationToken::new();
        let task_cancel = cancel.clone();
        let task_event_tx = event_tx.clone();
        let task = tokio::spawn(async move {
            while !task_cancel.is_cancelled() {
                let local_device = device_identity.current_device_id();
                let lease = match mailbox.lease_next(&local_device).await {
                    Ok(Some(lease)) => lease,
                    Ok(None) => {
                        wait_or_cancel(&task_cancel, EMPTY_POLL_DELAY).await;
                        continue;
                    }
                    Err(error) => {
                        warn!(error = %error, "clipboard mailbox poll failed");
                        wait_or_cancel(&task_cancel, ERROR_POLL_DELAY).await;
                        continue;
                    }
                };

                let outer_plaintext = match transfer_cipher.decrypt(&lease.ciphertext).await {
                    Ok(bytes) => bytes,
                    Err(TransferCipherError::NotUnlocked) => {
                        debug!("clipboard mailbox lease deferred while space is locked");
                        wait_or_cancel(&task_cancel, ERROR_POLL_DELAY).await;
                        continue;
                    }
                    Err(error) => {
                        warn!(error = %error, "clipboard mailbox discarded invalid outer ciphertext");
                        let _ = mailbox.acknowledge(&local_device, &lease.receipt).await;
                        continue;
                    }
                };
                let Some((sender, header, inner_ciphertext)) =
                    MailboxFrameV1::decode(&outer_plaintext)
                else {
                    warn!("clipboard mailbox discarded invalid encrypted frame");
                    let _ = mailbox.acknowledge(&local_device, &lease.receipt).await;
                    continue;
                };
                let event_targets_local = header.event.as_ref().is_some_and(|event| {
                    event.target_device_ids.is_empty()
                        || event.target_device_ids.contains(&local_device)
                });
                if !event_targets_local {
                    warn!("clipboard mailbox discarded frame addressed to a different device");
                    let _ = mailbox.acknowledge(&local_device, &lease.receipt).await;
                    continue;
                }

                let (receipt, result) = InboundClipboardReceipt::pending();
                let inbound = InboundClipboard {
                    peer_device_id: sender,
                    header,
                    ciphertext: inner_ciphertext,
                    transport: uc_core::ports::ClipboardDeliveryTransport::Mailbox,
                    received_at: Instant::now(),
                    receipt,
                };
                if task_event_tx.send(inbound).is_err() {
                    debug!("clipboard mailbox has no inbound subscriber; leaving lease for retry");
                    continue;
                }
                let settled = tokio::select! {
                    _ = task_cancel.cancelled() => return,
                    value = tokio::time::timeout(APPLICATION_SETTLEMENT_TIMEOUT, result.wait()) => {
                        value.ok().flatten()
                    }
                };
                if settled.is_some() {
                    if let Err(error) = mailbox.acknowledge(&local_device, &lease.receipt).await {
                        warn!(error = %error, "clipboard mailbox acknowledgement failed");
                    } else {
                        info!("clipboard mailbox delivery settled and ciphertext deleted");
                    }
                }
            }
        });
        Self {
            event_tx,
            cancel,
            task: Mutex::new(Some(task)),
        }
    }
}

impl ClipboardReceiverPort for MailboxClipboardReceiver {
    fn subscribe(&self) -> broadcast::Receiver<InboundClipboard> {
        self.event_tx.subscribe()
    }
}

impl Drop for MailboxClipboardReceiver {
    fn drop(&mut self) {
        self.cancel.cancel();
        if let Some(task) = self.task.lock().unwrap_or_else(|e| e.into_inner()).take() {
            task.abort();
        }
    }
}

/// Merges direct/relay Iroh and mailbox broadcasts without changing receipt
/// semantics. Event-ID deduplication remains in the shared application path.
pub struct MergedClipboardReceiver {
    event_tx: broadcast::Sender<InboundClipboard>,
    cancel: CancellationToken,
    tasks: Mutex<Vec<JoinHandle<()>>>,
    _sources: Vec<Arc<dyn ClipboardReceiverPort>>,
}

impl MergedClipboardReceiver {
    pub fn new(sources: Vec<Arc<dyn ClipboardReceiverPort>>) -> Self {
        let (event_tx, _) = broadcast::channel(MAILBOX_CHANNEL_CAPACITY);
        let cancel = CancellationToken::new();
        let mut tasks = Vec::with_capacity(sources.len());
        for source in &sources {
            let mut receiver = source.subscribe();
            let target = event_tx.clone();
            let task_cancel = cancel.clone();
            tasks.push(tokio::spawn(async move {
                loop {
                    tokio::select! {
                        _ = task_cancel.cancelled() => return,
                        inbound = receiver.recv() => match inbound {
                            Ok(inbound) => { let _ = target.send(inbound); }
                            Err(broadcast::error::RecvError::Lagged(missed)) => {
                                warn!(missed, "merged clipboard receiver lagged");
                            }
                            Err(broadcast::error::RecvError::Closed) => return,
                        }
                    }
                }
            }));
        }
        Self {
            event_tx,
            cancel,
            tasks: Mutex::new(tasks),
            _sources: sources,
        }
    }
}

impl ClipboardReceiverPort for MergedClipboardReceiver {
    fn subscribe(&self) -> broadcast::Receiver<InboundClipboard> {
        self.event_tx.subscribe()
    }
}

impl Drop for MergedClipboardReceiver {
    fn drop(&mut self) {
        self.cancel.cancel();
        for task in self
            .tasks
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .drain(..)
        {
            task.abort();
        }
    }
}

async fn wait_or_cancel(cancel: &CancellationToken, delay: Duration) {
    tokio::select! {
        _ = cancel.cancelled() => {}
        _ = tokio::time::sleep(delay) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uc_core::clipboard::{ClipboardEventEnvelope, ClipboardMimeRepresentation};

    #[test]
    fn encrypted_mailbox_inner_frame_round_trips_without_transport_fork() {
        let sender = DeviceId::new("sender-device");
        let target = DeviceId::new("target-device");
        let header = ClipboardHeader {
            version: ClipboardHeader::CURRENT_VERSION,
            snapshot_hash: "a".repeat(64),
            captured_at_ms: 1_700_000_000_000,
            origin_device_id: sender.as_str().to_owned(),
            origin_device_name: "Sender".to_owned(),
            payload_version: 3,
            flow_id: None,
            event: Some(ClipboardEventEnvelope::new(
                sender,
                1_700_000_000_000,
                "a".repeat(64),
                vec![ClipboardMimeRepresentation {
                    mime_type: "text/plain".to_owned(),
                    size_bytes: 5,
                }],
                vec![],
                vec![target],
            )),
        };
        let encoded = MailboxFrameV1::encode(&sender, &header, &Bytes::from_static(b"inner"))
            .expect("encode mailbox frame");
        let (decoded_sender, decoded_header, decoded_ciphertext) =
            MailboxFrameV1::decode(&encoded).expect("decode mailbox frame");
        assert_eq!(decoded_sender, sender);
        assert_eq!(decoded_header, header);
        assert_eq!(decoded_ciphertext, Bytes::from_static(b"inner"));
    }
}
