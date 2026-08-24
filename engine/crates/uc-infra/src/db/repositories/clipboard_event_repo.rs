use crate::db::{
    models::{
        clipboard_event::NewClipboardEventRow,
        snapshot_representation::{NewSnapshotRepresentationRow, SnapshotRepresentationRow},
    },
    ports::{DbExecutor, InsertMapper, RowMapper},
    schema::{clipboard_event, clipboard_snapshot_representation},
};
use anyhow::Result;
use diesel::prelude::*;
use diesel::sql_types::{BigInt, Text};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::debug_span;
use uc_core::{
    clipboard::{
        normalize_wire_mime, ClipboardEvent, PersistedClipboardRepresentation, FULLMESH_MAX_TTL_MS,
    },
    ids::{DeviceId, EventId},
    ports::{ClipboardEventRepositoryPort, ClipboardEventWriterPort},
};

const MAX_RECENT_EVENTS: i64 = 10_000;

#[derive(QueryableByName)]
struct OriginSequenceRow {
    #[diesel(sql_type = BigInt)]
    last_sequence: i64,
}

fn wall_clock_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| i64::try_from(duration.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or_default()
}

fn record_recent_event(
    conn: &mut SqliteConnection,
    event_id: &str,
    captured_at_ms: i64,
) -> Result<()> {
    let expires_at_ms = captured_at_ms
        .max(wall_clock_ms())
        .saturating_add(FULLMESH_MAX_TTL_MS);
    diesel::sql_query(
        "INSERT INTO clipboard_recent_event (event_id, expires_at_ms) VALUES (?, ?) \
         ON CONFLICT(event_id) DO UPDATE SET expires_at_ms = \
         MAX(clipboard_recent_event.expires_at_ms, excluded.expires_at_ms)",
    )
    .bind::<Text, _>(event_id)
    .bind::<BigInt, _>(expires_at_ms)
    .execute(conn)?;
    diesel::sql_query("DELETE FROM clipboard_recent_event WHERE expires_at_ms <= ?")
        .bind::<BigInt, _>(wall_clock_ms())
        .execute(conn)?;
    diesel::sql_query(
        "DELETE FROM clipboard_recent_event WHERE event_id IN (\
             SELECT event_id FROM clipboard_recent_event \
             ORDER BY expires_at_ms DESC, event_id DESC LIMIT -1 OFFSET ?\
         )",
    )
    .bind::<BigInt, _>(MAX_RECENT_EVENTS)
    .execute(conn)?;
    Ok(())
}

pub(super) fn insert_clipboard_event_rows(
    conn: &mut SqliteConnection,
    event: &NewClipboardEventRow,
    representations: &[NewSnapshotRepresentationRow],
) -> Result<()> {
    diesel::insert_into(clipboard_event::table)
        .values(event)
        .execute(conn)?;
    record_recent_event(conn, &event.event_id, event.captured_at_ms)?;
    for representation in representations {
        diesel::insert_into(clipboard_snapshot_representation::table)
            .values(representation)
            .execute(conn)?;
    }
    Ok(())
}

pub struct DieselClipboardEventRepository<E, ME, MS> {
    executor: E,
    event_mapper: ME,
    snapshot_mapper: MS,
}

impl<E, ME, MS> DieselClipboardEventRepository<E, ME, MS> {
    pub fn new(executor: E, event_mapper: ME, snapshot_mapper: MS) -> Self {
        Self {
            executor,
            event_mapper,
            snapshot_mapper,
        }
    }
}

