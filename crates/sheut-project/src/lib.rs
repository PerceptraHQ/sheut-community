#![forbid(unsafe_code)]

//! Project lifecycle, encryption-key orchestration, recovery, and filesystem ownership.
//! This crate resolves opaque local identifiers to project paths; UI callers never provide them.

use std::{
    collections::{BTreeMap, HashMap},
    error::Error,
    fmt, fs,
    fs::OpenOptions,
    io,
    path::{Path, PathBuf},
};

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, KeyInit, Payload},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sheut_core::{
    AnalyticConfidence, BrandAssetMetadata, BrandAssetRole, BrandProfile, BrandProfileInput,
    BuiltinReportTemplate, DocumentActivityEntry, DocumentEnvelope, DocumentKind,
    DocumentRevisionDiff, DocumentRevisionSummary, DocumentTextDiffKind, DocumentTextDiffSegment,
    DomainErrorCode, EvidenceFileMetadata, EvidenceMetadataInput, GraphViewport, GraphWorkspace,
    GraphWorkspaceSnapshot, GuidedReport, GuidedReportFieldValue, ImageAttachmentMetadata,
    ImageMediaType, LocalId, MAX_GRAPH_WORKSPACE_ITEMS, MitreTechniqueReference, Position,
    ProjectMetadata, PublicationRecord, ReportSectionDisposition, ReportTemplateDefinition,
    ReportTemplateSection, Revision, SemanticRelationshipDraft, TechniqueAssessment,
    TechniqueObservation, TechniqueOutcome, TlpMarking, VisualLink, WorkspaceItem,
    WorkspaceItemKind, WorkspaceMode, detect_evidence_media_type, render_document,
    report_template_catalog, report_template_revision,
};
use sheut_mitre::{
    CatalogSnapshot, MAX_MAPPING_OBSERVATIONS, MitreCatalogError, MitreCatalogErrorCode,
    validate_reference_in,
};
use sheut_stix::{ExistingStixObject, ImportCommit, StixDraft, is_relationship_endpoint_type};
use sheut_store::{EncryptedStore, StoreError, StoreErrorCode};
use uuid::Uuid;
use zeroize::Zeroizing;

const MANIFEST_FILE: &str = "manifest.json";
const DATABASE_FILE: &str = "project.sheut";
const BACKUP_DIRECTORY: &str = "backups";
const RECOVERY_DIRECTORY: &str = "recovery";
const BACKUP_EXTENSION: &str = ".sheut";
const MAX_MANIFEST_BYTES: u64 = 4_096;
const MIN_PASSPHRASE_BYTES: usize = 12;
const MAX_PASSPHRASE_BYTES: usize = 1_024;
const ARGON2_MEMORY_KIB: u32 = 65_536;
const ARGON2_ITERATIONS: u32 = 3;
const ARGON2_PARALLELISM: u32 = 1;
const ARGON2_VERSION: u32 = 0x13;
const PASSPHRASE_SALT_BYTES: usize = 16;
const WRAP_NONCE_BYTES: usize = 24;
const WRAPPED_PROJECT_KEY_BYTES: usize = 48;
const MAX_DOCUMENT_DIFF_MATRIX_CELLS: usize = 1_000_000;
const MAX_PROJECT_EVIDENCE_BYTES: u64 = 1024 * 1024 * 1024;

pub struct BrandAssetUpload {
    role: BrandAssetRole,
    file_name: String,
    payload: Vec<u8>,
}

impl BrandAssetUpload {
    #[must_use]
    pub fn new(role: BrandAssetRole, file_name: String, payload: Vec<u8>) -> Self {
        Self {
            role,
            file_name,
            payload,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleErrorCode {
    InvalidName,
    InvalidProject,
    InvalidPassphrase,
    InvalidPassphraseOrCorrupt,
    InvalidDocument,
    InvalidAttachment,
    InvalidStix,
    InvalidMitreReference,
    InvalidMitreCatalog,
    InvalidMitreMapping,
    InvalidGraphWorkspace,
    GraphWorkspaceNotFound,
    GraphItemUnavailable,
    MitreCatalogLimitExceeded,
    MitreMappingLimitExceeded,
    MitreCatalogDowngrade,
    MitreReferenceUnavailable,
    TechniqueObservationNotFound,
    StixDraftInUse,
    StixObjectInUse,
    UnsupportedStixVersion,
    StixValidationFailed,
    StixLimitExceeded,
    DuplicateDecisionRequired,
    ImportCancelled,
    DocumentNotFound,
    DocumentRevisionNotFound,
    AttachmentNotFound,
    ExportFailed,
    RevisionConflict,
    BackupFailed,
    BackupNotFound,
    ProjectNotFound,
    ProjectLocked,
    ProjectMustBeLocked,
    PassphraseRequired,
    RecoveryFailed,
    AlreadyLocked,
    InvalidKeyOrCorrupt,
    CredentialUnavailable,
    StorageUnavailable,
}

impl LifecycleErrorCode {
    const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidName => "invalid_name",
            Self::InvalidProject => "invalid_project",
            Self::InvalidPassphrase => "invalid_passphrase",
            Self::InvalidPassphraseOrCorrupt => "invalid_passphrase_or_corrupt",
            Self::InvalidDocument => "invalid_document",
            Self::InvalidAttachment => "invalid_attachment",
            Self::InvalidStix => "invalid_stix",
            Self::InvalidMitreReference => "invalid_mitre_reference",
            Self::InvalidMitreCatalog => "invalid_mitre_catalog",
            Self::InvalidMitreMapping => "invalid_mitre_mapping",
            Self::InvalidGraphWorkspace => "invalid_graph_workspace",
            Self::GraphWorkspaceNotFound => "graph_workspace_not_found",
            Self::GraphItemUnavailable => "graph_item_unavailable",
            Self::MitreCatalogLimitExceeded => "mitre_catalog_limit_exceeded",
            Self::MitreMappingLimitExceeded => "mitre_mapping_limit_exceeded",
            Self::MitreCatalogDowngrade => "mitre_catalog_downgrade",
            Self::MitreReferenceUnavailable => "mitre_reference_unavailable",
            Self::TechniqueObservationNotFound => "technique_observation_not_found",
            Self::StixDraftInUse => "stix_draft_in_use",
            Self::StixObjectInUse => "stix_object_in_use",
            Self::UnsupportedStixVersion => "unsupported_stix_version",
            Self::StixValidationFailed => "stix_validation_failed",
            Self::StixLimitExceeded => "stix_limit_exceeded",
            Self::DuplicateDecisionRequired => "duplicate_decision_required",
            Self::ImportCancelled => "import_cancelled",
            Self::DocumentNotFound => "document_not_found",
            Self::DocumentRevisionNotFound => "document_revision_not_found",
            Self::AttachmentNotFound => "attachment_not_found",
            Self::ExportFailed => "export_failed",
            Self::RevisionConflict => "revision_conflict",
            Self::BackupFailed => "backup_failed",
            Self::BackupNotFound => "backup_not_found",
            Self::ProjectNotFound => "project_not_found",
            Self::ProjectLocked => "project_locked",
            Self::ProjectMustBeLocked => "project_must_be_locked",
            Self::PassphraseRequired => "passphrase_required",
            Self::RecoveryFailed => "recovery_failed",
            Self::AlreadyLocked => "already_locked",
            Self::InvalidKeyOrCorrupt => "invalid_key_or_corrupt",
            Self::CredentialUnavailable => "credential_unavailable",
            Self::StorageUnavailable => "storage_unavailable",
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UnlockMethod {
    #[default]
    Device,
    Passphrase,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LifecycleError {
    code: LifecycleErrorCode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservationImportOutcome {
    imported: usize,
    skipped: usize,
}

impl ObservationImportOutcome {
    #[must_use]
    pub const fn imported(self) -> usize {
        self.imported
    }

    #[must_use]
    pub const fn skipped(self) -> usize {
        self.skipped
    }
}

impl LifecycleError {
    const fn new(code: LifecycleErrorCode) -> Self {
        Self { code }
    }

    #[must_use]
    pub const fn from_code(code: LifecycleErrorCode) -> Self {
        Self { code }
    }

    #[must_use]
    pub const fn code(self) -> LifecycleErrorCode {
        self.code
    }
}

impl fmt::Display for LifecycleError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code.as_str())
    }
}

impl Error for LifecycleError {}

pub struct ProjectKey(Zeroizing<[u8; 32]>);

impl ProjectKey {
    #[must_use]
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(Zeroizing::new(bytes))
    }

    fn generate() -> Result<Self, LifecycleError> {
        let mut bytes = Zeroizing::new([0_u8; 32]);
        getrandom::fill(bytes.as_mut())
            .map_err(|_| LifecycleError::new(LifecycleErrorCode::StorageUnavailable))?;
        Ok(Self(bytes))
    }

    #[must_use]
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl fmt::Debug for ProjectKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ProjectKey([REDACTED])")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProjectKeyStoreError;

impl fmt::Display for ProjectKeyStoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("credential_unavailable")
    }
}

impl Error for ProjectKeyStoreError {}

pub trait ProjectKeyStore {
    fn put(&self, id: LocalId, key: &ProjectKey) -> Result<(), ProjectKeyStoreError>;
    fn get(&self, id: LocalId) -> Result<ProjectKey, ProjectKeyStoreError>;
    fn delete(&self, id: LocalId) -> Result<(), ProjectKeyStoreError>;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct OsProjectKeyStore;

impl OsProjectKeyStore {
    const SERVICE: &'static str = "app.sheut.desktop.project";

    fn entry(id: LocalId) -> Result<keyring::Entry, ProjectKeyStoreError> {
        keyring::Entry::new(Self::SERVICE, &id.to_string()).map_err(|_| ProjectKeyStoreError)
    }
}

impl ProjectKeyStore for OsProjectKeyStore {
    fn put(&self, id: LocalId, key: &ProjectKey) -> Result<(), ProjectKeyStoreError> {
        Self::entry(id)?
            .set_secret(key.as_bytes())
            .map_err(|_| ProjectKeyStoreError)
    }

    fn get(&self, id: LocalId) -> Result<ProjectKey, ProjectKeyStoreError> {
        let secret = Zeroizing::new(
            Self::entry(id)?
                .get_secret()
                .map_err(|_| ProjectKeyStoreError)?,
        );
        let bytes: [u8; 32] = secret
            .as_slice()
            .try_into()
            .map_err(|_| ProjectKeyStoreError)?;
        Ok(ProjectKey::from_bytes(bytes))
    }

