//! Narrow Tauri adapters for validated project operations and native file dialogs.
//! Command arguments are untrusted; Rust retains path, persistence, and blocking-work ownership.

use std::{
    collections::{BTreeMap, HashMap},
    error::Error,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sheut_core::{
    AnalyticConfidence, BrandAssetMetadata, BrandAssetRole, BrandProfile, BrandProfileInput,
    DocumentActivityEntry, DocumentEnvelope, DocumentKind, DocumentRevisionDiff,
    DocumentRevisionSummary, EvidenceFileMetadata, EvidenceMetadataInput, GuidedReport,
    GuidedReportFieldValue, ImageAttachmentMetadata, ImageMediaType, LocalId,
    MAX_EVIDENCE_FILE_BYTES, MAX_IMAGE_ATTACHMENT_BYTES, MitreCatalog, MitreTechniqueReference,
    PageFurniture, PageOrientation, PaperSize, ProjectDataReferenceKind, PublicationRecord,
    PublicationReleaseEntry, PublicationSettings, PublicationSnapshot, PublicationSource,
    PublicationStatus, RenderedDocument, ReportSectionDisposition, ReportTemplateDefinition,
    ReportTemplateSection, Revision, SemanticRelationshipDraft, TechniqueAssessment,
    TechniqueObservation, TechniqueOutcome, TlpMarking, render_document,
};
use sheut_mitre::{
    CatalogSnapshot, CatalogStatus, CatalogStore, MAX_MAPPING_FILE_BYTES, MAX_MITRE_SOURCE_BYTES,
    MappingError, MappingErrorCode, MappingFile, MitreCatalogError, MitreCatalogErrorCode,
    NavigatorImportPreview, compile_official_catalog, export_mapping_file,
    export_navigator_projection as build_navigator_projection, import_mapping_file,
    navigator_catalog_from_source, preview_navigator_import as parse_navigator_layer,
};
use sheut_project::{
    BrandAssetUpload, LifecycleError, LifecycleErrorCode, ObservationImportOutcome,
    OsProjectKeyStore, ProjectBackup, ProjectManager, ProjectStatus, UnlockMethod,
};
use sheut_publish::{PublicationAssets, PublicationIr};
use sheut_stix::{
    DuplicateDecision, DuplicateStixObject, ExistingStixObject, ImportPreview,
    MAX_STIX_BUNDLE_BYTES, ProjectExportPreview, StixDraft, StixError, StixErrorCode,
    commit_import, commit_project_export, parse_bundle, preview_import, preview_project_export,
};
use tauri::{Emitter, Manager};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::export::{
    ExportFormat, ExportOutcome, render_freeform_snapshot, render_guided_snapshot,
    requested_file_name,
};

pub(crate) type SharedProjectManager = Arc<Mutex<ProjectManager<OsProjectKeyStore>>>;
type SharedCatalogStore = Arc<Mutex<CatalogStore>>;
const MAX_STIX_DISPLAY_NAME_CHARS: usize = 160;
pub(crate) const PROJECTS_AUTO_LOCKED_EVENT: &str = "projects-auto-locked";
const PROJECT_IDLE_TIMEOUT_MINUTES: i64 = 30;
const PROJECT_IDLE_TIMEOUT_MS: i64 = PROJECT_IDLE_TIMEOUT_MINUTES * 60 * 1_000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectsAutoLockedEvent {
    project_ids: Vec<LocalId>,
    idle_timeout_minutes: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct PublicationCommandOptions {
    format: ExportFormat,
    paper_size: PaperSize,
    orientation: PageOrientation,
    tlp_marking: TlpMarking,
    brand_profile_id: Option<String>,
    brand_profile_revision: Option<u64>,
    release_version: String,
    publication_status: PublicationStatus,
    include_release_history: bool,
    change_note: Option<String>,
    page_furniture: PageFurniture,
    included_sections: Vec<String>,
    appendices: Vec<String>,
    file_name: String,
}

pub(crate) struct AppState {
    pub(crate) projects: SharedProjectManager,
    stix_previews: Mutex<StixPreviews>,
    mitre_catalogs: SharedCatalogStore,
    mitre_previews: Mutex<HashMap<LocalId, CatalogSnapshot>>,
    mitre_mapping_previews: Mutex<MitreMappingPreviews>,
}

#[derive(Default)]
struct StixPreviews {
    imports: HashMap<LocalId, PendingStixImport>,
    exports: HashMap<LocalId, PendingStixExport>,
}

struct PendingStixImport {
    project_id: LocalId,
    preview: ImportPreview,
}

struct PendingStixExport {
    project_id: LocalId,
    preview: ProjectExportPreview,
}

#[derive(Default)]
struct MitreMappingPreviews {
    mappings: HashMap<LocalId, PendingMappingImport>,
    navigator: HashMap<LocalId, PendingNavigatorImport>,
}

struct PendingMappingImport {
    project_id: LocalId,
    mapping: MappingFile,
}

struct PendingNavigatorImport {
    project_id: LocalId,
    preview: NavigatorImportPreview,
}

#[derive(Debug, Serialize)]
pub(crate) struct CommandError {
    code: LifecycleErrorCode,
}

impl CommandError {
    pub(crate) const fn new(code: LifecycleErrorCode) -> Self {
        Self { code }
    }

    const fn storage_unavailable() -> Self {
        Self::new(LifecycleErrorCode::StorageUnavailable)
    }
}

impl From<LifecycleError> for CommandError {
    fn from(error: LifecycleError) -> Self {
        Self::new(error.code())
    }
}

impl From<StixError> for CommandError {
    fn from(error: StixError) -> Self {
        let code = match error.code() {
            StixErrorCode::UnsupportedSpecVersion => LifecycleErrorCode::UnsupportedStixVersion,
            StixErrorCode::ValidationFailed => LifecycleErrorCode::StixValidationFailed,
            StixErrorCode::LimitExceeded => LifecycleErrorCode::StixLimitExceeded,
            StixErrorCode::DuplicateDecisionRequired => {
                LifecycleErrorCode::DuplicateDecisionRequired
            }
            StixErrorCode::Cancelled => LifecycleErrorCode::ImportCancelled,
            StixErrorCode::InvalidJson
            | StixErrorCode::InvalidBundle
            | StixErrorCode::InvalidDraft => LifecycleErrorCode::InvalidStix,
        };
        Self::new(code)
    }
}

impl From<MitreCatalogError> for CommandError {
    fn from(error: MitreCatalogError) -> Self {
        let code = match error.code() {
            MitreCatalogErrorCode::InvalidCatalog => LifecycleErrorCode::InvalidMitreCatalog,
            MitreCatalogErrorCode::ReferenceUnavailable => {
                LifecycleErrorCode::MitreReferenceUnavailable
            }
            MitreCatalogErrorCode::LimitExceeded => LifecycleErrorCode::MitreCatalogLimitExceeded,
            MitreCatalogErrorCode::StorageUnavailable => LifecycleErrorCode::StorageUnavailable,
        };
        Self::new(code)
    }
}

impl From<MappingError> for CommandError {
    fn from(error: MappingError) -> Self {
        let code = match error.code() {
            MappingErrorCode::InvalidMapping | MappingErrorCode::InvalidNavigatorLayer => {
                LifecycleErrorCode::InvalidMitreMapping
            }
            MappingErrorCode::LimitExceeded => LifecycleErrorCode::MitreMappingLimitExceeded,
        };
        Self::new(code)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StixObjectSummary {
    local_id: LocalId,
    stix_id: String,
    object_type: String,
    display_name: String,
    modified: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    relationship: Option<StixRelationshipSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StixRelationshipSummary {
    relationship_type: String,
    source_ref: String,
    target_ref: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_id: Option<LocalId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    target_id: Option<LocalId>,
}

fn stix_object_summaries(objects: &[ExistingStixObject]) -> Vec<StixObjectSummary> {
    let local_ids = objects
        .iter()
        .map(|object| (object.stix_id(), object.local_id()))
        .collect::<HashMap<_, _>>();
    objects
        .iter()
        .map(|object| {
            let relationship = (object.object_type() == "relationship")
                .then(|| {
                    let raw = object.raw();
                    let relationship_type = raw.get("relationship_type")?.as_str()?;
                    let source_ref = raw.get("source_ref")?.as_str()?;
                    let target_ref = raw.get("target_ref")?.as_str()?;
                    Some(StixRelationshipSummary {
                        relationship_type: relationship_type.to_owned(),
                        source_ref: source_ref.to_owned(),
                        target_ref: target_ref.to_owned(),
                        source_id: local_ids.get(source_ref).copied(),
                        target_id: local_ids.get(target_ref).copied(),
                    })
                })
                .flatten();
            StixObjectSummary {
                local_id: object.local_id(),
                stix_id: object.stix_id().to_owned(),
                object_type: object.object_type().to_owned(),
                display_name: stix_display_name(object),
                modified: object.modified().map(str::to_owned),
                relationship,
            }
        })
        .collect()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StixDraftSummary {
    local_id: LocalId,
    object_type: String,
    properties: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_id: Option<LocalId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    target_id: Option<LocalId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    relationship_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    replaces_stix_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReportProjectDataItem {
    id: LocalId,
    kind: ProjectDataReferenceKind,
    object_type: String,
    label: String,
    summary: String,
    values: BTreeMap<String, String>,
}

impl From<&StixDraft> for StixDraftSummary {
    fn from(draft: &StixDraft) -> Self {
        let relationship = draft.semantic_relationship();
        Self {
            local_id: draft.local_id(),
            object_type: draft.object_type().to_owned(),
            properties: Value::Object(draft.properties().clone()),
            source_id: relationship.map(SemanticRelationshipDraft::source_id),
            target_id: relationship.map(SemanticRelationshipDraft::target_id),
            relationship_type: relationship
                .map(SemanticRelationshipDraft::relationship_type)
                .map(str::to_owned),
            replaces_stix_id: draft.replaces_stix_id().map(str::to_owned),
        }
    }
}

fn stix_display_name(object: &ExistingStixObject) -> String {
    ["name", "value", "subject"]
        .iter()
        .find_map(|property| object.raw().get(*property).and_then(Value::as_str))
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.chars().take(MAX_STIX_DISPLAY_NAME_CHARS).collect())
        .unwrap_or_else(|| object.stix_id().to_owned())
}

fn bounded_report_value(value: &str) -> String {
    value.trim().chars().take(4_000).collect()
}

fn readable_token(value: &str) -> String {
    let readable = value.replace(['-', '_'], " ");
    let mut characters = readable.chars();
    characters.next().map_or_else(String::new, |first| {
        first.to_uppercase().collect::<String>() + characters.as_str()
    })
}

fn report_values_from_stix(
    raw: &Value,
    label: &str,
    object_type: &str,
) -> BTreeMap<String, String> {
    let mut values = BTreeMap::from([
        ("label".to_owned(), label.to_owned()),
        ("name".to_owned(), label.to_owned()),
        ("type".to_owned(), readable_token(object_type)),
        ("source".to_owned(), label.to_owned()),
    ]);
    for (key, properties) in [
        ("value", &["value", "pattern"] as &[_]),
        (
            "description",
            &["description", "abstract", "content"] as &[_],
        ),
        (
            "first_seen",
            &["first_seen", "valid_from", "created"] as &[_],
        ),
        (
            "last_seen",
            &["last_seen", "valid_until", "modified"] as &[_],
        ),
    ] {
        if let Some(value) = properties
            .iter()
            .find_map(|property| raw.get(*property).and_then(Value::as_str))
            .filter(|value| !value.trim().is_empty())
        {
            values.insert(key.to_owned(), bounded_report_value(value));
        }
    }
    values
}

fn report_stix_item(object: &ExistingStixObject) -> ReportProjectDataItem {
    let label = ["name", "value", "subject", "title"]
        .iter()
        .find_map(|property| object.raw().get(*property).and_then(Value::as_str))
        .filter(|value| !value.trim().is_empty())
        .map(bounded_report_value)
        .unwrap_or_else(|| format!("Unnamed {}", readable_token(object.object_type())));
    ReportProjectDataItem {
        id: object.local_id(),
        kind: ProjectDataReferenceKind::Intelligence,
        object_type: object.object_type().to_owned(),
        summary: readable_token(object.object_type()),
        values: report_values_from_stix(object.raw(), &label, object.object_type()),
        label,
    }
}

fn report_draft_item(draft: &StixDraft) -> ReportProjectDataItem {
    let raw = Value::Object(draft.properties().clone());
    let label = ["name", "value", "subject", "title"]
        .iter()
        .find_map(|property| raw.get(*property).and_then(Value::as_str))
        .filter(|value| !value.trim().is_empty())
        .map(bounded_report_value)
        .unwrap_or_else(|| format!("Local {} draft", readable_token(draft.object_type())));
    ReportProjectDataItem {
        id: draft.local_id(),
        kind: ProjectDataReferenceKind::Intelligence,
        object_type: draft.object_type().to_owned(),
        summary: format!("{} draft", readable_token(draft.object_type())),
        values: report_values_from_stix(&raw, &label, draft.object_type()),
        label,
    }
}

fn report_document_item(document: &DocumentEnvelope) -> ReportProjectDataItem {
    let label = document
        .root()
        .get("content")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find_map(|node| {
            node.get("content")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .find_map(|inline| inline.get("text").and_then(Value::as_str))
        })
        .filter(|value| !value.trim().is_empty())
        .map(bounded_report_value)
        .unwrap_or_else(|| {
            format!(
                "Untitled {}",
                readable_token(document_kind_name(document.kind()))
            )
        });
    let object_type = document_kind_name(document.kind()).to_owned();
    ReportProjectDataItem {
        id: document.id(),
        kind: ProjectDataReferenceKind::Document,
        object_type: object_type.clone(),
        summary: readable_token(&object_type),
        values: BTreeMap::from([
            ("label".to_owned(), label.clone()),
            ("name".to_owned(), label.clone()),
            ("type".to_owned(), readable_token(&object_type)),
            ("source".to_owned(), label.clone()),
        ]),
        label,
    }
}

fn document_kind_name(kind: DocumentKind) -> &'static str {
    match kind {
        DocumentKind::Investigation => "investigation",
        DocumentKind::AnalystNote => "analyst_note",
        DocumentKind::Report => "report",
    }
}

fn report_evidence_item(evidence: &EvidenceFileMetadata) -> ReportProjectDataItem {
    let source = if evidence.source().is_empty() {
        evidence.file_name()
    } else {
        evidence.source()
    };
    let mut values = BTreeMap::from([
        ("label".to_owned(), evidence.title().to_owned()),
        ("name".to_owned(), evidence.title().to_owned()),
        ("type".to_owned(), evidence.media_type().to_owned()),
        ("sha256".to_owned(), evidence.sha256().to_owned()),
        ("source".to_owned(), source.to_owned()),
        ("description".to_owned(), evidence.description().to_owned()),
        ("url".to_owned(), evidence.source_url().to_owned()),
    ]);
    if let Some(captured_at) = evidence.captured_at() {
        values.insert("date".to_owned(), captured_at.to_owned());
    }
    ReportProjectDataItem {
        id: evidence.id(),
        kind: ProjectDataReferenceKind::Evidence,
        object_type: evidence.media_type().to_owned(),
        label: evidence.title().to_owned(),
        summary: "Evidence file".to_owned(),
        values,
    }
}

fn report_observation_item(
    observation: &TechniqueObservation,
    snapshot: &CatalogSnapshot,
) -> ReportProjectDataItem {
    let reference = observation.reference();
    let technique = snapshot
        .techniques()
        .iter()
        .find(|technique| technique.id() == reference.technique_id());
    let technique_name = technique.map_or("Unknown technique", |technique| technique.name());
    let technique_label = format!("{} — {technique_name}", reference.technique_id());
    let parent_label = technique
        .and_then(|technique| technique.parent_id())
        .and_then(|parent_id| {
            snapshot
                .techniques()
                .iter()
                .find(|candidate| candidate.id() == parent_id)
                .map(|parent| format!("{} — {}", parent.id(), parent.name()))
        });
    let mut values = BTreeMap::from([
        ("label".to_owned(), technique_label.clone()),
        (
            "technique_id".to_owned(),
            reference.technique_id().to_owned(),
        ),
        ("technique_name".to_owned(), technique_name.to_owned()),
        ("technique_label".to_owned(), technique_label.clone()),
        ("explanation".to_owned(), observation.narrative().to_owned()),
        ("source".to_owned(), technique_label.clone()),
        ("type".to_owned(), "MITRE ATT&CK technique".to_owned()),
    ]);
    if let Some(parent_label) = parent_label {
        values.insert("parent_technique_label".to_owned(), parent_label);
        values.insert("sub_technique_label".to_owned(), technique_label.clone());
    }
    ReportProjectDataItem {
        id: observation.id(),
        kind: ProjectDataReferenceKind::CatalogReference,
        object_type: "attack-pattern".to_owned(),
        label: technique_label,
        summary: if observation.narrative().is_empty() {
            "MITRE ATT&CK technique".to_owned()
        } else {
            bounded_report_value(observation.narrative())
        },
        values,
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StixImportPreviewSummary {
    preview_id: LocalId,
    object_count: usize,
    duplicates: Vec<DuplicateStixObject>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StixImportOutcome {
    imported: usize,
    skipped: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StixExportPreviewSummary {
    preview_id: LocalId,
    object_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct BrandAssetSelection {
    profile: BrandProfile,
    asset: BrandAssetMetadata,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProjectSummary {
    id: LocalId,
    name: Option<String>,
    locked: bool,
    unlock_method: UnlockMethod,
    default_tlp_marking: Option<TlpMarking>,
}

impl From<ProjectStatus> for ProjectSummary {
    fn from(status: ProjectStatus) -> Self {
        Self {
            id: status.id(),
            name: status.name().map(str::to_owned),
            locked: status.locked(),
            unlock_method: status.unlock_method(),
            default_tlp_marking: status.default_tlp_marking(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProjectBackupSummary {
    id: LocalId,
    created_at_unix_ms: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum CatalogVersionRelation {
    Upgrade,
    Same,
    Downgrade,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MitreCatalogUpdatePreviewSummary {
    preview_id: LocalId,
    catalog: MitreCatalog,
    current_version: String,
    candidate_version: String,
    relation: CatalogVersionRelation,
    source_url: String,
    sha256: String,
    tactic_count: usize,
    technique_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MitreMappingImportPreviewSummary {
    preview_id: LocalId,
    observation_count: usize,
    duplicate_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct NavigatorImportPreviewSummary {
    preview_id: LocalId,
    name: String,
    catalog: MitreCatalog,
    catalog_version: String,
    entry_count: usize,
    comment_count: usize,
    disabled_count: usize,
    scored_count: usize,
}

impl From<ProjectBackup> for ProjectBackupSummary {
    fn from(backup: ProjectBackup) -> Self {
        Self {
            id: backup.id(),
            created_at_unix_ms: backup.created_at_unix_ms(),
        }
    }
}

pub(super) fn initialize<R: tauri::Runtime>(app: &mut tauri::App<R>) -> Result<(), Box<dyn Error>> {
    let local_data_root = app.path().app_local_data_dir()?;
    let project_root = local_data_root.join("projects");
    let manager = ProjectManager::new(project_root, OsProjectKeyStore)?;
    let mitre_catalogs = CatalogStore::new(local_data_root.join("mitre-catalogs"))?;
    app.manage(AppState {
        projects: Arc::new(Mutex::new(manager)),
        stix_previews: Mutex::new(StixPreviews::default()),
        mitre_catalogs: Arc::new(Mutex::new(mitre_catalogs)),
        mitre_previews: Mutex::new(HashMap::new()),
        mitre_mapping_previews: Mutex::new(MitreMappingPreviews::default()),
    });
    Ok(())
}

pub(crate) fn lock_idle_projects<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let Ok(now_unix_ms) = now_unix_ms() else {
        return;
    };
    let locked = {
        let Ok(mut projects) = state.projects.try_lock() else {
            return;
        };
        projects.lock_idle_projects(now_unix_ms, PROJECT_IDLE_TIMEOUT_MS)
    };
    if locked.is_empty() {
        return;
    }
    let _ = app.emit_to(
        "main",
        PROJECTS_AUTO_LOCKED_EVENT,
        ProjectsAutoLockedEvent {
            project_ids: locked,
            idle_timeout_minutes: PROJECT_IDLE_TIMEOUT_MINUTES,
        },
    );
}

pub(crate) fn lock_all_projects<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    if let Ok(mut projects) = state.projects.lock() {
        projects.lock_all_projects();
    }
}

#[tauri::command]
pub(super) async fn list_projects(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ProjectSummary>, CommandError> {
    with_manager(Arc::clone(&state.projects), |manager| {
        manager
            .list_projects()
            .map(|projects| projects.into_iter().map(ProjectSummary::from).collect())
    })
    .await
}

#[tauri::command]
pub(super) async fn list_stix_objects(
    project_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<StixObjectSummary>, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager
            .list_stix_objects(project_id, now_unix_ms)
            .map(|objects| stix_object_summaries(&objects))
    })
    .await
}

#[tauri::command]
pub(super) async fn list_stix_drafts(
    project_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<StixDraftSummary>, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager
            .list_stix_drafts(project_id, now_unix_ms)
            .map(|drafts| drafts.iter().map(StixDraftSummary::from).collect())
    })
    .await
}

#[tauri::command]
pub(super) async fn create_stix_draft(
    project_id: String,
    object_type: String,
    properties: Value,
    state: tauri::State<'_, AppState>,
) -> Result<StixDraftSummary, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let draft = StixDraft::new(LocalId::from_uuid(Uuid::new_v4()), object_type, properties)?;
    let summary = StixDraftSummary::from(&draft);
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.save_stix_draft(project_id, &draft, now_unix_ms)
    })
    .await?;
    Ok(summary)
}

#[tauri::command]
pub(super) async fn create_stix_revision_draft(
    project_id: String,
    object_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<StixDraftSummary, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let object_id = parse_project_id(&object_id)?;
    let now_unix_ms = now_unix_ms()?;
    let draft = with_manager(Arc::clone(&state.projects), move |manager| {
        manager.create_stix_revision_draft(project_id, object_id, now_unix_ms)
    })
    .await?;
    Ok(StixDraftSummary::from(&draft))
}

#[tauri::command]
pub(super) async fn update_stix_draft(
    project_id: String,
    draft_id: String,
    object_type: String,
    properties: Value,
    state: tauri::State<'_, AppState>,
) -> Result<StixDraftSummary, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let draft_id = parse_project_id(&draft_id)?;
    let now_unix_ms = now_unix_ms()?;
    let draft = with_manager(Arc::clone(&state.projects), move |manager| {
        manager.update_stix_draft(
            project_id,
            draft_id,
            object_type,
            properties,
            None,
            now_unix_ms,
        )
    })
    .await?;
    Ok(StixDraftSummary::from(&draft))
}

#[tauri::command]
pub(super) async fn create_stix_relationship_draft(
    project_id: String,
    source_id: String,
    target_id: String,
    relationship_type: String,
    properties: Value,
    state: tauri::State<'_, AppState>,
) -> Result<StixDraftSummary, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let relationship = SemanticRelationshipDraft::new(
        parse_project_id(&source_id)?,
        parse_project_id(&target_id)?,
        relationship_type,
    )
    .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidStix))?;
    let draft =
        StixDraft::new_relationship(LocalId::from_uuid(Uuid::new_v4()), relationship, properties)?;
    let summary = StixDraftSummary::from(&draft);
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.save_stix_draft(project_id, &draft, now_unix_ms)
    })
    .await?;
    Ok(summary)
}

#[tauri::command]
pub(super) async fn update_stix_relationship_draft(
    project_id: String,
    draft_id: String,
    source_id: String,
    target_id: String,
    relationship_type: String,
    properties: Value,
    state: tauri::State<'_, AppState>,
) -> Result<StixDraftSummary, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let relationship = SemanticRelationshipDraft::new(
        parse_project_id(&source_id)?,
        parse_project_id(&target_id)?,
        relationship_type,
    )
    .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidStix))?;
    let draft_id = parse_project_id(&draft_id)?;
    let now_unix_ms = now_unix_ms()?;
    let draft = with_manager(Arc::clone(&state.projects), move |manager| {
        manager.update_stix_draft(
            project_id,
            draft_id,
            "relationship",
            properties,
            Some(relationship),
            now_unix_ms,
        )
    })
    .await?;
    Ok(StixDraftSummary::from(&draft))
}

#[tauri::command]
pub(super) async fn delete_stix_draft(
    project_id: String,
    draft_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let draft_id = parse_project_id(&draft_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.delete_stix_draft(project_id, draft_id, now_unix_ms)
    })
    .await
}

#[tauri::command]
pub(super) async fn delete_stix_object(
    project_id: String,
    object_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let object_id = parse_project_id(&object_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.delete_stix_object(project_id, object_id, now_unix_ms)
    })
    .await
}

