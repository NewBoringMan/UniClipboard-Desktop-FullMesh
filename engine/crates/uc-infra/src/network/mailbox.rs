//! HTTPS adapter for the FullMesh ciphertext-only mailbox service.

use async_trait::async_trait;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use bytes::Bytes;
use hmac::{Hmac, Mac};
use reqwest::{Client, StatusCode, Url};
use serde::Deserialize;
use sha2::Sha256;
use std::fmt;
use std::time::Duration;
use zeroize::Zeroizing;

use uc_core::ids::{DeviceId, EventId};
use uc_core::ports::{
    ClipboardMailboxError, ClipboardMailboxLease, ClipboardMailboxPort, MailboxUploadOutcome,
};

const MAILBOX_CONTEXT: &[u8] = b"uniclipboard-mailbox-v1\0";
const EVENT_CONTEXT: &[u8] = b"uniclipboard-mailbox-event-v1\0";

pub struct HttpClipboardMailbox {
    client: Client,
    base_url: Url,
    bearer_token: Zeroizing<String>,
}

impl fmt::Debug for HttpClipboardMailbox {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("HttpClipboardMailbox")
            .field("base_url", &self.base_url.origin().ascii_serialization())
            .field("bearer_token", &"[REDACTED]")
            .finish()
    }
}

impl HttpClipboardMailbox {
    pub fn new(base_url: &str, bearer_token: String) -> Result<Self, ClipboardMailboxError> {
        if bearer_token.len() < 32 || bearer_token.len() > 512 {
            return Err(ClipboardMailboxError::InvalidRequest);
        }
        let mut base_url =
            Url::parse(base_url).map_err(|_| ClipboardMailboxError::InvalidRequest)?;
        if base_url.username() != ""
            || base_url.password().is_some()
            || base_url.query().is_some()
            || base_url.fragment().is_some()
        {
            return Err(ClipboardMailboxError::InvalidRequest);
        }
        let loopback_http = base_url.scheme() == "http"
            && base_url.host_str().is_some_and(|host| {
                host == "localhost"
                    || host
                        .parse::<std::net::IpAddr>()
                        .is_ok_and(|ip| ip.is_loopback())
            });
        if base_url.scheme() != "https" && !loopback_http {
            return Err(ClipboardMailboxError::InvalidRequest);
        }
        base_url.set_path("/");
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|_| ClipboardMailboxError::Unavailable)?;
        Ok(Self {
            client,
            base_url,
            bearer_token: Zeroizing::new(bearer_token),
        })
    }

    fn mailbox_id(&self, device: &DeviceId) -> Result<String, ClipboardMailboxError> {
        let mut mac = Hmac::<Sha256>::new_from_slice(self.bearer_token.as_bytes())
            .map_err(|_| ClipboardMailboxError::InvalidRequest)?;
        mac.update(MAILBOX_CONTEXT);
        mac.update(device.as_str().as_bytes());
        Ok(URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()))
    }

    fn event_key(&self, event_id: &EventId) -> Result<String, ClipboardMailboxError> {
        let mut mac = Hmac::<Sha256>::new_from_slice(self.bearer_token.as_bytes())
            .map_err(|_| ClipboardMailboxError::InvalidRequest)?;
        mac.update(EVENT_CONTEXT);
        mac.update(event_id.to_string().as_bytes());
        Ok(URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()))
    }

    fn events_url(&self, device: &DeviceId) -> Result<Url, ClipboardMailboxError> {
        self.base_url
            .join(&format!("v1/mailboxes/{}/events", self.mailbox_id(device)?))
            .map_err(|_| ClipboardMailboxError::InvalidRequest)
    }

    fn map_status(status: StatusCode) -> ClipboardMailboxError {
        match status {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => ClipboardMailboxError::Unauthorized,
            StatusCode::TOO_MANY_REQUESTS
            | StatusCode::PAYLOAD_TOO_LARGE
            | StatusCode::INSUFFICIENT_STORAGE => ClipboardMailboxError::Capacity,
            status if status.is_client_error() => ClipboardMailboxError::InvalidRequest,
            _ => ClipboardMailboxError::Unavailable,
        }
    }
}

#[derive(Deserialize)]
struct UploadResponse {
    duplicate: bool,
}