    fn delete(&self, id: LocalId) -> Result<(), ProjectKeyStoreError> {
        Self::entry(id)?
            .delete_credential()
            .map_err(|_| ProjectKeyStoreError)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProjectStatus {
    id: LocalId,
    name: Option<String>,
    locked: bool,
    unlock_method: UnlockMethod,
    default_tlp_marking: Option<TlpMarking>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ProjectBackup {
    id: LocalId,
    created_at_unix_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GraphWorkspaceSeedItem {
    item_id: LocalId,
    item_kind: WorkspaceItemKind,
    position: Position,
    pinned: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GraphRelationshipDraftPreview {
    visual_link: VisualLink,
    source_object_type: String,
    target_object_type: String,
}

impl GraphRelationshipDraftPreview {
    #[must_use]
    pub const fn visual_link(&self) -> &VisualLink {
        &self.visual_link
    }

    #[must_use]
    pub fn source_object_type(&self) -> &str {
        &self.source_object_type
    }

    #[must_use]
    pub fn target_object_type(&self) -> &str {
        &self.target_object_type
    }
}

impl GraphWorkspaceSeedItem {
    #[must_use]
    pub const fn new(
        item_id: LocalId,
        item_kind: WorkspaceItemKind,
        position: Position,
        pinned: bool,
    ) -> Self {
        Self {
            item_id,
            item_kind,
            position,
            pinned,
        }
    }

    #[must_use]
    pub const fn item_id(self) -> LocalId {
        self.item_id
    }

    #[must_use]
    pub const fn item_kind(self) -> WorkspaceItemKind {
        self.item_kind
    }

    #[must_use]
    pub const fn position(self) -> Position {
        self.position
    }

    #[must_use]
    pub const fn pinned(self) -> bool {
        self.pinned
    }
}

impl ProjectBackup {
    #[must_use]
    pub const fn id(&self) -> LocalId {
        self.id
    }

    #[must_use]
    pub const fn created_at_unix_ms(&self) -> i64 {
        self.created_at_unix_ms
    }
}

impl ProjectStatus {
    #[must_use]
    pub const fn id(&self) -> LocalId {
        self.id
    }

    #[must_use]
    pub fn name(&self) -> Option<&str> {
        self.name.as_deref()
    }

    #[must_use]
    pub const fn locked(&self) -> bool {
        self.locked
    }

    #[must_use]
    pub const fn unlock_method(&self) -> UnlockMethod {
        self.unlock_method
    }

    #[must_use]
    pub const fn default_tlp_marking(&self) -> Option<TlpMarking> {
        self.default_tlp_marking
    }
}

pub struct ProjectManager<K> {
    root: PathBuf,
    key_store: K,
    sessions: HashMap<LocalId, ProjectSession>,
}

impl<K: ProjectKeyStore> ProjectManager<K> {
    pub fn new(root: PathBuf, key_store: K) -> Result<Self, LifecycleError> {
        create_project_root(&root)?;
        Ok(Self {
            root,
            key_store,
            sessions: HashMap::new(),
        })
    }

    pub fn create_project(
        &mut self,
        name: impl AsRef<str>,
        now_unix_ms: i64,
    ) -> Result<ProjectStatus, LifecycleError> {
        self.create_project_with_default_tlp(name, sheut_core::TlpMarking::Amber, now_unix_ms)
    }

    pub fn create_project_with_default_tlp(
        &mut self,
        name: impl AsRef<str>,
        default_tlp_marking: sheut_core::TlpMarking,
        now_unix_ms: i64,
    ) -> Result<ProjectStatus, LifecycleError> {
        let id = LocalId::from_uuid(Uuid::new_v4());
        let metadata =
            ProjectMetadata::new_with_default_tlp(id, name, default_tlp_marking, now_unix_ms)
                .map_err(map_domain_error)?;
        let key = ProjectKey::generate()?;
        let manifest = ProjectManifest::device(id, metadata.name().to_owned());
        self.create_initialized_project(metadata, key, manifest, true, now_unix_ms)
    }

    pub fn create_passphrase_project(
        &mut self,
        name: impl AsRef<str>,
        passphrase: impl AsRef<str>,
        now_unix_ms: i64,
    ) -> Result<ProjectStatus, LifecycleError> {
        self.create_passphrase_project_with_default_tlp(
            name,
            passphrase,
            sheut_core::TlpMarking::Amber,
            now_unix_ms,
        )
    }

    pub fn create_passphrase_project_with_default_tlp(
        &mut self,
        name: impl AsRef<str>,
        passphrase: impl AsRef<str>,
        default_tlp_marking: sheut_core::TlpMarking,
        now_unix_ms: i64,
    ) -> Result<ProjectStatus, LifecycleError> {
        validate_new_passphrase(passphrase.as_ref())?;
        let id = LocalId::from_uuid(Uuid::new_v4());
        let metadata =
            ProjectMetadata::new_with_default_tlp(id, name, default_tlp_marking, now_unix_ms)
                .map_err(map_domain_error)?;
        let key = ProjectKey::generate()?;
        let key_wrap = PassphraseKeyWrap::create(id, passphrase.as_ref(), &key)?;
        let manifest = ProjectManifest::passphrase(id, metadata.name().to_owned(), key_wrap);
        self.create_initialized_project(metadata, key, manifest, false, now_unix_ms)
    }

    fn create_initialized_project(
        &mut self,
        metadata: ProjectMetadata,
        key: ProjectKey,
        manifest: ProjectManifest,
        store_device_key: bool,
        now_unix_ms: i64,
    ) -> Result<ProjectStatus, LifecycleError> {
        let id = metadata.id();
        let project_directory = self.project_directory(id);
        create_project_directory(&project_directory)?;

        let result = (|| {
            write_manifest(&project_directory, &manifest)?;
            let mut store =
                EncryptedStore::create(&project_directory.join(DATABASE_FILE), key.as_bytes())
                    .map_err(map_store_error)?;
            store
                .initialize_project(&metadata)
                .map_err(map_store_error)?;
            if store_device_key {
                self.key_store
                    .put(id, &key)
                    .map_err(|_| LifecycleError::new(LifecycleErrorCode::CredentialUnavailable))?;
            }
            self.sessions.insert(
                id,
                ProjectSession {
                    store,
                    key,
                    metadata: metadata.clone(),
                    unlock_method: manifest.unlock_method,
                    last_active_unix_ms: now_unix_ms,
                },
            );
            Ok(ProjectStatus::unlocked(metadata, manifest.unlock_method))
        })();

        if result.is_err() {
            if store_device_key {
                let _ = self.key_store.delete(id);
            }
            let _ = fs::remove_dir_all(&project_directory);
        }
        result
    }

    pub fn unlock_project(
        &mut self,
        id: LocalId,
        now_unix_ms: i64,
    ) -> Result<ProjectStatus, LifecycleError> {
        if let Some(session) = self.sessions.get_mut(&id) {
            session.last_active_unix_ms = now_unix_ms;
            return Ok(ProjectStatus::unlocked(
                session.metadata.clone(),
                session.unlock_method,
            ));
        }

        let project_directory = self.project_directory(id);
        let manifest = validate_project_directory(&project_directory, id)?;
        if manifest.unlock_method != UnlockMethod::Device {
            return Err(LifecycleError::new(LifecycleErrorCode::PassphraseRequired));
        }
        let key = self
            .key_store
            .get(id)
            .map_err(|_| LifecycleError::new(LifecycleErrorCode::CredentialUnavailable))?;
        self.open_project(id, key, UnlockMethod::Device, now_unix_ms)
    }

    pub fn unlock_project_with_passphrase(
        &mut self,
        id: LocalId,
        passphrase: impl AsRef<str>,
        now_unix_ms: i64,
    ) -> Result<ProjectStatus, LifecycleError> {
        if let Some(session) = self.sessions.get_mut(&id) {
            session.last_active_unix_ms = now_unix_ms;
            return Ok(ProjectStatus::unlocked(
                session.metadata.clone(),
                session.unlock_method,
            ));
        }

        let project_directory = self.project_directory(id);
        let manifest = validate_project_directory(&project_directory, id)?;
        let key_wrap = manifest
            .passphrase_key_wrap
            .as_ref()
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::InvalidPassphraseOrCorrupt))?;
        if manifest.unlock_method != UnlockMethod::Passphrase {
            return Err(LifecycleError::new(LifecycleErrorCode::InvalidProject));
        }
        let key = key_wrap.open(id, passphrase.as_ref())?;
        self.open_project(id, key, UnlockMethod::Passphrase, now_unix_ms)
            .map_err(|error| match error.code() {
                LifecycleErrorCode::InvalidKeyOrCorrupt => {
                    LifecycleError::new(LifecycleErrorCode::InvalidPassphraseOrCorrupt)
                }
                _ => error,
            })
    }

    fn open_project(
        &mut self,
        id: LocalId,
        key: ProjectKey,
        unlock_method: UnlockMethod,
        now_unix_ms: i64,
    ) -> Result<ProjectStatus, LifecycleError> {
        let project_directory = self.project_directory(id);
        let store = EncryptedStore::open(&project_directory.join(DATABASE_FILE), key.as_bytes())
            .map_err(map_store_error)?;
        let metadata = store
            .load_project()
            .map_err(map_store_error)?
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::InvalidProject))?;
        if metadata.id() != id {
            return Err(LifecycleError::new(LifecycleErrorCode::InvalidProject));
        }

        let status = ProjectStatus::unlocked(metadata.clone(), unlock_method);
        self.sessions.insert(
            id,
            ProjectSession {
                store,
                key,
                metadata,
                unlock_method,
                last_active_unix_ms: now_unix_ms,
            },
        );
        Ok(status)
    }

    pub fn update_project_default_tlp(
        &mut self,
        id: LocalId,
        marking: TlpMarking,
        now_unix_ms: i64,
    ) -> Result<ProjectStatus, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let metadata = session.metadata.clone().with_default_tlp_marking(marking);
        session
            .store
            .save_project(&metadata)
            .map_err(map_store_error)?;
        session.metadata = metadata.clone();
        session.last_active_unix_ms = now_unix_ms;
        Ok(ProjectStatus::unlocked(metadata, session.unlock_method))
    }

    pub fn create_project_backup(
        &self,
        id: LocalId,
        now_unix_ms: i64,
    ) -> Result<ProjectBackup, LifecycleError> {
        if now_unix_ms < 0 {
            return Err(LifecycleError::new(LifecycleErrorCode::BackupFailed));
        }
        let session = self
            .sessions
            .get(&id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let backup_directory = self.project_directory(id).join(BACKUP_DIRECTORY);
        ensure_private_directory(&backup_directory)?;
        let backup = ProjectBackup {
            id: LocalId::from_uuid(Uuid::new_v4()),
            created_at_unix_ms: now_unix_ms,
        };
        session
            .store
            .backup_to(
                &backup_directory.join(backup_file_name(backup)),
                session.key.as_bytes(),
            )
            .map_err(map_store_error)?;
        sync_directory(&backup_directory)
            .map_err(|_| LifecycleError::new(LifecycleErrorCode::BackupFailed))?;
        Ok(backup)
    }

    pub fn list_project_backups(&self, id: LocalId) -> Result<Vec<ProjectBackup>, LifecycleError> {
        validate_project_directory(&self.project_directory(id), id)?;
        let mut backups: Vec<_> =
            backup_entries(&self.project_directory(id).join(BACKUP_DIRECTORY))?
                .into_iter()
                .map(|(backup, _)| backup)
                .collect();
        backups.sort_by(|left, right| {
            right
                .created_at_unix_ms
                .cmp(&left.created_at_unix_ms)
                .then_with(|| left.id.to_string().cmp(&right.id.to_string()))
        });
        Ok(backups)
    }

    pub fn restore_device_project_backup(
        &mut self,
        id: LocalId,
        backup_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<(), LifecycleError> {
        self.require_locked(id)?;
        let project_directory = self.project_directory(id);
        let manifest = validate_project_directory(&project_directory, id)?;
        if manifest.unlock_method != UnlockMethod::Device {
            return Err(LifecycleError::new(LifecycleErrorCode::InvalidProject));
        }
        let key = self
            .key_store
            .get(id)
            .map_err(|_| LifecycleError::new(LifecycleErrorCode::CredentialUnavailable))?;
        restore_project_backup(&project_directory, id, backup_id, now_unix_ms, &key)
    }

    pub fn restore_passphrase_project_backup(
        &mut self,
        id: LocalId,
        backup_id: LocalId,
        passphrase: impl AsRef<str>,
        now_unix_ms: i64,
    ) -> Result<(), LifecycleError> {
        self.require_locked(id)?;
        let project_directory = self.project_directory(id);
        let manifest = validate_project_directory(&project_directory, id)?;
        if manifest.unlock_method != UnlockMethod::Passphrase {
            return Err(LifecycleError::new(LifecycleErrorCode::InvalidProject));
        }
        let key_wrap = manifest
            .passphrase_key_wrap
            .as_ref()
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::InvalidPassphraseOrCorrupt))?;
        let key = key_wrap.open(id, passphrase.as_ref())?;
        restore_project_backup(&project_directory, id, backup_id, now_unix_ms, &key)
    }

    fn require_locked(&self, id: LocalId) -> Result<(), LifecycleError> {
        if self.sessions.contains_key(&id) {
            return Err(LifecycleError::new(LifecycleErrorCode::ProjectMustBeLocked));
        }
        Ok(())
    }

    pub fn lock_project(&mut self, id: LocalId) -> Result<(), LifecycleError> {
        self.sessions
            .remove(&id)
            .map(|_| ())
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::AlreadyLocked))
    }

    pub fn delete_project(&mut self, id: LocalId) -> Result<(), LifecycleError> {
        self.require_locked(id)?;
        let project_directory = self.project_directory(id);
        let manifest = validate_project_directory(&project_directory, id)?;

        if manifest.unlock_method == UnlockMethod::Device {
            let key = self
                .key_store
                .get(id)
                .map_err(|_| LifecycleError::new(LifecycleErrorCode::CredentialUnavailable))?;
            self.key_store
                .delete(id)
                .map_err(|_| LifecycleError::new(LifecycleErrorCode::CredentialUnavailable))?;

            if fs::remove_dir_all(&project_directory).is_err() {
                self.key_store
                    .put(id, &key)
                    .map_err(|_| LifecycleError::new(LifecycleErrorCode::CredentialUnavailable))?;
                return Err(LifecycleError::new(LifecycleErrorCode::StorageUnavailable));
            }
        } else {
            fs::remove_dir_all(&project_directory)
                .map_err(|_| LifecycleError::new(LifecycleErrorCode::StorageUnavailable))?;
        }
        Ok(())
    }

    pub fn create_document(
        &mut self,
        project_id: LocalId,
        kind: DocumentKind,
        now_unix_ms: i64,
    ) -> Result<DocumentEnvelope, LifecycleError> {
        if kind == DocumentKind::Report {
            return Err(LifecycleError::new(LifecycleErrorCode::InvalidDocument));
        }
        let document = DocumentEnvelope::new(
            LocalId::from_uuid(Uuid::new_v4()),
            kind,
            Revision::new(1).map_err(map_domain_error)?,
            default_document_root(kind),
        )
        .map_err(map_domain_error)?;
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        session
            .store
            .save_document_at(&document, None, now_unix_ms)
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(document)
    }

    pub fn list_documents(
        &mut self,
        project_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<Vec<DocumentEnvelope>, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let documents = session
            .store
            .list_documents()
            .map_err(map_store_error)?
            .into_iter()
            .filter(|document| document.kind() != DocumentKind::Report)
            .collect();
        session.last_active_unix_ms = now_unix_ms;
        Ok(documents)
    }

    pub fn list_report_templates(
        &mut self,
        project_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<Vec<ReportTemplateDefinition>, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let mut templates = report_template_catalog();
        for template in session
            .store
            .list_report_templates()
            .map_err(map_store_error)?
        {
            if !templates
                .iter()
                .any(|existing| existing.id() == template.id())
            {
                templates.push(template);
            }
        }
        for report in session
            .store
            .list_guided_reports()
            .map_err(map_store_error)?
        {
            if templates.iter().any(|template| {
                template.id() == report.template_id()
                    && template.revision() == report.template_revision()
            }) {
                continue;
            }
            if let Some(template) =
                report_template_revision(report.template_id(), report.template_revision())
            {
                templates.push(template);
            }
        }
        session.last_active_unix_ms = now_unix_ms;
        Ok(templates)
    }