#[tauri::command]
pub(super) async fn preview_stix_import(
    project_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Option<StixImportPreviewSummary>, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let now_unix_ms = now_unix_ms()?;
    let existing = with_manager(Arc::clone(&state.projects), move |manager| {
        manager.list_stix_objects(project_id, now_unix_ms)
    })
    .await?;
    let selection = rfd::AsyncFileDialog::new()
        .set_title("Import a STIX 2.1 bundle")
        .add_filter("STIX 2.1 bundle", &["json", "stix"])
        .pick_file()
        .await;
    let Some(selection) = selection else {
        return Ok(None);
    };
    let path = selection.path().to_owned();
    let payload = tauri::async_runtime::spawn_blocking(move || read_bounded_stix(&path))
        .await
        .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidStix))??;
    let preview = preview_import(parse_bundle(&payload)?, &existing)?;
    let preview_id = LocalId::from_uuid(Uuid::new_v4());
    let summary = StixImportPreviewSummary {
        preview_id,
        object_count: preview.object_count(),
        duplicates: preview.duplicate_objects(),
    };
    let mut previews = state
        .stix_previews
        .lock()
        .map_err(|_| CommandError::storage_unavailable())?;
    previews
        .imports
        .retain(|_, pending| pending.project_id != project_id);
    previews.imports.insert(
        preview_id,
        PendingStixImport {
            project_id,
            preview,
        },
    );
    Ok(Some(summary))
}

