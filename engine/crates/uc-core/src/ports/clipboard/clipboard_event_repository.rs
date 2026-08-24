use crate::{ids::DeviceId, ids::EventId, ObservedClipboardRepresentation};
use anyhow::Result;

#[async_trait::async_trait]
pub trait ClipboardEventRepositoryPort: Send + Sync {
    async fn get_representation(
        &self,
        id: &EventId,
        representation_id: &str,
    ) -> Result<ObservedClipboardRepresentation>;

    /// 返回该 event 的来源设备 id。`None` 表示 event 不存在;调用方应据此
    /// 把派生信息降级为"来源不可信",不得当作"本机产生"处理。
    async fn get_source_device(&self, event_id: &EventId) -> Result<Option<DeviceId>>;

    /// Atomically allocate the next monotonic sequence for one origin device.
    ///
    /// The default keeps small in-memory adapters source-compatible. Durable
    /// adapters must override this method so process restarts and concurrent
    /// dispatchers cannot reuse or regress a sequence.
    async fn allocate_origin_sequence(&self, _device_id: &DeviceId, now_ms: i64) -> Result<u64> {
        Ok(crate::clipboard::next_origin_sequence(now_ms))
    }

    /// Return whether an EventId is still inside the durable replay window.
    ///
    /// The default preserves the legacy event-row behavior for test adapters.
    /// Production storage keeps a bounded tombstone after history deletion.
    async fn has_recent_event(&self, event_id: &EventId, _now_ms: i64) -> Result<bool> {
        Ok(self.get_source_device(event_id).await?.is_some())
    }
}
