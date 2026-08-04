#![forbid(unsafe_code)]

//! SQLCipher-backed persistence, migrations, transactions, and revision history.
//! Storage accepts validated domain values and does not expose database handles to the UI.

use std::{
    collections::HashSet,
    error::Error,
    fmt, fs,
    fs::OpenOptions,
    path::{Path, PathBuf},
    time::Duration,
};

use rusqlite::{Connection, ErrorCode, OpenFlags, TransactionBehavior, backup::Backup};
use sha2::{Digest, Sha256};
use sheut_core::{
    BrandAssetMetadata, BrandAssetRole, BrandProfile, DocumentActivityEntry, DocumentActivityKind,
    DocumentEnvelope, DocumentRevisionSummary, EvidenceFileMetadata, EvidenceMetadataInput,
    GraphViewport, GraphWorkspace, GraphWorkspaceSnapshot, ImageAttachmentMetadata, ImageMediaType,
    LocalId, MAX_GRAPH_MUTATION_BATCH, MAX_GRAPH_VISUAL_LINKS, MAX_GRAPH_WORKSPACE_ITEMS, Position,
    ProjectMetadata, PublicationRecord, Revision, SemanticRelationshipDraft, TechniqueObservation,
    VisualLink, WorkspaceItem, WorkspaceItemKind, WorkspaceMode, detect_evidence_media_type,
};
use sheut_stix::{ExistingStixObject, ImportCommit, StixDraft};
use zeroize::Zeroizing;

mod queries;

const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

const fn brand_asset_role_name(role: BrandAssetRole) -> &'static str {
    match role {
        BrandAssetRole::Logo => "logo",
        BrandAssetRole::CompactMark => "compact_mark",
        BrandAssetRole::CoverArtwork => "cover_artwork",
    }
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        sql: "
            CREATE TABLE documents (
                id TEXT PRIMARY KEY NOT NULL,
                revision INTEGER NOT NULL CHECK (revision > 0),
                payload BLOB NOT NULL
            ) STRICT;

            CREATE TABLE project_metadata (
                singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                payload BLOB NOT NULL
            ) STRICT;
        ",
    },
    Migration {
        version: 2,
        sql: "
            CREATE TABLE document_image_attachments (
                id TEXT PRIMARY KEY NOT NULL,
                document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                media_type TEXT NOT NULL CHECK (media_type IN ('image/png', 'image/jpeg', 'image/webp')),
                file_name TEXT NOT NULL,
                byte_len INTEGER NOT NULL CHECK (byte_len > 0 AND byte_len <= 10485760),
                payload BLOB NOT NULL CHECK (length(payload) = byte_len)
            ) STRICT;

            CREATE INDEX document_image_attachments_document_id
                ON document_image_attachments(document_id);
        ",
    },
    Migration {
        version: 3,
        sql: "
            ALTER TABLE documents ADD COLUMN deleted_at_unix_ms INTEGER;

            CREATE TABLE document_revisions (
                document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                revision INTEGER NOT NULL CHECK (revision > 0),
                saved_at_unix_ms INTEGER NOT NULL CHECK (saved_at_unix_ms >= 0),
                payload BLOB NOT NULL,
                PRIMARY KEY (document_id, revision)
            ) STRICT;

            INSERT INTO document_revisions (document_id, revision, saved_at_unix_ms, payload)
                SELECT id, revision, 0, payload FROM documents;

            CREATE TABLE document_activity (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
                kind TEXT NOT NULL CHECK (
                    kind IN ('created', 'edited', 'deleted', 'restored', 'restored_revision')
                ),
                revision INTEGER NOT NULL CHECK (revision > 0),
                source_revision INTEGER CHECK (source_revision > 0),
                occurred_at_unix_ms INTEGER NOT NULL CHECK (occurred_at_unix_ms >= 0)
            ) STRICT;

            INSERT INTO document_activity (
                document_id, kind, revision, source_revision, occurred_at_unix_ms
            ) SELECT id, 'created', revision, NULL, 0 FROM documents;

            CREATE INDEX document_activity_document_sequence
                ON document_activity(document_id, sequence DESC);
        ",
    },
    Migration {
        version: 4,
        sql: "
            CREATE TABLE stix_objects (
                local_id TEXT PRIMARY KEY NOT NULL,
                stix_id TEXT NOT NULL,
                object_type TEXT NOT NULL,
                modified TEXT,
                version_key TEXT NOT NULL,
                payload BLOB NOT NULL,
                UNIQUE (stix_id, version_key)
            ) STRICT;

            CREATE INDEX stix_objects_type ON stix_objects(object_type);
        ",
    },
    Migration {
        version: 5,
        sql: "
            CREATE TABLE stix_drafts (
                local_id TEXT PRIMARY KEY NOT NULL,
                object_type TEXT NOT NULL,
                properties BLOB NOT NULL
            ) STRICT;

            CREATE INDEX stix_drafts_type ON stix_drafts(object_type);
        ",
    },
    Migration {
        version: 6,
        sql: "
            ALTER TABLE stix_drafts ADD COLUMN semantic_relationship BLOB;
        ",
    },
    Migration {
        version: 7,
        sql: "
            ALTER TABLE stix_drafts ADD COLUMN replaces_stix_id TEXT;
        ",
    },
    Migration {
        version: 8,
        sql: "
            CREATE TABLE technique_observations (
                id TEXT PRIMARY KEY NOT NULL,
                revision INTEGER NOT NULL CHECK (revision > 0),
                payload BLOB NOT NULL
            ) STRICT;
        ",
    },
    Migration {
        version: 9,
        sql: "
            CREATE TABLE graph_workspaces (
                id TEXT PRIMARY KEY NOT NULL,
                revision INTEGER NOT NULL CHECK (revision > 0),
                deleted_at_unix_ms INTEGER,
                payload BLOB NOT NULL
            ) STRICT;

            CREATE TABLE graph_workspace_items (
                workspace_id TEXT NOT NULL REFERENCES graph_workspaces(id) ON DELETE CASCADE,
                item_id TEXT NOT NULL,
                item_kind TEXT NOT NULL CHECK (
                    item_kind IN ('intelligence', 'evidence', 'document', 'catalog_reference')
                ),
                x REAL NOT NULL,
                y REAL NOT NULL,
                pinned INTEGER NOT NULL CHECK (pinned IN (0, 1)),
                PRIMARY KEY (workspace_id, item_id)
            ) STRICT;

            CREATE TABLE graph_visual_links (
                id TEXT PRIMARY KEY NOT NULL,
                workspace_id TEXT NOT NULL REFERENCES graph_workspaces(id) ON DELETE CASCADE,
                source_id TEXT NOT NULL,
                target_id TEXT NOT NULL,
                label TEXT,
                CHECK (source_id <> target_id),
                FOREIGN KEY (workspace_id, source_id)
                    REFERENCES graph_workspace_items(workspace_id, item_id) ON DELETE CASCADE,
                FOREIGN KEY (workspace_id, target_id)
                    REFERENCES graph_workspace_items(workspace_id, item_id) ON DELETE CASCADE
            ) STRICT;

            CREATE INDEX graph_visual_links_workspace
                ON graph_visual_links(workspace_id);
        ",
    },
    Migration {
        version: 10,
        sql: "
            CREATE TABLE guided_reports (
                id TEXT PRIMARY KEY NOT NULL,
                revision INTEGER NOT NULL CHECK (revision > 0),
                deleted_at_unix_ms INTEGER,
                payload BLOB NOT NULL
            ) STRICT;

            CREATE TABLE guided_report_revisions (
                report_id TEXT NOT NULL REFERENCES guided_reports(id) ON DELETE CASCADE,
                revision INTEGER NOT NULL CHECK (revision > 0),
                saved_at_unix_ms INTEGER NOT NULL CHECK (saved_at_unix_ms >= 0),
                payload BLOB NOT NULL,
                PRIMARY KEY (report_id, revision)
            ) STRICT;

            CREATE TABLE report_templates (
                id TEXT PRIMARY KEY NOT NULL,
                revision INTEGER NOT NULL CHECK (revision > 0),
                archived_at_unix_ms INTEGER,
                payload BLOB NOT NULL
            ) STRICT;

            CREATE TABLE report_template_revisions (
                template_id TEXT NOT NULL REFERENCES report_templates(id) ON DELETE CASCADE,
                revision INTEGER NOT NULL CHECK (revision > 0),
                saved_at_unix_ms INTEGER NOT NULL CHECK (saved_at_unix_ms >= 0),
                payload BLOB NOT NULL,
                PRIMARY KEY (template_id, revision)
            ) STRICT;

            CREATE TABLE brand_profiles (
                id TEXT PRIMARY KEY NOT NULL,
                revision INTEGER NOT NULL CHECK (revision > 0),
                archived_at_unix_ms INTEGER,
                payload BLOB NOT NULL
            ) STRICT;

            CREATE TABLE brand_profile_revisions (
                profile_id TEXT NOT NULL REFERENCES brand_profiles(id) ON DELETE CASCADE,
                revision INTEGER NOT NULL CHECK (revision > 0),
                saved_at_unix_ms INTEGER NOT NULL CHECK (saved_at_unix_ms >= 0),
                payload BLOB NOT NULL,
                PRIMARY KEY (profile_id, revision)
            ) STRICT;

            CREATE TABLE brand_assets (
                id TEXT PRIMARY KEY NOT NULL,
                profile_id TEXT NOT NULL REFERENCES brand_profiles(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK (role IN ('logo', 'compact_mark', 'cover_artwork')),
                media_type TEXT NOT NULL CHECK (media_type IN ('image/png', 'image/jpeg', 'image/webp')),
                file_name TEXT NOT NULL,
                byte_len INTEGER NOT NULL CHECK (byte_len > 0 AND byte_len <= 10485760),
                payload BLOB NOT NULL CHECK (length(payload) = byte_len)
            ) STRICT;

            CREATE INDEX brand_assets_profile_id ON brand_assets(profile_id);

            CREATE TABLE publication_history (
                id TEXT PRIMARY KEY NOT NULL,
                created_at_unix_ms INTEGER NOT NULL CHECK (created_at_unix_ms >= 0),
                payload BLOB NOT NULL
            ) STRICT;

            CREATE INDEX publication_history_created_at
                ON publication_history(created_at_unix_ms DESC, id);
        ",
    },
    Migration {
        version: 11,
        sql: "
            CREATE TABLE evidence_files (
                id TEXT PRIMARY KEY NOT NULL,
                media_type TEXT NOT NULL CHECK (media_type IN ('image/png', 'image/jpeg', 'image/webp')),
                file_name TEXT NOT NULL,
                byte_len INTEGER NOT NULL CHECK (byte_len > 0 AND byte_len <= 10485760),
                sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
                created_at_unix_ms INTEGER NOT NULL CHECK (created_at_unix_ms >= 0),
                payload BLOB NOT NULL CHECK (length(payload) = byte_len)
            ) STRICT;

            CREATE INDEX evidence_files_created_at
                ON evidence_files(created_at_unix_ms DESC, id);
        ",
    },
    Migration {
        version: 12,
        sql: "
            ALTER TABLE evidence_files RENAME TO evidence_files_image_only;

            CREATE TABLE evidence_files (
                id TEXT PRIMARY KEY NOT NULL,
                media_type TEXT NOT NULL,
                file_name TEXT NOT NULL,
                byte_len INTEGER NOT NULL CHECK (byte_len > 0 AND byte_len <= 104857600),
                sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
                created_at_unix_ms INTEGER NOT NULL CHECK (created_at_unix_ms >= 0),
                payload BLOB NOT NULL CHECK (length(payload) = byte_len)
            ) STRICT;

            INSERT INTO evidence_files (
                id, media_type, file_name, byte_len, sha256, created_at_unix_ms, payload
            ) SELECT
                id, media_type, file_name, byte_len, sha256, created_at_unix_ms, payload
            FROM evidence_files_image_only;

            DROP TABLE evidence_files_image_only;

            CREATE INDEX evidence_files_created_at
                ON evidence_files(created_at_unix_ms DESC, id);
        ",
    },
    Migration {
        version: 13,
        sql: "
            ALTER TABLE evidence_files ADD COLUMN revision INTEGER NOT NULL DEFAULT 1
                CHECK (revision > 0);
            ALTER TABLE evidence_files ADD COLUMN title TEXT NOT NULL DEFAULT '';
            ALTER TABLE evidence_files ADD COLUMN description TEXT NOT NULL DEFAULT '';
            ALTER TABLE evidence_files ADD COLUMN source TEXT NOT NULL DEFAULT '';
            ALTER TABLE evidence_files ADD COLUMN captured_at TEXT;
            ALTER TABLE evidence_files ADD COLUMN source_url TEXT NOT NULL DEFAULT '';
            ALTER TABLE evidence_files ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
            ALTER TABLE evidence_files ADD COLUMN analyst_notes TEXT NOT NULL DEFAULT '';
            ALTER TABLE evidence_files ADD COLUMN updated_at_unix_ms INTEGER NOT NULL DEFAULT 0
                CHECK (updated_at_unix_ms >= 0);

            UPDATE evidence_files SET title = file_name,
                updated_at_unix_ms = created_at_unix_ms;
        ",
    },
    Migration {
        version: 14,
        sql: "
            CREATE TABLE report_number_sequences (
                prefix TEXT PRIMARY KEY NOT NULL CHECK (
                    length(prefix) BETWEEN 2 AND 12
                    AND prefix NOT GLOB '*[^A-Z0-9]*'
                    AND substr(prefix, 1, 1) GLOB '[A-Z]'
                ),
                next_value INTEGER NOT NULL CHECK (next_value > 0)
            ) STRICT;
        ",
    },
    Migration {
        version: 15,
        sql: "
            DELETE FROM publication_history
            WHERE json_valid(CAST(payload AS TEXT))
              AND json_extract(CAST(payload AS TEXT), '$.snapshot.source.type') = 'guided_report';

            DELETE FROM guided_report_revisions;
            DELETE FROM guided_reports;
            DELETE FROM report_template_revisions;
            DELETE FROM report_templates;

            DROP TABLE guided_report_revisions;
            DROP TABLE guided_reports;
            DROP TABLE report_template_revisions;
            DROP TABLE report_templates;
        ",
    },
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoreErrorCode {
    AlreadyExists,
    NotFound,
    InvalidKeyOrCorrupt,
    MigrationFailed,
    RevisionConflict,
    InvalidStoredData,
    InvalidAttachment,
    BackupFailed,
    StorageUnavailable,
}

impl StoreErrorCode {
    const fn as_str(self) -> &'static str {
        match self {
            Self::AlreadyExists => "already_exists",
            Self::NotFound => "not_found",
            Self::InvalidKeyOrCorrupt => "invalid_key_or_corrupt",
            Self::MigrationFailed => "migration_failed",
            Self::RevisionConflict => "revision_conflict",
            Self::InvalidStoredData => "invalid_stored_data",
            Self::InvalidAttachment => "invalid_attachment",
            Self::BackupFailed => "backup_failed",
            Self::StorageUnavailable => "storage_unavailable",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StoreError {
    code: StoreErrorCode,
}

impl StoreError {
    const fn new(code: StoreErrorCode) -> Self {
        Self { code }
    }

    #[must_use]
    pub const fn code(self) -> StoreErrorCode {
        self.code
    }
}

impl fmt::Display for StoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code.as_str())
    }
}

