use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use sha2::{Digest, Sha256};

use sheut_core::{
    AnalyticConfidence, DocumentActivityKind, DocumentEnvelope, DocumentKind, EvidenceFileMetadata,
    EvidenceMetadataInput, GraphViewport, GraphWorkspace, ImageAttachmentMetadata, ImageMediaType,
    LocalId, MitreCatalog, MitreTechniqueReference, Position, ProjectMetadata, Revision,
    SemanticRelationshipDraft, TechniqueAssessment, TechniqueObservation, TechniqueOutcome,
    TlpMarking, VisualLink, WorkspaceItem, WorkspaceItemKind, WorkspaceMode,
};
use sheut_stix::{
    ExistingStixObject, StixDraft, commit_existing_export, commit_import, commit_project_export,
    parse_bundle, preview_existing_export, preview_import, preview_project_export,
};
use sheut_store::{EncryptedStore, StoreErrorCode};

const DOCUMENT_ID: &str = "e7c44850-9f67-4d26-b7e3-0d4ee82339ef";
const SECOND_DOCUMENT_ID: &str = "d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb";
const OTHER_DOCUMENT_ID: &str = "6f9619ff-8b86-d011-b42d-00cf4fc964ff";
const WORKSPACE_ID: &str = "4f3d8e34-7c64-4d41-8b68-d7a334e1a884";
const VISUAL_LINK_ID: &str = "d8c735f2-4f6b-4fd7-bcfa-52b5cfad9de5";
const PROJECT_KEY: [u8; 32] = [0x11; 32];
const WRONG_KEY: [u8; 32] = [0x22; 32];
const BACKUP_KEY: [u8; 32] = [0x33; 32];
const FIXTURE_CONTENT: &str = "fixture intelligence must remain encrypted";
const OASIS_APT1: &[u8] = include_bytes!("../../sheut-stix/tests/fixtures/apt1.json");
const TEST_PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x04, 0x00, 0x00, 0x00, 0xb5, 0x1c, 0x0c,
    0x02, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0x64, 0xf8, 0x0f, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x27, 0x18, 0xe3, 0x66, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
    0xae, 0x42, 0x60, 0x82,
];

static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(1);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new() -> Self {
        let suffix = NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed);
        let path =
            std::env::temp_dir().join(format!("sheut-store-test-{}-{suffix}", std::process::id()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }

    fn path(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn fixture_document(revision: u64) -> DocumentEnvelope {
    document_with_content(revision, FIXTURE_CONTENT)
}

fn document_with_content(revision: u64, content: &str) -> DocumentEnvelope {
    DocumentEnvelope::new(
        LocalId::parse(DOCUMENT_ID).unwrap(),
        DocumentKind::Investigation,
        Revision::new(revision).unwrap(),
        serde_json::json!({
            "type": "doc",
            "content": [{
                "type": "paragraph",
                "content": [{"type": "text", "text": content}]
            }]
        }),
    )
    .unwrap()
}

fn technique_observation(revision: u64) -> TechniqueObservation {
    let reference = MitreTechniqueReference::new(
        MitreCatalog::AttackEnterprise,
        "19.1",
        "T1059.001",
        Some("TA0002"),
    )
    .unwrap();
    let observation = TechniqueObservation::new(
        LocalId::parse(OTHER_DOCUMENT_ID).unwrap(),
        reference,
        TechniqueAssessment::Observed,
        TechniqueOutcome::Successful,
        AnalyticConfidence::High,
        "PowerShell execution was confirmed by endpoint telemetry.",
        Some(1_000),
        Some(2_000),
        3_000,
    )
    .unwrap();
    if revision == 1 {
        observation
    } else {
        observation
            .revise(
                TechniqueAssessment::Observed,
                TechniqueOutcome::Prevented,
                AnalyticConfidence::High,
                "PowerShell execution was blocked by endpoint controls.",
                Some(1_000),
                Some(2_500),
                4_000,
            )
            .unwrap()
    }
}

fn stix_bundle(value: &str) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "type": "bundle",
        "id": "bundle--d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
        "objects": [{
            "type": "domain-name",
            "spec_version": "2.1",
            "id": "domain-name--e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
            "value": value,
            "x_sheut_source": "fixture"
        }]
    }))
    .unwrap()
}