    pub fn list_guided_reports(
        &mut self,
        project_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<Vec<GuidedReport>, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let reports = session
            .store
            .list_guided_reports()
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(reports)
    }

    pub fn create_custom_report_template(
        &mut self,
        project_id: LocalId,
        base_template_id: LocalId,
        name: &str,
        description: &str,
        additional_sections: Vec<ReportTemplateSection>,
        now_unix_ms: i64,
    ) -> Result<ReportTemplateDefinition, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let base = if let Some(template) = report_template_catalog()
            .into_iter()
            .find(|template| template.id() == base_template_id)
        {
            template
        } else {
            session
                .store
                .load_report_template(base_template_id)
                .map_err(map_store_error)?
                .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::DocumentNotFound))?
        };
        let mut sections = base.sections().to_vec();
        sections.extend(additional_sections);
        let template = ReportTemplateDefinition::new_custom(
            LocalId::from_uuid(Uuid::new_v4()),
            Revision::new(1).map_err(map_domain_error)?,
            name,
            description,
            sections,
        )
        .map_err(map_domain_error)?;
        session
            .store
            .save_report_template(&template, None)
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(template)
    }

    pub fn create_guided_report(
        &mut self,
        project_id: LocalId,
        template_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<GuidedReport, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let template = if let Some(template) = report_template_catalog()
            .into_iter()
            .find(|template| template.id() == template_id)
        {
            template
        } else {
            session
                .store
                .load_report_template(template_id)
                .map_err(map_store_error)?
                .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::DocumentNotFound))?
        };
        let report_number = reserve_report_identifier(&mut session.store, &template)?;
        let report = GuidedReport::new_blank_with_fields(
            LocalId::from_uuid(Uuid::new_v4()),
            &template,
            BTreeMap::from([(
                "report_number".to_owned(),
                GuidedReportFieldValue::Text(report_number),
            )]),
            now_unix_ms,
        )
        .map_err(map_domain_error)?;
        session
            .store
            .save_guided_report(&report, None)
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(report)
    }

    pub fn save_guided_report_fields(
        &mut self,
        project_id: LocalId,
        report_id: LocalId,
        expected_revision: Revision,
        title: &str,
        fields: BTreeMap<String, GuidedReportFieldValue>,
        now_unix_ms: i64,
    ) -> Result<GuidedReport, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let report = session
            .store
            .load_guided_report(report_id)
            .map_err(map_store_error)?
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::DocumentNotFound))?;
        let template = if let Some(template) =
            report_template_revision(report.template_id(), report.template_revision())
        {
            template
        } else {
            session
                .store
                .load_report_template_revision(report.template_id(), report.template_revision())
                .map_err(map_store_error)?
                .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::DocumentNotFound))?
        };
        let revised = report
            .revise_fields(&template, expected_revision, title, fields, now_unix_ms)
            .map_err(map_domain_error)?;
        session
            .store
            .save_guided_report(&revised, Some(expected_revision))
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(revised)
    }

    pub fn update_guided_report_section_disposition(
        &mut self,
        project_id: LocalId,
        report_id: LocalId,
        expected_revision: Revision,
        section_key: &str,
        disposition: ReportSectionDisposition,
        now_unix_ms: i64,
    ) -> Result<GuidedReport, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let report = session
            .store
            .load_guided_report(report_id)
            .map_err(map_store_error)?
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::DocumentNotFound))?;
        let template = if let Some(template) =
            report_template_revision(report.template_id(), report.template_revision())
        {
            template
        } else {
            session
                .store
                .load_report_template_revision(report.template_id(), report.template_revision())
                .map_err(map_store_error)?
                .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::DocumentNotFound))?
        };
        let revised = report
            .revise_section_disposition(
                &template,
                expected_revision,
                section_key,
                disposition,
                now_unix_ms,
            )
            .map_err(map_domain_error)?;
        session
            .store
            .save_guided_report(&revised, Some(expected_revision))
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(revised)
    }

    pub fn upgrade_illicit_ecosystem_report(
        &mut self,
        project_id: LocalId,
        report_id: LocalId,
        expected_revision: Revision,
        now_unix_ms: i64,
    ) -> Result<GuidedReport, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let report = session
            .store
            .load_guided_report(report_id)
            .map_err(map_store_error)?
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::DocumentNotFound))?;
        let source_template =
            report_template_revision(report.template_id(), report.template_revision())
                .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::DocumentNotFound))?;
        let target_template = report_template_catalog()
            .into_iter()
            .find(|template| template.id() == report.template_id())
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::DocumentNotFound))?;
        let generated_report_number = report
            .fields()
            .get("report_number")
            .filter(|value| !guided_report_field_is_empty(value))
            .is_none()
            .then(|| reserve_report_identifier(&mut session.store, &target_template))
            .transpose()?;
        let upgraded = report
            .upgrade_illicit_ecosystem_template(
                &source_template,
                &target_template,
                generated_report_number.as_deref(),
                expected_revision,
                now_unix_ms,
            )
            .map_err(map_domain_error)?;
        session
            .store
            .save_guided_report(&upgraded, Some(expected_revision))
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(upgraded)
    }

    pub fn delete_guided_report(
        &mut self,
        project_id: LocalId,
        report_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<(), LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let deleted = session
            .store
            .soft_delete_guided_report(report_id, now_unix_ms)
            .map_err(map_store_error)?;
        if !deleted {
            return Err(LifecycleError::new(LifecycleErrorCode::DocumentNotFound));
        }
        session.last_active_unix_ms = now_unix_ms;
        Ok(())
    }

    pub fn restore_guided_report(
        &mut self,
        project_id: LocalId,
        report_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<GuidedReport, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let restored = session
            .store
            .restore_guided_report(report_id)
            .map_err(map_store_error)?;
        if !restored {
            return Err(LifecycleError::new(LifecycleErrorCode::DocumentNotFound));
        }
        let report = session
            .store
            .load_guided_report(report_id)
            .map_err(map_store_error)?
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::DocumentNotFound))?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(report)
    }

    pub fn load_guided_report_for_publication(
        &mut self,
        project_id: LocalId,
        report_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<(GuidedReport, ReportTemplateDefinition), LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let report = session
            .store
            .load_guided_report(report_id)
            .map_err(map_store_error)?
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::DocumentNotFound))?;
        let template = if let Some(template) =
            report_template_revision(report.template_id(), report.template_revision())
        {
            template
        } else {
            session
                .store
                .load_report_template_revision(report.template_id(), report.template_revision())
                .map_err(map_store_error)?
                .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::DocumentNotFound))?
        };
        session.last_active_unix_ms = now_unix_ms;
        Ok((report, template))
    }

    pub fn load_document_revision_for_publication(
        &mut self,
        project_id: LocalId,
        document_id: LocalId,
        revision: Revision,
        now_unix_ms: i64,
    ) -> Result<DocumentEnvelope, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let document = session
            .store
            .load_document_revision_for_publication(document_id, revision)
            .map_err(map_store_error)?
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::DocumentRevisionNotFound))?;
        require_current_document(&document)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(document)
    }

    pub fn load_guided_report_revision_for_publication(
        &mut self,
        project_id: LocalId,
        report_id: LocalId,
        revision: Revision,
        now_unix_ms: i64,
    ) -> Result<(GuidedReport, ReportTemplateDefinition), LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let report = session
            .store
            .load_guided_report_revision(report_id, revision)
            .map_err(map_store_error)?
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::DocumentRevisionNotFound))?;
        let template = if let Some(template) =
            report_template_revision(report.template_id(), report.template_revision())
        {
            template
        } else {
            session
                .store
                .load_report_template_revision(report.template_id(), report.template_revision())
                .map_err(map_store_error)?
                .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::DocumentRevisionNotFound))?
        };
        session.last_active_unix_ms = now_unix_ms;
        Ok((report, template))
    }

    pub fn list_brand_profiles(
        &mut self,
        project_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<Vec<BrandProfile>, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let profiles = session
            .store
            .list_brand_profiles()
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(profiles)
    }

    pub fn load_brand_profile_revision(
        &mut self,
        project_id: LocalId,
        profile_id: LocalId,
        revision: Revision,
        now_unix_ms: i64,
    ) -> Result<BrandProfile, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let profile = session
            .store
            .load_brand_profile_revision(profile_id, revision)
            .map_err(map_store_error)?
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::DocumentRevisionNotFound))?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(profile)
    }

    pub fn list_publication_records(
        &mut self,
        project_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<Vec<PublicationRecord>, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let records = session
            .store
            .list_publication_records()
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(records)
    }

    pub fn save_publication_record(
        &mut self,
        project_id: LocalId,
        record: &PublicationRecord,
        now_unix_ms: i64,
    ) -> Result<(), LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        session
            .store
            .save_publication_record(record)
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(())
    }

    pub fn create_brand_profile(
        &mut self,
        project_id: LocalId,
        input: BrandProfileInput,
        now_unix_ms: i64,
    ) -> Result<BrandProfile, LifecycleError> {
        let profile = BrandProfile::new(LocalId::from_uuid(Uuid::new_v4()), input, now_unix_ms)
            .map_err(map_domain_error)?;
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        session
            .store
            .save_brand_profile(&profile, None)
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(profile)
    }

    pub fn update_brand_profile(
        &mut self,
        project_id: LocalId,
        profile_id: LocalId,
        expected_revision: Revision,
        input: BrandProfileInput,
        now_unix_ms: i64,
    ) -> Result<BrandProfile, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let profile = session
            .store
            .load_brand_profile(profile_id)
            .map_err(map_store_error)?
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::DocumentNotFound))?;
        let revised = profile
            .revise(expected_revision, input, now_unix_ms)
            .map_err(map_domain_error)?;
        session
            .store
            .save_brand_profile(&revised, Some(expected_revision))
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(revised)
    }

    pub fn create_brand_asset(
        &mut self,
        project_id: LocalId,
        profile_id: LocalId,
        expected_revision: Revision,
        upload: BrandAssetUpload,
        now_unix_ms: i64,
    ) -> Result<(BrandProfile, BrandAssetMetadata), LifecycleError> {
        let media_type = ImageMediaType::detect(&upload.payload).map_err(map_domain_error)?;
        let byte_len = u64::try_from(upload.payload.len())
            .map_err(|_| LifecycleError::new(LifecycleErrorCode::InvalidAttachment))?;
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let profile = session
            .store
            .load_brand_profile(profile_id)
            .map_err(map_store_error)?
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::DocumentNotFound))?;
        if profile.revision() != expected_revision {
            return Err(LifecycleError::new(LifecycleErrorCode::RevisionConflict));
        }
        let metadata = BrandAssetMetadata::new(
            LocalId::from_uuid(Uuid::new_v4()),
            profile_id,
            upload.role,
            media_type,
            &upload.file_name,
            byte_len,
        )
        .map_err(map_domain_error)?;
        session
            .store
            .save_brand_asset(&metadata, &upload.payload)
            .map_err(map_store_error)?;
        let revised = profile
            .with_asset(expected_revision, upload.role, metadata.id(), now_unix_ms)
            .map_err(map_domain_error)?;
        session
            .store
            .save_brand_profile(&revised, Some(expected_revision))
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok((revised, metadata))
    }

    pub fn load_brand_asset(
        &mut self,
        project_id: LocalId,
        profile_id: LocalId,
        asset_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<(BrandAssetMetadata, Vec<u8>), LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let asset = session
            .store
            .load_brand_asset(profile_id, asset_id)
            .map_err(map_store_error)?
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::AttachmentNotFound))?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(asset)
    }

    pub fn create_graph_workspace(
        &mut self,
        project_id: LocalId,
        name: impl AsRef<str>,
        mode: WorkspaceMode,
        items: &[GraphWorkspaceSeedItem],
        now_unix_ms: i64,
    ) -> Result<GraphWorkspaceSnapshot, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        validate_graph_seed_items(&session.store, items)?;
        let workspace = GraphWorkspace::new(
            LocalId::from_uuid(Uuid::new_v4()),
            name,
            mode,
            GraphViewport::default(),
            now_unix_ms,
        )
        .map_err(map_graph_domain_error)?;
        let members = items
            .iter()
            .map(|item| {
                WorkspaceItem::new(
                    workspace.id(),
                    item.item_id(),
                    item.item_kind(),
                    item.position(),
                    item.pinned(),
                )
            })
            .collect::<Vec<_>>();
        session
            .store
            .create_graph_workspace(&workspace, &members)
            .map_err(map_graph_store_error)?;
        let snapshot = session
            .store
            .load_graph_workspace(workspace.id(), false)
            .map_err(map_graph_store_error)?
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::GraphWorkspaceNotFound))?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(snapshot)
    }

    pub fn list_graph_workspaces(
        &mut self,
        project_id: LocalId,
        include_deleted: bool,
        now_unix_ms: i64,
    ) -> Result<Vec<GraphWorkspace>, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let workspaces = session
            .store
            .list_graph_workspaces(include_deleted)
            .map_err(map_graph_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(workspaces)
    }

    pub fn load_graph_workspace(
        &mut self,
        project_id: LocalId,
        workspace_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<GraphWorkspaceSnapshot, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let snapshot = session
            .store
            .load_graph_workspace(workspace_id, false)
            .map_err(map_graph_store_error)?
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::GraphWorkspaceNotFound))?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(snapshot)
    }

    pub fn rename_graph_workspace(
        &mut self,
        project_id: LocalId,
        workspace_id: LocalId,
        expected_revision: Revision,
        name: impl AsRef<str>,
        now_unix_ms: i64,
    ) -> Result<GraphWorkspace, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let workspace = session
            .store
            .rename_graph_workspace(workspace_id, expected_revision, name, now_unix_ms)
            .map_err(map_graph_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(workspace)
    }

    pub fn delete_graph_workspace(
        &mut self,
        project_id: LocalId,
        workspace_id: LocalId,
        expected_revision: Revision,
        now_unix_ms: i64,
    ) -> Result<GraphWorkspace, LifecycleError> {
        self.set_graph_workspace_deleted(
            project_id,
            workspace_id,
            expected_revision,
            true,
            now_unix_ms,
        )
    }

    pub fn restore_graph_workspace(
        &mut self,
        project_id: LocalId,
        workspace_id: LocalId,
        expected_revision: Revision,
        now_unix_ms: i64,
    ) -> Result<GraphWorkspace, LifecycleError> {
        self.set_graph_workspace_deleted(
            project_id,
            workspace_id,
            expected_revision,
            false,
            now_unix_ms,
        )
    }

    fn set_graph_workspace_deleted(
        &mut self,
        project_id: LocalId,
        workspace_id: LocalId,
        expected_revision: Revision,
        deleted: bool,
        now_unix_ms: i64,
    ) -> Result<GraphWorkspace, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let workspace = session
            .store
            .set_graph_workspace_deleted(workspace_id, expected_revision, deleted, now_unix_ms)
            .map_err(map_graph_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(workspace)
    }

    pub fn add_graph_workspace_items(
        &mut self,
        project_id: LocalId,
        workspace_id: LocalId,
        expected_revision: Revision,
        items: &[GraphWorkspaceSeedItem],
        now_unix_ms: i64,
    ) -> Result<GraphWorkspace, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        validate_graph_seed_items(&session.store, items)?;
        let members = items
            .iter()
            .map(|item| {
                WorkspaceItem::new(
                    workspace_id,
                    item.item_id(),
                    item.item_kind(),
                    item.position(),
                    item.pinned(),
                )
            })
            .collect::<Vec<_>>();
        let workspace = session
            .store
            .add_graph_workspace_items(workspace_id, expected_revision, &members, now_unix_ms)
            .map_err(map_graph_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(workspace)
    }

    pub fn remove_graph_workspace_items(
        &mut self,
        project_id: LocalId,
        workspace_id: LocalId,
        expected_revision: Revision,
        item_ids: &[LocalId],
        now_unix_ms: i64,
    ) -> Result<GraphWorkspace, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let workspace = session
            .store
            .remove_graph_workspace_items(workspace_id, expected_revision, item_ids, now_unix_ms)
            .map_err(map_graph_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(workspace)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn save_graph_workspace_state(
        &mut self,
        project_id: LocalId,
        workspace_id: LocalId,
        expected_revision: Revision,
        mode: WorkspaceMode,
        viewport: GraphViewport,
        items: &[WorkspaceItem],
        now_unix_ms: i64,
    ) -> Result<GraphWorkspace, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let workspace = session
            .store
            .save_graph_workspace_state(
                workspace_id,
                expected_revision,
                mode,
                viewport,
                items,
                now_unix_ms,
            )
            .map_err(map_graph_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(workspace)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_graph_visual_link(
        &mut self,
        project_id: LocalId,
        workspace_id: LocalId,
        expected_revision: Revision,
        source_id: LocalId,
        target_id: LocalId,
        label: Option<&str>,
        now_unix_ms: i64,
    ) -> Result<GraphWorkspace, LifecycleError> {
        let link = VisualLink::new(
            LocalId::from_uuid(Uuid::new_v4()),
            workspace_id,
            source_id,
            target_id,
            label,
        )
        .map_err(map_graph_domain_error)?;
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let workspace = session
            .store
            .create_visual_link(workspace_id, expected_revision, &link, now_unix_ms)
            .map_err(map_graph_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(workspace)
    }

    pub fn update_graph_visual_link(
        &mut self,
        project_id: LocalId,
        workspace_id: LocalId,
        expected_revision: Revision,
        link: &VisualLink,
        now_unix_ms: i64,
    ) -> Result<GraphWorkspace, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let workspace = session
            .store
            .update_visual_link(workspace_id, expected_revision, link, now_unix_ms)
            .map_err(map_graph_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(workspace)
    }

    pub fn delete_graph_visual_link(
        &mut self,
        project_id: LocalId,
        workspace_id: LocalId,
        expected_revision: Revision,
        link_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<GraphWorkspace, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let workspace = session
            .store
            .delete_visual_link(workspace_id, expected_revision, link_id, now_unix_ms)
            .map_err(map_graph_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(workspace)
    }

    pub fn preview_graph_relationship_draft(
        &mut self,
        project_id: LocalId,
        workspace_id: LocalId,
        link_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<GraphRelationshipDraftPreview, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let preview = resolve_graph_relationship_draft(&session.store, workspace_id, link_id)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(preview)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn commit_graph_relationship_draft(
        &mut self,
        project_id: LocalId,
        workspace_id: LocalId,
        link_id: LocalId,
        relationship_type: impl AsRef<str>,
        properties: Value,
        now_unix_ms: i64,
    ) -> Result<StixDraft, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let preview = resolve_graph_relationship_draft(&session.store, workspace_id, link_id)?;
        let link = preview.visual_link();
        let relationship =
            SemanticRelationshipDraft::new(link.source_id(), link.target_id(), relationship_type)
                .map_err(|_| LifecycleError::new(LifecycleErrorCode::InvalidStix))?;
        let draft = StixDraft::new_relationship(
            LocalId::from_uuid(Uuid::new_v4()),
            relationship,
            properties,
        )
        .map_err(|_| LifecycleError::new(LifecycleErrorCode::InvalidStix))?;
        let objects = session.store.list_stix_objects().map_err(map_store_error)?;
        let drafts = session.store.list_stix_drafts().map_err(map_store_error)?;
        validate_stix_relationship_endpoints(&objects, &drafts, &draft)?;
        session
            .store
            .save_stix_draft(&draft)
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(draft)
    }

    pub fn list_technique_observations(
        &mut self,
        project_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<Vec<TechniqueObservation>, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let observations = session
            .store
            .list_technique_observations()
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(observations)
    }

    pub fn import_technique_observations(
        &mut self,
        project_id: LocalId,
        observations: &[TechniqueObservation],
        replace_existing: bool,
        now_unix_ms: i64,
    ) -> Result<ObservationImportOutcome, LifecycleError> {
        if observations.len() > MAX_MAPPING_OBSERVATIONS {
            return Err(LifecycleError::new(
                LifecycleErrorCode::MitreCatalogLimitExceeded,
            ));
        }
        let mut ids = std::collections::HashSet::with_capacity(observations.len());
        if !observations.iter().all(|item| ids.insert(item.id())) {
            return Err(LifecycleError::new(
                LifecycleErrorCode::InvalidMitreReference,
            ));
        }
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let (imported, skipped) = session
            .store
            .import_technique_observations(observations, replace_existing)
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(ObservationImportOutcome { imported, skipped })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_technique_observation(
        &mut self,
        project_id: LocalId,
        reference: MitreTechniqueReference,
        catalog: &CatalogSnapshot,
        assessment: TechniqueAssessment,
        outcome: TechniqueOutcome,
        confidence: AnalyticConfidence,
        narrative: impl AsRef<str>,
        first_seen_unix_ms: Option<i64>,
        last_seen_unix_ms: Option<i64>,
        now_unix_ms: i64,
    ) -> Result<TechniqueObservation, LifecycleError> {
        validate_reference_in(catalog, &reference).map_err(map_mitre_error)?;
        let observation = TechniqueObservation::new(
            LocalId::from_uuid(Uuid::new_v4()),
            reference,
            assessment,
            outcome,
            confidence,
            narrative,
            first_seen_unix_ms,
            last_seen_unix_ms,
            now_unix_ms,
        )
        .map_err(map_domain_error)?;
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        session
            .store
            .save_technique_observation(&observation, None)
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(observation)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_technique_observation(
        &mut self,
        project_id: LocalId,
        observation_id: LocalId,
        expected_revision: Revision,
        assessment: TechniqueAssessment,
        outcome: TechniqueOutcome,
        confidence: AnalyticConfidence,
        narrative: impl AsRef<str>,
        first_seen_unix_ms: Option<i64>,
        last_seen_unix_ms: Option<i64>,
        now_unix_ms: i64,
    ) -> Result<TechniqueObservation, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let current = session
            .store
            .list_technique_observations()
            .map_err(map_store_error)?
            .into_iter()
            .find(|observation| observation.id() == observation_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::TechniqueObservationNotFound))?;
        if current.revision() != expected_revision {
            return Err(LifecycleError::new(LifecycleErrorCode::RevisionConflict));
        }
        let updated = current
            .revise(
                assessment,
                outcome,
                confidence,
                narrative,
                first_seen_unix_ms,
                last_seen_unix_ms,
                now_unix_ms,
            )
            .map_err(map_domain_error)?;
        session
            .store
            .save_technique_observation(&updated, Some(expected_revision))
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(updated)
    }

    pub fn delete_technique_observation(
        &mut self,
        project_id: LocalId,
        observation_id: LocalId,
        expected_revision: Revision,
        now_unix_ms: i64,
    ) -> Result<(), LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        session
            .store
            .delete_technique_observation(observation_id, expected_revision)
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(())
    }

    pub fn list_stix_objects(
        &mut self,
        project_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<Vec<ExistingStixObject>, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let objects = session.store.list_stix_objects().map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(objects)
    }

    pub fn delete_stix_object(
        &mut self,
        project_id: LocalId,
        object_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<(), LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let objects = session.store.list_stix_objects().map_err(map_store_error)?;
        let drafts = session.store.list_stix_drafts().map_err(map_store_error)?;
        let target = objects
            .iter()
            .find(|object| object.local_id() == object_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::InvalidStix))?;
        let referenced_by_object = objects.iter().any(|object| {
            object.local_id() != object_id
                && stix_reference_fields_contain(object.raw(), target.stix_id())
        });
        let referenced_by_draft = drafts.iter().any(|draft| {
            draft.local_id() == object_id
                || draft.replaces_stix_id() == Some(target.stix_id())
                || draft.semantic_relationship().is_some_and(|relationship| {
                    relationship.source_id() == object_id || relationship.target_id() == object_id
                })
                || stix_reference_fields_contain(
                    &Value::Object(draft.properties().clone()),
                    target.stix_id(),
                )
        });
        if referenced_by_object || referenced_by_draft {
            return Err(LifecycleError::new(LifecycleErrorCode::StixObjectInUse));
        }
        if !session
            .store
            .delete_stix_object_and_remove_projection_memberships(
                object_id,
                "All intelligence",
                now_unix_ms,
            )
            .map_err(map_store_error)?
        {
            return Err(LifecycleError::new(LifecycleErrorCode::InvalidStix));
        }
        session.last_active_unix_ms = now_unix_ms;
        Ok(())
    }

    pub fn commit_stix_import(
        &mut self,
        project_id: LocalId,
        commit: &ImportCommit,
        now_unix_ms: i64,
    ) -> Result<(), LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        session
            .store
            .commit_stix_import(commit)
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(())
    }

    pub fn list_stix_drafts(
        &mut self,
        project_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<Vec<StixDraft>, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let drafts = session.store.list_stix_drafts().map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(drafts)
    }

    pub fn save_stix_draft(
        &mut self,
        project_id: LocalId,
        draft: &StixDraft,
        now_unix_ms: i64,
    ) -> Result<(), LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let objects = session.store.list_stix_objects().map_err(map_store_error)?;
        let drafts = session.store.list_stix_drafts().map_err(map_store_error)?;
        validate_stix_relationship_endpoints(&objects, &drafts, draft)?;
        session
            .store
            .save_stix_draft(draft)
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(())
    }

    pub fn create_stix_revision_draft(
        &mut self,
        project_id: LocalId,
        object_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<StixDraft, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let objects = session.store.list_stix_objects().map_err(map_store_error)?;
        let object = objects
            .iter()
            .find(|candidate| candidate.local_id() == object_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::InvalidStix))?;
        let drafts = session.store.list_stix_drafts().map_err(map_store_error)?;
        if let Some(draft) = drafts.iter().find(|draft| draft.local_id() == object_id) {
            if draft.replaces_stix_id() == Some(object.stix_id()) {
                session.last_active_unix_ms = now_unix_ms;
                return Ok(draft.clone());
            }
            return Err(LifecycleError::new(LifecycleErrorCode::InvalidStix));
        }

        let mut properties = object
            .raw()
            .as_object()
            .cloned()
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::InvalidStix))?;
        for reserved in ["type", "spec_version", "id"] {
            properties.remove(reserved);
        }
        let relationship = if object.object_type() == "relationship" {
            let source_ref = properties
                .remove("source_ref")
                .and_then(|value| value.as_str().map(str::to_owned))
                .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::InvalidStix))?;
            let target_ref = properties
                .remove("target_ref")
                .and_then(|value| value.as_str().map(str::to_owned))
                .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::InvalidStix))?;
            let relationship_type = properties
                .remove("relationship_type")
                .and_then(|value| value.as_str().map(str::to_owned))
                .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::InvalidStix))?;
            let source_id = objects
                .iter()
                .find(|candidate| candidate.stix_id() == source_ref)
                .map(ExistingStixObject::local_id)
                .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::InvalidStix))?;
            let target_id = objects
                .iter()
                .find(|candidate| candidate.stix_id() == target_ref)
                .map(ExistingStixObject::local_id)
                .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::InvalidStix))?;
            Some(
                sheut_core::SemanticRelationshipDraft::new(source_id, target_id, relationship_type)
                    .map_err(|_| LifecycleError::new(LifecycleErrorCode::InvalidStix))?,
            )
        } else {
            None
        };
        let draft = StixDraft::new_revision(object, Value::Object(properties), relationship)
            .map_err(|_| LifecycleError::new(LifecycleErrorCode::InvalidStix))?;
        validate_stix_relationship_endpoints(&objects, &drafts, &draft)?;
        session
            .store
            .save_stix_draft(&draft)
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(draft)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_stix_draft(
        &mut self,
        project_id: LocalId,
        draft_id: LocalId,
        object_type: impl Into<String>,
        properties: Value,
        semantic_relationship: Option<sheut_core::SemanticRelationshipDraft>,
        now_unix_ms: i64,
    ) -> Result<StixDraft, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let objects = session.store.list_stix_objects().map_err(map_store_error)?;
        let drafts = session.store.list_stix_drafts().map_err(map_store_error)?;
        let current = drafts
            .iter()
            .find(|draft| draft.local_id() == draft_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::InvalidStix))?;
        let updated = current
            .updated(object_type, properties, semantic_relationship)
            .map_err(|_| LifecycleError::new(LifecycleErrorCode::InvalidStix))?;
        validate_stix_relationship_endpoints(&objects, &drafts, &updated)?;
        session
            .store
            .save_stix_draft(&updated)
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(updated)
    }

    pub fn promote_stix_drafts(
        &mut self,
        project_id: LocalId,
        objects: &[ExistingStixObject],
        now_unix_ms: i64,
    ) -> Result<(), LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        session
            .store
            .promote_stix_drafts(objects)
            .map_err(|error| {
                if error.code() == StoreErrorCode::NotFound {
                    LifecycleError::new(LifecycleErrorCode::InvalidStix)
                } else {
                    map_store_error(error)
                }
            })?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(())
    }

    pub fn delete_stix_draft(
        &mut self,
        project_id: LocalId,
        draft_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<(), LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let is_relationship_endpoint = session
            .store
            .list_stix_drafts()
            .map_err(map_store_error)?
            .iter()
            .filter_map(StixDraft::semantic_relationship)
            .any(|relationship| {
                relationship.source_id() == draft_id || relationship.target_id() == draft_id
            });
        if is_relationship_endpoint {
            return Err(LifecycleError::new(LifecycleErrorCode::StixDraftInUse));
        }
        if !session
            .store
            .delete_stix_draft(draft_id)
            .map_err(map_store_error)?
        {
            return Err(LifecycleError::new(LifecycleErrorCode::InvalidStix));
        }
        session.last_active_unix_ms = now_unix_ms;
        Ok(())
    }

    pub fn load_document(
        &mut self,
        project_id: LocalId,
        document_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<DocumentEnvelope, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let document = require_active_document(&session.store, document_id)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(document)
    }

    pub fn save_document(
        &mut self,
        project_id: LocalId,
        document_id: LocalId,
        expected_revision: Revision,
        root: Value,
        now_unix_ms: i64,
    ) -> Result<DocumentEnvelope, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let current = session
            .store
            .load_document(document_id)
            .map_err(map_store_error)?
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::DocumentNotFound))?;
        require_current_document(&current)?;
        let document = DocumentEnvelope::new(
            current.id(),
            current.kind(),
            expected_revision.next().map_err(map_domain_error)?,
            root,
        )
        .map_err(map_domain_error)?;
        session
            .store
            .save_document_at(&document, Some(expected_revision), now_unix_ms)
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(document)
    }

    pub fn delete_document(
        &mut self,
        project_id: LocalId,
        document_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<(), LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        require_active_document(&session.store, document_id)?;
        let deleted = session
            .store
            .soft_delete_document(document_id, now_unix_ms)
            .map_err(map_store_error)?;
        if !deleted {
            return Err(LifecycleError::new(LifecycleErrorCode::DocumentNotFound));
        }
        session.last_active_unix_ms = now_unix_ms;
        Ok(())
    }

    pub fn restore_document(
        &mut self,
        project_id: LocalId,
        document_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<DocumentEnvelope, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        require_stored_document(&session.store, document_id)?;
        let restored = session
            .store
            .restore_document(document_id, now_unix_ms)
            .map_err(map_store_error)?;
        if !restored {
            return Err(LifecycleError::new(LifecycleErrorCode::DocumentNotFound));
        }
        let document = require_active_document(&session.store, document_id)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(document)
    }

    pub fn list_document_revisions(
        &mut self,
        project_id: LocalId,
        document_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<Vec<DocumentRevisionSummary>, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        require_active_document(&session.store, document_id)?;
        let revisions = session
            .store
            .list_document_revisions(document_id)
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(revisions)
    }

    pub fn list_document_activity(
        &mut self,
        project_id: LocalId,
        document_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<Vec<DocumentActivityEntry>, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        require_active_document(&session.store, document_id)?;
        let activity = session
            .store
            .list_document_activity(document_id)
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(activity)
    }

    pub fn compare_document_revisions(
        &mut self,
        project_id: LocalId,
        document_id: LocalId,
        from_revision: Revision,
        to_revision: Revision,
        now_unix_ms: i64,
    ) -> Result<DocumentRevisionDiff, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        require_active_document(&session.store, document_id)?;
        let from = load_document_revision(&session.store, document_id, from_revision)?;
        let to = load_document_revision(&session.store, document_id, to_revision)?;
        let before = render_document(&from);
        let after = render_document(&to);
        let (segments, simplified) = compare_document_text(before.plain_text(), after.plain_text());
        session.last_active_unix_ms = now_unix_ms;
        Ok(DocumentRevisionDiff::new(
            from_revision,
            to_revision,
            segments,
            simplified,
        ))
    }

    pub fn restore_document_revision(
        &mut self,
        project_id: LocalId,
        document_id: LocalId,
        source_revision: Revision,
        expected_revision: Revision,
        now_unix_ms: i64,
    ) -> Result<DocumentEnvelope, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let current = require_active_document(&session.store, document_id)?;
        if current.revision() != expected_revision {
            return Err(LifecycleError::new(LifecycleErrorCode::RevisionConflict));
        }
        let source = load_document_revision(&session.store, document_id, source_revision)?;
        let restored = DocumentEnvelope::new(
            current.id(),
            current.kind(),
            expected_revision.next().map_err(map_domain_error)?,
            source.root().clone(),
        )
        .map_err(map_domain_error)?;
        session
            .store
            .save_restored_document_revision(
                &restored,
                expected_revision,
                source_revision,
                now_unix_ms,
            )
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(restored)
    }

    pub fn create_image_attachment(
        &mut self,
        project_id: LocalId,
        document_id: LocalId,
        file_name: impl AsRef<str>,
        payload: Vec<u8>,
        now_unix_ms: i64,
    ) -> Result<ImageAttachmentMetadata, LifecycleError> {
        let media_type = ImageMediaType::detect(&payload).map_err(map_domain_error)?;
        let byte_len = u64::try_from(payload.len())
            .map_err(|_| LifecycleError::new(LifecycleErrorCode::InvalidAttachment))?;
        let metadata = ImageAttachmentMetadata::new(
            LocalId::from_uuid(Uuid::new_v4()),
            document_id,
            media_type,
            file_name,
            byte_len,
        )
        .map_err(map_domain_error)?;
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        require_active_document(&session.store, document_id)?;
        session
            .store
            .save_image_attachment(&metadata, &payload)
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(metadata)
    }

    pub fn load_image_attachment(
        &mut self,
        project_id: LocalId,
        document_id: LocalId,
        attachment_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<(ImageAttachmentMetadata, Vec<u8>), LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        if let Some(document) = session
            .store
            .load_document_record(document_id)
            .map_err(map_store_error)?
        {
            require_current_document(&document)?;
        }
        let attachment = session
            .store
            .load_image_attachment(document_id, attachment_id)
            .map_err(map_store_error)?
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::AttachmentNotFound))?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(attachment)
    }

    pub fn create_evidence_image(
        &mut self,
        project_id: LocalId,
        file_name: impl AsRef<str>,
        payload: Vec<u8>,
        now_unix_ms: i64,
    ) -> Result<EvidenceFileMetadata, LifecycleError> {
        ImageMediaType::detect(&payload).map_err(map_domain_error)?;
        self.create_evidence_file(project_id, file_name, payload, now_unix_ms)
    }

    pub fn create_evidence_file(
        &mut self,
        project_id: LocalId,
        file_name: impl AsRef<str>,
        payload: Vec<u8>,
        now_unix_ms: i64,
    ) -> Result<EvidenceFileMetadata, LifecycleError> {
        let file_name = file_name.as_ref();
        let media_type =
            detect_evidence_media_type(file_name, &payload).map_err(map_domain_error)?;
        let byte_len = u64::try_from(payload.len())
            .map_err(|_| LifecycleError::new(LifecycleErrorCode::InvalidAttachment))?;
        let metadata = EvidenceFileMetadata::new(
            LocalId::from_uuid(Uuid::new_v4()),
            media_type,
            file_name,
            byte_len,
            format!("{:x}", Sha256::digest(&payload)),
            now_unix_ms,
        )
        .map_err(map_domain_error)?;
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let existing_files = session
            .store
            .list_evidence_files()
            .map_err(map_store_error)?;
        if let Some(existing) = existing_files
            .iter()
            .find(|existing| existing.sha256() == metadata.sha256())
        {
            session.last_active_unix_ms = now_unix_ms;
            return Ok(existing.clone());
        }
        if !evidence_project_total_within_limit(
            existing_files.iter().map(EvidenceFileMetadata::byte_len),
            byte_len,
        ) {
            return Err(LifecycleError::new(LifecycleErrorCode::InvalidAttachment));
        }
        session
            .store
            .save_evidence_file(&metadata, &payload)
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(metadata)
    }

    pub fn list_evidence_files(
        &mut self,
        project_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<Vec<EvidenceFileMetadata>, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let evidence = session
            .store
            .list_evidence_files()
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(evidence)
    }

    pub fn load_evidence_file(
        &mut self,
        project_id: LocalId,
        evidence_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<(EvidenceFileMetadata, Vec<u8>), LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let evidence = session
            .store
            .load_evidence_file(evidence_id)
            .map_err(map_store_error)?
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::AttachmentNotFound))?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(evidence)
    }

    pub fn load_evidence_image(
        &mut self,
        project_id: LocalId,
        evidence_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<(EvidenceFileMetadata, Vec<u8>), LifecycleError> {
        let (metadata, payload) = self.load_evidence_file(project_id, evidence_id, now_unix_ms)?;
        let detected = ImageMediaType::detect(&payload).map_err(map_domain_error)?;
        if metadata.media_type() != detected.as_str() {
            return Err(LifecycleError::new(LifecycleErrorCode::InvalidAttachment));
        }
        Ok((metadata, payload))
    }

    pub fn update_evidence_metadata(
        &mut self,
        project_id: LocalId,
        evidence_id: LocalId,
        expected_revision: Revision,
        input: EvidenceMetadataInput,
        now_unix_ms: i64,
    ) -> Result<EvidenceFileMetadata, LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        let (current, _) = session
            .store
            .load_evidence_file(evidence_id)
            .map_err(map_store_error)?
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::AttachmentNotFound))?;
        let revised = current
            .updated(expected_revision, input, now_unix_ms)
            .map_err(map_domain_error)?;
        session
            .store
            .update_evidence_metadata(&revised, expected_revision)
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(revised)
    }

    pub fn delete_evidence_file(
        &mut self,
        project_id: LocalId,
        evidence_id: LocalId,
        expected_revision: Revision,
        now_unix_ms: i64,
    ) -> Result<(), LifecycleError> {
        let session = self
            .sessions
            .get_mut(&project_id)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::ProjectLocked))?;
        session
            .store
            .delete_evidence_file(evidence_id, expected_revision)
            .map_err(map_store_error)?;
        session.last_active_unix_ms = now_unix_ms;
        Ok(())
    }

    pub fn lock_idle_projects(&mut self, now_unix_ms: i64, timeout_ms: i64) -> Vec<LocalId> {
        let mut expired: Vec<_> = self
            .sessions
            .iter()
            .filter_map(|(id, session)| {
                (now_unix_ms.saturating_sub(session.last_active_unix_ms) >= timeout_ms)
                    .then_some(*id)
            })
            .collect();
        expired.sort_by_key(ToString::to_string);
        for id in &expired {
            self.sessions.remove(id);
        }
        expired
    }

    pub fn lock_all_projects(&mut self) -> Vec<LocalId> {
        let mut locked = self.sessions.keys().copied().collect::<Vec<_>>();
        locked.sort_by_key(ToString::to_string);
        self.sessions.clear();
        locked
    }

    pub fn project(&self, id: LocalId) -> Result<ProjectStatus, LifecycleError> {
        if let Some(session) = self.sessions.get(&id) {
            return Ok(ProjectStatus::unlocked(
                session.metadata.clone(),
                session.unlock_method,
            ));
        }
        let manifest = validate_project_directory(&self.project_directory(id), id)?;
        Ok(ProjectStatus::from_locked_manifest(manifest))
    }

    pub fn list_projects(&self) -> Result<Vec<ProjectStatus>, LifecycleError> {
        let entries = fs::read_dir(&self.root)
            .map_err(|_| LifecycleError::new(LifecycleErrorCode::StorageUnavailable))?;
        let mut projects = Vec::new();

        for entry in entries {
            let entry =
                entry.map_err(|_| LifecycleError::new(LifecycleErrorCode::StorageUnavailable))?;
            let Some(directory_name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            let Ok(id) = LocalId::parse(&directory_name) else {
                continue;
            };
            let Ok(manifest) = validate_project_directory(&self.project_directory(id), id) else {
                continue;
            };

            let status = self
                .sessions
                .get(&id)
                .map_or(ProjectStatus::from_locked_manifest(manifest), |session| {
                    ProjectStatus::unlocked(session.metadata.clone(), session.unlock_method)
                });
            projects.push(status);
        }

        projects.sort_by_key(|project| project.id().to_string());
        Ok(projects)
    }

    fn project_directory(&self, id: LocalId) -> PathBuf {
        self.root.join(id.to_string())
    }
}