impl Error for StoreError {}

pub struct EncryptedStore {
    connection: Connection,
}

type RevisionedInsert =
    for<'a> fn(&rusqlite::Transaction<'a>, &str, i64, &[u8]) -> rusqlite::Result<usize>;
type RevisionedUpdate =
    for<'a> fn(&rusqlite::Transaction<'a>, &str, i64, &[u8], i64) -> rusqlite::Result<usize>;
type RevisionedHistoryInsert =
    for<'a> fn(&rusqlite::Transaction<'a>, &str, i64, i64, &[u8]) -> rusqlite::Result<usize>;

impl fmt::Debug for EncryptedStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("EncryptedStore")
    }
}

impl EncryptedStore {
    pub fn create(path: &Path, key: &[u8; 32]) -> Result<Self, StoreError> {
        reserve_database_file(path)?;

        let result = (|| {
            let mut connection = open_existing_connection(path)?;
            configure_key_and_verify(&connection, key)?;
            apply_migrations(&mut connection, MIGRATIONS)?;
            Ok(Self { connection })
        })();

        if result.is_err() {
            remove_database_files(path);
        }
        result
    }

    pub fn open(path: &Path, key: &[u8; 32]) -> Result<Self, StoreError> {
        if !path.is_file() {
            return Err(StoreError::new(StoreErrorCode::NotFound));
        }
        let mut connection = open_existing_connection(path)?;
        configure_key_and_verify(&connection, key)?;
        apply_migrations(&mut connection, MIGRATIONS)?;
        Ok(Self { connection })
    }

    pub fn save_document(
        &mut self,
        document: &DocumentEnvelope,
        expected_revision: Option<Revision>,
    ) -> Result<(), StoreError> {
        self.save_document_at(document, expected_revision, 0)
    }

    pub fn save_document_at(
        &mut self,
        document: &DocumentEnvelope,
        expected_revision: Option<Revision>,
        saved_at_unix_ms: i64,
    ) -> Result<(), StoreError> {
        let activity_kind = if expected_revision.is_some() {
            "edited"
        } else {
            "created"
        };
        self.save_document_with_activity(
            document,
            expected_revision,
            saved_at_unix_ms,
            activity_kind,
            None,
        )
    }

    pub fn save_restored_document_revision(
        &mut self,
        document: &DocumentEnvelope,
        expected_revision: Revision,
        source_revision: Revision,
        saved_at_unix_ms: i64,
    ) -> Result<(), StoreError> {
        self.save_document_with_activity(
            document,
            Some(expected_revision),
            saved_at_unix_ms,
            "restored_revision",
            Some(source_revision),
        )
    }