#[test]
fn imported_text_is_bound_as_data_and_cannot_change_the_schema() {
    let directory = TestDirectory::new();
    let path = directory.path("project.sheut");
    let mut store = EncryptedStore::create(&path, &PROJECT_KEY).unwrap();
    let hostile_text = "'); DROP TABLE documents; --";

    store
        .save_document(&document_with_content(1, hostile_text), None)
        .unwrap();
    let loaded = store
        .load_document(LocalId::parse(DOCUMENT_ID).unwrap())
        .unwrap()
        .unwrap();

    assert_eq!(
        loaded.root()["content"][0]["content"][0]["text"],
        hostile_text
    );
    store
        .save_document(
            &document_with_content(2, "still present"),
            Some(Revision::new(1).unwrap()),
        )
        .unwrap();
}

#[test]
fn report_number_sequences_are_monotonic_and_honor_existing_report_numbers() {
    let directory = TestDirectory::new();
    let path = directory.path("report-number-sequence.sheut");
    let mut store = EncryptedStore::create(&path, &PROJECT_KEY).unwrap();

    assert_eq!(store.reserve_report_number("IER", 1).unwrap(), 1);
    assert_eq!(store.reserve_report_number("IER", 8).unwrap(), 8);
    assert_eq!(store.reserve_report_number("IER", 1).unwrap(), 9);
    assert_eq!(store.reserve_report_number("CR", 1).unwrap(), 1);
    assert_eq!(
        store.reserve_report_number("ier", 1).unwrap_err().code(),
        StoreErrorCode::InvalidStoredData
    );

    drop(store);
    let mut reopened = EncryptedStore::open(&path, &PROJECT_KEY).unwrap();
    assert_eq!(reopened.reserve_report_number("IER", 1).unwrap(), 10);
}

#[test]
fn graph_workspaces_round_trip_atomically_and_recover_without_owning_content() {
    let directory = TestDirectory::new();
    let path = directory.path("project.sheut");
    let mut store = EncryptedStore::create(&path, &PROJECT_KEY).unwrap();
    let workspace_id = LocalId::parse(WORKSPACE_ID).unwrap();
    let workspace = GraphWorkspace::new(
        workspace_id,
        "APT1 view",
        WorkspaceMode::Build,
        GraphViewport::default(),
        1_000,
    )
    .unwrap();
    let items = vec![
        WorkspaceItem::new(
            workspace_id,
            LocalId::parse(DOCUMENT_ID).unwrap(),
            WorkspaceItemKind::Intelligence,
            Position::new(10.0, 20.0).unwrap(),
            true,
        ),
        WorkspaceItem::new(
            workspace_id,
            LocalId::parse(SECOND_DOCUMENT_ID).unwrap(),
            WorkspaceItemKind::Intelligence,
            Position::new(40.0, 60.0).unwrap(),
            false,
        ),
    ];
    store.create_graph_workspace(&workspace, &items).unwrap();

    let link = VisualLink::new(
        LocalId::parse(VISUAL_LINK_ID).unwrap(),
        workspace_id,
        LocalId::parse(DOCUMENT_ID).unwrap(),
        LocalId::parse(SECOND_DOCUMENT_ID).unwrap(),
        Some("supports"),
    )
    .unwrap();
    let revised = store
        .create_visual_link(workspace_id, Revision::new(1).unwrap(), &link, 1_100)
        .unwrap();
    assert_eq!(revised.revision(), Revision::new(2).unwrap());

    let stale = store
        .rename_graph_workspace(
            workspace_id,
            Revision::new(1).unwrap(),
            "stale overwrite",
            1_200,
        )
        .unwrap_err();
    assert_eq!(stale.code(), StoreErrorCode::RevisionConflict);

    let deleted = store
        .set_graph_workspace_deleted(workspace_id, Revision::new(2).unwrap(), true, 1_300)
        .unwrap();
    assert_eq!(deleted.revision(), Revision::new(3).unwrap());
    assert!(
        store
            .load_graph_workspace(workspace_id, false)
            .unwrap()
            .is_none()
    );
    let recoverable = store
        .load_graph_workspace(workspace_id, true)
        .unwrap()
        .unwrap();
    assert_eq!(recoverable.items().len(), 2);
    assert_eq!(recoverable.visual_links().len(), 1);

    store
        .set_graph_workspace_deleted(workspace_id, Revision::new(3).unwrap(), false, 1_400)
        .unwrap();
    drop(store);

    let reopened = EncryptedStore::open(&path, &PROJECT_KEY).unwrap();
    let recovered = reopened
        .load_graph_workspace(workspace_id, false)
        .unwrap()
        .unwrap();
    assert_eq!(recovered.workspace().revision(), Revision::new(4).unwrap());
    assert_eq!(recovered.visual_links()[0].label(), Some("supports"));
    assert_encrypted_file(&path);
}