#[async_trait::async_trait]
impl<E, ME, MS> ClipboardEventWriterPort for DieselClipboardEventRepository<E, ME, MS>
where
    E: DbExecutor,
    ME: InsertMapper<ClipboardEvent, NewClipboardEventRow>,
    for<'a> MS: InsertMapper<
        (&'a PersistedClipboardRepresentation, &'a EventId),
        NewSnapshotRepresentationRow,
    >,
{
    /// Inserts a clipboard event and all its snapshot representations in a single database transaction.
    ///
    /// Converts the provided event and each persisted representation to their corresponding database rows and persists them; if any conversion or insert fails, the whole transaction is rolled back.
    ///
    /// # Examples
    ///
    /// ```
    /// # use uc_core::{ClipboardEvent, PersistedClipboardRepresentation};
    /// # use uc_core::ports::ClipboardEventWriterPort;
    /// # async fn example(
    /// #     repo: &impl ClipboardEventWriterPort,
    /// #     event: &ClipboardEvent,
    /// #     reps: &Vec<PersistedClipboardRepresentation>,
    /// # ) -> anyhow::Result<()> {
    /// repo.insert_event(event, reps).await?;
    /// # Ok(())
    /// # }
    /// ```
    ///
    /// # Returns
    ///
    /// `Ok(())` on success, `Err` if mapping or database operations fail.
    async fn insert_event(
        &self,
        event: &ClipboardEvent,
        reps: &Vec<PersistedClipboardRepresentation>,
    ) -> Result<()> {
        let span = debug_span!(
            "infra.sqlite.insert_clipboard_event",
            table = "clipboard_event",
            event_id = %event.event_id,
        );
        span.in_scope(|| {
            let new_event: NewClipboardEventRow = self.event_mapper.to_row(event)?;
            let new_reps: Vec<NewSnapshotRepresentationRow> = reps
                .iter()
                .map(|rep| self.snapshot_mapper.to_row(&(rep, &event.event_id)))
                .collect::<Result<Vec<_>, _>>()?;

            self.executor.run(|conn| {
                conn.transaction(|conn| insert_clipboard_event_rows(conn, &new_event, &new_reps))
            })
        })
    }

    /// Deletes the clipboard event and all associated snapshot representations for the given event ID.
    ///
    /// The deletions are performed inside a single database transaction: snapshot representations referencing
    /// the event are removed first, then the event row itself is deleted.
    ///
    /// # Returns
    ///
    /// `Ok(())` if the deletion succeeds, `Err` if a database error prevents the operation.
    ///
    /// # Examples
    ///
    /// ```
    /// # use uc_core::ids::EventId;
    /// # use uc_core::ports::ClipboardEventWriterPort;
    /// # async fn run_example(
    /// #     repo: &impl ClipboardEventWriterPort,
    /// #     event_id: &EventId,
    /// # ) -> anyhow::Result<()> {
    /// repo.delete_event_and_representations(event_id).await?;
    /// # Ok(())
    /// # }
    /// ```
    async fn delete_event_and_representations(&self, event_id: &EventId) -> Result<()> {
        let span = debug_span!(
            "infra.sqlite.delete_clipboard_event",
            table = "clipboard_event",
            event_id = %event_id,
        );
        span.in_scope(|| {
            let event_id_str = event_id.to_string();
            self.executor.run(|conn| {
                conn.transaction(|conn| {
                    // Delete representations first (they reference the event)
                    diesel::delete(clipboard_snapshot_representation::table)
                        .filter(clipboard_snapshot_representation::event_id.eq(&event_id_str))
                        .execute(conn)?;

                    // Then delete the event
                    diesel::delete(clipboard_event::table)
                        .filter(clipboard_event::event_id.eq(&event_id_str))
                        .execute(conn)?;

                    Ok(())
                })
            })
        })
    }
}