    fn save_document_with_activity(
        &mut self,
        document: &DocumentEnvelope,
        expected_revision: Option<Revision>,
        saved_at_unix_ms: i64,
        activity_kind: &str,
        source_revision: Option<Revision>,
    ) -> Result<(), StoreError> {
        if saved_at_unix_ms < 0 {
            return Err(StoreError::new(StoreErrorCode::InvalidStoredData));
        }
        let payload = serde_json::to_vec(document)
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
        let id = document.id().to_string();
        let revision = i64::try_from(document.revision().get())
            .map_err(|_| StoreError::new(StoreErrorCode::RevisionConflict))?;

        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;

        let changed = match expected_revision {
            None if document.revision().get() == 1 => {
                queries::insert_document(&transaction, &id, revision, &payload)
                    .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
            }
            Some(expected) if document.revision().get() == expected.get().saturating_add(1) => {
                let expected = i64::try_from(expected.get())
                    .map_err(|_| StoreError::new(StoreErrorCode::RevisionConflict))?;
                queries::update_document(&transaction, &id, revision, &payload, expected)
                    .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
            }
            _ => 0,
        };

        if changed != 1 {
            return Err(StoreError::new(StoreErrorCode::RevisionConflict));
        }
        let source_revision = source_revision
            .map(|value| i64::try_from(value.get()))
            .transpose()
            .map_err(|_| StoreError::new(StoreErrorCode::RevisionConflict))?;
        if queries::insert_document_revision(
            &transaction,
            &id,
            revision,
            saved_at_unix_ms,
            &payload,
        )
        .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
            != 1
            || queries::insert_document_activity(
                &transaction,
                &id,
                activity_kind,
                revision,
                source_revision,
                saved_at_unix_ms,
            )
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
                != 1
        {
            return Err(StoreError::new(StoreErrorCode::StorageUnavailable));
        }
        transaction
            .commit()
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))
    }

    pub fn initialize_project(&mut self, metadata: &ProjectMetadata) -> Result<(), StoreError> {
        let payload = serde_json::to_vec(metadata)
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
        let changed = queries::insert_project(&self.connection, &payload)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        if changed != 1 {
            return Err(StoreError::new(StoreErrorCode::AlreadyExists));
        }
        Ok(())
    }

    pub fn load_project(&self) -> Result<Option<ProjectMetadata>, StoreError> {
        queries::load_project(&self.connection)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
            .map(|payload| {
                serde_json::from_slice(&payload)
                    .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))
            })
            .transpose()
    }

    pub fn save_project(&mut self, metadata: &ProjectMetadata) -> Result<(), StoreError> {
        let payload = serde_json::to_vec(metadata)
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
        let changed = queries::update_project(&self.connection, &payload)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        if changed != 1 {
            return Err(StoreError::new(StoreErrorCode::NotFound));
        }
        Ok(())
    }

    pub fn load_document(&self, id: LocalId) -> Result<Option<DocumentEnvelope>, StoreError> {
        let payload = queries::load_document(&self.connection, &id.to_string())
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;

        payload
            .map(|payload| {
                serde_json::from_slice(&payload)
                    .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))
            })
            .transpose()
    }

    pub fn load_document_record(
        &self,
        id: LocalId,
    ) -> Result<Option<DocumentEnvelope>, StoreError> {
        let payload = queries::load_document_record(&self.connection, &id.to_string())
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;

        payload
            .map(|payload| {
                serde_json::from_slice(&payload)
                    .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))
            })
            .transpose()
    }

    pub fn list_documents(&self) -> Result<Vec<DocumentEnvelope>, StoreError> {
        queries::list_documents(&self.connection)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
            .into_iter()
            .map(|payload| {
                serde_json::from_slice(&payload)
                    .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))
            })
            .collect()
    }

    pub fn reserve_report_number(
        &mut self,
        prefix: &str,
        minimum_next: u64,
    ) -> Result<u64, StoreError> {
        if !(2..=12).contains(&prefix.len())
            || !prefix
                .bytes()
                .next()
                .is_some_and(|byte| byte.is_ascii_uppercase())
            || !prefix
                .chars()
                .all(|character| character.is_ascii_uppercase() || character.is_ascii_digit())
            || minimum_next == 0
        {
            return Err(StoreError::new(StoreErrorCode::InvalidStoredData));
        }
        let minimum_next = i64::try_from(minimum_next)
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        let stored_next = queries::load_report_number_sequence(&transaction, prefix)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
            .unwrap_or(1);
        if stored_next < 1 {
            return Err(StoreError::new(StoreErrorCode::InvalidStoredData));
        }
        let allocated = stored_next.max(minimum_next);
        let next_value = allocated
            .checked_add(1)
            .ok_or_else(|| StoreError::new(StoreErrorCode::InvalidStoredData))?;
        if queries::upsert_report_number_sequence(&transaction, prefix, next_value)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
            != 1
        {
            return Err(StoreError::new(StoreErrorCode::StorageUnavailable));
        }
        transaction
            .commit()
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        u64::try_from(allocated).map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))
    }

    pub fn save_brand_profile(
        &mut self,
        profile: &BrandProfile,
        expected_revision: Option<Revision>,
    ) -> Result<(), StoreError> {
        let payload = encode_payload(profile)?;
        self.save_revisioned_payload(
            profile.id(),
            profile.revision(),
            expected_revision,
            profile.updated_at_unix_ms(),
            None,
            &payload,
            queries::insert_brand_profile,
            queries::update_brand_profile,
            queries::insert_brand_profile_revision,
        )
    }

    pub fn load_brand_profile(&self, id: LocalId) -> Result<Option<BrandProfile>, StoreError> {
        decode_optional_payload(
            queries::load_brand_profile(&self.connection, &id.to_string())
                .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?,
        )
    }

    pub fn load_brand_profile_revision(
        &self,
        id: LocalId,
        revision: Revision,
    ) -> Result<Option<BrandProfile>, StoreError> {
        decode_optional_payload(
            queries::load_brand_profile_revision(
                &self.connection,
                &id.to_string(),
                revision_to_i64(revision)?,
            )
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?,
        )
    }

    pub fn list_brand_profiles(&self) -> Result<Vec<BrandProfile>, StoreError> {
        decode_payloads(
            queries::list_brand_profiles(&self.connection)
                .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?,
        )
    }

    pub fn save_brand_asset(
        &self,
        metadata: &BrandAssetMetadata,
        payload: &[u8],
    ) -> Result<(), StoreError> {
        let byte_len = u64::try_from(payload.len())
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidAttachment))?;
        if byte_len != metadata.byte_len()
            || ImageMediaType::detect(payload).ok() != Some(metadata.media_type())
        {
            return Err(StoreError::new(StoreErrorCode::InvalidAttachment));
        }
        let byte_len = i64::try_from(byte_len)
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidAttachment))?;
        let changed = queries::insert_brand_asset(
            &self.connection,
            queries::BrandAssetInsert {
                id: &metadata.id().to_string(),
                profile_id: &metadata.profile_id().to_string(),
                role: brand_asset_role_name(metadata.role()),
                media_type: metadata.media_type().as_str(),
                file_name: metadata.file_name(),
                byte_len,
                payload,
            },
        )
        .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        if changed != 1 {
            return Err(StoreError::new(StoreErrorCode::AlreadyExists));
        }
        Ok(())
    }

    pub fn load_brand_asset(
        &self,
        profile_id: LocalId,
        asset_id: LocalId,
    ) -> Result<Option<(BrandAssetMetadata, Vec<u8>)>, StoreError> {
        let stored = queries::load_brand_asset(
            &self.connection,
            &profile_id.to_string(),
            &asset_id.to_string(),
        )
        .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        stored
            .map(|stored| {
                let role = match stored.role.as_str() {
                    "logo" => BrandAssetRole::Logo,
                    "compact_mark" => BrandAssetRole::CompactMark,
                    "cover_artwork" => BrandAssetRole::CoverArtwork,
                    _ => return Err(StoreError::new(StoreErrorCode::InvalidStoredData)),
                };
                let media_type = match stored.media_type.as_str() {
                    "image/png" => ImageMediaType::Png,
                    "image/jpeg" => ImageMediaType::Jpeg,
                    "image/webp" => ImageMediaType::Webp,
                    _ => return Err(StoreError::new(StoreErrorCode::InvalidStoredData)),
                };
                let byte_len = u64::try_from(stored.byte_len)
                    .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
                if u64::try_from(stored.payload.len()).ok() != Some(byte_len)
                    || ImageMediaType::detect(&stored.payload).ok() != Some(media_type)
                {
                    return Err(StoreError::new(StoreErrorCode::InvalidStoredData));
                }
                let metadata = BrandAssetMetadata::new(
                    asset_id,
                    profile_id,
                    role,
                    media_type,
                    stored.file_name,
                    byte_len,
                )
                .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
                Ok((metadata, stored.payload))
            })
            .transpose()
    }

    pub fn save_publication_record(&self, record: &PublicationRecord) -> Result<(), StoreError> {
        let payload = encode_payload(record)?;
        let changed = queries::insert_publication_record(
            &self.connection,
            &record.id().to_string(),
            record.snapshot().created_at_unix_ms(),
            &payload,
        )
        .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        if changed != 1 {
            return Err(StoreError::new(StoreErrorCode::AlreadyExists));
        }
        Ok(())
    }

    pub fn list_publication_records(&self) -> Result<Vec<PublicationRecord>, StoreError> {
        decode_payloads(
            queries::list_publication_records(&self.connection)
                .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn save_revisioned_payload(
        &mut self,
        id: LocalId,
        revision: Revision,
        expected_revision: Option<Revision>,
        saved_at_unix_ms: i64,
        deleted_or_archived_at_unix_ms: Option<i64>,
        payload: &[u8],
        insert: RevisionedInsert,
        update: RevisionedUpdate,
        insert_revision: RevisionedHistoryInsert,
    ) -> Result<(), StoreError> {
        if saved_at_unix_ms < 0 || deleted_or_archived_at_unix_ms.is_some() {
            return Err(StoreError::new(StoreErrorCode::InvalidStoredData));
        }
        let revision_value = revision_to_i64(revision)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        let id = id.to_string();
        let changed = match expected_revision {
            None if revision.get() == 1 => insert(&transaction, &id, revision_value, payload),
            Some(expected) if revision.get() == expected.get().saturating_add(1) => update(
                &transaction,
                &id,
                revision_value,
                payload,
                revision_to_i64(expected)?,
            ),
            _ => return Err(StoreError::new(StoreErrorCode::RevisionConflict)),
        }
        .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        if changed != 1 {
            return Err(StoreError::new(StoreErrorCode::RevisionConflict));
        }
        if insert_revision(&transaction, &id, revision_value, saved_at_unix_ms, payload)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
            != 1
        {
            return Err(StoreError::new(StoreErrorCode::StorageUnavailable));
        }
        transaction
            .commit()
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))
    }

    pub fn create_graph_workspace(
        &mut self,
        workspace: &GraphWorkspace,
        items: &[WorkspaceItem],
    ) -> Result<(), StoreError> {
        GraphWorkspaceSnapshot::new(workspace.clone(), items.to_vec(), Vec::new())
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
        if items.len() > MAX_GRAPH_WORKSPACE_ITEMS {
            return Err(StoreError::new(StoreErrorCode::InvalidStoredData));
        }
        let payload = encode_graph_workspace(workspace)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        if queries::insert_graph_workspace(
            &transaction,
            &workspace.id().to_string(),
            revision_to_i64(workspace.revision())?,
            workspace.deleted_at_unix_ms(),
            &payload,
        )
        .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
            != 1
        {
            return Err(StoreError::new(StoreErrorCode::AlreadyExists));
        }
        for item in items {
            if queries::insert_graph_workspace_item(
                &transaction,
                &workspace.id().to_string(),
                &item.item_id().to_string(),
                workspace_item_kind_name(item.item_kind()),
                item.position().x,
                item.position().y,
                item.pinned(),
            )
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
                != 1
            {
                return Err(StoreError::new(StoreErrorCode::AlreadyExists));
            }
        }
        transaction
            .commit()
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))
    }

    pub fn list_graph_workspaces(
        &self,
        include_deleted: bool,
    ) -> Result<Vec<GraphWorkspace>, StoreError> {
        queries::list_graph_workspaces(&self.connection, include_deleted)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
            .into_iter()
            .map(|payload| decode_graph_workspace(&payload))
            .collect()
    }

    pub fn load_graph_workspace(
        &self,
        workspace_id: LocalId,
        include_deleted: bool,
    ) -> Result<Option<GraphWorkspaceSnapshot>, StoreError> {
        let Some(payload) = queries::load_graph_workspace(
            &self.connection,
            &workspace_id.to_string(),
            include_deleted,
        )
        .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
        else {
            return Ok(None);
        };
        let workspace = decode_graph_workspace(&payload)?;
        let items =
            queries::list_graph_workspace_items(&self.connection, &workspace_id.to_string())
                .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
                .into_iter()
                .map(|row| {
                    let item_id = LocalId::parse(&row.item_id)
                        .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
                    let item_kind = parse_workspace_item_kind(&row.item_kind)?;
                    let position = Position::new(row.x, row.y)
                        .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
                    Ok(WorkspaceItem::new(
                        workspace_id,
                        item_id,
                        item_kind,
                        position,
                        row.pinned,
                    ))
                })
                .collect::<Result<Vec<_>, StoreError>>()?;
        let visual_links =
            queries::list_graph_visual_links(&self.connection, &workspace_id.to_string())
                .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
                .into_iter()
                .map(|row| {
                    VisualLink::new(
                        LocalId::parse(&row.id)
                            .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?,
                        workspace_id,
                        LocalId::parse(&row.source_id)
                            .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?,
                        LocalId::parse(&row.target_id)
                            .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?,
                        row.label.as_deref(),
                    )
                    .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))
                })
                .collect::<Result<Vec<_>, StoreError>>()?;
        GraphWorkspaceSnapshot::new(workspace, items, visual_links)
            .map(Some)
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))
    }

    pub fn rename_graph_workspace(
        &mut self,
        workspace_id: LocalId,
        expected_revision: Revision,
        name: impl AsRef<str>,
        now_unix_ms: i64,
    ) -> Result<GraphWorkspace, StoreError> {
        let current = self.require_graph_workspace(workspace_id, false)?;
        require_graph_revision(&current, expected_revision)?;
        let revised = current
            .revised(
                name,
                current.mode(),
                current.viewport(),
                now_unix_ms,
                current.deleted_at_unix_ms(),
            )
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
        self.save_graph_workspace_revision(&revised, expected_revision)?;
        Ok(revised)
    }

    pub fn set_graph_workspace_deleted(
        &mut self,
        workspace_id: LocalId,
        expected_revision: Revision,
        deleted: bool,
        now_unix_ms: i64,
    ) -> Result<GraphWorkspace, StoreError> {
        let current = self.require_graph_workspace(workspace_id, true)?;
        require_graph_revision(&current, expected_revision)?;
        if current.deleted_at_unix_ms().is_some() == deleted {
            return Err(StoreError::new(StoreErrorCode::RevisionConflict));
        }
        let revised = current
            .revised(
                current.name(),
                current.mode(),
                current.viewport(),
                now_unix_ms,
                deleted.then_some(now_unix_ms),
            )
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
        self.save_graph_workspace_revision(&revised, expected_revision)?;
        Ok(revised)
    }

    pub fn create_visual_link(
        &mut self,
        workspace_id: LocalId,
        expected_revision: Revision,
        link: &VisualLink,
        now_unix_ms: i64,
    ) -> Result<GraphWorkspace, StoreError> {
        let snapshot = self
            .load_graph_workspace(workspace_id, false)?
            .ok_or_else(|| StoreError::new(StoreErrorCode::NotFound))?;
        let current = snapshot.workspace();
        require_graph_revision(current, expected_revision)?;
        if link.workspace_id() != workspace_id
            || !snapshot
                .items()
                .iter()
                .any(|item| item.item_id() == link.source_id())
            || !snapshot
                .items()
                .iter()
                .any(|item| item.item_id() == link.target_id())
            || snapshot.visual_links().len() >= MAX_GRAPH_VISUAL_LINKS
        {
            return Err(StoreError::new(StoreErrorCode::InvalidStoredData));
        }
        let revised = current
            .revised(
                current.name(),
                current.mode(),
                current.viewport(),
                now_unix_ms,
                None,
            )
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
        let payload = encode_graph_workspace(&revised)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        let count = queries::count_graph_visual_links(&transaction, &workspace_id.to_string())
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        if usize::try_from(count)
            .ok()
            .is_none_or(|count| count >= MAX_GRAPH_VISUAL_LINKS)
        {
            return Err(StoreError::new(StoreErrorCode::InvalidStoredData));
        }
        if queries::insert_graph_visual_link(
            &transaction,
            &link.id().to_string(),
            &workspace_id.to_string(),
            &link.source_id().to_string(),
            &link.target_id().to_string(),
            link.label(),
        )
        .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
            != 1
        {
            return Err(StoreError::new(StoreErrorCode::AlreadyExists));
        }
        update_graph_workspace_row(&transaction, &revised, expected_revision, &payload)?;
        transaction
            .commit()
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        Ok(revised)
    }

    pub fn add_graph_workspace_items(
        &mut self,
        workspace_id: LocalId,
        expected_revision: Revision,
        items: &[WorkspaceItem],
        now_unix_ms: i64,
    ) -> Result<GraphWorkspace, StoreError> {
        if items.is_empty() || items.len() > MAX_GRAPH_MUTATION_BATCH {
            return Err(StoreError::new(StoreErrorCode::InvalidStoredData));
        }
        let unique = items
            .iter()
            .map(WorkspaceItem::item_id)
            .collect::<HashSet<_>>();
        if unique.len() != items.len()
            || items.iter().any(|item| item.workspace_id() != workspace_id)
        {
            return Err(StoreError::new(StoreErrorCode::InvalidStoredData));
        }
        let current = self.require_graph_workspace(workspace_id, false)?;
        require_graph_revision(&current, expected_revision)?;
        let revised = current
            .revised(
                current.name(),
                current.mode(),
                current.viewport(),
                now_unix_ms,
                None,
            )
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
        let payload = encode_graph_workspace(&revised)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        let count = queries::count_graph_workspace_items(&transaction, &workspace_id.to_string())
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        let count = usize::try_from(count)
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
        if count.saturating_add(items.len()) > MAX_GRAPH_WORKSPACE_ITEMS {
            return Err(StoreError::new(StoreErrorCode::InvalidStoredData));
        }
        for item in items {
            if queries::insert_graph_workspace_item(
                &transaction,
                &workspace_id.to_string(),
                &item.item_id().to_string(),
                workspace_item_kind_name(item.item_kind()),
                item.position().x,
                item.position().y,
                item.pinned(),
            )
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
                != 1
            {
                return Err(StoreError::new(StoreErrorCode::AlreadyExists));
            }
        }
        update_graph_workspace_row(&transaction, &revised, expected_revision, &payload)?;
        transaction
            .commit()
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        Ok(revised)
    }

    pub fn save_graph_workspace_state(
        &mut self,
        workspace_id: LocalId,
        expected_revision: Revision,
        mode: WorkspaceMode,
        viewport: GraphViewport,
        items: &[WorkspaceItem],
        now_unix_ms: i64,
    ) -> Result<GraphWorkspace, StoreError> {
        if items.len() > MAX_GRAPH_MUTATION_BATCH
            || items.iter().any(|item| item.workspace_id() != workspace_id)
            || items
                .iter()
                .map(WorkspaceItem::item_id)
                .collect::<HashSet<_>>()
                .len()
                != items.len()
        {
            return Err(StoreError::new(StoreErrorCode::InvalidStoredData));
        }
        let current = self.require_graph_workspace(workspace_id, false)?;
        require_graph_revision(&current, expected_revision)?;
        let revised = current
            .revised(current.name(), mode, viewport, now_unix_ms, None)
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
        let payload = encode_graph_workspace(&revised)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        for item in items {
            if queries::update_graph_workspace_item(
                &transaction,
                &workspace_id.to_string(),
                &item.item_id().to_string(),
                item.position().x,
                item.position().y,
                item.pinned(),
            )
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
                != 1
            {
                return Err(StoreError::new(StoreErrorCode::NotFound));
            }
        }
        update_graph_workspace_row(&transaction, &revised, expected_revision, &payload)?;
        transaction
            .commit()
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        Ok(revised)
    }

    pub fn remove_graph_workspace_items(
        &mut self,
        workspace_id: LocalId,
        expected_revision: Revision,
        item_ids: &[LocalId],
        now_unix_ms: i64,
    ) -> Result<GraphWorkspace, StoreError> {
        if item_ids.is_empty()
            || item_ids.len() > MAX_GRAPH_MUTATION_BATCH
            || item_ids.iter().copied().collect::<HashSet<_>>().len() != item_ids.len()
        {
            return Err(StoreError::new(StoreErrorCode::InvalidStoredData));
        }
        let current = self.require_graph_workspace(workspace_id, false)?;
        require_graph_revision(&current, expected_revision)?;
        let revised = current
            .revised(
                current.name(),
                current.mode(),
                current.viewport(),
                now_unix_ms,
                None,
            )
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
        let payload = encode_graph_workspace(&revised)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        for item_id in item_ids {
            if queries::delete_graph_workspace_item(
                &transaction,
                &workspace_id.to_string(),
                &item_id.to_string(),
            )
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
                != 1
            {
                return Err(StoreError::new(StoreErrorCode::NotFound));
            }
        }
        update_graph_workspace_row(&transaction, &revised, expected_revision, &payload)?;
        transaction
            .commit()
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        Ok(revised)
    }

    pub fn update_visual_link(
        &mut self,
        workspace_id: LocalId,
        expected_revision: Revision,
        link: &VisualLink,
        now_unix_ms: i64,
    ) -> Result<GraphWorkspace, StoreError> {
        let snapshot = self
            .load_graph_workspace(workspace_id, false)?
            .ok_or_else(|| StoreError::new(StoreErrorCode::NotFound))?;
        require_graph_revision(snapshot.workspace(), expected_revision)?;
        if link.workspace_id() != workspace_id
            || !snapshot
                .items()
                .iter()
                .any(|item| item.item_id() == link.source_id())
            || !snapshot
                .items()
                .iter()
                .any(|item| item.item_id() == link.target_id())
        {
            return Err(StoreError::new(StoreErrorCode::InvalidStoredData));
        }
        let current = snapshot.workspace();
        let revised = current
            .revised(
                current.name(),
                current.mode(),
                current.viewport(),
                now_unix_ms,
                None,
            )
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
        let payload = encode_graph_workspace(&revised)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        if queries::update_graph_visual_link(
            &transaction,
            &link.id().to_string(),
            &workspace_id.to_string(),
            &link.source_id().to_string(),
            &link.target_id().to_string(),
            link.label(),
        )
        .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
            != 1
        {
            return Err(StoreError::new(StoreErrorCode::NotFound));
        }
        update_graph_workspace_row(&transaction, &revised, expected_revision, &payload)?;
        transaction
            .commit()
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        Ok(revised)
    }

    pub fn delete_visual_link(
        &mut self,
        workspace_id: LocalId,
        expected_revision: Revision,
        link_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<GraphWorkspace, StoreError> {
        let current = self.require_graph_workspace(workspace_id, false)?;
        require_graph_revision(&current, expected_revision)?;
        let revised = current
            .revised(
                current.name(),
                current.mode(),
                current.viewport(),
                now_unix_ms,
                None,
            )
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
        let payload = encode_graph_workspace(&revised)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        if queries::delete_graph_visual_link(
            &transaction,
            &link_id.to_string(),
            &workspace_id.to_string(),
        )
        .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
            != 1
        {
            return Err(StoreError::new(StoreErrorCode::NotFound));
        }
        update_graph_workspace_row(&transaction, &revised, expected_revision, &payload)?;
        transaction
            .commit()
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        Ok(revised)
    }

    fn require_graph_workspace(
        &self,
        workspace_id: LocalId,
        include_deleted: bool,
    ) -> Result<GraphWorkspace, StoreError> {
        self.load_graph_workspace(workspace_id, include_deleted)?
            .map(|snapshot| snapshot.workspace().clone())
            .ok_or_else(|| StoreError::new(StoreErrorCode::NotFound))
    }

    fn save_graph_workspace_revision(
        &mut self,
        workspace: &GraphWorkspace,
        expected_revision: Revision,
    ) -> Result<(), StoreError> {
        let payload = encode_graph_workspace(workspace)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        update_graph_workspace_row(&transaction, workspace, expected_revision, &payload)?;
        transaction
            .commit()
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))
    }

    pub fn save_technique_observation(
        &mut self,
        observation: &TechniqueObservation,
        expected_revision: Option<Revision>,
    ) -> Result<(), StoreError> {
        let payload = serde_json::to_vec(observation)
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
        let id = observation.id().to_string();
        let revision = revision_to_i64(observation.revision())?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;

        let changed = match expected_revision {
            None if observation.revision().get() == 1 => {
                queries::insert_technique_observation(&transaction, &id, revision, &payload)
            }
            Some(expected) if observation.revision().get() == expected.get().saturating_add(1) => {
                queries::update_technique_observation(
                    &transaction,
                    &id,
                    revision,
                    &payload,
                    revision_to_i64(expected)?,
                )
            }
            _ => return Err(StoreError::new(StoreErrorCode::RevisionConflict)),
        }
        .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;

        if changed != 1 {
            return Err(StoreError::new(StoreErrorCode::RevisionConflict));
        }
        transaction
            .commit()
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))
    }

    pub fn list_technique_observations(&self) -> Result<Vec<TechniqueObservation>, StoreError> {
        queries::list_technique_observations(&self.connection)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
            .into_iter()
            .map(|payload| {
                serde_json::from_slice(&payload)
                    .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))
            })
            .collect()
    }

    pub fn import_technique_observations(
        &mut self,
        observations: &[TechniqueObservation],
        replace_existing: bool,
    ) -> Result<(usize, usize), StoreError> {
        let encoded = observations
            .iter()
            .map(|observation| {
                Ok((
                    observation.id().to_string(),
                    revision_to_i64(observation.revision())?,
                    serde_json::to_vec(observation)
                        .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?,
                ))
            })
            .collect::<Result<Vec<_>, StoreError>>()?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        let mut imported = 0;
        for (id, revision, payload) in &encoded {
            imported += queries::import_technique_observation(
                &transaction,
                id,
                *revision,
                payload,
                replace_existing,
            )
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        }
        transaction
            .commit()
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        Ok((imported, observations.len().saturating_sub(imported)))
    }

    pub fn delete_technique_observation(
        &mut self,
        id: LocalId,
        expected_revision: Revision,
    ) -> Result<(), StoreError> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        let changed = queries::delete_technique_observation(
            &transaction,
            &id.to_string(),
            revision_to_i64(expected_revision)?,
        )
        .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        if changed != 1 {
            return Err(StoreError::new(StoreErrorCode::RevisionConflict));
        }
        transaction
            .commit()
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))
    }

    pub fn commit_stix_import(&mut self, commit: &ImportCommit) -> Result<(), StoreError> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;

        for imported in commit.upserts() {
            let object = ExistingStixObject::new(imported.local_id(), imported.raw().clone())
                .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
            store_stix_object(&transaction, &object)?;
        }

        transaction
            .commit()
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))
    }

    pub fn promote_stix_drafts(
        &mut self,
        objects: &[ExistingStixObject],
    ) -> Result<(), StoreError> {
        if objects.is_empty() {
            return Ok(());
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        for object in objects {
            store_stix_object(&transaction, object)?;
            let deleted = queries::delete_stix_draft(&transaction, &object.local_id().to_string())
                .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
            if deleted != 1 {
                return Err(StoreError::new(StoreErrorCode::NotFound));
            }
        }
        transaction
            .commit()
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))
    }

    pub fn list_stix_objects(&self) -> Result<Vec<ExistingStixObject>, StoreError> {
        queries::list_stix_objects(&self.connection)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
            .into_iter()
            .map(|row| {
                let local_id = LocalId::parse(&row.local_id)
                    .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
                let raw = serde_json::from_slice(&row.payload)
                    .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
                ExistingStixObject::new(local_id, raw)
                    .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))
            })
            .collect()
    }

    pub fn delete_stix_object(&self, id: LocalId) -> Result<bool, StoreError> {
        queries::delete_stix_object(&self.connection, &id.to_string())
            .map(|changed| changed == 1)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))
    }

    pub fn delete_stix_object_and_remove_projection_memberships(
        &mut self,
        id: LocalId,
        projection_workspace_name: &str,
        now_unix_ms: i64,
    ) -> Result<bool, StoreError> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        let deleted = queries::delete_stix_object_in_transaction(&transaction, &id.to_string())
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        if deleted != 1 {
            return Ok(false);
        }

        let workspaces = queries::list_graph_workspaces(&transaction, false)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        for payload in workspaces {
            let workspace = decode_graph_workspace(&payload)?;
            if workspace.name() != projection_workspace_name {
                continue;
            }
            let removed = queries::delete_graph_workspace_item(
                &transaction,
                &workspace.id().to_string(),
                &id.to_string(),
            )
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
            if removed == 0 {
                continue;
            }
            let revised = workspace
                .revised(
                    workspace.name(),
                    workspace.mode(),
                    workspace.viewport(),
                    now_unix_ms,
                    None,
                )
                .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
            let revised_payload = encode_graph_workspace(&revised)?;
            update_graph_workspace_row(
                &transaction,
                &revised,
                workspace.revision(),
                &revised_payload,
            )?;
        }

        transaction
            .commit()
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        Ok(true)
    }

    pub fn save_stix_draft(&self, draft: &StixDraft) -> Result<(), StoreError> {
        let properties = serde_json::to_vec(draft.properties())
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
        let semantic_relationship = draft
            .semantic_relationship()
            .map(serde_json::to_vec)
            .transpose()
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
        queries::upsert_stix_draft(
            &self.connection,
            &draft.local_id().to_string(),
            draft.object_type(),
            &properties,
            semantic_relationship.as_deref(),
            draft.replaces_stix_id(),
        )
        .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        Ok(())
    }

    pub fn list_stix_drafts(&self) -> Result<Vec<StixDraft>, StoreError> {
        queries::list_stix_drafts(&self.connection)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
            .into_iter()
            .map(|row| {
                let local_id = LocalId::parse(&row.local_id)
                    .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
                let properties = serde_json::from_slice(&row.properties)
                    .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
                let semantic_relationship = row
                    .semantic_relationship
                    .map(|payload| serde_json::from_slice::<SemanticRelationshipDraft>(&payload))
                    .transpose()
                    .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
                StixDraft::restore(
                    local_id,
                    row.object_type,
                    properties,
                    semantic_relationship,
                    row.replaces_stix_id,
                )
                .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))
            })
            .collect()
    }

    pub fn delete_stix_draft(&self, id: LocalId) -> Result<bool, StoreError> {
        queries::delete_stix_draft(&self.connection, &id.to_string())
            .map(|changed| changed == 1)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))
    }

    pub fn load_document_revision(
        &self,
        id: LocalId,
        revision: Revision,
    ) -> Result<Option<DocumentEnvelope>, StoreError> {
        let revision = revision_to_i64(revision)?;
        queries::load_document_revision(&self.connection, &id.to_string(), revision)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
            .map(|payload| {
                serde_json::from_slice(&payload)
                    .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))
            })
            .transpose()
    }

    pub fn load_document_revision_for_publication(
        &self,
        id: LocalId,
        revision: Revision,
    ) -> Result<Option<DocumentEnvelope>, StoreError> {
        let revision = revision_to_i64(revision)?;
        queries::load_document_revision_for_publication(&self.connection, &id.to_string(), revision)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
            .map(|payload| {
                serde_json::from_slice(&payload)
                    .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))
            })
            .transpose()
    }

    pub fn list_document_revisions(
        &self,
        id: LocalId,
    ) -> Result<Vec<DocumentRevisionSummary>, StoreError> {
        queries::list_document_revisions(&self.connection, &id.to_string())
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
            .into_iter()
            .map(|row| {
                Ok(DocumentRevisionSummary::new(
                    revision_from_i64(row.revision)?,
                    row.saved_at_unix_ms,
                ))
            })
            .collect()
    }

    pub fn list_document_activity(
        &self,
        id: LocalId,
    ) -> Result<Vec<DocumentActivityEntry>, StoreError> {
        queries::list_document_activity(&self.connection, &id.to_string())
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
            .into_iter()
            .map(|row| {
                let kind = match row.kind.as_str() {
                    "created" => DocumentActivityKind::Created,
                    "edited" => DocumentActivityKind::Edited,
                    "deleted" => DocumentActivityKind::Deleted,
                    "restored" => DocumentActivityKind::Restored,
                    "restored_revision" => DocumentActivityKind::RestoredRevision,
                    _ => return Err(StoreError::new(StoreErrorCode::InvalidStoredData)),
                };
                let sequence = u64::try_from(row.sequence)
                    .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
                let source_revision = row.source_revision.map(revision_from_i64).transpose()?;
                Ok(DocumentActivityEntry::new(
                    sequence,
                    kind,
                    revision_from_i64(row.revision)?,
                    source_revision,
                    row.occurred_at_unix_ms,
                ))
            })
            .collect()
    }

    pub fn soft_delete_document(
        &mut self,
        id: LocalId,
        deleted_at_unix_ms: i64,
    ) -> Result<bool, StoreError> {
        if deleted_at_unix_ms < 0 {
            return Err(StoreError::new(StoreErrorCode::InvalidStoredData));
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        let id = id.to_string();
        let Some(revision) = queries::active_document_revision(&transaction, &id)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
        else {
            return Ok(false);
        };
        if queries::soft_delete_document(&transaction, &id, deleted_at_unix_ms)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
            != 1
            || queries::insert_document_activity(
                &transaction,
                &id,
                "deleted",
                revision,
                None,
                deleted_at_unix_ms,
            )
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
                != 1
        {
            return Err(StoreError::new(StoreErrorCode::StorageUnavailable));
        }
        transaction
            .commit()
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        Ok(true)
    }

    pub fn restore_document(
        &mut self,
        id: LocalId,
        restored_at_unix_ms: i64,
    ) -> Result<bool, StoreError> {
        if restored_at_unix_ms < 0 {
            return Err(StoreError::new(StoreErrorCode::InvalidStoredData));
        }
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        let id = id.to_string();
        let Some(revision) = queries::deleted_document_revision(&transaction, &id)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
        else {
            return Ok(false);
        };
        if queries::restore_document(&transaction, &id)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
            != 1
            || queries::insert_document_activity(
                &transaction,
                &id,
                "restored",
                revision,
                None,
                restored_at_unix_ms,
            )
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
                != 1
        {
            return Err(StoreError::new(StoreErrorCode::StorageUnavailable));
        }
        transaction
            .commit()
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        Ok(true)
    }

    pub fn delete_document(&self, id: LocalId) -> Result<bool, StoreError> {
        queries::delete_document(&self.connection, &id.to_string())
            .map(|changed| changed == 1)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))
    }

    pub fn save_image_attachment(
        &self,
        metadata: &ImageAttachmentMetadata,
        payload: &[u8],
    ) -> Result<(), StoreError> {
        let byte_len = u64::try_from(payload.len())
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidAttachment))?;
        if byte_len != metadata.byte_len()
            || ImageMediaType::detect(payload).ok() != Some(metadata.media_type())
        {
            return Err(StoreError::new(StoreErrorCode::InvalidAttachment));
        }
        let byte_len = i64::try_from(byte_len)
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidAttachment))?;
        let changed = queries::insert_image_attachment(
            &self.connection,
            &metadata.id().to_string(),
            &metadata.document_id().to_string(),
            metadata.media_type().as_str(),
            metadata.file_name(),
            byte_len,
            payload,
        )
        .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        if changed != 1 {
            return Err(StoreError::new(StoreErrorCode::AlreadyExists));
        }
        Ok(())
    }

    pub fn load_image_attachment(
        &self,
        document_id: LocalId,
        attachment_id: LocalId,
    ) -> Result<Option<(ImageAttachmentMetadata, Vec<u8>)>, StoreError> {
        let stored = queries::load_image_attachment(
            &self.connection,
            &document_id.to_string(),
            &attachment_id.to_string(),
        )
        .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        stored
            .map(|stored| {
                let media_type = match stored.media_type.as_str() {
                    "image/png" => ImageMediaType::Png,
                    "image/jpeg" => ImageMediaType::Jpeg,
                    "image/webp" => ImageMediaType::Webp,
                    _ => return Err(StoreError::new(StoreErrorCode::InvalidStoredData)),
                };
                let byte_len = u64::try_from(stored.byte_len)
                    .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
                if u64::try_from(stored.payload.len()).ok() != Some(byte_len)
                    || ImageMediaType::detect(&stored.payload).ok() != Some(media_type)
                {
                    return Err(StoreError::new(StoreErrorCode::InvalidStoredData));
                }
                let metadata = ImageAttachmentMetadata::new(
                    attachment_id,
                    document_id,
                    media_type,
                    stored.file_name,
                    byte_len,
                )
                .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
                Ok((metadata, stored.payload))
            })
            .transpose()
    }

    pub fn save_evidence_file(
        &self,
        metadata: &EvidenceFileMetadata,
        payload: &[u8],
    ) -> Result<(), StoreError> {
        let byte_len = u64::try_from(payload.len())
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidAttachment))?;
        if byte_len != metadata.byte_len()
            || detect_evidence_media_type(metadata.file_name(), payload).ok()
                != Some(metadata.media_type())
            || format!("{:x}", Sha256::digest(payload)) != metadata.sha256()
        {
            return Err(StoreError::new(StoreErrorCode::InvalidAttachment));
        }
        let byte_len = i64::try_from(byte_len)
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidAttachment))?;
        let changed = queries::insert_evidence_file(
            &self.connection,
            queries::EvidenceFileInsert {
                id: &metadata.id().to_string(),
                media_type: metadata.media_type(),
                file_name: metadata.file_name(),
                byte_len,
                sha256: metadata.sha256(),
                title: metadata.title(),
                description: metadata.description(),
                source: metadata.source(),
                captured_at: metadata.captured_at(),
                source_url: metadata.source_url(),
                tags_json: &serde_json::to_string(metadata.tags())
                    .map_err(|_| StoreError::new(StoreErrorCode::InvalidAttachment))?,
                analyst_notes: metadata.analyst_notes(),
                created_at_unix_ms: metadata.created_at_unix_ms(),
                updated_at_unix_ms: metadata.updated_at_unix_ms(),
                payload,
            },
        )
        .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        if changed != 1 {
            return Err(StoreError::new(StoreErrorCode::AlreadyExists));
        }
        Ok(())
    }

    pub fn list_evidence_files(&self) -> Result<Vec<EvidenceFileMetadata>, StoreError> {
        queries::list_evidence_files(&self.connection)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?
            .into_iter()
            .map(evidence_file_metadata_from_row)
            .collect()
    }

    pub fn load_evidence_file(
        &self,
        evidence_id: LocalId,
    ) -> Result<Option<(EvidenceFileMetadata, Vec<u8>)>, StoreError> {
        let stored = queries::load_evidence_file(&self.connection, &evidence_id.to_string())
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        stored
            .map(|stored| {
                let metadata = evidence_file_metadata_from_row(stored.metadata)?;
                if u64::try_from(stored.payload.len()).ok() != Some(metadata.byte_len())
                    || detect_evidence_media_type(metadata.file_name(), &stored.payload).ok()
                        != Some(metadata.media_type())
                    || format!("{:x}", Sha256::digest(&stored.payload)) != metadata.sha256()
                {
                    return Err(StoreError::new(StoreErrorCode::InvalidStoredData));
                }
                Ok((metadata, stored.payload))
            })
            .transpose()
    }

    pub fn update_evidence_metadata(
        &self,
        metadata: &EvidenceFileMetadata,
        expected_revision: Revision,
    ) -> Result<(), StoreError> {
        let row = evidence_file_metadata_row(metadata)?;
        let expected_revision = revision_to_i64(expected_revision)?;
        let changed = queries::update_evidence_metadata(&self.connection, &row, expected_revision)
            .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        if changed != 1 {
            return Err(StoreError::new(StoreErrorCode::RevisionConflict));
        }
        Ok(())
    }

    pub fn delete_evidence_file(
        &self,
        evidence_id: LocalId,
        expected_revision: Revision,
    ) -> Result<(), StoreError> {
        let expected_revision = revision_to_i64(expected_revision)?;
        let changed = queries::delete_evidence_file(
            &self.connection,
            &evidence_id.to_string(),
            expected_revision,
        )
        .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
        if changed != 1 {
            return Err(StoreError::new(StoreErrorCode::RevisionConflict));
        }
        Ok(())
    }

    pub fn backup_to(&self, path: &Path, key: &[u8; 32]) -> Result<(), StoreError> {
        reserve_database_file(path)?;

        let result = (|| {
            let mut destination = open_existing_connection(path)
                .map_err(|_| StoreError::new(StoreErrorCode::BackupFailed))?;
            configure_key_and_verify(&destination, key)
                .map_err(|_| StoreError::new(StoreErrorCode::BackupFailed))?;

            let backup = Backup::new(&self.connection, &mut destination)
                .map_err(|_| StoreError::new(StoreErrorCode::BackupFailed))?;
            backup
                .run_to_completion(128, Duration::from_millis(10), None)
                .map_err(|_| StoreError::new(StoreErrorCode::BackupFailed))?;
            drop(backup);

            destination
                .query_row("SELECT count(*) FROM sqlite_schema", [], |_| Ok(()))
                .map_err(|_| StoreError::new(StoreErrorCode::BackupFailed))?;
            Ok(())
        })();

        if result.is_err() {
            remove_database_files(path);
        }
        result
    }
}