#[test]
fn graph_state_batches_and_membership_removal_are_revision_checked() {
    let directory = TestDirectory::new();
    let path = directory.path("project.sheut");
    let mut store = EncryptedStore::create(&path, &PROJECT_KEY).unwrap();
    let workspace_id = LocalId::parse(WORKSPACE_ID).unwrap();
    let source_id = LocalId::parse(DOCUMENT_ID).unwrap();
    let target_id = LocalId::parse(SECOND_DOCUMENT_ID).unwrap();
    let workspace = GraphWorkspace::new(
        workspace_id,
        "Builder",
        WorkspaceMode::Build,
        GraphViewport::default(),
        1_000,
    )
    .unwrap();
    let initial_items = vec![
        WorkspaceItem::new(
            workspace_id,
            source_id,
            WorkspaceItemKind::Document,
            Position::new(0.0, 0.0).unwrap(),
            false,
        ),
        WorkspaceItem::new(
            workspace_id,
            target_id,
            WorkspaceItemKind::Intelligence,
            Position::new(100.0, 100.0).unwrap(),
            false,
        ),
    ];
    store
        .create_graph_workspace(&workspace, &initial_items)
        .unwrap();
    let link = VisualLink::new(
        LocalId::parse(VISUAL_LINK_ID).unwrap(),
        workspace_id,
        source_id,
        target_id,
        Some("analyst note"),
    )
    .unwrap();
    store
        .create_visual_link(workspace_id, Revision::new(1).unwrap(), &link, 1_100)
        .unwrap();

    let moved = vec![WorkspaceItem::new(
        workspace_id,
        source_id,
        WorkspaceItemKind::Document,
        Position::new(25.0, -15.0).unwrap(),
        true,
    )];
    let revised = store
        .save_graph_workspace_state(
            workspace_id,
            Revision::new(2).unwrap(),
            WorkspaceMode::View,
            GraphViewport::new(10.0, 12.0, 1.5).unwrap(),
            &moved,
            1_200,
        )
        .unwrap();
    assert_eq!(revised.revision(), Revision::new(3).unwrap());
    let loaded = store
        .load_graph_workspace(workspace_id, false)
        .unwrap()
        .unwrap();
    let moved_source = loaded
        .items()
        .iter()
        .find(|item| item.item_id() == source_id)
        .unwrap();
    assert_eq!(moved_source.position(), Position::new(25.0, -15.0).unwrap());
    assert!(moved_source.pinned());
    assert_eq!(loaded.workspace().mode(), WorkspaceMode::View);

    let revised = store
        .remove_graph_workspace_items(workspace_id, Revision::new(3).unwrap(), &[source_id], 1_300)
        .unwrap();
    assert_eq!(revised.revision(), Revision::new(4).unwrap());
    let loaded = store
        .load_graph_workspace(workspace_id, false)
        .unwrap()
        .unwrap();
    assert_eq!(loaded.items().len(), 1);
    assert!(loaded.visual_links().is_empty());
}

fn assert_encrypted_file(path: &Path) {
    let bytes = fs::read(path).unwrap();
    assert!(!bytes.starts_with(b"SQLite format 3\0"));
    assert!(
        !bytes
            .windows(FIXTURE_CONTENT.len())
            .any(|window| window == FIXTURE_CONTENT.as_bytes())
    );
}

#[test]
fn encrypted_database_reopens_only_with_the_correct_key() {
    let directory = TestDirectory::new();
    let path = directory.path("project.sheut");

    let mut store = EncryptedStore::create(&path, &PROJECT_KEY).unwrap();
    store.save_document(&fixture_document(1), None).unwrap();
    drop(store);

    assert_encrypted_file(&path);

    let wrong_key_error = EncryptedStore::open(&path, &WRONG_KEY).unwrap_err();
    assert_eq!(wrong_key_error.code(), StoreErrorCode::InvalidKeyOrCorrupt);
    assert_eq!(wrong_key_error.to_string(), "invalid_key_or_corrupt");
    assert!(
        !wrong_key_error
            .to_string()
            .contains(path.to_string_lossy().as_ref())
    );

    let store = EncryptedStore::open(&path, &PROJECT_KEY).unwrap();
    assert_eq!(
        store
            .load_document(LocalId::parse(DOCUMENT_ID).unwrap())
            .unwrap(),
        Some(fixture_document(1))
    );
}