impl ProjectStatus {
    fn unlocked(metadata: ProjectMetadata, unlock_method: UnlockMethod) -> Self {
        Self {
            id: metadata.id(),
            name: Some(metadata.name().to_owned()),
            locked: false,
            unlock_method,
            default_tlp_marking: Some(metadata.default_tlp_marking()),
        }
    }

    fn from_locked_manifest(manifest: ProjectManifest) -> Self {
        Self {
            id: manifest.project_id,
            name: manifest.display_name,
            locked: true,
            unlock_method: manifest.unlock_method,
            default_tlp_marking: None,
        }
    }
}

struct ProjectSession {
    store: EncryptedStore,
    key: ProjectKey,
    metadata: ProjectMetadata,
    unlock_method: UnlockMethod,
    last_active_unix_ms: i64,
}

fn default_document_root(kind: DocumentKind) -> Value {
    let title = match kind {
        DocumentKind::Investigation => "Untitled investigation",
        DocumentKind::AnalystNote => "Untitled analyst note",
        DocumentKind::Report => "Untitled report",
    };
    serde_json::json!({
        "type": "doc",
        "content": [
            {
                "type": "heading",
                "attrs": {"level": 1},
                "content": [{"type": "text", "text": title}]
            },
            {"type": "paragraph"}
        ]
    })
}