#[async_trait]
impl ClipboardMailboxPort for HttpClipboardMailbox {
    async fn upload(
        &self,
        target: &DeviceId,
        event_id: &EventId,
        ttl_seconds: u32,
        ciphertext: Bytes,
    ) -> Result<MailboxUploadOutcome, ClipboardMailboxError> {
        let response = self
            .client
            .post(self.events_url(target)?)
            .bearer_auth(self.bearer_token.as_str())
            .header("content-type", "application/octet-stream")
            .header("x-uniclipboard-event-id", self.event_key(event_id)?)
            .header("x-uniclipboard-ttl-seconds", ttl_seconds)
            .body(ciphertext)
            .send()
            .await
            .map_err(|_| ClipboardMailboxError::Unavailable)?;
        if !response.status().is_success() {
            return Err(Self::map_status(response.status()));
        }
        let body: UploadResponse = response
            .json()
            .await
            .map_err(|_| ClipboardMailboxError::InvalidResponse)?;
        Ok(if body.duplicate {
            MailboxUploadOutcome::Duplicate
        } else {
            MailboxUploadOutcome::Stored
        })
    }

    async fn lease_next(
        &self,
        local_device: &DeviceId,
    ) -> Result<Option<ClipboardMailboxLease>, ClipboardMailboxError> {
        let url = self
            .events_url(local_device)?
            .join("events/next")
            .map_err(|_| ClipboardMailboxError::InvalidRequest)?;
        let response = self
            .client
            .get(url)
            .bearer_auth(self.bearer_token.as_str())
            .send()
            .await
            .map_err(|_| ClipboardMailboxError::Unavailable)?;
        if response.status() == StatusCode::NO_CONTENT {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(Self::map_status(response.status()));
        }
        let receipt = response
            .headers()
            .get("x-uniclipboard-receipt")
            .and_then(|value| value.to_str().ok())
            .filter(|value| value.len() >= 16 && value.len() <= 128)
            .map(str::to_owned)
            .ok_or(ClipboardMailboxError::InvalidResponse)?;
        let expires_at_ms = response
            .headers()
            .get("x-uniclipboard-expires-at")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<i64>().ok())
            .ok_or(ClipboardMailboxError::InvalidResponse)?;
        let ciphertext = response
            .bytes()
            .await
            .map_err(|_| ClipboardMailboxError::InvalidResponse)?;
        Ok(Some(ClipboardMailboxLease {
            receipt,
            ciphertext,
            expires_at_ms,
        }))
    }

    async fn acknowledge(
        &self,
        local_device: &DeviceId,
        receipt: &str,
    ) -> Result<(), ClipboardMailboxError> {
        if receipt.len() < 16
            || receipt.len() > 128
            || !receipt
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return Err(ClipboardMailboxError::InvalidRequest);
        }
        let url = self
            .events_url(local_device)?
            .join(&format!("events/receipts/{receipt}"))
            .map_err(|_| ClipboardMailboxError::InvalidRequest)?;
        let response = self
            .client
            .delete(url)
            .bearer_auth(self.bearer_token.as_str())
            .send()
            .await
            .map_err(|_| ClipboardMailboxError::Unavailable)?;
        if response.status().is_success() || response.status() == StatusCode::NOT_FOUND {
            return Ok(());
        }
        Err(Self::map_status(response.status()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derived_mailbox_ids_are_stable_distinct_and_opaque() {
        let mailbox = HttpClipboardMailbox::new(
            "https://mailbox.example.test",
            "a-very-long-space-token-that-is-never-logged".to_owned(),
        )
        .unwrap();
        let first = mailbox.mailbox_id(&DeviceId::new("device-alpha")).unwrap();
        let again = mailbox.mailbox_id(&DeviceId::new("device-alpha")).unwrap();
        let second = mailbox.mailbox_id(&DeviceId::new("device-beta")).unwrap();
        assert_eq!(first, again);
        assert_ne!(first, second);
        assert!(!first.contains("device"));
    }

    #[test]
    fn insecure_non_loopback_urls_and_short_tokens_are_rejected() {
        assert!(HttpClipboardMailbox::new(
            "http://mailbox.example.test",
            "a-very-long-space-token-that-is-never-logged".to_owned(),
        )
        .is_err());
        assert!(
            HttpClipboardMailbox::new("https://mailbox.example.test", "short".to_owned()).is_err()
        );
        assert!(HttpClipboardMailbox::new(
            "http://127.0.0.1:8787",
            "a-very-long-space-token-that-is-never-logged".to_owned(),
        )
        .is_ok());
    }
}