#[test]
fn stale_document_revisions_cannot_overwrite_committed_data() {
    let directory = TestDirectory::new();
    let path = directory.path("project.sheut");
    let mut store = EncryptedStore::create(&path, &PROJECT_KEY).unwrap();

    store.save_document(&fixture_document(1), None).unwrap();
    store
        .save_document(&fixture_document(2), Some(Revision::new(1).unwrap()))
        .unwrap();

    let error = store
        .save_document(&fixture_document(3), Some(Revision::new(1).unwrap()))
        .unwrap_err();
    assert_eq!(error.code(), StoreErrorCode::RevisionConflict);
    assert_eq!(
        store
            .load_document(LocalId::parse(DOCUMENT_ID).unwrap())
            .unwrap()
            .unwrap()
            .revision(),
        Revision::new(2).unwrap()
    );
}

#[test]
fn backups_use_an_independent_key_and_reopen_committed_data() {
    let directory = TestDirectory::new();
    let project_path = directory.path("project.sheut");
    let backup_path = directory.path("project.backup.sheut");
    let mut store = EncryptedStore::create(&project_path, &PROJECT_KEY).unwrap();
    store.save_document(&fixture_document(1), None).unwrap();

    store.backup_to(&backup_path, &BACKUP_KEY).unwrap();
    assert_encrypted_file(&backup_path);
    assert_eq!(
        EncryptedStore::open(&backup_path, &PROJECT_KEY)
            .unwrap_err()
            .code(),
        StoreErrorCode::InvalidKeyOrCorrupt
    );
    assert_eq!(
        EncryptedStore::open(&backup_path, &BACKUP_KEY)
            .unwrap()
            .load_document(LocalId::parse(DOCUMENT_ID).unwrap())
            .unwrap(),
        Some(fixture_document(1))
    );
}

#[test]
fn create_never_overwrites_an_existing_file() {
    let directory = TestDirectory::new();
    let path = directory.path("existing.sheut");
    fs::write(&path, b"existing bytes").unwrap();

    let error = EncryptedStore::create(&path, &PROJECT_KEY).unwrap_err();
    assert_eq!(error.code(), StoreErrorCode::AlreadyExists);
    assert_eq!(fs::read(path).unwrap(), b"existing bytes");
}

#[test]
fn project_metadata_round_trips_inside_the_encrypted_database() {
    let directory = TestDirectory::new();
    let path = directory.path("project.sheut");
    let metadata = ProjectMetadata::new(
        LocalId::parse("6f9619ff-8b86-d011-b42d-00cf4fc964ff").unwrap(),
        "Operation Shadow",
        1_785_342_000_000,
    )
    .unwrap();
    let mut store = EncryptedStore::create(&path, &PROJECT_KEY).unwrap();

    store.initialize_project(&metadata).unwrap();
    assert_eq!(store.load_project().unwrap(), Some(metadata));
    let updated = store
        .load_project()
        .unwrap()
        .unwrap()
        .with_default_tlp_marking(TlpMarking::Red);
    store.save_project(&updated).unwrap();
    assert_eq!(store.load_project().unwrap(), Some(updated));
    drop(store);

    let raw = fs::read(path).unwrap();
    assert!(
        !raw.windows("Operation Shadow".len())
            .any(|window| window == b"Operation Shadow")
    );
}

#[test]
fn documents_can_be_listed_without_exposing_queries_to_callers() {
    let directory = TestDirectory::new();
    let path = directory.path("project.sheut");
    let mut store = EncryptedStore::create(&path, &PROJECT_KEY).unwrap();
    let first = fixture_document(1);
    let second = DocumentEnvelope::new(
        LocalId::parse(SECOND_DOCUMENT_ID).unwrap(),
        DocumentKind::AnalystNote,
        Revision::new(1).unwrap(),
        serde_json::json!({"type": "doc", "content": []}),
    )
    .unwrap();

    store.save_document(&first, None).unwrap();
    store.save_document(&second, None).unwrap();

    assert_eq!(store.list_documents().unwrap(), vec![second, first]);
}

#[test]
fn technique_observations_are_encrypted_reopenable_and_revision_checked() {
    let directory = TestDirectory::new();
    let path = directory.path("project.sheut");
    let first = technique_observation(1);
    let second = technique_observation(2);
    let mut store = EncryptedStore::create(&path, &PROJECT_KEY).unwrap();

    store.save_technique_observation(&first, None).unwrap();
    store
        .save_technique_observation(&second, Some(Revision::new(1).unwrap()))
        .unwrap();
    let stale = store
        .save_technique_observation(&second, Some(Revision::new(1).unwrap()))
        .unwrap_err();
    assert_eq!(stale.code(), StoreErrorCode::RevisionConflict);
    drop(store);

    let raw = fs::read(&path).unwrap();
    assert!(
        !raw.windows(first.narrative().len())
            .any(|window| { window == first.narrative().as_bytes() })
    );
    let reopened = EncryptedStore::open(&path, &PROJECT_KEY).unwrap();
    assert_eq!(
        reopened.list_technique_observations().unwrap(),
        vec![second]
    );
}