#[async_trait::async_trait]
impl<E, ME, MS> ClipboardEventRepositoryPort for DieselClipboardEventRepository<E, ME, MS>
where
    E: DbExecutor,
    ME: Send + Sync,
    MS: RowMapper<SnapshotRepresentationRow, PersistedClipboardRepresentation> + Send + Sync,
{
    async fn get_representation(
        &self,
        event_id: &EventId,
        representation_id: &str,
    ) -> Result<uc_core::ObservedClipboardRepresentation> {
        let span = debug_span!(
            "infra.sqlite.query_snapshot_representation",
            table = "snapshot_representation",
            event_id = %event_id,
            representation_id = representation_id,
        );
        let rep_row = span.in_scope(|| {
            use crate::db::schema::clipboard_snapshot_representation;

            let event_id_str = event_id.as_ref().to_string();
            let rep_id_str = representation_id.to_string();

            self.executor
                .run(|conn| {
                    let rep = clipboard_snapshot_representation::table
                        .filter(clipboard_snapshot_representation::event_id.eq(&event_id_str))
                        .filter(clipboard_snapshot_representation::id.eq(&rep_id_str))
                        .first::<SnapshotRepresentationRow>(conn)
                        .map_err(|e| anyhow::anyhow!("Failed to fetch representation: {}", e))?;
                    Ok(rep)
                })
                .map_err(|e| anyhow::anyhow!("Database error: {}", e))
        })?;

        // Convert from PersistedClipboardRepresentation to ObservedClipboardRepresentation.
        // Normalize `mime_type` to drop UTI / platform-native identifiers
        // that older database rows may still hold; downstream falls back
        // to `format_id` for classification when mime ends up `None`.
        let persisted = self.snapshot_mapper.to_domain(&rep_row)?;
        let normalized_mime = normalize_wire_mime(persisted.mime_type.map(|m| m.0));
        Ok(uc_core::ObservedClipboardRepresentation::new(
            persisted.id,
            persisted.format_id,
            normalized_mime,
            persisted.inline_data.unwrap_or_default(),
        ))
    }

    async fn get_source_device(
        &self,
        event_id: &EventId,
    ) -> Result<Option<uc_core::ids::DeviceId>> {
        use crate::db::schema::clipboard_event;

        let event_id_str = event_id.as_ref().to_string();
        let source: Option<String> = self.executor.run(move |conn| {
            Ok(clipboard_event::table
                .filter(clipboard_event::event_id.eq(&event_id_str))
                .select(clipboard_event::source_device)
                .first::<String>(conn)
                .optional()?)
        })?;
        Ok(source.map(uc_core::ids::DeviceId::new))
    }

    async fn allocate_origin_sequence(&self, device_id: &DeviceId, now_ms: i64) -> Result<u64> {
        let device_id = device_id.as_str().to_owned();
        let clock_floor = now_ms.max(0).saturating_mul(1_000_000).max(1);
        let row = self.executor.run(move |conn| {
            conn.transaction(|conn| {
                diesel::sql_query(
                    "INSERT INTO clipboard_origin_sequence (device_id, last_sequence) VALUES (?, ?) \
                     ON CONFLICT(device_id) DO UPDATE SET last_sequence = \
                     MAX(clipboard_origin_sequence.last_sequence + 1, excluded.last_sequence)",
                )
                .bind::<Text, _>(&device_id)
                .bind::<BigInt, _>(clock_floor)
                .execute(conn)?;
                Ok(diesel::sql_query(
                    "SELECT last_sequence FROM clipboard_origin_sequence WHERE device_id = ?",
                )
                .bind::<Text, _>(&device_id)
                .get_result::<OriginSequenceRow>(conn)?)
            })
        })?;
        u64::try_from(row.last_sequence)
            .map_err(|_| anyhow::anyhow!("persisted clipboard origin sequence is invalid"))
    }

    async fn has_recent_event(&self, event_id: &EventId, now_ms: i64) -> Result<bool> {
        let event_id = event_id.as_ref().to_owned();
        self.executor.run(move |conn| {
            Ok(diesel::select(diesel::dsl::exists(
                crate::db::schema::clipboard_recent_event::table
                    .filter(crate::db::schema::clipboard_recent_event::event_id.eq(event_id))
                    .filter(crate::db::schema::clipboard_recent_event::expires_at_ms.gt(now_ms)),
            ))
            .get_result(conn)?)
        })
    }
}