#[derive(Clone, Copy)]
struct Migration {
    version: u32,
    sql: &'static str,
}

fn apply_migrations(
    connection: &mut Connection,
    migrations: &[Migration],
) -> Result<(), StoreError> {
    let current_version = connection
        .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
        .map_err(|_| StoreError::new(StoreErrorCode::MigrationFailed))?;
    let supported_version = migrations.last().map_or(0, |migration| migration.version);
    if current_version > supported_version {
        return Err(StoreError::new(StoreErrorCode::MigrationFailed));
    }

    for migration in migrations
        .iter()
        .filter(|migration| migration.version > current_version)
    {
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| StoreError::new(StoreErrorCode::MigrationFailed))?;
        transaction
            .execute_batch(migration.sql)
            .map_err(|_| StoreError::new(StoreErrorCode::MigrationFailed))?;
        transaction
            .pragma_update(None, "user_version", migration.version)
            .map_err(|_| StoreError::new(StoreErrorCode::MigrationFailed))?;
        transaction
            .commit()
            .map_err(|_| StoreError::new(StoreErrorCode::MigrationFailed))?;
    }
    Ok(())
}

fn reserve_database_file(path: &Path) -> Result<(), StoreError> {
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                StoreError::new(StoreErrorCode::AlreadyExists)
            } else {
                StoreError::new(StoreErrorCode::StorageUnavailable)
            }
        })?;
    set_sensitive_permissions(&file)?;
    Ok(())
}