#[test]
fn documents_are_deleted_by_bound_identifier() {
    let directory = TestDirectory::new();
    let path = directory.path("project.sheut");
    let mut store = EncryptedStore::create(&path, &PROJECT_KEY).unwrap();
    let document_id = LocalId::parse(DOCUMENT_ID).unwrap();
    store.save_document(&fixture_document(1), None).unwrap();

    assert!(store.delete_document(document_id).unwrap());
    assert_eq!(store.load_document(document_id).unwrap(), None);
    assert!(!store.delete_document(document_id).unwrap());
}

#[test]
fn revision_history_is_append_only_and_soft_deletion_is_recoverable() {
    let directory = TestDirectory::new();
    let path = directory.path("project.sheut");
    let mut store = EncryptedStore::create(&path, &PROJECT_KEY).unwrap();
    let document_id = LocalId::parse(DOCUMENT_ID).unwrap();
    let first = document_with_content(1, "Initial finding");
    let second = document_with_content(2, "Updated finding");

    store.save_document_at(&first, None, 1_000).unwrap();
    store
        .save_document_at(&second, Some(Revision::new(1).unwrap()), 31_000)
        .unwrap();

    let revisions = store.list_document_revisions(document_id).unwrap();
    assert_eq!(revisions.len(), 2);
    assert_eq!(revisions[0].revision(), Revision::new(2).unwrap());
    assert_eq!(revisions[0].saved_at_unix_ms(), 31_000);
    assert_eq!(revisions[1].revision(), Revision::new(1).unwrap());
    assert_eq!(
        store
            .load_document_revision(document_id, Revision::new(1).unwrap())
            .unwrap(),
        Some(first.clone())
    );

    assert!(store.soft_delete_document(document_id, 32_000).unwrap());
    assert!(store.list_documents().unwrap().is_empty());
    assert_eq!(store.load_document(document_id).unwrap(), None);
    assert!(store.restore_document(document_id, 33_000).unwrap());
    assert_eq!(
        store.load_document(document_id).unwrap(),
        Some(second.clone())
    );

    let restored = DocumentEnvelope::new(
        document_id,
        second.kind(),
        Revision::new(3).unwrap(),
        first.root().clone(),
    )
    .unwrap();
    store
        .save_restored_document_revision(
            &restored,
            Revision::new(2).unwrap(),
            Revision::new(1).unwrap(),
            34_000,
        )
        .unwrap();

    let activity = store.list_document_activity(document_id).unwrap();
    assert_eq!(activity.len(), 5);
    assert_eq!(activity[0].kind(), DocumentActivityKind::RestoredRevision);
    assert_eq!(activity[0].revision(), Revision::new(3).unwrap());
    assert_eq!(
        activity[0].source_revision(),
        Some(Revision::new(1).unwrap())
    );
    assert_eq!(activity[1].kind(), DocumentActivityKind::Restored);
    assert_eq!(activity[2].kind(), DocumentActivityKind::Deleted);
    assert_eq!(activity[3].kind(), DocumentActivityKind::Edited);
    assert_eq!(activity[4].kind(), DocumentActivityKind::Created);
    assert_eq!(store.list_document_revisions(document_id).unwrap().len(), 3);
}

#[test]
fn image_attachments_are_encrypted_scoped_and_deleted_with_the_document() {
    let directory = TestDirectory::new();
    let path = directory.path("project.sheut");
    let mut store = EncryptedStore::create(&path, &PROJECT_KEY).unwrap();
    let document_id = LocalId::parse(DOCUMENT_ID).unwrap();
    let attachment_id = LocalId::parse(SECOND_DOCUMENT_ID).unwrap();
    let payload = TEST_PNG.to_vec();
    let metadata = ImageAttachmentMetadata::new(
        attachment_id,
        document_id,
        ImageMediaType::Png,
        "screenshot.png'); DROP TABLE documents; --",
        payload.len() as u64,
    )
    .unwrap();
    store.save_document(&fixture_document(1), None).unwrap();

    store.save_image_attachment(&metadata, &payload).unwrap();
    assert_eq!(
        store
            .load_image_attachment(document_id, attachment_id)
            .unwrap(),
        Some((metadata.clone(), payload.clone()))
    );
    assert_eq!(
        store
            .load_image_attachment(LocalId::parse(OTHER_DOCUMENT_ID).unwrap(), attachment_id)
            .unwrap(),
        None
    );
    drop(store);

    let raw = fs::read(&path).unwrap();
    assert!(!raw.windows(payload.len()).any(|window| window == payload));
    assert!(
        !raw.windows(metadata.file_name().len())
            .any(|window| { window == metadata.file_name().as_bytes() })
    );

    let store = EncryptedStore::open(&path, &PROJECT_KEY).unwrap();
    assert!(store.delete_document(document_id).unwrap());
    assert_eq!(
        store
            .load_image_attachment(document_id, attachment_id)
            .unwrap(),
        None
    );
}