#[tauri::command]
pub(super) async fn discard_stix_import_preview(
    project_id: String,
    preview_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let preview_id = parse_project_id(&preview_id)?;
    let mut previews = state
        .stix_previews
        .lock()
        .map_err(|_| CommandError::storage_unavailable())?;
    if previews
        .imports
        .get(&preview_id)
        .is_some_and(|pending| pending.project_id == project_id)
    {
        previews.imports.remove(&preview_id);
    }
    Ok(())
}

#[tauri::command]
pub(super) async fn commit_stix_import(
    project_id: String,
    preview_id: String,
    decisions: Vec<DuplicateDecision>,
    state: tauri::State<'_, AppState>,
) -> Result<StixImportOutcome, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let preview_id = parse_project_id(&preview_id)?;
    let pending = {
        let mut previews = state
            .stix_previews
            .lock()
            .map_err(|_| CommandError::storage_unavailable())?;
        if previews
            .imports
            .get(&preview_id)
            .is_none_or(|pending| pending.project_id != project_id)
        {
            return Err(CommandError::new(LifecycleErrorCode::InvalidStix));
        }
        previews
            .imports
            .remove(&preview_id)
            .ok_or_else(|| CommandError::new(LifecycleErrorCode::InvalidStix))?
    };
    let commit = commit_import(&pending.preview, &decisions)?;
    let outcome = StixImportOutcome {
        imported: commit.upserts().len(),
        skipped: commit.skipped(),
    };
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.commit_stix_import(project_id, &commit, now_unix_ms)
    })
    .await?;
    Ok(outcome)
}

#[tauri::command]
pub(super) async fn preview_stix_export(
    project_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<StixExportPreviewSummary, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let now_unix_ms = now_unix_ms()?;
    let (objects, drafts) = with_manager(Arc::clone(&state.projects), move |manager| {
        let objects = manager.list_stix_objects(project_id, now_unix_ms)?;
        let drafts = manager.list_stix_drafts(project_id, now_unix_ms)?;
        Ok((objects, drafts))
    })
    .await?;
    let preview = preview_project_export(&objects, &drafts)?;
    let preview_id = LocalId::from_uuid(Uuid::new_v4());
    let summary = StixExportPreviewSummary {
        preview_id,
        object_count: preview.object_count(),
    };
    let mut previews = state
        .stix_previews
        .lock()
        .map_err(|_| CommandError::storage_unavailable())?;
    previews
        .exports
        .retain(|_, pending| pending.project_id != project_id);
    previews.exports.insert(
        preview_id,
        PendingStixExport {
            project_id,
            preview,
        },
    );
    Ok(summary)
}

#[tauri::command]
pub(super) async fn discard_stix_export_preview(
    project_id: String,
    preview_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let preview_id = parse_project_id(&preview_id)?;
    let mut previews = state
        .stix_previews
        .lock()
        .map_err(|_| CommandError::storage_unavailable())?;
    if previews
        .exports
        .get(&preview_id)
        .is_some_and(|pending| pending.project_id == project_id)
    {
        previews.exports.remove(&preview_id);
    }
    Ok(())
}

#[tauri::command]
pub(super) async fn commit_stix_export(
    project_id: String,
    preview_id: String,
    file_name: String,
    state: tauri::State<'_, AppState>,
) -> Result<ExportOutcome, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let preview_id = parse_project_id(&preview_id)?;
    let file_name = requested_stix_file_name(&file_name)?;
    {
        let previews = state
            .stix_previews
            .lock()
            .map_err(|_| CommandError::storage_unavailable())?;
        if previews
            .exports
            .get(&preview_id)
            .is_none_or(|pending| pending.project_id != project_id)
        {
            return Err(CommandError::new(LifecycleErrorCode::InvalidStix));
        }
    }
    let selection = rfd::AsyncFileDialog::new()
        .set_title("Export STIX 2.1 bundle")
        .set_file_name(file_name)
        .add_filter("STIX 2.1 bundle", &["json"])
        .save_file()
        .await;
    let Some(selection) = selection else {
        return Ok(ExportOutcome::cancelled());
    };
    let pending = {
        let mut previews = state
            .stix_previews
            .lock()
            .map_err(|_| CommandError::storage_unavailable())?;
        previews
            .exports
            .remove(&preview_id)
            .ok_or_else(|| CommandError::new(LifecycleErrorCode::InvalidStix))?
    };
    let committed = commit_project_export(&pending.preview)?;
    let path = ensure_export_extension(selection.path(), "json");
    let bytes = committed.bytes().to_vec();
    tauri::async_runtime::spawn_blocking(move || write_export(&path, &bytes))
        .await
        .map_err(|_| CommandError::new(LifecycleErrorCode::ExportFailed))?
        .map_err(|_| CommandError::new(LifecycleErrorCode::ExportFailed))?;
    let promoted = committed.generated_objects()?;
    if !promoted.is_empty() {
        let now_unix_ms = now_unix_ms()?;
        with_manager(Arc::clone(&state.projects), move |manager| {
            manager.promote_stix_drafts(project_id, &promoted, now_unix_ms)
        })
        .await?;
    }
    Ok(ExportOutcome::saved())
}

#[tauri::command]
pub(super) async fn list_documents(
    project_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DocumentEnvelope>, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.list_documents(project_id, now_unix_ms)
    })
    .await
}

#[tauri::command]
pub(super) async fn get_mitre_catalog(
    catalog: MitreCatalog,
    state: tauri::State<'_, AppState>,
) -> Result<CatalogSnapshot, CommandError> {
    with_catalogs(Arc::clone(&state.mitre_catalogs), move |catalogs| {
        catalogs.active(catalog).map_err(CommandError::from)
    })
    .await
}

#[tauri::command]
pub(super) async fn list_mitre_catalog_statuses(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<CatalogStatus>, CommandError> {
    with_catalogs(Arc::clone(&state.mitre_catalogs), |catalogs| {
        [
            MitreCatalog::AttackEnterprise,
            MitreCatalog::AttackMobile,
            MitreCatalog::AttackIcs,
            MitreCatalog::Atlas,
        ]
        .into_iter()
        .map(|catalog| catalogs.status(catalog).map_err(CommandError::from))
        .collect()
    })
    .await
}

#[tauri::command]
pub(super) async fn preview_mitre_catalog_update(
    state: tauri::State<'_, AppState>,
) -> Result<Option<MitreCatalogUpdatePreviewSummary>, CommandError> {
    let selection = rfd::AsyncFileDialog::new()
        .set_title("Install an official MITRE catalog")
        .add_filter("MITRE STIX 2.1 catalog", &["json"])
        .pick_file()
        .await;
    let Some(selection) = selection else {
        return Ok(None);
    };
    let path = selection.path().to_owned();
    let payload = tauri::async_runtime::spawn_blocking(move || read_bounded_mitre_catalog(&path))
        .await
        .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidMitreCatalog))??;
    let snapshot = tauri::async_runtime::spawn_blocking(move || compile_official_catalog(&payload))
        .await
        .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidMitreCatalog))??;
    let catalog = snapshot.catalog();
    let current_version = with_catalogs(Arc::clone(&state.mitre_catalogs), move |catalogs| {
        Ok(catalogs.active(catalog)?.version().to_owned())
    })
    .await?;
    let relation = compare_catalog_versions(snapshot.version(), &current_version)?;
    let preview_id = LocalId::from_uuid(Uuid::new_v4());
    let summary = MitreCatalogUpdatePreviewSummary {
        preview_id,
        catalog: snapshot.catalog(),
        current_version,
        candidate_version: snapshot.version().to_owned(),
        relation,
        source_url: snapshot.source().url().to_owned(),
        sha256: snapshot.source().sha256().to_owned(),
        tactic_count: snapshot.tactics().len(),
        technique_count: snapshot.techniques().len(),
    };
    let mut previews = state
        .mitre_previews
        .lock()
        .map_err(|_| CommandError::storage_unavailable())?;
    previews.clear();
    previews.insert(preview_id, snapshot);
    Ok(Some(summary))
}

#[tauri::command]
pub(super) async fn commit_mitre_catalog_update(
    preview_id: String,
    allow_downgrade: bool,
    state: tauri::State<'_, AppState>,
) -> Result<CatalogSnapshot, CommandError> {
    let preview_id = parse_project_id(&preview_id)?;
    let snapshot = state
        .mitre_previews
        .lock()
        .map_err(|_| CommandError::storage_unavailable())?
        .get(&preview_id)
        .cloned()
        .ok_or_else(|| CommandError::new(LifecycleErrorCode::InvalidMitreCatalog))?;
    let installed = snapshot.clone();
    with_catalogs(Arc::clone(&state.mitre_catalogs), move |catalogs| {
        let current = catalogs.active(installed.catalog())?;
        if compare_catalog_versions(installed.version(), current.version())?
            == CatalogVersionRelation::Downgrade
            && !allow_downgrade
        {
            return Err(CommandError::new(LifecycleErrorCode::MitreCatalogDowngrade));
        }
        catalogs.install(&installed)?;
        Ok(())
    })
    .await?;
    state
        .mitre_previews
        .lock()
        .map_err(|_| CommandError::storage_unavailable())?
        .remove(&preview_id);
    Ok(snapshot)
}

#[tauri::command]
pub(super) async fn reset_mitre_catalog(
    catalog: MitreCatalog,
    state: tauri::State<'_, AppState>,
) -> Result<CatalogSnapshot, CommandError> {
    with_catalogs(Arc::clone(&state.mitre_catalogs), move |catalogs| {
        catalogs.reset(catalog)?;
        catalogs.active(catalog).map_err(CommandError::from)
    })
    .await
}

#[tauri::command]
pub(super) async fn list_technique_observations(
    project_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<TechniqueObservation>, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.list_technique_observations(project_id, now_unix_ms)
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(super) async fn create_technique_observation(
    project_id: String,
    reference: MitreTechniqueReference,
    assessment: TechniqueAssessment,
    outcome: TechniqueOutcome,
    confidence: AnalyticConfidence,
    narrative: String,
    first_seen_unix_ms: Option<i64>,
    last_seen_unix_ms: Option<i64>,
    state: tauri::State<'_, AppState>,
) -> Result<TechniqueObservation, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let now_unix_ms = now_unix_ms()?;
    let catalog_id = reference.catalog();
    let catalog = with_catalogs(Arc::clone(&state.mitre_catalogs), move |catalogs| {
        catalogs.active(catalog_id).map_err(CommandError::from)
    })
    .await?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.create_technique_observation(
            project_id,
            reference,
            &catalog,
            assessment,
            outcome,
            confidence,
            narrative,
            first_seen_unix_ms,
            last_seen_unix_ms,
            now_unix_ms,
        )
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(super) async fn update_technique_observation(
    project_id: String,
    observation_id: String,
    expected_revision: u64,
    assessment: TechniqueAssessment,
    outcome: TechniqueOutcome,
    confidence: AnalyticConfidence,
    narrative: String,
    first_seen_unix_ms: Option<i64>,
    last_seen_unix_ms: Option<i64>,
    state: tauri::State<'_, AppState>,
) -> Result<TechniqueObservation, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let observation_id = parse_technique_observation_id(&observation_id)?;
    let expected_revision = parse_revision(expected_revision)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.update_technique_observation(
            project_id,
            observation_id,
            expected_revision,
            assessment,
            outcome,
            confidence,
            narrative,
            first_seen_unix_ms,
            last_seen_unix_ms,
            now_unix_ms,
        )
    })
    .await
}

#[tauri::command]
pub(super) async fn delete_technique_observation(
    project_id: String,
    observation_id: String,
    expected_revision: u64,
    state: tauri::State<'_, AppState>,
) -> Result<(), CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let observation_id = parse_technique_observation_id(&observation_id)?;
    let expected_revision = parse_revision(expected_revision)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.delete_technique_observation(
            project_id,
            observation_id,
            expected_revision,
            now_unix_ms,
        )
    })
    .await
}