fn require_active_document(
    store: &EncryptedStore,
    document_id: LocalId,
) -> Result<DocumentEnvelope, LifecycleError> {
    let document = store
        .load_document(document_id)
        .map_err(map_store_error)?
        .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::DocumentNotFound))?;
    require_current_document(&document)?;
    Ok(document)
}

fn require_stored_document(
    store: &EncryptedStore,
    document_id: LocalId,
) -> Result<DocumentEnvelope, LifecycleError> {
    let document = store
        .load_document_record(document_id)
        .map_err(map_store_error)?
        .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::DocumentNotFound))?;
    require_current_document(&document)?;
    Ok(document)
}

fn require_current_document(document: &DocumentEnvelope) -> Result<(), LifecycleError> {
    if document.kind() == DocumentKind::Report {
        return Err(LifecycleError::new(LifecycleErrorCode::InvalidDocument));
    }
    Ok(())
}

fn load_document_revision(
    store: &EncryptedStore,
    document_id: LocalId,
    revision: Revision,
) -> Result<DocumentEnvelope, LifecycleError> {
    let document = store
        .load_document_revision(document_id, revision)
        .map_err(map_store_error)?
        .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::DocumentRevisionNotFound))?;
    require_current_document(&document)?;
    Ok(document)
}

fn compare_document_text(before: &str, after: &str) -> (Vec<DocumentTextDiffSegment>, bool) {
    let before_tokens = tokenize_document_text(before);
    let after_tokens = tokenize_document_text(after);
    let prefix_len = before_tokens
        .iter()
        .zip(&after_tokens)
        .take_while(|(before, after)| before == after)
        .count();
    let suffix_len = before_tokens[prefix_len..]
        .iter()
        .rev()
        .zip(after_tokens[prefix_len..].iter().rev())
        .take_while(|(before, after)| before == after)
        .count();
    let before_middle = &before_tokens[prefix_len..before_tokens.len() - suffix_len];
    let after_middle = &after_tokens[prefix_len..after_tokens.len() - suffix_len];
    let mut raw_segments = Vec::new();

    push_text_segment(
        &mut raw_segments,
        DocumentTextDiffKind::Unchanged,
        before_tokens[..prefix_len].concat(),
    );

    let matrix_cells = before_middle.len().checked_mul(after_middle.len());
    let simplified = matrix_cells.is_none_or(|cells| cells > MAX_DOCUMENT_DIFF_MATRIX_CELLS);
    if simplified {
        push_text_segment(
            &mut raw_segments,
            DocumentTextDiffKind::Removed,
            before_middle.concat(),
        );
        push_text_segment(
            &mut raw_segments,
            DocumentTextDiffKind::Added,
            after_middle.concat(),
        );
    } else {
        collect_lcs_text_diff(before_middle, after_middle, &mut raw_segments);
    }

    push_text_segment(
        &mut raw_segments,
        DocumentTextDiffKind::Unchanged,
        before_tokens[before_tokens.len() - suffix_len..].concat(),
    );

    (
        raw_segments
            .into_iter()
            .map(|(kind, text)| DocumentTextDiffSegment::new(kind, text))
            .collect(),
        simplified,
    )
}