#[test]
fn image_attachment_payload_must_match_validated_metadata() {
    let directory = TestDirectory::new();
    let path = directory.path("project.sheut");
    let mut store = EncryptedStore::create(&path, &PROJECT_KEY).unwrap();
    let document_id = LocalId::parse(DOCUMENT_ID).unwrap();
    let metadata = ImageAttachmentMetadata::new(
        LocalId::parse(SECOND_DOCUMENT_ID).unwrap(),
        document_id,
        ImageMediaType::Png,
        "evidence.png",
        9,
    )
    .unwrap();
    store.save_document(&fixture_document(1), None).unwrap();

    let error = store
        .save_image_attachment(&metadata, b"not-image")
        .unwrap_err();
    assert_eq!(error.code(), StoreErrorCode::InvalidAttachment);
}

#[test]
fn evidence_files_are_encrypted_project_assets_and_reopenable() {
    let directory = TestDirectory::new();
    let path = directory.path("project.sheut");
    let store = EncryptedStore::create(&path, &PROJECT_KEY).unwrap();
    let evidence_id = LocalId::parse(DOCUMENT_ID).unwrap();
    let payload = TEST_PNG.to_vec();
    let metadata = EvidenceFileMetadata::new(
        evidence_id,
        ImageMediaType::Png.as_str(),
        "interview-frame.png",
        payload.len() as u64,
        format!("{:x}", Sha256::digest(&payload)),
        1_000,
    )
    .unwrap();

    store.save_evidence_file(&metadata, &payload).unwrap();
    assert_eq!(store.list_evidence_files().unwrap(), vec![metadata.clone()]);
    assert_eq!(
        store.load_evidence_file(evidence_id).unwrap(),
        Some((metadata.clone(), payload.clone()))
    );
    drop(store);

    let raw = fs::read(&path).unwrap();
    assert!(!raw.windows(payload.len()).any(|window| window == payload));
    assert!(
        !raw.windows(metadata.file_name().len())
            .any(|window| window == metadata.file_name().as_bytes())
    );

    let reopened = EncryptedStore::open(&path, &PROJECT_KEY).unwrap();
    assert_eq!(
        reopened.load_evidence_file(evidence_id).unwrap(),
        Some((metadata, payload))
    );
}

#[test]
fn evidence_metadata_updates_optimistically_and_deletion_removes_the_payload() {
    let directory = TestDirectory::new();
    let path = directory.path("evidence-metadata.sheut");
    let store = EncryptedStore::create(&path, &PROJECT_KEY).unwrap();
    let evidence_id = LocalId::parse(DOCUMENT_ID).unwrap();
    let payload = b"PK\x03\x04evidence archive".to_vec();
    let metadata = EvidenceFileMetadata::new(
        evidence_id,
        "application/zip",
        "capture.zip",
        payload.len() as u64,
        format!("{:x}", Sha256::digest(&payload)),
        1_000,
    )
    .unwrap();
    store.save_evidence_file(&metadata, &payload).unwrap();
    let revised = metadata
        .updated(
            Revision::new(1).unwrap(),
            EvidenceMetadataInput::new(
                "Redirect capture",
                "Evidence description",
                "Analyst capture",
                Some("2026-07-31".to_owned()),
                "https://piracy.example/",
                vec!["piracy".to_owned()],
                "Handling note",
            )
            .unwrap(),
            1_100,
        )
        .unwrap();

    store
        .update_evidence_metadata(&revised, Revision::new(1).unwrap())
        .unwrap();
    assert_eq!(
        store.load_evidence_file(evidence_id).unwrap(),
        Some((revised.clone(), payload))
    );
    assert_eq!(
        store
            .update_evidence_metadata(&revised, Revision::new(1).unwrap())
            .unwrap_err()
            .code(),
        StoreErrorCode::RevisionConflict
    );
    store
        .delete_evidence_file(evidence_id, Revision::new(2).unwrap())
        .unwrap();
    assert_eq!(store.load_evidence_file(evidence_id).unwrap(), None);
}