#[tauri::command]
pub(super) async fn preview_mitre_mapping_import(
    project_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Option<MitreMappingImportPreviewSummary>, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let selection = rfd::AsyncFileDialog::new()
        .set_title("Import a Sheut MITRE mapping")
        .add_filter("Sheut MITRE mapping", &["json"])
        .pick_file()
        .await;
    let Some(selection) = selection else {
        return Ok(None);
    };
    let path = selection.path().to_owned();
    let payload = tauri::async_runtime::spawn_blocking(move || read_bounded_mitre_mapping(&path))
        .await
        .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidMitreMapping))??;
    let mapping = import_mapping_file(&payload)?;
    let now_unix_ms = now_unix_ms()?;
    let existing = with_manager(Arc::clone(&state.projects), move |manager| {
        manager.list_technique_observations(project_id, now_unix_ms)
    })
    .await?;
    let existing_ids = existing
        .iter()
        .map(TechniqueObservation::id)
        .collect::<std::collections::HashSet<_>>();
    let duplicate_count = mapping
        .observations()
        .iter()
        .filter(|item| existing_ids.contains(&item.id()))
        .count();
    let preview_id = LocalId::from_uuid(Uuid::new_v4());
    let summary = MitreMappingImportPreviewSummary {
        preview_id,
        observation_count: mapping.observations().len(),
        duplicate_count,
    };
    let mut previews = state
        .mitre_mapping_previews
        .lock()
        .map_err(|_| CommandError::storage_unavailable())?;
    previews
        .mappings
        .retain(|_, pending| pending.project_id != project_id);
    previews.mappings.insert(
        preview_id,
        PendingMappingImport {
            project_id,
            mapping,
        },
    );
    Ok(Some(summary))
}

#[tauri::command]
pub(super) async fn commit_mitre_mapping_import(
    project_id: String,
    preview_id: String,
    replace_existing: bool,
    state: tauri::State<'_, AppState>,
) -> Result<ObservationImportOutcome, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let preview_id = parse_project_id(&preview_id)?;
    let pending = {
        let mut previews = state
            .mitre_mapping_previews
            .lock()
            .map_err(|_| CommandError::storage_unavailable())?;
        if previews
            .mappings
            .get(&preview_id)
            .is_none_or(|pending| pending.project_id != project_id)
        {
            return Err(CommandError::new(LifecycleErrorCode::InvalidMitreMapping));
        }
        previews
            .mappings
            .remove(&preview_id)
            .ok_or_else(|| CommandError::new(LifecycleErrorCode::InvalidMitreMapping))?
    };
    let observations = pending.mapping.observations().to_vec();
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.import_technique_observations(
            project_id,
            &observations,
            replace_existing,
            now_unix_ms,
        )
    })
    .await
}

#[tauri::command]
pub(super) async fn export_mitre_mapping(
    project_id: String,
    file_name: String,
    state: tauri::State<'_, AppState>,
) -> Result<ExportOutcome, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let file_name = requested_mitre_json_file_name(&file_name)?;
    let now_unix_ms = now_unix_ms()?;
    let observations = with_manager(Arc::clone(&state.projects), move |manager| {
        manager.list_technique_observations(project_id, now_unix_ms)
    })
    .await?;
    let bytes = export_mapping_file(&observations, now_unix_ms)?;
    let selection = rfd::AsyncFileDialog::new()
        .set_title("Export Sheut MITRE mapping")
        .set_file_name(file_name)
        .add_filter("Sheut MITRE mapping", &["json"])
        .save_file()
        .await;
    let Some(selection) = selection else {
        return Ok(ExportOutcome::cancelled());
    };
    let path = ensure_export_extension(selection.path(), "json");
    tauri::async_runtime::spawn_blocking(move || write_export(&path, &bytes))
        .await
        .map_err(|_| CommandError::new(LifecycleErrorCode::ExportFailed))?
        .map_err(|_| CommandError::new(LifecycleErrorCode::ExportFailed))?;
    Ok(ExportOutcome::saved())
}

#[tauri::command]
pub(super) async fn preview_navigator_import(
    project_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Option<NavigatorImportPreviewSummary>, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.list_technique_observations(project_id, now_unix_ms)
    })
    .await?;
    let selection = rfd::AsyncFileDialog::new()
        .set_title("Import an ATT&CK or ATLAS Navigator layer")
        .add_filter("Navigator layer", &["json"])
        .pick_file()
        .await;
    let Some(selection) = selection else {
        return Ok(None);
    };
    let path = selection.path().to_owned();
    let payload = tauri::async_runtime::spawn_blocking(move || read_bounded_mitre_mapping(&path))
        .await
        .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidMitreMapping))??;
    let catalog_id = navigator_catalog_from_source(&payload)?;
    let catalog = with_catalogs(Arc::clone(&state.mitre_catalogs), move |catalogs| {
        catalogs.active(catalog_id).map_err(CommandError::from)
    })
    .await?;
    let preview = parse_navigator_layer(&payload, &catalog)?;
    let preview_id = LocalId::from_uuid(Uuid::new_v4());
    let summary = NavigatorImportPreviewSummary {
        preview_id,
        name: preview.name().to_owned(),
        catalog: preview.catalog(),
        catalog_version: preview.catalog_version().to_owned(),
        entry_count: preview.entries().len(),
        comment_count: preview
            .entries()
            .iter()
            .filter(|entry| !entry.comment().is_empty())
            .count(),
        disabled_count: preview
            .entries()
            .iter()
            .filter(|entry| !entry.enabled())
            .count(),
        scored_count: preview
            .entries()
            .iter()
            .filter(|entry| entry.score().is_some())
            .count(),
    };
    let mut previews = state
        .mitre_mapping_previews
        .lock()
        .map_err(|_| CommandError::storage_unavailable())?;
    previews
        .navigator
        .retain(|_, pending| pending.project_id != project_id);
    previews.navigator.insert(
        preview_id,
        PendingNavigatorImport {
            project_id,
            preview,
        },
    );
    Ok(Some(summary))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(super) async fn commit_navigator_import(
    project_id: String,
    preview_id: String,
    assessment: TechniqueAssessment,
    outcome: TechniqueOutcome,
    confidence: AnalyticConfidence,
    default_narrative: String,
    include_disabled: bool,
    state: tauri::State<'_, AppState>,
) -> Result<ObservationImportOutcome, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let preview_id = parse_project_id(&preview_id)?;
    let pending = {
        let mut previews = state
            .mitre_mapping_previews
            .lock()
            .map_err(|_| CommandError::storage_unavailable())?;
        if previews
            .navigator
            .get(&preview_id)
            .is_none_or(|pending| pending.project_id != project_id)
        {
            return Err(CommandError::new(LifecycleErrorCode::InvalidMitreMapping));
        }
        previews
            .navigator
            .remove(&preview_id)
            .ok_or_else(|| CommandError::new(LifecycleErrorCode::InvalidMitreMapping))?
    };
    let now_unix_ms = now_unix_ms()?;
    let observations = pending
        .preview
        .entries()
        .iter()
        .filter(|entry| include_disabled || entry.enabled())
        .map(|entry| {
            let narrative = if entry.comment().is_empty() {
                default_narrative.as_str()
            } else {
                entry.comment()
            };
            TechniqueObservation::new(
                LocalId::from_uuid(Uuid::new_v4()),
                entry.reference().clone(),
                assessment,
                outcome,
                confidence,
                narrative,
                None,
                None,
                now_unix_ms,
            )
            .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidMitreMapping))
        })
        .collect::<Result<Vec<_>, _>>()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.import_technique_observations(project_id, &observations, false, now_unix_ms)
    })
    .await
}

#[tauri::command]
pub(super) async fn export_navigator_projection(
    project_id: String,
    catalog: MitreCatalog,
    layer_name: String,
    file_name: String,
    state: tauri::State<'_, AppState>,
) -> Result<ExportOutcome, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let file_name = requested_mitre_json_file_name(&file_name)?;
    let now_unix_ms = now_unix_ms()?;
    let observations = with_manager(Arc::clone(&state.projects), move |manager| {
        manager.list_technique_observations(project_id, now_unix_ms)
    })
    .await?;
    let snapshot = with_catalogs(Arc::clone(&state.mitre_catalogs), move |catalogs| {
        catalogs.active(catalog).map_err(CommandError::from)
    })
    .await?;
    let bytes = build_navigator_projection(&layer_name, &snapshot, &observations)?;
    let selection = rfd::AsyncFileDialog::new()
        .set_title("Export Navigator projection")
        .set_file_name(file_name)
        .add_filter("Navigator layer", &["json"])
        .save_file()
        .await;
    let Some(selection) = selection else {
        return Ok(ExportOutcome::cancelled());
    };
    let path = ensure_export_extension(selection.path(), "json");
    tauri::async_runtime::spawn_blocking(move || write_export(&path, &bytes))
        .await
        .map_err(|_| CommandError::new(LifecycleErrorCode::ExportFailed))?
        .map_err(|_| CommandError::new(LifecycleErrorCode::ExportFailed))?;
    Ok(ExportOutcome::saved())
}

#[tauri::command]
pub(super) async fn create_document(
    project_id: String,
    kind: DocumentKind,
    state: tauri::State<'_, AppState>,
) -> Result<DocumentEnvelope, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.create_document(project_id, kind, now_unix_ms)
    })
    .await
}

#[tauri::command]
pub(super) async fn list_report_templates(
    project_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ReportTemplateDefinition>, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.list_report_templates(project_id, now_unix_ms)
    })
    .await
}

#[tauri::command]
pub(super) async fn create_custom_report_template(
    project_id: String,
    base_template_id: String,
    name: String,
    description: String,
    additional_sections: Vec<ReportTemplateSection>,
    state: tauri::State<'_, AppState>,
) -> Result<ReportTemplateDefinition, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let base_template_id = parse_document_id(&base_template_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.create_custom_report_template(
            project_id,
            base_template_id,
            &name,
            &description,
            additional_sections,
            now_unix_ms,
        )
    })
    .await
}

#[tauri::command]
pub(super) async fn list_guided_reports(
    project_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<GuidedReport>, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.list_guided_reports(project_id, now_unix_ms)
    })
    .await
}

#[tauri::command]
pub(super) async fn list_report_project_data(
    project_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ReportProjectDataItem>, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let now_unix_ms = now_unix_ms()?;
    let (objects, drafts, documents, observations, evidence) =
        with_manager(Arc::clone(&state.projects), move |manager| {
            Ok((
                manager.list_stix_objects(project_id, now_unix_ms)?,
                manager.list_stix_drafts(project_id, now_unix_ms)?,
                manager.list_documents(project_id, now_unix_ms)?,
                manager.list_technique_observations(project_id, now_unix_ms)?,
                manager.list_evidence_files(project_id, now_unix_ms)?,
            ))
        })
        .await?;

    let mut items = Vec::with_capacity(
        objects.len() + drafts.len() + documents.len() + observations.len() + evidence.len(),
    );
    items.extend(objects.iter().map(report_stix_item));
    items.extend(drafts.iter().map(report_draft_item));
    items.extend(documents.iter().map(report_document_item));
    items.extend(evidence.iter().map(report_evidence_item));

    let catalog_ids = observations
        .iter()
        .map(|observation| observation.reference().catalog())
        .collect::<std::collections::HashSet<_>>();
    let snapshots = with_catalogs(Arc::clone(&state.mitre_catalogs), move |catalogs| {
        catalog_ids
            .into_iter()
            .map(|catalog| Ok((catalog, catalogs.active(catalog)?)))
            .collect::<Result<HashMap<_, _>, CommandError>>()
    })
    .await?;
    items.extend(observations.iter().filter_map(|observation| {
        snapshots
            .get(&observation.reference().catalog())
            .map(|snapshot| report_observation_item(observation, snapshot))
    }));
    items.sort_by(|left, right| {
        left.kind
            .cmp(&right.kind)
            .then_with(|| left.label.to_lowercase().cmp(&right.label.to_lowercase()))
    });
    Ok(items)
}

#[tauri::command]
pub(super) async fn create_guided_report(
    project_id: String,
    template_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<GuidedReport, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let template_id = parse_document_id(&template_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.create_guided_report(project_id, template_id, now_unix_ms)
    })
    .await
}

#[tauri::command]
pub(super) async fn save_guided_report(
    project_id: String,
    report_id: String,
    expected_revision: u64,
    title: String,
    fields: BTreeMap<String, GuidedReportFieldValue>,
    state: tauri::State<'_, AppState>,
) -> Result<GuidedReport, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let report_id = parse_document_id(&report_id)?;
    let expected_revision = parse_revision(expected_revision)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.save_guided_report_fields(
            project_id,
            report_id,
            expected_revision,
            &title,
            fields,
            now_unix_ms,
        )
    })
    .await
}

#[tauri::command]
pub(super) async fn update_guided_report_section_disposition(
    project_id: String,
    report_id: String,
    expected_revision: u64,
    section_key: String,
    disposition: ReportSectionDisposition,
    state: tauri::State<'_, AppState>,
) -> Result<GuidedReport, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let report_id = parse_document_id(&report_id)?;
    let expected_revision = parse_revision(expected_revision)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.update_guided_report_section_disposition(
            project_id,
            report_id,
            expected_revision,
            &section_key,
            disposition,
            now_unix_ms,
        )
    })
    .await
}

#[tauri::command]
pub(super) async fn upgrade_illicit_ecosystem_report(
    project_id: String,
    report_id: String,
    expected_revision: u64,
    state: tauri::State<'_, AppState>,
) -> Result<GuidedReport, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let report_id = parse_document_id(&report_id)?;
    let expected_revision = parse_revision(expected_revision)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.upgrade_illicit_ecosystem_report(
            project_id,
            report_id,
            expected_revision,
            now_unix_ms,
        )
    })
    .await
}