#[cfg(test)]
mod fullmesh_state_tests {
    use super::*;
    use crate::db::executor::DieselSqliteExecutor;
    use crate::db::mappers::clipboard_event_mapper::ClipboardEventRowMapper;
    use crate::db::mappers::snapshot_representation_mapper::RepresentationRowMapper;
    use crate::db::pool::init_db_pool;
    use std::collections::HashSet;
    use std::sync::Arc;

    fn repository(
        database_url: &str,
    ) -> DieselClipboardEventRepository<
        Arc<DieselSqliteExecutor>,
        ClipboardEventRowMapper,
        RepresentationRowMapper,
    > {
        let pool = init_db_pool(database_url).expect("initialize test database");
        DieselClipboardEventRepository::new(
            Arc::new(DieselSqliteExecutor::new(pool)),
            ClipboardEventRowMapper,
            RepresentationRowMapper,
        )
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn origin_sequence_is_unique_under_concurrency_and_monotonic_after_reopen() {
        let directory = tempfile::tempdir().expect("tempdir");
        let database = directory.path().join("event-state.sqlite");
        let database_url = database.to_str().expect("utf8 database path").to_owned();
        let shared_repository = Arc::new(repository(&database_url));
        let device = DeviceId::new("device-a");
        let mut tasks = Vec::new();
        for _ in 0..16 {
            let repository = Arc::clone(&shared_repository);
            tasks.push(tokio::spawn(async move {
                repository
                    .allocate_origin_sequence(&device, 1_700_000_000_000)
                    .await
                    .expect("allocate sequence")
            }));
        }
        let mut sequences = Vec::new();
        for task in tasks {
            sequences.push(task.await.expect("join allocator"));
        }
        assert_eq!(
            sequences.iter().copied().collect::<HashSet<_>>().len(),
            sequences.len()
        );
        let prior_max = sequences.into_iter().max().expect("sequence");
        drop(shared_repository);

        let reopened = repository(&database_url);
        let after_restart = reopened
            .allocate_origin_sequence(&device, 1)
            .await
            .expect("allocate after restart");
        assert!(after_restart > prior_max);
    }

    #[tokio::test]
    async fn recent_event_tombstone_survives_history_row_deletion() {
        let directory = tempfile::tempdir().expect("tempdir");
        let database = directory.path().join("event-replay.sqlite");
        let database_url = database.to_str().expect("utf8 database path");
        let pool = init_db_pool(database_url).expect("initialize test database");
        let event_id = EventId::new();
        let event_id_text = event_id.to_string();
        {
            let mut connection = pool.get().expect("database connection");
            diesel::sql_query(
                "INSERT INTO clipboard_event \
                 (event_id, captured_at_ms, source_device, snapshot_hash) \
                 VALUES (?, 1, 'device-a', ?)",
            )
            .bind::<Text, _>(&event_id_text)
            .bind::<Text, _>("a".repeat(64))
            .execute(&mut connection)
            .expect("insert event");
            diesel::sql_query(
                "INSERT INTO clipboard_recent_event (event_id, expires_at_ms) VALUES (?, ?)",
            )
            .bind::<Text, _>(&event_id_text)
            .bind::<BigInt, _>(10_000)
            .execute(&mut connection)
            .expect("insert replay tombstone");
            diesel::sql_query("DELETE FROM clipboard_event WHERE event_id = ?")
                .bind::<Text, _>(&event_id_text)
                .execute(&mut connection)
                .expect("delete history event");
        }
        let repository = DieselClipboardEventRepository::new(
            Arc::new(DieselSqliteExecutor::new(pool)),
            ClipboardEventRowMapper,
            RepresentationRowMapper,
        );
        assert!(repository
            .has_recent_event(&event_id, 9_999)
            .await
            .expect("query replay tombstone"));
        assert!(!repository
            .has_recent_event(&event_id, 10_000)
            .await
            .expect("query expired tombstone"));
    }
}