fn collect_lcs_text_diff(
    before: &[&str],
    after: &[&str],
    segments: &mut Vec<(DocumentTextDiffKind, String)>,
) {
    let columns = after.len() + 1;
    let mut lengths = vec![0_u32; (before.len() + 1) * columns];
    for before_index in (0..before.len()).rev() {
        for after_index in (0..after.len()).rev() {
            let index = before_index * columns + after_index;
            lengths[index] = if before[before_index] == after[after_index] {
                lengths[(before_index + 1) * columns + after_index + 1] + 1
            } else {
                lengths[(before_index + 1) * columns + after_index]
                    .max(lengths[before_index * columns + after_index + 1])
            };
        }
    }

    let (mut before_index, mut after_index) = (0, 0);
    while before_index < before.len() && after_index < after.len() {
        if before[before_index] == after[after_index] {
            push_text_segment(
                segments,
                DocumentTextDiffKind::Unchanged,
                before[before_index].to_owned(),
            );
            before_index += 1;
            after_index += 1;
        } else if lengths[(before_index + 1) * columns + after_index]
            >= lengths[before_index * columns + after_index + 1]
        {
            push_text_segment(
                segments,
                DocumentTextDiffKind::Removed,
                before[before_index].to_owned(),
            );
            before_index += 1;
        } else {
            push_text_segment(
                segments,
                DocumentTextDiffKind::Added,
                after[after_index].to_owned(),
            );
            after_index += 1;
        }
    }
    push_text_segment(
        segments,
        DocumentTextDiffKind::Removed,
        before[before_index..].concat(),
    );
    push_text_segment(
        segments,
        DocumentTextDiffKind::Added,
        after[after_index..].concat(),
    );
}

fn push_text_segment(
    segments: &mut Vec<(DocumentTextDiffKind, String)>,
    kind: DocumentTextDiffKind,
    text: String,
) {
    if text.is_empty() {
        return;
    }
    if let Some((previous_kind, previous_text)) = segments.last_mut()
        && *previous_kind == kind
    {
        previous_text.push_str(&text);
        return;
    }
    segments.push((kind, text));
}

fn tokenize_document_text(value: &str) -> Vec<&str> {
    let mut characters = value.char_indices();
    let Some((_, first_character)) = characters.next() else {
        return Vec::new();
    };
    let mut tokens = Vec::new();
    let mut start = 0;
    let mut previous_kind = document_character_kind(first_character);
    for (index, character) in characters {
        let kind = document_character_kind(character);
        if kind != previous_kind {
            tokens.push(&value[start..index]);
            start = index;
            previous_kind = kind;
        }
    }
    tokens.push(&value[start..]);
    tokens
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum DocumentCharacterKind {
    Word,
    Whitespace,
    Punctuation,
}

fn document_character_kind(character: char) -> DocumentCharacterKind {
    if character.is_whitespace() {
        DocumentCharacterKind::Whitespace
    } else if character.is_alphanumeric() || character == '_' {
        DocumentCharacterKind::Word
    } else {
        DocumentCharacterKind::Punctuation
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ProjectManifest {
    format_version: u16,
    project_id: LocalId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
    #[serde(default)]
    unlock_method: UnlockMethod,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    passphrase_key_wrap: Option<PassphraseKeyWrap>,
}

impl ProjectManifest {
    fn device(project_id: LocalId, display_name: String) -> Self {
        Self {
            format_version: 1,
            project_id,
            display_name: Some(display_name),
            unlock_method: UnlockMethod::Device,
            passphrase_key_wrap: None,
        }
    }

    fn passphrase(
        project_id: LocalId,
        display_name: String,
        passphrase_key_wrap: PassphraseKeyWrap,
    ) -> Self {
        Self {
            format_version: 1,
            project_id,
            display_name: Some(display_name),
            unlock_method: UnlockMethod::Passphrase,
            passphrase_key_wrap: Some(passphrase_key_wrap),
        }
    }

    fn validate(&self, expected_id: LocalId) -> Result<(), LifecycleError> {
        if self.format_version != 1 || self.project_id != expected_id {
            return Err(LifecycleError::new(LifecycleErrorCode::InvalidProject));
        }
        if let Some(display_name) = &self.display_name {
            ProjectMetadata::new(expected_id, display_name, 0)
                .map_err(|_| LifecycleError::new(LifecycleErrorCode::InvalidProject))?;
        }
        match (self.unlock_method, &self.passphrase_key_wrap) {
            (UnlockMethod::Device, None) => Ok(()),
            (UnlockMethod::Passphrase, Some(key_wrap)) => key_wrap.validate(),
            _ => Err(LifecycleError::new(LifecycleErrorCode::InvalidProject)),
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PassphraseKeyWrap {
    algorithm: PassphraseKdfAlgorithm,
    version: u32,
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
    salt: String,
    nonce: String,
    wrapped_project_key: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum PassphraseKdfAlgorithm {
    Argon2id,
}

impl PassphraseKeyWrap {
    fn create(
        project_id: LocalId,
        passphrase: &str,
        project_key: &ProjectKey,
    ) -> Result<Self, LifecycleError> {
        let mut salt = [0_u8; PASSPHRASE_SALT_BYTES];
        let mut nonce = [0_u8; WRAP_NONCE_BYTES];
        getrandom::fill(&mut salt)
            .map_err(|_| LifecycleError::new(LifecycleErrorCode::StorageUnavailable))?;
        getrandom::fill(&mut nonce)
            .map_err(|_| LifecycleError::new(LifecycleErrorCode::StorageUnavailable))?;

        let wrapping_key = derive_wrapping_key(passphrase, &salt)
            .map_err(|_| LifecycleError::new(LifecycleErrorCode::StorageUnavailable))?;
        let cipher = XChaCha20Poly1305::new_from_slice(wrapping_key.as_ref())
            .map_err(|_| LifecycleError::new(LifecycleErrorCode::StorageUnavailable))?;
        // Bind the wrapped key to its project identity so a valid manifest from
        // one project cannot be transplanted into another project directory.
        let associated_data = project_key_associated_data(project_id);
        let wrapped_project_key = cipher
            .encrypt(
                XNonce::from_slice(&nonce),
                Payload {
                    msg: project_key.as_bytes(),
                    aad: associated_data.as_bytes(),
                },
            )
            .map_err(|_| LifecycleError::new(LifecycleErrorCode::StorageUnavailable))?;

        Ok(Self {
            algorithm: PassphraseKdfAlgorithm::Argon2id,
            version: ARGON2_VERSION,
            memory_kib: ARGON2_MEMORY_KIB,
            iterations: ARGON2_ITERATIONS,
            parallelism: ARGON2_PARALLELISM,
            salt: encode_hex(&salt),
            nonce: encode_hex(&nonce),
            wrapped_project_key: encode_hex(&wrapped_project_key),
        })
    }

    fn validate(&self) -> Result<(), LifecycleError> {
        // Refuse silent KDF downgrades: projects are opened only with the exact
        // parameters that this release writes and tests.
        if !matches!(self.algorithm, PassphraseKdfAlgorithm::Argon2id)
            || self.version != ARGON2_VERSION
            || self.memory_kib != ARGON2_MEMORY_KIB
            || self.iterations != ARGON2_ITERATIONS
            || self.parallelism != ARGON2_PARALLELISM
            || decode_hex::<PASSPHRASE_SALT_BYTES>(&self.salt).is_none()
            || decode_hex::<WRAP_NONCE_BYTES>(&self.nonce).is_none()
            || decode_hex::<WRAPPED_PROJECT_KEY_BYTES>(&self.wrapped_project_key).is_none()
        {
            return Err(LifecycleError::new(LifecycleErrorCode::InvalidProject));
        }
        Ok(())
    }

    fn open(&self, project_id: LocalId, passphrase: &str) -> Result<ProjectKey, LifecycleError> {
        if !passphrase_is_bounded(passphrase) {
            return Err(LifecycleError::new(
                LifecycleErrorCode::InvalidPassphraseOrCorrupt,
            ));
        }
        self.validate()
            .map_err(|_| LifecycleError::new(LifecycleErrorCode::InvalidPassphraseOrCorrupt))?;
        let salt = decode_hex::<PASSPHRASE_SALT_BYTES>(&self.salt)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::InvalidPassphraseOrCorrupt))?;
        let nonce = decode_hex::<WRAP_NONCE_BYTES>(&self.nonce)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::InvalidPassphraseOrCorrupt))?;
        let wrapped_project_key = decode_hex::<WRAPPED_PROJECT_KEY_BYTES>(
            &self.wrapped_project_key,
        )
        .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::InvalidPassphraseOrCorrupt))?;
        let wrapping_key = derive_wrapping_key(passphrase, &salt)
            .map_err(|_| LifecycleError::new(LifecycleErrorCode::InvalidPassphraseOrCorrupt))?;
        let cipher = XChaCha20Poly1305::new_from_slice(wrapping_key.as_ref())
            .map_err(|_| LifecycleError::new(LifecycleErrorCode::InvalidPassphraseOrCorrupt))?;
        let associated_data = project_key_associated_data(project_id);
        let plaintext = Zeroizing::new(
            cipher
                .decrypt(
                    XNonce::from_slice(&nonce),
                    Payload {
                        msg: &wrapped_project_key,
                        aad: associated_data.as_bytes(),
                    },
                )
                .map_err(|_| LifecycleError::new(LifecycleErrorCode::InvalidPassphraseOrCorrupt))?,
        );
        let bytes = plaintext
            .as_slice()
            .try_into()
            .map_err(|_| LifecycleError::new(LifecycleErrorCode::InvalidPassphraseOrCorrupt))?;
        Ok(ProjectKey::from_bytes(bytes))
    }
}

fn create_project_root(root: &Path) -> Result<(), LifecycleError> {
    match fs::symlink_metadata(root) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(LifecycleError::new(LifecycleErrorCode::InvalidProject));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(root)
                .map_err(|_| LifecycleError::new(LifecycleErrorCode::StorageUnavailable))?;
        }
        Err(_) => return Err(LifecycleError::new(LifecycleErrorCode::StorageUnavailable)),
    }
    set_directory_permissions(root)
}