#[tauri::command]
pub(super) async fn delete_guided_report(
    project_id: String,
    report_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let report_id = parse_document_id(&report_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.delete_guided_report(project_id, report_id, now_unix_ms)
    })
    .await
}

#[tauri::command]
pub(super) async fn restore_guided_report(
    project_id: String,
    report_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<GuidedReport, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let report_id = parse_document_id(&report_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.restore_guided_report(project_id, report_id, now_unix_ms)
    })
    .await
}

#[tauri::command]
pub(super) async fn list_brand_profiles(
    project_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<BrandProfile>, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.list_brand_profiles(project_id, now_unix_ms)
    })
    .await
}

#[tauri::command]
pub(super) async fn create_brand_profile(
    project_id: String,
    input: BrandProfileInput,
    state: tauri::State<'_, AppState>,
) -> Result<BrandProfile, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.create_brand_profile(project_id, input, now_unix_ms)
    })
    .await
}

#[tauri::command]
pub(super) async fn update_brand_profile(
    project_id: String,
    profile_id: String,
    expected_revision: u64,
    input: BrandProfileInput,
    state: tauri::State<'_, AppState>,
) -> Result<BrandProfile, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let profile_id = parse_document_id(&profile_id)?;
    let expected_revision = parse_revision(expected_revision)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.update_brand_profile(
            project_id,
            profile_id,
            expected_revision,
            input,
            now_unix_ms,
        )
    })
    .await
}

#[tauri::command]
pub(super) async fn pick_brand_asset(
    project_id: String,
    profile_id: String,
    expected_revision: u64,
    role: BrandAssetRole,
    state: tauri::State<'_, AppState>,
) -> Result<Option<BrandAssetSelection>, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let profile_id = parse_document_id(&profile_id)?;
    let expected_revision = parse_revision(expected_revision)?;
    let selection = rfd::AsyncFileDialog::new()
        .set_title("Choose Brand Studio image")
        .add_filter("Images", &["png", "jpg", "jpeg", "webp"])
        .pick_file()
        .await;
    let Some(selection) = selection else {
        return Ok(None);
    };
    let file_name = selection.file_name();
    let path = selection.path().to_owned();
    let payload = tauri::async_runtime::spawn_blocking(move || read_bounded_image(&path))
        .await
        .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidAttachment))??;
    let now_unix_ms = now_unix_ms()?;
    let (profile, asset) = with_manager(Arc::clone(&state.projects), move |manager| {
        manager.create_brand_asset(
            project_id,
            profile_id,
            expected_revision,
            BrandAssetUpload::new(role, file_name, payload),
            now_unix_ms,
        )
    })
    .await?;
    Ok(Some(BrandAssetSelection { profile, asset }))
}

#[tauri::command]
pub(super) async fn load_brand_asset(
    project_id: String,
    profile_id: String,
    asset_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<tauri::ipc::Response, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let profile_id = parse_document_id(&profile_id)?;
    let asset_id = parse_attachment_id(&asset_id)?;
    let now_unix_ms = now_unix_ms()?;
    let (_, payload) = with_manager(Arc::clone(&state.projects), move |manager| {
        manager.load_brand_asset(project_id, profile_id, asset_id, now_unix_ms)
    })
    .await?;
    Ok(tauri::ipc::Response::new(payload))
}

#[tauri::command]
pub(super) async fn load_document(
    project_id: String,
    document_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<DocumentEnvelope, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let document_id = parse_document_id(&document_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.load_document(project_id, document_id, now_unix_ms)
    })
    .await
}

#[tauri::command]
pub(super) async fn save_document(
    project_id: String,
    document_id: String,
    expected_revision: u64,
    root: Value,
    state: tauri::State<'_, AppState>,
) -> Result<DocumentEnvelope, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let document_id = parse_document_id(&document_id)?;
    let expected_revision = parse_revision(expected_revision)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.save_document(
            project_id,
            document_id,
            expected_revision,
            root,
            now_unix_ms,
        )
    })
    .await
}

#[tauri::command]
pub(super) async fn render_saved_document(
    project_id: String,
    document_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<RenderedDocument, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let document_id = parse_document_id(&document_id)?;
    let now_unix_ms = now_unix_ms()?;
    let document = with_manager(Arc::clone(&state.projects), move |manager| {
        manager.load_document(project_id, document_id, now_unix_ms)
    })
    .await?;
    Ok(render_document(&document))
}

#[tauri::command]
pub(super) async fn delete_document(
    project_id: String,
    document_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let document_id = parse_document_id(&document_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.delete_document(project_id, document_id, now_unix_ms)
    })
    .await
}

#[tauri::command]
pub(super) async fn restore_document(
    project_id: String,
    document_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<DocumentEnvelope, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let document_id = parse_document_id(&document_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.restore_document(project_id, document_id, now_unix_ms)
    })
    .await
}

#[tauri::command]
pub(super) async fn list_document_revisions(
    project_id: String,
    document_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DocumentRevisionSummary>, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let document_id = parse_document_id(&document_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.list_document_revisions(project_id, document_id, now_unix_ms)
    })
    .await
}

#[tauri::command]
pub(super) async fn list_document_activity(
    project_id: String,
    document_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<DocumentActivityEntry>, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let document_id = parse_document_id(&document_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.list_document_activity(project_id, document_id, now_unix_ms)
    })
    .await
}

#[tauri::command]
pub(super) async fn compare_document_revisions(
    project_id: String,
    document_id: String,
    from_revision: u64,
    to_revision: u64,
    state: tauri::State<'_, AppState>,
) -> Result<DocumentRevisionDiff, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let document_id = parse_document_id(&document_id)?;
    let from_revision = parse_revision(from_revision)?;
    let to_revision = parse_revision(to_revision)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.compare_document_revisions(
            project_id,
            document_id,
            from_revision,
            to_revision,
            now_unix_ms,
        )
    })
    .await
}

#[tauri::command]
pub(super) async fn restore_document_revision(
    project_id: String,
    document_id: String,
    source_revision: u64,
    expected_revision: u64,
    state: tauri::State<'_, AppState>,
) -> Result<DocumentEnvelope, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let document_id = parse_document_id(&document_id)?;
    let source_revision = parse_revision(source_revision)?;
    let expected_revision = parse_revision(expected_revision)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.restore_document_revision(
            project_id,
            document_id,
            source_revision,
            expected_revision,
            now_unix_ms,
        )
    })
    .await
}

#[tauri::command]
pub(super) async fn export_saved_document(
    project_id: String,
    document_id: String,
    options: PublicationCommandOptions,
    state: tauri::State<'_, AppState>,
) -> Result<ExportOutcome, CommandError> {
    let PublicationCommandOptions {
        format,
        paper_size,
        orientation,
        tlp_marking,
        brand_profile_id,
        brand_profile_revision,
        release_version,
        publication_status,
        include_release_history,
        change_note,
        page_furniture,
        included_sections,
        appendices,
        file_name,
    } = options;
    let project_id = parse_project_id(&project_id)?;
    let document_id = parse_document_id(&document_id)?;
    let brand_selection = parse_brand_profile_selection(brand_profile_id, brand_profile_revision)?;
    let now_unix_ms = now_unix_ms()?;
    let (document, brand, assets, records) =
        with_manager(Arc::clone(&state.projects), move |manager| {
            let document = manager.load_document(project_id, document_id, now_unix_ms)?;
            let brand = publication_brand(manager, project_id, brand_selection, now_unix_ms)?;
            let publication = PublicationIr::from_freeform(&document)
                .map_err(|_| LifecycleError::from_code(LifecycleErrorCode::InvalidDocument))?;
            let assets = publication_assets(
                manager,
                project_id,
                &brand,
                &publication.evidence_image_ids(),
                now_unix_ms,
            )?;
            let records = manager.list_publication_records(project_id, now_unix_ms)?;
            Ok((document, brand, assets, records))
        })
        .await?;
    let suggested_name = requested_file_name(&file_name, format);
    let selection = rfd::AsyncFileDialog::new()
        .set_title("Export Sheut document")
        .set_file_name(&suggested_name)
        .add_filter(format.filter_name(), &[format.extension()])
        .save_file()
        .await;
    let Some(selection) = selection else {
        return Ok(ExportOutcome::cancelled());
    };
    let path = ensure_export_extension(selection.path(), format.extension());
    let source = PublicationSource::FreeformDocument {
        document_id: document.id(),
        revision: document.revision(),
    };
    let snapshot = build_publication_snapshot(
        source,
        &brand,
        format,
        paper_size,
        orientation,
        tlp_marking,
        &suggested_name,
        &path,
        &release_version,
        publication_status,
        include_release_history,
        change_note.as_deref(),
        page_furniture,
        included_sections,
        appendices,
        &records,
        now_unix_ms,
    )?;
    let (snapshot, bytes) = tauri::async_runtime::spawn_blocking(move || {
        let bytes = render_freeform_snapshot(&document, &snapshot, &brand, &assets)
            .map_err(|_| CommandError::new(LifecycleErrorCode::ExportFailed))?;
        Ok::<_, CommandError>((snapshot, bytes))
    })
    .await
    .map_err(|_| CommandError::new(LifecycleErrorCode::ExportFailed))??;
    let record = publication_record(snapshot, &bytes)?;
    let write_path = path.clone();
    tauri::async_runtime::spawn_blocking(move || write_export(&write_path, &bytes))
        .await
        .map_err(|_| CommandError::new(LifecycleErrorCode::ExportFailed))?
        .map_err(|_| CommandError::new(LifecycleErrorCode::ExportFailed))?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.save_publication_record(project_id, &record, now_unix_ms)
    })
    .await?;
    Ok(ExportOutcome::saved())
}

#[tauri::command]
pub(super) async fn export_guided_report(
    project_id: String,
    report_id: String,
    options: PublicationCommandOptions,
    state: tauri::State<'_, AppState>,
) -> Result<ExportOutcome, CommandError> {
    let PublicationCommandOptions {
        format,
        paper_size,
        orientation,
        tlp_marking,
        brand_profile_id,
        brand_profile_revision,
        release_version,
        publication_status,
        include_release_history,
        change_note,
        page_furniture,
        included_sections,
        appendices,
        file_name,
    } = options;
    let project_id = parse_project_id(&project_id)?;
    let report_id = parse_document_id(&report_id)?;
    let brand_selection = parse_brand_profile_selection(brand_profile_id, brand_profile_revision)?;
    let now_unix_ms = now_unix_ms()?;
    let (report, template, brand, assets, records) =
        with_manager(Arc::clone(&state.projects), move |manager| {
            let (report, template) =
                manager.load_guided_report_for_publication(project_id, report_id, now_unix_ms)?;
            let brand = publication_brand(manager, project_id, brand_selection, now_unix_ms)?;
            let publication = PublicationIr::from_guided(&report, &template)
                .map_err(|_| LifecycleError::from_code(LifecycleErrorCode::InvalidDocument))?;
            let assets = publication_assets(
                manager,
                project_id,
                &brand,
                &publication.evidence_image_ids(),
                now_unix_ms,
            )?;
            let records = manager.list_publication_records(project_id, now_unix_ms)?;
            Ok((report, template, brand, assets, records))
        })
        .await?;
    let suggested_name = requested_file_name(&file_name, format);
    let selection = rfd::AsyncFileDialog::new()
        .set_title("Publish Sheut guided report")
        .set_file_name(&suggested_name)
        .add_filter(format.filter_name(), &[format.extension()])
        .save_file()
        .await;
    let Some(selection) = selection else {
        return Ok(ExportOutcome::cancelled());
    };
    let path = ensure_export_extension(selection.path(), format.extension());
    let source = PublicationSource::GuidedReport {
        report_id: report.id(),
        revision: report.revision(),
    };
    let snapshot = build_publication_snapshot(
        source,
        &brand,
        format,
        paper_size,
        orientation,
        tlp_marking,
        &suggested_name,
        &path,
        &release_version,
        publication_status,
        include_release_history,
        change_note.as_deref(),
        page_furniture,
        included_sections,
        appendices,
        &records,
        now_unix_ms,
    )?;
    let (snapshot, bytes) = tauri::async_runtime::spawn_blocking(move || {
        let bytes = render_guided_snapshot(&report, &template, &snapshot, &brand, &assets)
            .map_err(|_| CommandError::new(LifecycleErrorCode::ExportFailed))?;
        Ok::<_, CommandError>((snapshot, bytes))
    })
    .await
    .map_err(|_| CommandError::new(LifecycleErrorCode::ExportFailed))??;
    let record = publication_record(snapshot, &bytes)?;
    let write_path = path.clone();
    tauri::async_runtime::spawn_blocking(move || write_export(&write_path, &bytes))
        .await
        .map_err(|_| CommandError::new(LifecycleErrorCode::ExportFailed))?
        .map_err(|_| CommandError::new(LifecycleErrorCode::ExportFailed))?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.save_publication_record(project_id, &record, now_unix_ms)
    })
    .await?;
    Ok(ExportOutcome::saved())
}

#[tauri::command]
pub(super) async fn list_publication_records(
    project_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<PublicationRecord>, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.list_publication_records(project_id, now_unix_ms)
    })
    .await
}