#[test]
fn inert_archives_are_encrypted_evidence_and_survive_reopen() {
    let directory = TestDirectory::new();
    let path = directory.path("archive-project.sheut");
    let store = EncryptedStore::create(&path, &PROJECT_KEY).unwrap();
    let evidence_id = LocalId::parse(DOCUMENT_ID).unwrap();
    let payload = b"PK\x03\x04inert archive bytes".to_vec();
    let metadata = EvidenceFileMetadata::new(
        evidence_id,
        "application/zip",
        "site-backup.zip",
        payload.len() as u64,
        format!("{:x}", Sha256::digest(&payload)),
        1_000,
    )
    .unwrap();

    store.save_evidence_file(&metadata, &payload).unwrap();
    drop(store);

    let reopened = EncryptedStore::open(&path, &PROJECT_KEY).unwrap();
    assert_eq!(
        reopened.load_evidence_file(evidence_id).unwrap(),
        Some((metadata, payload))
    );
}

#[test]
fn stix_import_commit_is_encrypted_atomic_and_reopenable() {
    let directory = TestDirectory::new();
    let path = directory.path("project.sheut");
    let mut store = EncryptedStore::create(&path, &PROJECT_KEY).unwrap();
    let preview = preview_import(parse_bundle(&stix_bundle("evil.example")).unwrap(), &[]).unwrap();
    let commit = commit_import(&preview, &[]).unwrap();

    store.commit_stix_import(&commit).unwrap();
    let stored = store.list_stix_objects().unwrap();
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].raw()["value"], "evil.example");
    drop(store);

    let raw = fs::read(&path).unwrap();
    assert!(
        !raw.windows("evil.example".len())
            .any(|window| window == b"evil.example")
    );
    let reopened = EncryptedStore::open(&path, &PROJECT_KEY).unwrap();
    assert_eq!(reopened.list_stix_objects().unwrap(), stored);
}

#[test]
fn official_oasis_apt1_import_reopens_and_exports_all_objects() {
    let directory = TestDirectory::new();
    let path = directory.path("project.sheut");
    let mut store = EncryptedStore::create(&path, &PROJECT_KEY).unwrap();
    let preview = preview_import(parse_bundle(OASIS_APT1).unwrap(), &[]).unwrap();
    assert_eq!(preview.object_count(), 76);

    store
        .commit_stix_import(&commit_import(&preview, &[]).unwrap())
        .unwrap();
    drop(store);

    let reopened = EncryptedStore::open(&path, &PROJECT_KEY).unwrap();
    let stored = reopened.list_stix_objects().unwrap();
    assert_eq!(stored.len(), 76);
    let exported = commit_existing_export(&preview_existing_export(&stored).unwrap()).unwrap();
    let reparsed = parse_bundle(exported.bytes()).unwrap();
    assert_eq!(reparsed.objects().len(), 76);
    assert!(reparsed.objects().iter().any(|object| {
        object.object_type() == "intrusion-set" && object.raw()["name"] == "APT1"
    }));
}

#[test]
fn stix_version_conflict_rolls_back_the_whole_import() {
    let directory = TestDirectory::new();
    let path = directory.path("project.sheut");
    let mut store = EncryptedStore::create(&path, &PROJECT_KEY).unwrap();
    let first_preview =
        preview_import(parse_bundle(&stix_bundle("first.example")).unwrap(), &[]).unwrap();
    let second_preview =
        preview_import(parse_bundle(&stix_bundle("second.example")).unwrap(), &[]).unwrap();

    store
        .commit_stix_import(&commit_import(&first_preview, &[]).unwrap())
        .unwrap();
    let error = store
        .commit_stix_import(&commit_import(&second_preview, &[]).unwrap())
        .unwrap_err();

    assert_eq!(error.code(), StoreErrorCode::AlreadyExists);
    let stored = store.list_stix_objects().unwrap();
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].raw()["value"], "first.example");
}

#[test]
fn stix_drafts_keep_local_identity_and_never_gain_ids_before_export() {
    let directory = TestDirectory::new();
    let path = directory.path("project.sheut");
    let store = EncryptedStore::create(&path, &PROJECT_KEY).unwrap();
    let local_id = LocalId::parse(DOCUMENT_ID).unwrap();
    let draft = StixDraft::new(
        local_id,
        "indicator",
        serde_json::json!({
            "pattern": "[domain-name:value = 'evil.example']",
            "pattern_type": "stix"
        }),
    )
    .unwrap();

    store.save_stix_draft(&draft).unwrap();
    assert_eq!(store.list_stix_drafts().unwrap(), vec![draft]);
    assert!(store.delete_stix_draft(local_id).unwrap());
    assert!(store.list_stix_drafts().unwrap().is_empty());
}