fn create_project_directory(path: &Path) -> Result<(), LifecycleError> {
    fs::create_dir(path)
        .map_err(|_| LifecycleError::new(LifecycleErrorCode::StorageUnavailable))?;
    set_directory_permissions(path)
}

fn ensure_private_directory(path: &Path) -> Result<(), LifecycleError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            Err(LifecycleError::new(LifecycleErrorCode::InvalidProject))
        }
        Ok(_) => set_directory_permissions(path),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            fs::create_dir(path)
                .map_err(|_| LifecycleError::new(LifecycleErrorCode::StorageUnavailable))?;
            set_directory_permissions(path)
        }
        Err(_) => Err(LifecycleError::new(LifecycleErrorCode::StorageUnavailable)),
    }
}

fn backup_file_name(backup: ProjectBackup) -> String {
    format!(
        "{}--{}{}",
        backup.created_at_unix_ms, backup.id, BACKUP_EXTENSION
    )
}

fn parse_backup_file_name(file_name: &str) -> Option<ProjectBackup> {
    let stem = file_name.strip_suffix(BACKUP_EXTENSION)?;
    let (created_at, id) = stem.split_once("--")?;
    let created_at_unix_ms = created_at.parse::<i64>().ok()?;
    if created_at_unix_ms < 0 {
        return None;
    }
    let backup = ProjectBackup {
        id: LocalId::parse(id).ok()?,
        created_at_unix_ms,
    };
    (backup_file_name(backup) == file_name).then_some(backup)
}

fn backup_entries(path: &Path) -> Result<Vec<(ProjectBackup, PathBuf)>, LifecycleError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => {
            return Err(LifecycleError::new(LifecycleErrorCode::StorageUnavailable));
        }
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(LifecycleError::new(LifecycleErrorCode::InvalidProject));
    }

    let mut backups = Vec::new();
    for entry in fs::read_dir(path)
        .map_err(|_| LifecycleError::new(LifecycleErrorCode::StorageUnavailable))?
    {
        let entry =
            entry.map_err(|_| LifecycleError::new(LifecycleErrorCode::StorageUnavailable))?;
        let file_type = entry
            .file_type()
            .map_err(|_| LifecycleError::new(LifecycleErrorCode::StorageUnavailable))?;
        if file_type.is_symlink() || !file_type.is_file() {
            continue;
        }
        let Some(file_name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if let Some(backup) = parse_backup_file_name(&file_name) {
            backups.push((backup, entry.path()));
        }
    }
    Ok(backups)
}

fn restore_project_backup(
    project_directory: &Path,
    project_id: LocalId,
    backup_id: LocalId,
    now_unix_ms: i64,
    key: &ProjectKey,
) -> Result<(), LifecycleError> {
    if now_unix_ms < 0 {
        return Err(LifecycleError::new(LifecycleErrorCode::RecoveryFailed));
    }
    let backup_path = backup_entries(&project_directory.join(BACKUP_DIRECTORY))?
        .into_iter()
        .find_map(|(backup, path)| (backup.id == backup_id).then_some(path))
        .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::BackupNotFound))?;

    // Authenticate and inspect the backup under a random staging name before
    // moving the current database. A corrupt or cross-project backup therefore
    // cannot destroy the last known-good project state.
    let staging_path =
        project_directory.join(format!(".restore--{}{}", Uuid::new_v4(), BACKUP_EXTENSION));
    copy_sensitive_file(&backup_path, &staging_path)?;
    let staged_store = match EncryptedStore::open(&staging_path, key.as_bytes()) {
        Ok(store) => store,
        Err(_) => {
            let _ = fs::remove_file(&staging_path);
            return Err(LifecycleError::new(LifecycleErrorCode::RecoveryFailed));
        }
    };
    let staged_metadata = match staged_store.load_project() {
        Ok(metadata) => metadata,
        Err(_) => {
            drop(staged_store);
            let _ = fs::remove_file(&staging_path);
            return Err(LifecycleError::new(LifecycleErrorCode::RecoveryFailed));
        }
    };
    if staged_metadata.as_ref().map(ProjectMetadata::id) != Some(project_id) {
        drop(staged_store);
        let _ = fs::remove_file(&staging_path);
        return Err(LifecycleError::new(LifecycleErrorCode::RecoveryFailed));
    }
    drop(staged_store);

    let recovery_directory = project_directory.join(RECOVERY_DIRECTORY);
    ensure_private_directory(&recovery_directory)?;
    let rollback = ProjectBackup {
        id: LocalId::from_uuid(Uuid::new_v4()),
        created_at_unix_ms: now_unix_ms,
    };
    let database_path = project_directory.join(DATABASE_FILE);
    let rollback_path = recovery_directory.join(backup_file_name(rollback));
    let mut archived = Vec::new();
    if archive_file(&database_path, &rollback_path, &mut archived).is_err() {
        let _ = fs::remove_file(&staging_path);
        return Err(LifecycleError::new(LifecycleErrorCode::RecoveryFailed));
    }
    for suffix in ["-journal", "-wal", "-shm"] {
        let source = path_with_suffix(&database_path, suffix);
        match fs::symlink_metadata(&source) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(_) => {
                rollback_archived_files(&archived);
                let _ = fs::remove_file(&staging_path);
                return Err(LifecycleError::new(LifecycleErrorCode::RecoveryFailed));
            }
            Ok(_) => {}
        }
        let destination = path_with_suffix(&rollback_path, suffix);
        if archive_file(&source, &destination, &mut archived).is_err() {
            rollback_archived_files(&archived);
            let _ = fs::remove_file(&staging_path);
            return Err(LifecycleError::new(LifecycleErrorCode::RecoveryFailed));
        }
    }
    if fs::rename(&staging_path, &database_path).is_err() {
        rollback_archived_files(&archived);
        let _ = fs::remove_file(&staging_path);
        return Err(LifecycleError::new(LifecycleErrorCode::RecoveryFailed));
    }
    sync_directory(project_directory)?;
    sync_directory(&recovery_directory)?;
    Ok(())
}

fn copy_sensitive_file(source: &Path, destination: &Path) -> Result<(), LifecycleError> {
    // Backups and restores never follow a source symlink. The destination is a
    // freshly created private file within a previously validated project root.
    let source_metadata = fs::symlink_metadata(source)
        .map_err(|_| LifecycleError::new(LifecycleErrorCode::BackupNotFound))?;
    if source_metadata.file_type().is_symlink() || !source_metadata.is_file() {
        return Err(LifecycleError::new(LifecycleErrorCode::InvalidProject));
    }
    let result = (|| {
        let mut source_file = fs::File::open(source)
            .map_err(|_| LifecycleError::new(LifecycleErrorCode::RecoveryFailed))?;
        let mut destination_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination)
            .map_err(|_| LifecycleError::new(LifecycleErrorCode::RecoveryFailed))?;
        set_file_permissions(&destination_file)?;
        io::copy(&mut source_file, &mut destination_file)
            .map_err(|_| LifecycleError::new(LifecycleErrorCode::RecoveryFailed))?;
        destination_file
            .sync_all()
            .map_err(|_| LifecycleError::new(LifecycleErrorCode::RecoveryFailed))
    })();
    if result.is_err() {
        let _ = fs::remove_file(destination);
    }
    result
}

fn archive_file(
    source: &Path,
    destination: &Path,
    archived: &mut Vec<(PathBuf, PathBuf)>,
) -> Result<(), LifecycleError> {
    let metadata = fs::symlink_metadata(source)
        .map_err(|_| LifecycleError::new(LifecycleErrorCode::RecoveryFailed))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(LifecycleError::new(LifecycleErrorCode::RecoveryFailed));
    }
    fs::rename(source, destination)
        .map_err(|_| LifecycleError::new(LifecycleErrorCode::RecoveryFailed))?;
    archived.push((source.to_owned(), destination.to_owned()));
    Ok(())
}

fn rollback_archived_files(archived: &[(PathBuf, PathBuf)]) {
    for (source, destination) in archived.iter().rev() {
        let _ = fs::rename(destination, source);
    }
}

fn path_with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_owned();
    value.push(suffix);
    PathBuf::from(value)
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), LifecycleError> {
    fs::File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| LifecycleError::new(LifecycleErrorCode::RecoveryFailed))
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<(), LifecycleError> {
    Ok(())
}

fn write_manifest(directory: &Path, manifest: &ProjectManifest) -> Result<(), LifecycleError> {
    let path = directory.join(MANIFEST_FILE);
    let manifest = serde_json::to_vec(manifest)
        .map_err(|_| LifecycleError::new(LifecycleErrorCode::StorageUnavailable))?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| LifecycleError::new(LifecycleErrorCode::StorageUnavailable))?;
    set_file_permissions(&file)?;
    std::io::Write::write_all(&mut file, &manifest)
        .map_err(|_| LifecycleError::new(LifecycleErrorCode::StorageUnavailable))?;
    file.sync_all()
        .map_err(|_| LifecycleError::new(LifecycleErrorCode::StorageUnavailable))
}

fn validate_project_directory(
    directory: &Path,
    expected_id: LocalId,
) -> Result<ProjectManifest, LifecycleError> {
    let directory_metadata = fs::symlink_metadata(directory)
        .map_err(|_| LifecycleError::new(LifecycleErrorCode::ProjectNotFound))?;
    if directory_metadata.file_type().is_symlink() || !directory_metadata.is_dir() {
        return Err(LifecycleError::new(LifecycleErrorCode::InvalidProject));
    }

    let manifest_path = directory.join(MANIFEST_FILE);
    let database_path = directory.join(DATABASE_FILE);
    for path in [&manifest_path, &database_path] {
        let metadata = fs::symlink_metadata(path)
            .map_err(|_| LifecycleError::new(LifecycleErrorCode::InvalidProject))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(LifecycleError::new(LifecycleErrorCode::InvalidProject));
        }
    }
    if fs::metadata(&manifest_path)
        .map_err(|_| LifecycleError::new(LifecycleErrorCode::InvalidProject))?
        .len()
        > MAX_MANIFEST_BYTES
    {
        return Err(LifecycleError::new(LifecycleErrorCode::InvalidProject));
    }
    let manifest: ProjectManifest = serde_json::from_slice(
        &fs::read(manifest_path)
            .map_err(|_| LifecycleError::new(LifecycleErrorCode::InvalidProject))?,
    )
    .map_err(|_| LifecycleError::new(LifecycleErrorCode::InvalidProject))?;
    manifest.validate(expected_id)?;
    Ok(manifest)
}

fn validate_new_passphrase(passphrase: &str) -> Result<(), LifecycleError> {
    passphrase_is_bounded(passphrase)
        .then_some(())
        .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::InvalidPassphrase))
}

fn passphrase_is_bounded(passphrase: &str) -> bool {
    (MIN_PASSPHRASE_BYTES..=MAX_PASSPHRASE_BYTES).contains(&passphrase.len())
}

fn derive_wrapping_key(
    passphrase: &str,
    salt: &[u8; PASSPHRASE_SALT_BYTES],
) -> Result<Zeroizing<[u8; 32]>, argon2::Error> {
    let params = Params::new(
        ARGON2_MEMORY_KIB,
        ARGON2_ITERATIONS,
        ARGON2_PARALLELISM,
        Some(32),
    )?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut output = Zeroizing::new([0_u8; 32]);
    argon2.hash_password_into(passphrase.as_bytes(), salt, output.as_mut())?;
    Ok(output)
}

fn project_key_associated_data(project_id: LocalId) -> String {
    format!("sheut-project-key-v1:{project_id}")
}

fn encode_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    encoded
}

fn decode_hex<const N: usize>(encoded: &str) -> Option<[u8; N]> {
    if encoded.len() != N * 2 || !encoded.is_ascii() {
        return None;
    }
    let mut decoded = [0_u8; N];
    for (index, pair) in encoded.as_bytes().chunks_exact(2).enumerate() {
        let high = decode_hex_nibble(pair[0])?;
        let low = decode_hex_nibble(pair[1])?;
        decoded[index] = (high << 4) | low;
    }
    Some(decoded)
}