enum HistoricalPublication {
    Freeform(DocumentEnvelope),
    Guided(Box<GuidedReport>, ReportTemplateDefinition),
}

#[tauri::command]
pub(super) async fn reproduce_publication(
    project_id: String,
    publication_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<ExportOutcome, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let publication_id = parse_document_id(&publication_id)?;
    let now_unix_ms = now_unix_ms()?;
    let (record, source, brand, assets) =
        with_manager(Arc::clone(&state.projects), move |manager| {
            let record = manager
                .list_publication_records(project_id, now_unix_ms)?
                .into_iter()
                .find(|record| record.id() == publication_id)
                .ok_or_else(|| LifecycleError::from_code(LifecycleErrorCode::DocumentNotFound))?;
            let snapshot = record.snapshot();
            let source = match snapshot.source() {
                PublicationSource::FreeformDocument {
                    document_id,
                    revision,
                } => HistoricalPublication::Freeform(
                    manager.load_document_revision_for_publication(
                        project_id,
                        *document_id,
                        *revision,
                        now_unix_ms,
                    )?,
                ),
                PublicationSource::GuidedReport {
                    report_id,
                    revision,
                } => {
                    let (report, template) = manager.load_guided_report_revision_for_publication(
                        project_id,
                        *report_id,
                        *revision,
                        now_unix_ms,
                    )?;
                    HistoricalPublication::Guided(Box::new(report), template)
                }
            };
            let default_brand_id = LocalId::parse("110b83fb-9fdb-4133-a29b-e75725bb6d0c")
                .map_err(|_| LifecycleError::from_code(LifecycleErrorCode::InvalidDocument))?;
            let brand_selection = snapshot
                .brand_profile_revision()
                .filter(|reference| reference.profile_id != default_brand_id)
                .map(|reference| {
                    Revision::new(reference.revision)
                        .map(|revision| (reference.profile_id, revision))
                        .map_err(|_| LifecycleError::from_code(LifecycleErrorCode::InvalidDocument))
                })
                .transpose()?;
            let brand = publication_brand(manager, project_id, brand_selection, now_unix_ms)?;
            let evidence_ids = match &source {
                HistoricalPublication::Freeform(document) => PublicationIr::from_freeform(document),
                HistoricalPublication::Guided(report, template) => {
                    PublicationIr::from_guided(report, template)
                }
            }
            .map_err(|_| LifecycleError::from_code(LifecycleErrorCode::InvalidDocument))?
            .evidence_image_ids();
            let assets =
                publication_assets(manager, project_id, &brand, &evidence_ids, now_unix_ms)?;
            Ok((record, source, brand, assets))
        })
        .await?;
    let (record, bytes) = tauri::async_runtime::spawn_blocking(move || {
        let snapshot = record.snapshot();
        let bytes = match &source {
            HistoricalPublication::Freeform(document) => {
                render_freeform_snapshot(document, snapshot, &brand, &assets)
            }
            HistoricalPublication::Guided(report, template) => {
                render_guided_snapshot(report, template, snapshot, &brand, &assets)
            }
        }
        .map_err(|_| CommandError::new(LifecycleErrorCode::ExportFailed))?;
        Ok::<_, CommandError>((record, bytes))
    })
    .await
    .map_err(|_| CommandError::new(LifecycleErrorCode::ExportFailed))??;
    let snapshot = record.snapshot();
    let byte_len = u64::try_from(bytes.len())
        .map_err(|_| CommandError::new(LifecycleErrorCode::ExportFailed))?;
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    if byte_len != record.byte_len() || sha256 != record.sha256() {
        return Err(CommandError::new(LifecycleErrorCode::ExportFailed));
    }
    let format = ExportFormat::from_publication_format(snapshot.format());
    let suggested_name = requested_file_name(snapshot.output_file_name(), format);
    let selection = rfd::AsyncFileDialog::new()
        .set_title("Reproduce historical Sheut publication")
        .set_file_name(&suggested_name)
        .add_filter(format.filter_name(), &[format.extension()])
        .save_file()
        .await;
    let Some(selection) = selection else {
        return Ok(ExportOutcome::cancelled());
    };
    let path = ensure_export_extension(selection.path(), format.extension());
    tauri::async_runtime::spawn_blocking(move || write_export(&path, &bytes))
        .await
        .map_err(|_| CommandError::new(LifecycleErrorCode::ExportFailed))?
        .map_err(|_| CommandError::new(LifecycleErrorCode::ExportFailed))?;
    Ok(ExportOutcome::saved())
}

fn parse_brand_profile_selection(
    profile_id: Option<String>,
    revision: Option<u64>,
) -> Result<Option<(LocalId, Revision)>, CommandError> {
    match (profile_id, revision) {
        (None, None) => Ok(None),
        (Some(profile_id), Some(revision)) => Ok(Some((
            parse_document_id(&profile_id)?,
            parse_revision(revision)?,
        ))),
        _ => Err(CommandError::new(LifecycleErrorCode::InvalidDocument)),
    }
}

fn publication_brand(
    manager: &mut ProjectManager<OsProjectKeyStore>,
    project_id: LocalId,
    selection: Option<(LocalId, Revision)>,
    now_unix_ms: i64,
) -> Result<BrandProfile, LifecycleError> {
    if let Some((profile_id, revision)) = selection {
        return manager.load_brand_profile_revision(project_id, profile_id, revision, now_unix_ms);
    }
    let project = manager.project(project_id)?;
    let organization = project.name().unwrap_or("Sheut");
    let default_id = LocalId::parse("110b83fb-9fdb-4133-a29b-e75725bb6d0c")
        .map_err(|_| LifecycleError::from_code(LifecycleErrorCode::InvalidDocument))?;
    BrandProfile::project_default(default_id, organization, now_unix_ms)
        .map_err(|_| LifecycleError::from_code(LifecycleErrorCode::InvalidDocument))
}

fn publication_assets(
    manager: &mut ProjectManager<OsProjectKeyStore>,
    project_id: LocalId,
    brand: &BrandProfile,
    evidence_image_ids: &[LocalId],
    now_unix_ms: i64,
) -> Result<PublicationAssets, LifecycleError> {
    let mut assets = PublicationAssets::default();
    for role in [
        BrandAssetRole::Logo,
        BrandAssetRole::CompactMark,
        BrandAssetRole::CoverArtwork,
    ] {
        let Some(asset_id) = brand.asset_id(role) else {
            continue;
        };
        let (_, payload) =
            manager.load_brand_asset(project_id, brand.id(), asset_id, now_unix_ms)?;
        match role {
            BrandAssetRole::Logo => assets.logo = Some(payload),
            BrandAssetRole::CompactMark => assets.compact_mark = Some(payload),
            BrandAssetRole::CoverArtwork => assets.cover_artwork = Some(payload),
        }
    }
    for evidence_id in evidence_image_ids {
        if assets.evidence_images.contains_key(evidence_id) {
            continue;
        }
        let (_, payload) = manager.load_evidence_image(project_id, *evidence_id, now_unix_ms)?;
        assets.evidence_images.insert(*evidence_id, payload);
    }
    Ok(assets)
}

#[allow(clippy::too_many_arguments)]
fn build_publication_snapshot(
    source: PublicationSource,
    brand: &BrandProfile,
    format: ExportFormat,
    paper_size: PaperSize,
    orientation: PageOrientation,
    tlp_marking: TlpMarking,
    file_name: &str,
    output_path: &Path,
    release_version: &str,
    publication_status: PublicationStatus,
    include_release_history: bool,
    change_note: Option<&str>,
    page_furniture: PageFurniture,
    included_sections: Vec<String>,
    appendices: Vec<String>,
    records: &[PublicationRecord],
    now_unix_ms: i64,
) -> Result<PublicationSnapshot, CommandError> {
    let release_history =
        publication_release_history(records, &source, release_version, change_note, now_unix_ms)?;
    let settings = PublicationSettings::from_brand(brand, format.publication_format())
        .with_paper_size(paper_size)
        .with_orientation(orientation)
        .with_tlp_marking(Some(tlp_marking))
        .with_page_furniture(page_furniture)
        .with_included_sections(included_sections)
        .with_appendices(appendices)
        .with_output_file_name(file_name)
        .and_then(|settings| settings.with_output_location(output_path.to_string_lossy()))
        .and_then(|settings| {
            settings.with_release(
                release_version,
                publication_status,
                include_release_history,
                release_history,
            )
        })
        .map_err(|_| CommandError::new(LifecycleErrorCode::ExportFailed))?;
    PublicationSnapshot::new(
        LocalId::from_uuid(Uuid::new_v4()),
        source,
        settings,
        now_unix_ms,
    )
    .map_err(|_| CommandError::new(LifecycleErrorCode::ExportFailed))
}

fn publication_release_history(
    records: &[PublicationRecord],
    source: &PublicationSource,
    release_version: &str,
    change_note: Option<&str>,
    now_unix_ms: i64,
) -> Result<Vec<PublicationReleaseEntry>, CommandError> {
    let current_note = change_note.map(str::trim).filter(|note| !note.is_empty());
    let current = PublicationReleaseEntry::new(
        release_version,
        current_note.unwrap_or("Initial release"),
        now_unix_ms,
    )
    .map_err(|_| CommandError::new(LifecycleErrorCode::ExportFailed))?;
    let latest = records
        .iter()
        .find(|record| same_publication_subject(record.snapshot().source(), source));
    let Some(latest) = latest else {
        if current.version() == "1.0" {
            return Ok(vec![current]);
        }
        let initial = PublicationReleaseEntry::new("1.0", "Initial release", now_unix_ms)
            .map_err(|_| CommandError::new(LifecycleErrorCode::ExportFailed))?;
        return Ok(vec![initial, current]);
    };
    let mut history = latest.snapshot().release_history().to_vec();
    if history.is_empty() {
        history.push(
            PublicationReleaseEntry::new(
                latest.snapshot().release_version(),
                "Initial release",
                latest.snapshot().created_at_unix_ms(),
            )
            .map_err(|_| CommandError::new(LifecycleErrorCode::ExportFailed))?,
        );
    }
    if let Some(previous) = history.last()
        && previous.version() == current.version()
    {
        if current_note.is_some_and(|note| note != previous.change_note()) {
            return Err(CommandError::new(LifecycleErrorCode::ExportFailed));
        }
        return Ok(history);
    }
    if current.version() != "1.0" && current_note.is_none() {
        return Err(CommandError::new(LifecycleErrorCode::ExportFailed));
    }
    history.push(current);
    Ok(history)
}

fn same_publication_subject(left: &PublicationSource, right: &PublicationSource) -> bool {
    match (left, right) {
        (
            PublicationSource::FreeformDocument {
                document_id: left, ..
            },
            PublicationSource::FreeformDocument {
                document_id: right, ..
            },
        ) => left == right,
        (
            PublicationSource::GuidedReport {
                report_id: left, ..
            },
            PublicationSource::GuidedReport {
                report_id: right, ..
            },
        ) => left == right,
        _ => false,
    }
}

fn publication_record(
    snapshot: PublicationSnapshot,
    bytes: &[u8],
) -> Result<PublicationRecord, CommandError> {
    let byte_len = u64::try_from(bytes.len())
        .map_err(|_| CommandError::new(LifecycleErrorCode::ExportFailed))?;
    let sha256 = format!("{:x}", Sha256::digest(bytes));
    PublicationRecord::new(
        LocalId::from_uuid(Uuid::new_v4()),
        snapshot,
        byte_len,
        sha256,
    )
    .map_err(|_| CommandError::new(LifecycleErrorCode::ExportFailed))
}

#[tauri::command]
pub(super) async fn pick_document_image(
    project_id: String,
    document_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Option<ImageAttachmentMetadata>, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let document_id = parse_document_id(&document_id)?;
    let selection = rfd::AsyncFileDialog::new()
        .set_title("Attach image to Sheut document")
        .add_filter("Images", &["png", "jpg", "jpeg", "webp"])
        .pick_file()
        .await;
    let Some(selection) = selection else {
        return Ok(None);
    };
    let file_name = selection.file_name();
    let path = selection.path().to_owned();
    let payload = tauri::async_runtime::spawn_blocking(move || read_bounded_image(&path))
        .await
        .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidAttachment))??;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.create_image_attachment(project_id, document_id, file_name, payload, now_unix_ms)
    })
    .await
    .map(Some)
}

#[tauri::command]
pub(super) async fn load_document_image(
    project_id: String,
    document_id: String,
    attachment_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<tauri::ipc::Response, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let document_id = parse_document_id(&document_id)?;
    let attachment_id = parse_attachment_id(&attachment_id)?;
    let now_unix_ms = now_unix_ms()?;
    let (_, payload) = with_manager(Arc::clone(&state.projects), move |manager| {
        manager.load_image_attachment(project_id, document_id, attachment_id, now_unix_ms)
    })
    .await?;
    Ok(tauri::ipc::Response::new(payload))
}