#[test]
fn validated_stix_objects_can_be_explicitly_deleted_from_encrypted_storage() {
    let directory = TestDirectory::new();
    let path = directory.path("project.sheut");
    let mut store = EncryptedStore::create(&path, &PROJECT_KEY).unwrap();
    let bundle = serde_json::to_vec(&serde_json::json!({
        "type": "bundle",
        "id": "bundle--d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
        "objects": [{
            "type": "ipv4-addr",
            "spec_version": "2.1",
            "id": "ipv4-addr--e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
            "value": "198.51.100.4"
        }]
    }))
    .unwrap();
    let preview = preview_import(parse_bundle(&bundle).unwrap(), &[]).unwrap();
    store
        .commit_stix_import(&commit_import(&preview, &[]).unwrap())
        .unwrap();
    let object_id = store.list_stix_objects().unwrap()[0].local_id();

    assert!(store.delete_stix_object(object_id).unwrap());
    assert!(store.list_stix_objects().unwrap().is_empty());
    assert!(!store.delete_stix_object(object_id).unwrap());
}

#[test]
fn semantic_relationship_drafts_reopen_with_local_endpoint_identity() {
    let directory = TestDirectory::new();
    let path = directory.path("project.sheut");
    let store = EncryptedStore::create(&path, &PROJECT_KEY).unwrap();
    let relationship = SemanticRelationshipDraft::new(
        LocalId::parse(DOCUMENT_ID).unwrap(),
        LocalId::parse(SECOND_DOCUMENT_ID).unwrap(),
        "attributed-to",
    )
    .unwrap();
    let draft = StixDraft::new_relationship(
        LocalId::parse(OTHER_DOCUMENT_ID).unwrap(),
        relationship,
        serde_json::json!({"description": "Analyst attribution"}),
    )
    .unwrap();

    store.save_stix_draft(&draft).unwrap();
    drop(store);

    let reopened = EncryptedStore::open(&path, &PROJECT_KEY).unwrap();
    assert_eq!(reopened.list_stix_drafts().unwrap(), vec![draft]);
}

#[test]
fn stix_revision_drafts_reopen_with_replacement_identity() {
    let directory = TestDirectory::new();
    let path = directory.path("project.sheut");
    let store = EncryptedStore::create(&path, &PROJECT_KEY).unwrap();
    let existing = ExistingStixObject::new(
        LocalId::parse(DOCUMENT_ID).unwrap(),
        serde_json::json!({
            "type": "indicator",
            "spec_version": "2.1",
            "id": "indicator--e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
            "created": "2020-01-01T00:00:00.000Z",
            "modified": "2020-01-01T00:00:00.000Z",
            "pattern": "[domain-name:value = 'evil.example']",
            "pattern_type": "stix",
            "valid_from": "2020-01-01T00:00:00.000Z"
        }),
    )
    .unwrap();
    let draft = StixDraft::new_revision(
        &existing,
        serde_json::json!({
            "created": "2020-01-01T00:00:00.000Z",
            "modified": "2020-01-02T00:00:00.000Z",
            "pattern": "[domain-name:value = 'revised.example']",
            "pattern_type": "stix",
            "valid_from": "2020-01-01T00:00:00.000Z"
        }),
        None,
    )
    .unwrap();

    store.save_stix_draft(&draft).unwrap();
    drop(store);

    let reopened = EncryptedStore::open(&path, &PROJECT_KEY).unwrap();
    assert_eq!(reopened.list_stix_drafts().unwrap(), vec![draft]);
}

#[test]
fn confirmed_stix_export_atomically_promotes_drafts_with_generated_ids() {
    let directory = TestDirectory::new();
    let path = directory.path("project.sheut");
    let mut store = EncryptedStore::create(&path, &PROJECT_KEY).unwrap();
    let local_id = LocalId::parse(DOCUMENT_ID).unwrap();
    let draft = StixDraft::new(
        local_id,
        "domain-name",
        serde_json::json!({"value": "draft.example"}),
    )
    .unwrap();
    store.save_stix_draft(&draft).unwrap();

    let preview = preview_project_export(&[], &[draft]).unwrap();
    let committed = commit_project_export(&preview).unwrap();
    let promoted = committed.generated_objects().unwrap();
    store.promote_stix_drafts(&promoted).unwrap();

    assert!(store.list_stix_drafts().unwrap().is_empty());
    let objects = store.list_stix_objects().unwrap();
    assert_eq!(objects.len(), 1);
    assert_eq!(objects[0].local_id(), local_id);
    assert_eq!(objects[0].stix_id(), committed.generated_ids()[0].stix_id());
}