#[cfg(unix)]
fn set_sensitive_permissions(file: &fs::File) -> Result<(), StoreError> {
    use std::os::unix::fs::PermissionsExt;

    file.set_permissions(fs::Permissions::from_mode(0o600))
        .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))
}

#[cfg(not(unix))]
fn set_sensitive_permissions(_file: &fs::File) -> Result<(), StoreError> {
    Ok(())
}

fn open_existing_connection(path: &Path) -> Result<Connection, StoreError> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))
}

fn configure_key_and_verify(connection: &Connection, key: &[u8; 32]) -> Result<(), StoreError> {
    connection
        .busy_timeout(BUSY_TIMEOUT)
        .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
    // SQLCipher must receive the key before any schema access. The encoded
    // statement is zeroized on drop and is never included in returned errors.
    let key_pragma = key_pragma(key);
    connection
        .execute_batch(key_pragma.as_str())
        .map_err(|_| StoreError::new(StoreErrorCode::InvalidKeyOrCorrupt))?;
    connection
        .query_row("SELECT count(*) FROM sqlite_schema", [], |_| Ok(()))
        .map_err(|_| StoreError::new(StoreErrorCode::InvalidKeyOrCorrupt))?;
    connection
        .pragma_update(None, "cipher_memory_security", true)
        .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
    connection
        .pragma_update(None, "foreign_keys", true)
        .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
    connection
        .pragma_update(None, "secure_delete", true)
        .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
    connection
        .pragma_update(None, "journal_mode", "DELETE")
        .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
    connection
        .pragma_update(None, "synchronous", "FULL")
        .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))
}