#[tauri::command]
pub(super) async fn import_evidence_image(
    project_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Option<EvidenceFileMetadata>, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let selection = rfd::AsyncFileDialog::new()
        .set_title("Import image into project evidence")
        .add_filter("Images", &["png", "jpg", "jpeg", "webp"])
        .pick_file()
        .await;
    let Some(selection) = selection else {
        return Ok(None);
    };
    let file_name = selection.file_name();
    let path = selection.path().to_owned();
    let payload = tauri::async_runtime::spawn_blocking(move || read_bounded_image(&path))
        .await
        .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidAttachment))??;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.create_evidence_image(project_id, file_name, payload, now_unix_ms)
    })
    .await
    .map(Some)
}

#[tauri::command]
pub(super) async fn import_evidence_file(
    project_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Option<EvidenceFileMetadata>, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let selection = rfd::AsyncFileDialog::new()
        .set_title("Import file into project evidence")
        .pick_file()
        .await;
    let Some(selection) = selection else {
        return Ok(None);
    };
    let file_name = selection.file_name();
    let path = selection.path().to_owned();
    let payload = tauri::async_runtime::spawn_blocking(move || read_bounded_evidence_file(&path))
        .await
        .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidAttachment))??;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.create_evidence_file(project_id, file_name, payload, now_unix_ms)
    })
    .await
    .map(Some)
}

#[tauri::command]
pub(super) async fn list_evidence_files(
    project_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<EvidenceFileMetadata>, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.list_evidence_files(project_id, now_unix_ms)
    })
    .await
}

#[tauri::command]
pub(super) async fn load_evidence_image(
    project_id: String,
    evidence_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<tauri::ipc::Response, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let evidence_id = parse_attachment_id(&evidence_id)?;
    let now_unix_ms = now_unix_ms()?;
    let (_, payload) = with_manager(Arc::clone(&state.projects), move |manager| {
        manager.load_evidence_image(project_id, evidence_id, now_unix_ms)
    })
    .await?;
    Ok(tauri::ipc::Response::new(payload))
}

#[tauri::command]
pub(super) async fn update_evidence_metadata(
    project_id: String,
    evidence_id: String,
    expected_revision: u64,
    input: EvidenceMetadataInput,
    state: tauri::State<'_, AppState>,
) -> Result<EvidenceFileMetadata, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let evidence_id = parse_attachment_id(&evidence_id)?;
    let expected_revision = parse_revision(expected_revision)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.update_evidence_metadata(
            project_id,
            evidence_id,
            expected_revision,
            input,
            now_unix_ms,
        )
    })
    .await
}

#[tauri::command]
pub(super) async fn delete_evidence_file(
    project_id: String,
    evidence_id: String,
    expected_revision: u64,
    state: tauri::State<'_, AppState>,
) -> Result<(), CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let evidence_id = parse_attachment_id(&evidence_id)?;
    let expected_revision = parse_revision(expected_revision)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.delete_evidence_file(project_id, evidence_id, expected_revision, now_unix_ms)
    })
    .await
}

#[tauri::command]
pub(super) async fn list_project_backups(
    project_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ProjectBackupSummary>, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.list_project_backups(project_id).map(|backups| {
            backups
                .into_iter()
                .map(ProjectBackupSummary::from)
                .collect()
        })
    })
    .await
}

#[tauri::command]
pub(super) async fn create_project(
    name: String,
    default_tlp_marking: TlpMarking,
    state: tauri::State<'_, AppState>,
) -> Result<ProjectSummary, CommandError> {
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager
            .create_project_with_default_tlp(name, default_tlp_marking, now_unix_ms)
            .map(ProjectSummary::from)
    })
    .await
}

#[tauri::command]
pub(super) async fn update_project_default_tlp(
    project_id: String,
    marking: TlpMarking,
    state: tauri::State<'_, AppState>,
) -> Result<ProjectSummary, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager
            .update_project_default_tlp(project_id, marking, now_unix_ms)
            .map(ProjectSummary::from)
    })
    .await
}

#[tauri::command]
pub(super) async fn unlock_project(
    project_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<ProjectSummary, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager
            .unlock_project(project_id, now_unix_ms)
            .map(ProjectSummary::from)
    })
    .await
}

#[tauri::command]
pub(super) async fn create_passphrase_project(
    name: String,
    default_tlp_marking: TlpMarking,
    passphrase: String,
    state: tauri::State<'_, AppState>,
) -> Result<ProjectSummary, CommandError> {
    let now_unix_ms = now_unix_ms()?;
    // Move the webview-provided allocation into zeroizing storage before it
    // crosses to the blocking pool; neither errors nor events contain it.
    let passphrase = Zeroizing::new(passphrase);
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager
            .create_passphrase_project_with_default_tlp(
                name,
                passphrase.as_str(),
                default_tlp_marking,
                now_unix_ms,
            )
            .map(ProjectSummary::from)
    })
    .await
}

#[tauri::command]
pub(super) async fn unlock_passphrase_project(
    project_id: String,
    passphrase: String,
    state: tauri::State<'_, AppState>,
) -> Result<ProjectSummary, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let now_unix_ms = now_unix_ms()?;
    let passphrase = Zeroizing::new(passphrase);
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager
            .unlock_project_with_passphrase(project_id, passphrase.as_str(), now_unix_ms)
            .map(ProjectSummary::from)
    })
    .await
}

#[tauri::command]
pub(super) async fn lock_project(
    project_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), CommandError> {
    let project_id = parse_project_id(&project_id)?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.lock_project(project_id)
    })
    .await?;
    clear_project_stix_previews(&state.stix_previews, project_id)?;
    clear_project_mitre_previews(&state.mitre_mapping_previews, project_id)?;
    Ok(())
}

#[tauri::command]
pub(super) async fn delete_project(
    project_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), CommandError> {
    let project_id = parse_project_id(&project_id)?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.delete_project(project_id)
    })
    .await?;
    clear_project_stix_previews(&state.stix_previews, project_id)?;
    clear_project_mitre_previews(&state.mitre_mapping_previews, project_id)?;
    Ok(())
}

#[tauri::command]
pub(super) async fn create_project_backup(
    project_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<ProjectBackupSummary, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager
            .create_project_backup(project_id, now_unix_ms)
            .map(ProjectBackupSummary::from)
    })
    .await
}

#[tauri::command]
pub(super) async fn restore_device_project_backup(
    project_id: String,
    backup_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let backup_id = parse_project_id(&backup_id)?;
    let now_unix_ms = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.restore_device_project_backup(project_id, backup_id, now_unix_ms)
    })
    .await
}

#[tauri::command]
pub(super) async fn restore_passphrase_project_backup(
    project_id: String,
    backup_id: String,
    passphrase: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let backup_id = parse_project_id(&backup_id)?;
    let now_unix_ms = now_unix_ms()?;
    let passphrase = Zeroizing::new(passphrase);
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.restore_passphrase_project_backup(
            project_id,
            backup_id,
            passphrase.as_str(),
            now_unix_ms,
        )
    })
    .await
}

pub(crate) fn parse_project_id(value: &str) -> Result<LocalId, CommandError> {
    LocalId::parse(value).map_err(|_| CommandError::new(LifecycleErrorCode::InvalidProject))
}

fn parse_document_id(value: &str) -> Result<LocalId, CommandError> {
    LocalId::parse(value).map_err(|_| CommandError::new(LifecycleErrorCode::InvalidDocument))
}

fn parse_technique_observation_id(value: &str) -> Result<LocalId, CommandError> {
    LocalId::parse(value)
        .map_err(|_| CommandError::new(LifecycleErrorCode::TechniqueObservationNotFound))
}

fn parse_attachment_id(value: &str) -> Result<LocalId, CommandError> {
    LocalId::parse(value).map_err(|_| CommandError::new(LifecycleErrorCode::InvalidAttachment))
}

pub(crate) fn parse_revision(value: u64) -> Result<Revision, CommandError> {
    Revision::new(value).map_err(|_| CommandError::new(LifecycleErrorCode::RevisionConflict))
}

fn ensure_export_extension(path: &Path, extension: &str) -> PathBuf {
    if path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(extension))
    {
        return path.to_owned();
    }
    let mut value = path.as_os_str().to_owned();
    value.push(format!(".{extension}"));
    PathBuf::from(value)
}

fn requested_stix_file_name(value: &str) -> Result<String, CommandError> {
    let value = value.trim();
    if value.is_empty()
        || value.chars().count() > 96
        || value.contains(['/', '\\'])
        || value.chars().any(|character| character.is_control())
    {
        return Err(CommandError::new(LifecycleErrorCode::InvalidStix));
    }
    let stem = value
        .strip_suffix(".json")
        .or_else(|| value.strip_suffix(".JSON"))
        .unwrap_or(value)
        .trim();
    if stem.is_empty() || stem == "." || stem == ".." {
        return Err(CommandError::new(LifecycleErrorCode::InvalidStix));
    }
    Ok(format!("{stem}.json"))
}

fn requested_mitre_json_file_name(value: &str) -> Result<String, CommandError> {
    let value = value.trim();
    if value.is_empty()
        || value.chars().count() > 96
        || value.contains(['/', '\\'])
        || value.chars().any(|character| character.is_control())
    {
        return Err(CommandError::new(LifecycleErrorCode::InvalidMitreMapping));
    }
    let stem = value
        .strip_suffix(".json")
        .or_else(|| value.strip_suffix(".JSON"))
        .unwrap_or(value)
        .trim();
    if stem.is_empty() || stem == "." || stem == ".." {
        return Err(CommandError::new(LifecycleErrorCode::InvalidMitreMapping));
    }
    Ok(format!("{stem}.json"))
}

fn write_export(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut file = fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(path)?;
    set_export_permissions(&file)?;
    file.write_all(bytes)?;
    file.sync_all()
}

fn read_bounded_image(path: &Path) -> Result<Vec<u8>, CommandError> {
    let mut file = fs::File::open(path)
        .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidAttachment))?;
    let metadata = file
        .metadata()
        .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidAttachment))?;
    if !metadata.is_file() || !(1..=MAX_IMAGE_ATTACHMENT_BYTES).contains(&metadata.len()) {
        return Err(CommandError::new(LifecycleErrorCode::InvalidAttachment));
    }
    let mut payload = Vec::with_capacity(usize::try_from(metadata.len()).unwrap_or(0));
    Read::by_ref(&mut file)
        .take(MAX_IMAGE_ATTACHMENT_BYTES.saturating_add(1))
        .read_to_end(&mut payload)
        .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidAttachment))?;
    if u64::try_from(payload.len())
        .ok()
        .is_none_or(|length| !(1..=MAX_IMAGE_ATTACHMENT_BYTES).contains(&length))
        || ImageMediaType::detect(&payload).is_err()
    {
        return Err(CommandError::new(LifecycleErrorCode::InvalidAttachment));
    }
    Ok(payload)
}

fn read_bounded_evidence_file(path: &Path) -> Result<Vec<u8>, CommandError> {
    let mut file = fs::File::open(path)
        .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidAttachment))?;
    let metadata = file
        .metadata()
        .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidAttachment))?;
    if !metadata.is_file() || !(1..=MAX_EVIDENCE_FILE_BYTES).contains(&metadata.len()) {
        return Err(CommandError::new(LifecycleErrorCode::InvalidAttachment));
    }
    let mut payload = Vec::with_capacity(usize::try_from(metadata.len()).unwrap_or(0));
    Read::by_ref(&mut file)
        .take(MAX_EVIDENCE_FILE_BYTES.saturating_add(1))
        .read_to_end(&mut payload)
        .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidAttachment))?;
    if u64::try_from(payload.len())
        .ok()
        .is_none_or(|length| !(1..=MAX_EVIDENCE_FILE_BYTES).contains(&length))
    {
        return Err(CommandError::new(LifecycleErrorCode::InvalidAttachment));
    }
    Ok(payload)
}

fn read_bounded_stix(path: &Path) -> Result<Vec<u8>, CommandError> {
    let maximum = u64::try_from(MAX_STIX_BUNDLE_BYTES)
        .map_err(|_| CommandError::new(LifecycleErrorCode::StixLimitExceeded))?;
    let mut file =
        fs::File::open(path).map_err(|_| CommandError::new(LifecycleErrorCode::InvalidStix))?;
    let metadata = file
        .metadata()
        .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidStix))?;
    if !metadata.is_file() || !(1..=maximum).contains(&metadata.len()) {
        return Err(CommandError::new(LifecycleErrorCode::StixLimitExceeded));
    }
    let mut payload = Vec::with_capacity(usize::try_from(metadata.len()).unwrap_or(0));
    Read::by_ref(&mut file)
        .take(maximum.saturating_add(1))
        .read_to_end(&mut payload)
        .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidStix))?;
    if payload.is_empty() || payload.len() > MAX_STIX_BUNDLE_BYTES {
        return Err(CommandError::new(LifecycleErrorCode::StixLimitExceeded));
    }
    Ok(payload)
}