fn reserve_report_identifier(
    store: &mut EncryptedStore,
    template: &ReportTemplateDefinition,
) -> Result<String, LifecycleError> {
    let prefix = report_identifier_prefix(template);
    let marker = format!("{prefix}-");
    let minimum_next = store
        .list_all_guided_reports()
        .map_err(map_store_error)?
        .into_iter()
        .filter_map(|report| match report.fields().get("report_number") {
            Some(GuidedReportFieldValue::Text(value)) => value
                .strip_prefix(&marker)
                .filter(|suffix| {
                    !suffix.is_empty() && suffix.bytes().all(|byte| byte.is_ascii_digit())
                })
                .and_then(|suffix| suffix.parse::<u64>().ok()),
            _ => None,
        })
        .max()
        .map_or(1, |value| value.saturating_add(1));
    let sequence = store
        .reserve_report_number(prefix, minimum_next)
        .map_err(map_store_error)?;
    Ok(format!("{prefix}-{sequence:04}"))
}

fn report_identifier_prefix(template: &ReportTemplateDefinition) -> &'static str {
    const ILLICIT_ECOSYSTEM_TEMPLATE_ID: &str = "6fba43e4-fcac-5b12-b37a-17aa0d4e99ca";
    match template.builtin() {
        Some(BuiltinReportTemplate::ThreatActorProfile) => "TAP",
        Some(BuiltinReportTemplate::IntrusionAnalysis) => "IA",
        Some(BuiltinReportTemplate::CampaignReport) => "CR",
        Some(BuiltinReportTemplate::ExecutiveReport) => "ER",
        Some(BuiltinReportTemplate::BlankGuidedReport) => "RPT",
        None if template.id().to_string() == ILLICIT_ECOSYSTEM_TEMPLATE_ID => "IER",
        None => "RPT",
    }
}

fn guided_report_field_is_empty(value: &GuidedReportFieldValue) -> bool {
    matches!(value, GuidedReportFieldValue::Text(text) if text.trim().is_empty())
}

const fn decode_hex_nibble(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        _ => None,
    }
}

#[cfg(unix)]
fn set_directory_permissions(path: &Path) -> Result<(), LifecycleError> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|_| LifecycleError::new(LifecycleErrorCode::StorageUnavailable))
}

#[cfg(not(unix))]
fn set_directory_permissions(_path: &Path) -> Result<(), LifecycleError> {
    Ok(())
}

#[cfg(unix)]
fn set_file_permissions(file: &fs::File) -> Result<(), LifecycleError> {
    use std::os::unix::fs::PermissionsExt;

    file.set_permissions(fs::Permissions::from_mode(0o600))
        .map_err(|_| LifecycleError::new(LifecycleErrorCode::StorageUnavailable))
}

#[cfg(not(unix))]
fn set_file_permissions(_file: &fs::File) -> Result<(), LifecycleError> {
    Ok(())
}

fn map_domain_error(error: sheut_core::DomainError) -> LifecycleError {
    match error.code() {
        DomainErrorCode::InvalidName => LifecycleError::new(LifecycleErrorCode::InvalidName),
        DomainErrorCode::InvalidDocument
        | DomainErrorCode::InvalidGuidedReport
        | DomainErrorCode::InvalidBrandProfile => {
            LifecycleError::new(LifecycleErrorCode::InvalidDocument)
        }
        DomainErrorCode::InvalidAttachment => {
            LifecycleError::new(LifecycleErrorCode::InvalidAttachment)
        }
        DomainErrorCode::InvalidCatalogReference | DomainErrorCode::InvalidTechniqueObservation => {
            LifecycleError::new(LifecycleErrorCode::InvalidMitreReference)
        }
        DomainErrorCode::InvalidRevision | DomainErrorCode::RevisionOverflow => {
            LifecycleError::new(LifecycleErrorCode::RevisionConflict)
        }
        _ => LifecycleError::new(LifecycleErrorCode::InvalidProject),
    }
}

fn map_graph_domain_error(_error: sheut_core::DomainError) -> LifecycleError {
    LifecycleError::new(LifecycleErrorCode::InvalidGraphWorkspace)
}

fn map_graph_store_error(error: StoreError) -> LifecycleError {
    match error.code() {
        StoreErrorCode::NotFound => LifecycleError::new(LifecycleErrorCode::GraphWorkspaceNotFound),
        StoreErrorCode::RevisionConflict => {
            LifecycleError::new(LifecycleErrorCode::RevisionConflict)
        }
        StoreErrorCode::InvalidStoredData | StoreErrorCode::AlreadyExists => {
            LifecycleError::new(LifecycleErrorCode::InvalidGraphWorkspace)
        }
        _ => map_store_error(error),
    }
}

fn validate_graph_seed_items(
    store: &EncryptedStore,
    items: &[GraphWorkspaceSeedItem],
) -> Result<(), LifecycleError> {
    if items.len() > MAX_GRAPH_WORKSPACE_ITEMS {
        return Err(LifecycleError::new(
            LifecycleErrorCode::InvalidGraphWorkspace,
        ));
    }
    let unique = items
        .iter()
        .map(|item| item.item_id())
        .collect::<std::collections::HashSet<_>>();
    if unique.len() != items.len() {
        return Err(LifecycleError::new(
            LifecycleErrorCode::InvalidGraphWorkspace,
        ));
    }

    let intelligence = store
        .list_stix_objects()
        .map_err(map_graph_store_error)?
        .into_iter()
        .map(|object| object.local_id())
        .chain(
            store
                .list_stix_drafts()
                .map_err(map_graph_store_error)?
                .into_iter()
                .map(|draft| draft.local_id()),
        )
        .collect::<std::collections::HashSet<_>>();
    let documents = store
        .list_documents()
        .map_err(map_graph_store_error)?
        .into_iter()
        .map(|document| document.id())
        .collect::<std::collections::HashSet<_>>();
    let catalog_references = store
        .list_technique_observations()
        .map_err(map_graph_store_error)?
        .into_iter()
        .map(|observation| observation.id())
        .collect::<std::collections::HashSet<_>>();

    if items.iter().any(|item| match item.item_kind() {
        WorkspaceItemKind::Intelligence => !intelligence.contains(&item.item_id()),
        WorkspaceItemKind::Document => !documents.contains(&item.item_id()),
        WorkspaceItemKind::CatalogReference => !catalog_references.contains(&item.item_id()),
        WorkspaceItemKind::Evidence => false,
    }) {
        return Err(LifecycleError::new(
            LifecycleErrorCode::GraphItemUnavailable,
        ));
    }
    Ok(())
}

fn map_mitre_error(error: MitreCatalogError) -> LifecycleError {
    match error.code() {
        MitreCatalogErrorCode::ReferenceUnavailable => {
            LifecycleError::new(LifecycleErrorCode::MitreReferenceUnavailable)
        }
        MitreCatalogErrorCode::InvalidCatalog => {
            LifecycleError::new(LifecycleErrorCode::InvalidMitreReference)
        }
        MitreCatalogErrorCode::LimitExceeded => {
            LifecycleError::new(LifecycleErrorCode::InvalidMitreReference)
        }
        MitreCatalogErrorCode::StorageUnavailable => {
            LifecycleError::new(LifecycleErrorCode::StorageUnavailable)
        }
    }
}

fn stix_reference_fields_contain(value: &Value, target_stix_id: &str) -> bool {
    let Some(properties) = value.as_object() else {
        return false;
    };
    properties.iter().any(|(name, value)| {
        (name.ends_with("_ref") || name.ends_with("_refs"))
            && stix_reference_value_contains(value, target_stix_id)
    })
}

fn stix_reference_value_contains(value: &Value, target_stix_id: &str) -> bool {
    match value {
        Value::String(reference) => reference == target_stix_id,
        Value::Array(references) => references
            .iter()
            .any(|reference| reference.as_str() == Some(target_stix_id)),
        _ => false,
    }
}

fn validate_stix_relationship_endpoints(
    objects: &[ExistingStixObject],
    drafts: &[StixDraft],
    candidate: &StixDraft,
) -> Result<(), LifecycleError> {
    let Some(relationship) = candidate.semantic_relationship() else {
        return Ok(());
    };
    for endpoint in [relationship.source_id(), relationship.target_id()] {
        let object_type = objects
            .iter()
            .find(|object| object.local_id() == endpoint)
            .map(ExistingStixObject::object_type)
            .or_else(|| {
                drafts
                    .iter()
                    .find(|draft| draft.local_id() == endpoint)
                    .map(StixDraft::object_type)
            })
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::InvalidStix))?;
        if !is_relationship_endpoint_type(object_type) {
            return Err(LifecycleError::new(LifecycleErrorCode::InvalidStix));
        }
    }
    Ok(())
}

fn resolve_graph_relationship_draft(
    store: &EncryptedStore,
    workspace_id: LocalId,
    link_id: LocalId,
) -> Result<GraphRelationshipDraftPreview, LifecycleError> {
    let snapshot = store
        .load_graph_workspace(workspace_id, false)
        .map_err(map_graph_store_error)?
        .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::GraphWorkspaceNotFound))?;
    let link = snapshot
        .visual_links()
        .iter()
        .find(|link| link.id() == link_id)
        .cloned()
        .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::GraphItemUnavailable))?;
    let intelligence_ids = snapshot
        .items()
        .iter()
        .filter(|item| item.item_kind() == WorkspaceItemKind::Intelligence)
        .map(WorkspaceItem::item_id)
        .collect::<std::collections::HashSet<_>>();
    if !intelligence_ids.contains(&link.source_id())
        || !intelligence_ids.contains(&link.target_id())
    {
        return Err(LifecycleError::new(LifecycleErrorCode::InvalidStix));
    }
    let objects = store.list_stix_objects().map_err(map_store_error)?;
    let drafts = store.list_stix_drafts().map_err(map_store_error)?;
    let object_type = |item_id| {
        objects
            .iter()
            .find(|object| object.local_id() == item_id)
            .map(ExistingStixObject::object_type)
            .or_else(|| {
                drafts
                    .iter()
                    .find(|draft| draft.local_id() == item_id)
                    .map(StixDraft::object_type)
            })
            .filter(|object_type| is_relationship_endpoint_type(object_type))
            .map(str::to_owned)
            .ok_or_else(|| LifecycleError::new(LifecycleErrorCode::InvalidStix))
    };
    Ok(GraphRelationshipDraftPreview {
        source_object_type: object_type(link.source_id())?,
        target_object_type: object_type(link.target_id())?,
        visual_link: link,
    })
}

fn evidence_project_total_within_limit(
    byte_lengths: impl IntoIterator<Item = u64>,
    incoming_byte_len: u64,
) -> bool {
    byte_lengths
        .into_iter()
        .try_fold(incoming_byte_len, u64::checked_add)
        .is_some_and(|total| total <= MAX_PROJECT_EVIDENCE_BYTES)
}

fn map_store_error(error: StoreError) -> LifecycleError {
    match error.code() {
        StoreErrorCode::InvalidKeyOrCorrupt => {
            LifecycleError::new(LifecycleErrorCode::InvalidKeyOrCorrupt)
        }
        StoreErrorCode::NotFound => LifecycleError::new(LifecycleErrorCode::ProjectNotFound),
        StoreErrorCode::InvalidStoredData | StoreErrorCode::MigrationFailed => {
            LifecycleError::new(LifecycleErrorCode::InvalidProject)
        }
        StoreErrorCode::BackupFailed => LifecycleError::new(LifecycleErrorCode::BackupFailed),
        StoreErrorCode::RevisionConflict => {
            LifecycleError::new(LifecycleErrorCode::RevisionConflict)
        }
        StoreErrorCode::InvalidAttachment => {
            LifecycleError::new(LifecycleErrorCode::InvalidAttachment)
        }
        _ => LifecycleError::new(LifecycleErrorCode::StorageUnavailable),
    }
}

#[cfg(test)]
mod document_text_diff_tests {
    use super::*;

    #[test]
    fn evidence_project_budget_rejects_overflow_and_over_limit_totals() {
        assert!(evidence_project_total_within_limit(
            [MAX_PROJECT_EVIDENCE_BYTES - 1],
            1,
        ));
        assert!(!evidence_project_total_within_limit(
            [MAX_PROJECT_EVIDENCE_BYTES],
            1,
        ));
        assert!(!evidence_project_total_within_limit([u64::MAX], 1));
    }

    #[test]
    fn large_rewrites_fall_back_without_losing_either_version() {
        let before = (0..1_001)
            .map(|index| format!("old{index}"))
            .collect::<Vec<_>>()
            .join(" ");
        let after = (0..1_001)
            .map(|index| format!("new{index}"))
            .collect::<Vec<_>>()
            .join(" ");

        let (segments, simplified) = compare_document_text(&before, &after);

        assert!(simplified);
        let reconstructed_before = segments
            .iter()
            .filter(|segment| segment.kind() != DocumentTextDiffKind::Added)
            .map(DocumentTextDiffSegment::text)
            .collect::<String>();
        let reconstructed_after = segments
            .iter()
            .filter(|segment| segment.kind() != DocumentTextDiffKind::Removed)
            .map(DocumentTextDiffSegment::text)
            .collect::<String>();
        assert_eq!(reconstructed_before, before);
        assert_eq!(reconstructed_after, after);
    }
}