fn key_pragma(key: &[u8; 32]) -> Zeroizing<String> {
    // rusqlite cannot bind PRAGMA key as a query parameter. Encode the fixed-size
    // byte array ourselves so no caller-controlled text enters the statement.
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = Zeroizing::new(String::with_capacity(key.len() * 2 + 20));
    encoded.push_str("PRAGMA key = \"x'");
    for byte in key {
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    encoded.push_str("'\";");
    encoded
}

fn evidence_file_metadata_from_row(
    row: queries::EvidenceFileMetadataRow,
) -> Result<EvidenceFileMetadata, StoreError> {
    let id =
        LocalId::parse(&row.id).map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
    let byte_len = u64::try_from(row.byte_len)
        .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
    let revision = Revision::new(
        u64::try_from(row.revision)
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?,
    )
    .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
    let tags = serde_json::from_str::<Vec<String>>(&row.tags_json)
        .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
    let metadata = EvidenceMetadataInput::new(
        row.title,
        row.description,
        row.source,
        row.captured_at,
        row.source_url,
        tags,
        row.analyst_notes,
    )
    .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
    EvidenceFileMetadata::from_parts(
        id,
        revision,
        row.media_type,
        row.file_name,
        byte_len,
        row.sha256,
        metadata,
        row.created_at_unix_ms,
        row.updated_at_unix_ms,
    )
    .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))
}