fn read_bounded_mitre_catalog(path: &Path) -> Result<Vec<u8>, CommandError> {
    let maximum = u64::try_from(MAX_MITRE_SOURCE_BYTES)
        .map_err(|_| CommandError::new(LifecycleErrorCode::MitreCatalogLimitExceeded))?;
    let mut file = fs::File::open(path)
        .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidMitreCatalog))?;
    let metadata = file
        .metadata()
        .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidMitreCatalog))?;
    if !metadata.is_file() || !(1..=maximum).contains(&metadata.len()) {
        return Err(CommandError::new(
            LifecycleErrorCode::MitreCatalogLimitExceeded,
        ));
    }
    let mut payload = Vec::with_capacity(usize::try_from(metadata.len()).unwrap_or(0));
    Read::by_ref(&mut file)
        .take(maximum.saturating_add(1))
        .read_to_end(&mut payload)
        .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidMitreCatalog))?;
    if payload.is_empty() || payload.len() > MAX_MITRE_SOURCE_BYTES {
        return Err(CommandError::new(
            LifecycleErrorCode::MitreCatalogLimitExceeded,
        ));
    }
    Ok(payload)
}

fn read_bounded_mitre_mapping(path: &Path) -> Result<Vec<u8>, CommandError> {
    let maximum = u64::try_from(MAX_MAPPING_FILE_BYTES)
        .map_err(|_| CommandError::new(LifecycleErrorCode::MitreMappingLimitExceeded))?;
    let mut file = fs::File::open(path)
        .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidMitreMapping))?;
    let metadata = file
        .metadata()
        .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidMitreMapping))?;
    if !metadata.is_file() || !(1..=maximum).contains(&metadata.len()) {
        return Err(CommandError::new(
            LifecycleErrorCode::MitreMappingLimitExceeded,
        ));
    }
    let mut payload = Vec::with_capacity(usize::try_from(metadata.len()).unwrap_or(0));
    Read::by_ref(&mut file)
        .take(maximum.saturating_add(1))
        .read_to_end(&mut payload)
        .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidMitreMapping))?;
    if payload.is_empty() || payload.len() > MAX_MAPPING_FILE_BYTES {
        return Err(CommandError::new(
            LifecycleErrorCode::MitreMappingLimitExceeded,
        ));
    }
    Ok(payload)
}

fn compare_catalog_versions(
    candidate: &str,
    current: &str,
) -> Result<CatalogVersionRelation, CommandError> {
    fn parse(value: &str) -> Option<[u64; 3]> {
        let parts = value.split('.').collect::<Vec<_>>();
        if !(2..=3).contains(&parts.len()) {
            return None;
        }
        let mut parsed = [0_u64; 3];
        for (index, part) in parts.into_iter().enumerate() {
            if part.is_empty() || part.len() > 4 || !part.bytes().all(|byte| byte.is_ascii_digit())
            {
                return None;
            }
            parsed[index] = part.parse().ok()?;
        }
        Some(parsed)
    }

    let candidate = parse(candidate)
        .ok_or_else(|| CommandError::new(LifecycleErrorCode::InvalidMitreCatalog))?;
    let current =
        parse(current).ok_or_else(|| CommandError::new(LifecycleErrorCode::InvalidMitreCatalog))?;
    Ok(match candidate.cmp(&current) {
        std::cmp::Ordering::Greater => CatalogVersionRelation::Upgrade,
        std::cmp::Ordering::Equal => CatalogVersionRelation::Same,
        std::cmp::Ordering::Less => CatalogVersionRelation::Downgrade,
    })
}

fn clear_project_stix_previews(
    previews: &Mutex<StixPreviews>,
    project_id: LocalId,
) -> Result<(), CommandError> {
    let mut previews = previews
        .lock()
        .map_err(|_| CommandError::storage_unavailable())?;
    previews
        .imports
        .retain(|_, pending| pending.project_id != project_id);
    previews
        .exports
        .retain(|_, pending| pending.project_id != project_id);
    Ok(())
}

fn clear_project_mitre_previews(
    previews: &Mutex<MitreMappingPreviews>,
    project_id: LocalId,
) -> Result<(), CommandError> {
    let mut previews = previews
        .lock()
        .map_err(|_| CommandError::storage_unavailable())?;
    previews
        .mappings
        .retain(|_, pending| pending.project_id != project_id);
    previews
        .navigator
        .retain(|_, pending| pending.project_id != project_id);
    Ok(())
}

#[cfg(unix)]
fn set_export_permissions(file: &fs::File) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    file.set_permissions(fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn set_export_permissions(_file: &fs::File) -> std::io::Result<()> {
    Ok(())
}

pub(crate) fn now_unix_ms() -> Result<i64, CommandError> {
    let milliseconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| CommandError::storage_unavailable())?
        .as_millis();
    i64::try_from(milliseconds).map_err(|_| CommandError::storage_unavailable())
}

pub(crate) async fn with_manager<T, F>(
    projects: SharedProjectManager,
    operation: F,
) -> Result<T, CommandError>
where
    T: Send + 'static,
    F: FnOnce(&mut ProjectManager<OsProjectKeyStore>) -> Result<T, LifecycleError> + Send + 'static,
{
    // SQLCipher and filesystem work are synchronous. Keep them off Tauri's async
    // command workers while serializing one project's transactional mutations.
    tauri::async_runtime::spawn_blocking(move || {
        let mut manager = projects
            .lock()
            .map_err(|_| CommandError::storage_unavailable())?;
        operation(&mut manager).map_err(CommandError::from)
    })
    .await
    .map_err(|_| CommandError::storage_unavailable())?
}

async fn with_catalogs<T, F>(catalogs: SharedCatalogStore, operation: F) -> Result<T, CommandError>
where
    T: Send + 'static,
    F: FnOnce(&CatalogStore) -> Result<T, CommandError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let catalogs = catalogs
            .lock()
            .map_err(|_| CommandError::storage_unavailable())?;
        operation(&catalogs)
    })
    .await
    .map_err(|_| CommandError::storage_unavailable())?
}

#[cfg(test)]
mod tests {
    use super::{
        CatalogVersionRelation, CommandError, compare_catalog_versions, parse_attachment_id,
        parse_document_id, parse_project_id, parse_revision, parse_technique_observation_id,
        requested_mitre_json_file_name, requested_stix_file_name, stix_display_name,
        stix_object_summaries,
    };
    use sheut_core::LocalId;
    use sheut_project::LifecycleErrorCode;
    use sheut_stix::{ExistingStixObject, StixErrorCode, parse_bundle};

    #[test]
    fn command_project_ids_must_be_canonical_local_ids() {
        assert!(parse_project_id("019b0dc2-34c8-7c31-a2e5-c447222ce0b9").is_ok());
        let error = parse_project_id("../../project.sheut").unwrap_err();
        assert_eq!(error.code, LifecycleErrorCode::InvalidProject);
    }

    #[test]
    fn serialized_command_errors_expose_only_a_stable_code() {
        let error = CommandError::new(LifecycleErrorCode::StorageUnavailable);
        assert_eq!(
            serde_json::to_string(&error).unwrap(),
            r#"{"code":"storage_unavailable"}"#
        );
    }

    #[test]
    fn document_arguments_are_validated_before_storage_access() {
        assert!(parse_document_id("019b0dc2-34c8-7c31-a2e5-c447222ce0b9").is_ok());
        assert_eq!(
            parse_document_id("../document.json").unwrap_err().code,
            LifecycleErrorCode::InvalidDocument
        );
        assert_eq!(
            parse_revision(0).unwrap_err().code,
            LifecycleErrorCode::RevisionConflict
        );
        assert_eq!(
            parse_attachment_id("file:///private/evidence.png")
                .unwrap_err()
                .code,
            LifecycleErrorCode::InvalidAttachment
        );
        assert_eq!(
            parse_technique_observation_id("../mapping.json")
                .unwrap_err()
                .code,
            LifecycleErrorCode::TechniqueObservationNotFound
        );
    }

    #[test]
    fn stix_export_names_are_bounded_basenames() {
        assert_eq!(
            requested_stix_file_name("apt1-review").unwrap(),
            "apt1-review.json"
        );
        assert_eq!(
            requested_stix_file_name("apt1-review.json").unwrap(),
            "apt1-review.json"
        );
        assert_eq!(
            requested_stix_file_name("../apt1.json").unwrap_err().code,
            LifecycleErrorCode::InvalidStix
        );
    }

    #[test]
    fn mitre_export_names_are_bounded_basenames() {
        assert_eq!(
            requested_mitre_json_file_name("operation-northwind").unwrap(),
            "operation-northwind.json"
        );
        assert_eq!(
            requested_mitre_json_file_name("../mapping.json")
                .unwrap_err()
                .code,
            LifecycleErrorCode::InvalidMitreMapping
        );
    }

    #[test]
    fn stix_errors_cross_ipc_as_redacted_codes() {
        let error = parse_bundle(b"{}").unwrap_err();
        assert_eq!(error.code(), StixErrorCode::InvalidBundle);
        let command_error = CommandError::from(error);
        assert_eq!(
            serde_json::to_string(&command_error).unwrap(),
            r#"{"code":"invalid_stix"}"#
        );
    }

    #[test]
    fn stix_summaries_expose_only_a_bounded_display_label() {
        let name = "A".repeat(200);
        let bundle = serde_json::to_vec(&serde_json::json!({
            "type": "bundle",
            "id": "bundle--d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
            "objects": [{
                "type": "threat-actor",
                "spec_version": "2.1",
                "id": "threat-actor--e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
                "created": "2020-01-01T00:00:00.000Z",
                "modified": "2020-01-01T00:00:00.000Z",
                "name": name
            }]
        }))
        .unwrap();
        let parsed = parse_bundle(&bundle).unwrap();
        let object = ExistingStixObject::new(
            LocalId::parse("019b0dc2-34c8-7c31-a2e5-c447222ce0b9").unwrap(),
            parsed.objects()[0].raw().clone(),
        )
        .unwrap();

        let display_name = stix_display_name(&object);

        assert_eq!(display_name.chars().count(), 160);
    }

    #[test]
    fn stix_relationship_summaries_preserve_direction_and_resolve_local_endpoints() {
        let bundle = serde_json::to_vec(&serde_json::json!({
            "type": "bundle",
            "id": "bundle--cf20f99b-3ed2-4a9f-b4f1-d660a7fc8241",
            "objects": [
                {
                    "type": "intrusion-set",
                    "spec_version": "2.1",
                    "id": "intrusion-set--da1065ce-972c-4605-8755-9cd1074e3b5a",
                    "created": "2015-05-15T09:12:16.000Z",
                    "modified": "2015-05-15T09:12:16.000Z",
                    "name": "APT1"
                },
                {
                    "type": "threat-actor",
                    "spec_version": "2.1",
                    "id": "threat-actor--6d179234-61fc-40c4-ae86-3d53308d8e65",
                    "created": "2015-05-15T09:12:16.000Z",
                    "modified": "2015-05-15T09:12:16.000Z",
                    "name": "Ugly Gorilla"
                },
                {
                    "type": "relationship",
                    "spec_version": "2.1",
                    "id": "relationship--765815fb-d993-4a1d-959f-7f7bcc4a5eb3",
                    "created": "2015-05-15T09:12:16.000Z",
                    "modified": "2015-05-15T09:12:16.000Z",
                    "relationship_type": "attributed-to",
                    "source_ref": "intrusion-set--da1065ce-972c-4605-8755-9cd1074e3b5a",
                    "target_ref": "threat-actor--6d179234-61fc-40c4-ae86-3d53308d8e65"
                }
            ]
        }))
        .unwrap();
        let parsed = parse_bundle(&bundle).unwrap();
        let local_ids = [
            "019b0dc2-34c8-7c31-a2e5-c447222ce0b9",
            "d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
            "e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
        ];
        let objects = parsed
            .objects()
            .iter()
            .zip(local_ids)
            .map(|(object, local_id)| {
                ExistingStixObject::new(LocalId::parse(local_id).unwrap(), object.raw().clone())
                    .unwrap()
            })
            .collect::<Vec<_>>();

        let summaries = stix_object_summaries(&objects);
        let relationship = summaries
            .iter()
            .find(|summary| summary.object_type == "relationship")
            .and_then(|summary| summary.relationship.as_ref())
            .unwrap();

        assert_eq!(relationship.relationship_type, "attributed-to");
        assert_eq!(relationship.source_ref, objects[0].stix_id());
        assert_eq!(relationship.target_ref, objects[1].stix_id());
        assert_eq!(relationship.source_id, Some(objects[0].local_id()));
        assert_eq!(relationship.target_id, Some(objects[1].local_id()));
    }

    #[test]
    fn catalog_versions_are_compared_numerically_not_lexically() {
        assert_eq!(
            compare_catalog_versions("20.0", "19.1").unwrap(),
            CatalogVersionRelation::Upgrade
        );
        assert_eq!(
            compare_catalog_versions("2026.06", "2026.6").unwrap(),
            CatalogVersionRelation::Same
        );
        assert_eq!(
            compare_catalog_versions("18.10", "19.1").unwrap(),
            CatalogVersionRelation::Downgrade
        );
        assert_eq!(
            compare_catalog_versions("latest", "19.1").unwrap_err().code,
            LifecycleErrorCode::InvalidMitreCatalog
        );
    }
}