fn evidence_file_metadata_row(
    metadata: &EvidenceFileMetadata,
) -> Result<queries::EvidenceFileMetadataRow, StoreError> {
    Ok(queries::EvidenceFileMetadataRow {
        id: metadata.id().to_string(),
        revision: revision_to_i64(metadata.revision())?,
        media_type: metadata.media_type().to_owned(),
        file_name: metadata.file_name().to_owned(),
        byte_len: i64::try_from(metadata.byte_len())
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidAttachment))?,
        sha256: metadata.sha256().to_owned(),
        title: metadata.title().to_owned(),
        description: metadata.description().to_owned(),
        source: metadata.source().to_owned(),
        captured_at: metadata.captured_at().map(str::to_owned),
        source_url: metadata.source_url().to_owned(),
        tags_json: serde_json::to_string(metadata.tags())
            .map_err(|_| StoreError::new(StoreErrorCode::InvalidAttachment))?,
        analyst_notes: metadata.analyst_notes().to_owned(),
        created_at_unix_ms: metadata.created_at_unix_ms(),
        updated_at_unix_ms: metadata.updated_at_unix_ms(),
    })
}

fn revision_to_i64(revision: Revision) -> Result<i64, StoreError> {
    i64::try_from(revision.get()).map_err(|_| StoreError::new(StoreErrorCode::RevisionConflict))
}

fn encode_payload<T: serde::Serialize>(value: &T) -> Result<Vec<u8>, StoreError> {
    serde_json::to_vec(value).map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))
}

fn decode_optional_payload<T: serde::de::DeserializeOwned>(
    payload: Option<Vec<u8>>,
) -> Result<Option<T>, StoreError> {
    payload
        .map(|payload| {
            serde_json::from_slice(&payload)
                .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))
        })
        .transpose()
}

fn decode_payloads<T: serde::de::DeserializeOwned>(
    payloads: Vec<Vec<u8>>,
) -> Result<Vec<T>, StoreError> {
    payloads
        .into_iter()
        .map(|payload| {
            serde_json::from_slice(&payload)
                .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))
        })
        .collect()
}

fn is_constraint_violation(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(sqlite_error, _)
            if sqlite_error.code == ErrorCode::ConstraintViolation
    )
}

fn store_stix_object(
    transaction: &rusqlite::Transaction<'_>,
    object: &ExistingStixObject,
) -> Result<(), StoreError> {
    let payload = serde_json::to_vec(object.raw())
        .map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))?;
    let version_key = object.modified().unwrap_or("");
    queries::upsert_stix_object(
        transaction,
        &object.local_id().to_string(),
        object.stix_id(),
        object.object_type(),
        object.modified(),
        version_key,
        &payload,
    )
    .map(|_| ())
    .map_err(|error| {
        if is_constraint_violation(&error) {
            StoreError::new(StoreErrorCode::AlreadyExists)
        } else {
            StoreError::new(StoreErrorCode::StorageUnavailable)
        }
    })
}

fn encode_graph_workspace(workspace: &GraphWorkspace) -> Result<Vec<u8>, StoreError> {
    serde_json::to_vec(workspace).map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))
}

fn decode_graph_workspace(payload: &[u8]) -> Result<GraphWorkspace, StoreError> {
    serde_json::from_slice(payload).map_err(|_| StoreError::new(StoreErrorCode::InvalidStoredData))
}

fn workspace_item_kind_name(kind: WorkspaceItemKind) -> &'static str {
    match kind {
        WorkspaceItemKind::Intelligence => "intelligence",
        WorkspaceItemKind::Evidence => "evidence",
        WorkspaceItemKind::Document => "document",
        WorkspaceItemKind::CatalogReference => "catalog_reference",
    }
}

fn parse_workspace_item_kind(value: &str) -> Result<WorkspaceItemKind, StoreError> {
    match value {
        "intelligence" => Ok(WorkspaceItemKind::Intelligence),
        "evidence" => Ok(WorkspaceItemKind::Evidence),
        "document" => Ok(WorkspaceItemKind::Document),
        "catalog_reference" => Ok(WorkspaceItemKind::CatalogReference),
        _ => Err(StoreError::new(StoreErrorCode::InvalidStoredData)),
    }
}

fn require_graph_revision(
    workspace: &GraphWorkspace,
    expected_revision: Revision,
) -> Result<(), StoreError> {
    if workspace.revision() != expected_revision {
        return Err(StoreError::new(StoreErrorCode::RevisionConflict));
    }
    Ok(())
}

fn update_graph_workspace_row(
    transaction: &rusqlite::Transaction<'_>,
    workspace: &GraphWorkspace,
    expected_revision: Revision,
    payload: &[u8],
) -> Result<(), StoreError> {
    let changed = queries::update_graph_workspace(
        transaction,
        &workspace.id().to_string(),
        revision_to_i64(workspace.revision())?,
        workspace.deleted_at_unix_ms(),
        payload,
        revision_to_i64(expected_revision)?,
    )
    .map_err(|_| StoreError::new(StoreErrorCode::StorageUnavailable))?;
    if changed != 1 {
        return Err(StoreError::new(StoreErrorCode::RevisionConflict));
    }
    Ok(())
}

fn revision_from_i64(revision: i64) -> Result<Revision, StoreError> {
    u64::try_from(revision)
        .ok()
        .and_then(|value| Revision::new(value).ok())
        .ok_or_else(|| StoreError::new(StoreErrorCode::InvalidStoredData))
}

fn remove_database_files(path: &Path) {
    let _ = fs::remove_file(path);
    for suffix in ["-journal", "-wal", "-shm"] {
        let _ = fs::remove_file(with_suffix(path, suffix));
    }
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_owned();
    value.push(suffix);
    PathBuf::from(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guided_reporting_cleanup_migration_removes_only_guided_data() {
        let cleanup_index = MIGRATIONS
            .iter()
            .position(|migration| migration.version == 15)
            .expect("guided reporting cleanup migration");
        let mut connection = Connection::open_in_memory().unwrap();
        apply_migrations(&mut connection, &MIGRATIONS[..cleanup_index]).unwrap();
        connection
            .execute_batch(
                r#"
                INSERT INTO documents (id, revision, payload)
                    VALUES ('document', 1, x'7b7d');
                INSERT INTO document_revisions (
                    document_id, revision, saved_at_unix_ms, payload
                ) VALUES ('document', 1, 1, x'7b7d');
                INSERT INTO document_activity (
                    document_id, kind, revision, source_revision, occurred_at_unix_ms
                ) VALUES ('document', 'created', 1, NULL, 1);
                INSERT INTO document_image_attachments (
                    id, document_id, media_type, file_name, byte_len, payload
                ) VALUES ('attachment', 'document', 'image/png', 'figure.png', 1, x'00');
                INSERT INTO project_metadata (singleton, payload) VALUES (1, x'7b7d');
                INSERT INTO stix_objects (
                    local_id, stix_id, object_type, modified, version_key, payload
                ) VALUES ('object', 'indicator--fixture', 'indicator', NULL, 'fixture', x'7b7d');
                INSERT INTO stix_drafts (
                    local_id, object_type, properties, semantic_relationship, replaces_stix_id
                ) VALUES ('draft', 'indicator', x'7b7d', NULL, NULL);
                INSERT INTO guided_reports (id, revision, payload)
                    VALUES ('guided', 1, x'7b7d');
                INSERT INTO guided_report_revisions (report_id, revision, saved_at_unix_ms, payload)
                    VALUES ('guided', 1, 1, x'7b7d');
                INSERT INTO report_templates (id, revision, payload)
                    VALUES ('template', 1, x'7b7d');
                INSERT INTO report_template_revisions (template_id, revision, saved_at_unix_ms, payload)
                    VALUES ('template', 1, 1, x'7b7d');
                INSERT INTO technique_observations (id, revision, payload)
                    VALUES ('observation', 1, x'7b7d');
                INSERT INTO graph_workspaces (id, revision, payload)
                    VALUES ('graph', 1, x'7b7d');
                INSERT INTO graph_workspace_items (
                    workspace_id, item_id, item_kind, x, y, pinned
                ) VALUES
                    ('graph', 'graph-source', 'intelligence', 0.0, 0.0, 1),
                    ('graph', 'graph-target', 'evidence', 100.0, 0.0, 0);
                INSERT INTO graph_visual_links (
                    id, workspace_id, source_id, target_id, label
                ) VALUES ('visual-link', 'graph', 'graph-source', 'graph-target', 'analysis');
                INSERT INTO brand_profiles (id, revision, payload)
                    VALUES ('brand', 1, x'7b7d');
                INSERT INTO brand_profile_revisions (
                    profile_id, revision, saved_at_unix_ms, payload
                ) VALUES ('brand', 1, 1, x'7b7d');
                INSERT INTO brand_assets (
                    id, profile_id, role, media_type, file_name, byte_len, payload
                ) VALUES ('brand-asset', 'brand', 'logo', 'image/png', 'logo.png', 1, x'00');
                INSERT INTO evidence_files (
                    id, media_type, file_name, byte_len, sha256, created_at_unix_ms, payload,
                    revision, title, description, source, source_url, tags_json, analyst_notes,
                    updated_at_unix_ms
                ) VALUES (
                    'evidence', 'text/plain', 'evidence.txt', 1,
                    '0000000000000000000000000000000000000000000000000000000000000000',
                    1, x'78', 1, 'Evidence', '', '', '', '[]', '', 1
                );
                INSERT INTO report_number_sequences (prefix, next_value) VALUES ('RPT', 7);
                INSERT INTO publication_history (id, created_at_unix_ms, payload) VALUES
                    ('guided-publication', 1,
                     CAST('{"snapshot":{"source":{"type":"guided_report"}}}' AS BLOB)),
                    ('document-publication', 2,
                     CAST('{"snapshot":{"source":{"type":"freeform_document"}}}' AS BLOB));
                "#,
            )
            .unwrap();

        apply_migrations(&mut connection, &MIGRATIONS[cleanup_index..]).unwrap();

        for removed in [
            "guided_reports",
            "guided_report_revisions",
            "report_templates",
            "report_template_revisions",
        ] {
            let exists = connection
                .query_row(
                    "SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name = ?1",
                    [removed],
                    |row| row.get::<_, u32>(0),
                )
                .unwrap();
            assert_eq!(exists, 0, "{removed} must be dropped");
        }
        for (preserved, expected_count) in [
            ("documents", 1),
            ("document_revisions", 1),
            ("document_activity", 1),
            ("document_image_attachments", 1),
            ("project_metadata", 1),
            ("stix_objects", 1),
            ("stix_drafts", 1),
            ("technique_observations", 1),
            ("graph_workspaces", 1),
            ("graph_workspace_items", 2),
            ("graph_visual_links", 1),
            ("brand_profiles", 1),
            ("brand_profile_revisions", 1),
            ("brand_assets", 1),
            ("evidence_files", 1),
            ("report_number_sequences", 1),
        ] {
            let count = connection
                .query_row(&format!("SELECT count(*) FROM {preserved}"), [], |row| {
                    row.get::<_, u32>(0)
                })
                .unwrap();
            assert_eq!(count, expected_count, "{preserved} must be preserved");
        }
        let publications = connection
            .query_row("SELECT count(*) FROM publication_history", [], |row| {
                row.get::<_, u32>(0)
            })
            .unwrap();
        assert_eq!(publications, 1);
        let surviving_publication: String = connection
            .query_row("SELECT id FROM publication_history", [], |row| row.get(0))
            .unwrap();
        assert_eq!(surviving_publication, "document-publication");
    }

    #[test]
    fn failed_migration_rolls_back_schema_and_version() {
        let mut connection = Connection::open_in_memory().unwrap();
        apply_migrations(&mut connection, MIGRATIONS).unwrap();
        let current_version = MIGRATIONS.last().unwrap().version;
        let failing = [Migration {
            version: current_version + 1,
            sql: "
                CREATE TABLE should_roll_back (id INTEGER PRIMARY KEY) STRICT;
                THIS IS NOT SQL;
            ",
        }];

        let error = apply_migrations(&mut connection, &failing).unwrap_err();
        assert_eq!(error.code(), StoreErrorCode::MigrationFailed);
        assert_eq!(
            connection
                .pragma_query_value(None, "user_version", |row| row.get::<_, u32>(0))
                .unwrap(),
            current_version
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM sqlite_schema WHERE name = 'should_roll_back'",
                    [],
                    |row| row.get::<_, u32>(0),
                )
                .unwrap(),
            0
        );
    }
}
