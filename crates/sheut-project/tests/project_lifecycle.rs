use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};

use sheut_core::{
    AnalyticConfidence, BuiltinReportTemplate, DocumentActivityKind, DocumentEnvelope,
    DocumentKind, DocumentTextDiffKind, EvidenceMetadataInput, GraphViewport,
    GuidedReportFieldValue, LocalId, MitreCatalog, MitreTechniqueReference, Position,
    ReportTemplateSection, Revision, SemanticRelationshipDraft, TechniqueAssessment,
    TechniqueOutcome, TlpMarking, WorkspaceItemKind, WorkspaceMode,
};
use sheut_mitre::{catalog, export_mapping_file, import_mapping_file};
use sheut_project::{
    GraphWorkspaceSeedItem, LifecycleErrorCode, ProjectKey, ProjectKeyStore, ProjectKeyStoreError,
    ProjectManager, UnlockMethod,
};
use sheut_stix::{
    StixDraft, commit_import, commit_project_export, parse_bundle, preview_import,
    preview_project_export,
};
use sheut_store::EncryptedStore;

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
        let path = std::env::temp_dir().join(format!(
            "sheut-project-test-{}-{suffix}",
            std::process::id()
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[derive(Clone, Default)]
struct FakeKeyStore {
    keys: Arc<Mutex<HashMap<LocalId, [u8; 32]>>>,
    reject_writes: Arc<AtomicBool>,
    reject_deletes: Arc<AtomicBool>,
}

impl FakeKeyStore {
    fn key_for(&self, id: LocalId) -> [u8; 32] {
        *self.keys.lock().unwrap().get(&id).unwrap()
    }

    fn replace(&self, id: LocalId, bytes: [u8; 32]) {
        self.keys.lock().unwrap().insert(id, bytes);
    }

    fn contains(&self, id: LocalId) -> bool {
        self.keys.lock().unwrap().contains_key(&id)
    }
}

impl ProjectKeyStore for FakeKeyStore {
    fn put(&self, id: LocalId, key: &ProjectKey) -> Result<(), ProjectKeyStoreError> {
        if self.reject_writes.load(Ordering::Relaxed) {
            return Err(ProjectKeyStoreError);
        }
        self.keys.lock().unwrap().insert(id, *key.as_bytes());
        Ok(())
    }

    fn get(&self, id: LocalId) -> Result<ProjectKey, ProjectKeyStoreError> {
        self.keys
            .lock()
            .unwrap()
            .get(&id)
            .copied()
            .map(ProjectKey::from_bytes)
            .ok_or(ProjectKeyStoreError)
    }

    fn delete(&self, id: LocalId) -> Result<(), ProjectKeyStoreError> {
        if self.reject_deletes.load(Ordering::Relaxed) {
            return Err(ProjectKeyStoreError);
        }
        self.keys.lock().unwrap().remove(&id);
        Ok(())
    }
}

fn stix_bundle() -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "type": "bundle",
        "id": "bundle--d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
        "objects": [{
            "type": "ipv4-addr",
            "spec_version": "2.1",
            "id": "ipv4-addr--e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
            "value": "198.51.100.4"
        }]
    }))
    .unwrap()
}

fn stix_bundle_from_objects(objects: Vec<serde_json::Value>) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!({
        "type": "bundle",
        "id": "bundle--d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
        "objects": objects
    }))
    .unwrap()
}

#[test]
fn create_lock_and_reopen_expose_only_the_display_name_and_keep_paths_rust_owned() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys.clone()).unwrap();

    let created = manager
        .create_project_with_default_tlp(
            "Operation Shadow",
            TlpMarking::AmberStrict,
            1_785_342_000_000,
        )
        .unwrap();
    assert!(!created.locked());
    assert_eq!(created.name(), Some("Operation Shadow"));
    assert_eq!(created.default_tlp_marking(), Some(TlpMarking::AmberStrict));

    let project_directory = directory.0.join(created.id().to_string());
    let manifest = fs::read_to_string(project_directory.join("manifest.json")).unwrap();
    assert!(manifest.contains(&created.id().to_string()));
    assert!(manifest.contains("Operation Shadow"));
    assert!(!manifest.contains("project.sheut"));
    assert!(!manifest.contains("amber_strict"));

    manager.lock_project(created.id()).unwrap();
    let locked = manager.project(created.id()).unwrap();
    assert!(locked.locked());
    assert_eq!(locked.name(), Some("Operation Shadow"));
    assert_eq!(locked.unlock_method(), UnlockMethod::Device);
    assert_eq!(locked.default_tlp_marking(), None);

    let reopened = manager
        .unlock_project(created.id(), 1_785_342_001_000)
        .unwrap();
    assert_eq!(reopened.id(), created.id());
    assert_eq!(reopened.name(), Some("Operation Shadow"));
    assert!(!reopened.locked());
    assert_eq!(
        reopened.default_tlp_marking(),
        Some(TlpMarking::AmberStrict)
    );

    let updated = manager
        .update_project_default_tlp(created.id(), TlpMarking::Red, 1_785_342_002_000)
        .unwrap();
    assert_eq!(updated.default_tlp_marking(), Some(TlpMarking::Red));
    manager.lock_project(created.id()).unwrap();
    let reopened = manager
        .unlock_project(created.id(), 1_785_342_003_000)
        .unwrap();
    assert_eq!(reopened.default_tlp_marking(), Some(TlpMarking::Red));
}

#[test]
fn stix_objects_commit_only_to_an_unlocked_encrypted_project() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys).unwrap();
    let project = manager.create_project("STIX fixture", 1_000).unwrap();
    let preview = preview_import(parse_bundle(&stix_bundle()).unwrap(), &[]).unwrap();
    let commit = commit_import(&preview, &[]).unwrap();

    manager
        .commit_stix_import(project.id(), &commit, 2_000)
        .unwrap();
    let stored = manager.list_stix_objects(project.id(), 3_000).unwrap();
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].raw()["value"], "198.51.100.4");

    let draft = StixDraft::new(
        LocalId::parse("d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb").unwrap(),
        "indicator",
        serde_json::json!({"pattern_type": "stix"}),
    )
    .unwrap();
    manager
        .save_stix_draft(project.id(), &draft, 3_500)
        .unwrap();
    assert_eq!(
        manager.list_stix_drafts(project.id(), 3_600).unwrap(),
        vec![draft.clone()]
    );
    manager
        .delete_stix_draft(project.id(), draft.local_id(), 3_700)
        .unwrap();
    assert!(
        manager
            .list_stix_drafts(project.id(), 3_800)
            .unwrap()
            .is_empty()
    );

    manager.lock_project(project.id()).unwrap();
    assert_eq!(
        manager
            .list_stix_objects(project.id(), 4_000)
            .unwrap_err()
            .code(),
        LifecycleErrorCode::ProjectLocked
    );
}

#[test]
fn graph_membership_and_visual_links_never_mutate_project_intelligence() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys).unwrap();
    let project = manager.create_project("Graph fixture", 1_000).unwrap();
    let bundle = stix_bundle_from_objects(vec![
        serde_json::json!({
            "type": "indicator",
            "spec_version": "2.1",
            "id": "indicator--e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
            "created": "2020-01-01T00:00:00.000Z",
            "modified": "2020-01-01T00:00:00.000Z",
            "pattern_type": "stix",
            "pattern": "[domain-name:value = 'example.test']",
            "valid_from": "2020-01-01T00:00:00.000Z",
            "name": "Example indicator"
        }),
        serde_json::json!({
            "type": "malware",
            "spec_version": "2.1",
            "id": "malware--d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
            "created": "2020-01-01T00:00:00.000Z",
            "modified": "2020-01-01T00:00:00.000Z",
            "name": "Fixture malware",
            "is_family": false
        }),
    ]);
    let preview = preview_import(parse_bundle(&bundle).unwrap(), &[]).unwrap();
    manager
        .commit_stix_import(project.id(), &commit_import(&preview, &[]).unwrap(), 1_100)
        .unwrap();
    let objects = manager.list_stix_objects(project.id(), 1_150).unwrap();
    let source_id = objects
        .iter()
        .find(|object| object.object_type() == "indicator")
        .unwrap()
        .local_id();
    let target_id = objects
        .iter()
        .find(|object| object.object_type() == "malware")
        .unwrap()
        .local_id();

    let workspace = manager
        .create_graph_workspace(
            project.id(),
            "All intelligence",
            WorkspaceMode::Build,
            &[
                GraphWorkspaceSeedItem::new(
                    source_id,
                    WorkspaceItemKind::Intelligence,
                    Position::new(0.0, 0.0).unwrap(),
                    true,
                ),
                GraphWorkspaceSeedItem::new(
                    target_id,
                    WorkspaceItemKind::Intelligence,
                    Position::new(120.0, 0.0).unwrap(),
                    false,
                ),
            ],
            1_200,
        )
        .unwrap();
    let workspace_id = workspace.workspace().id();
    let revised = manager
        .create_graph_visual_link(
            project.id(),
            workspace_id,
            Revision::new(1).unwrap(),
            source_id,
            target_id,
            Some("analyst hypothesis"),
            1_300,
        )
        .unwrap();
    assert_eq!(revised.revision(), Revision::new(2).unwrap());
    assert_eq!(
        manager
            .list_stix_objects(project.id(), 1_350)
            .unwrap()
            .len(),
        2
    );

    let link_id = manager
        .load_graph_workspace(project.id(), workspace_id, 1_360)
        .unwrap()
        .visual_links()[0]
        .id();
    let relationship_preview = manager
        .preview_graph_relationship_draft(project.id(), workspace_id, link_id, 1_370)
        .unwrap();
    assert_eq!(relationship_preview.source_object_type(), "indicator");
    assert_eq!(relationship_preview.target_object_type(), "malware");
    let relationship_draft = manager
        .commit_graph_relationship_draft(
            project.id(),
            workspace_id,
            link_id,
            "indicates",
            serde_json::json!({"description": "Validated analyst assertion"}),
            1_380,
        )
        .unwrap();
    assert_eq!(
        relationship_draft
            .semantic_relationship()
            .unwrap()
            .relationship_type(),
        "indicates"
    );
    assert_eq!(
        manager
            .load_graph_workspace(project.id(), workspace_id, 1_390)
            .unwrap()
            .visual_links()
            .len(),
        1
    );
    assert_eq!(
        manager.list_stix_drafts(project.id(), 1_395).unwrap().len(),
        1
    );

    manager
        .save_graph_workspace_state(
            project.id(),
            workspace_id,
            Revision::new(2).unwrap(),
            WorkspaceMode::View,
            GraphViewport::new(10.0, 5.0, 1.2).unwrap(),
            &[],
            1_400,
        )
        .unwrap();
    manager
        .remove_graph_workspace_items(
            project.id(),
            workspace_id,
            Revision::new(3).unwrap(),
            &[source_id],
            1_500,
        )
        .unwrap();
    let loaded = manager
        .load_graph_workspace(project.id(), workspace_id, 1_600)
        .unwrap();
    assert_eq!(loaded.items().len(), 1);
    assert!(loaded.visual_links().is_empty());
    assert_eq!(
        manager
            .list_stix_objects(project.id(), 1_700)
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn deleting_validated_stix_prunes_generated_projection_and_keeps_named_placeholder() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys).unwrap();
    let project = manager
        .create_project("Deleted STIX fixture", 1_000)
        .unwrap();
    let preview = preview_import(parse_bundle(&stix_bundle()).unwrap(), &[]).unwrap();
    manager
        .commit_stix_import(project.id(), &commit_import(&preview, &[]).unwrap(), 1_100)
        .unwrap();
    let object_id = manager.list_stix_objects(project.id(), 1_200).unwrap()[0].local_id();
    let workspace = manager
        .create_graph_workspace(
            project.id(),
            "Deletion placeholder",
            WorkspaceMode::View,
            &[GraphWorkspaceSeedItem::new(
                object_id,
                WorkspaceItemKind::Intelligence,
                Position::new(25.0, 40.0).unwrap(),
                false,
            )],
            1_300,
        )
        .unwrap();
    let all_intelligence = manager
        .create_graph_workspace(
            project.id(),
            "All intelligence",
            WorkspaceMode::View,
            &[GraphWorkspaceSeedItem::new(
                object_id,
                WorkspaceItemKind::Intelligence,
                Position::new(80.0, 120.0).unwrap(),
                false,
            )],
            1_350,
        )
        .unwrap();

    manager
        .delete_stix_object(project.id(), object_id, 1_400)
        .unwrap();

    assert!(
        manager
            .list_stix_objects(project.id(), 1_500)
            .unwrap()
            .is_empty()
    );
    let graph = manager
        .load_graph_workspace(project.id(), workspace.workspace().id(), 1_600)
        .unwrap();
    assert_eq!(graph.items().len(), 1);
    assert_eq!(graph.items()[0].item_id(), object_id);
    let generated_graph = manager
        .load_graph_workspace(project.id(), all_intelligence.workspace().id(), 1_700)
        .unwrap();
    assert!(generated_graph.items().is_empty());
}

#[test]
fn validated_stix_deletion_refuses_objects_still_used_by_relationships() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys).unwrap();
    let project = manager
        .create_project("Referenced STIX fixture", 1_000)
        .unwrap();
    let bundle = stix_bundle_from_objects(vec![
        serde_json::json!({
            "type": "indicator",
            "spec_version": "2.1",
            "id": "indicator--e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
            "created": "2020-01-01T00:00:00.000Z",
            "modified": "2020-01-01T00:00:00.000Z",
            "pattern_type": "stix",
            "pattern": "[domain-name:value = 'example.test']",
            "valid_from": "2020-01-01T00:00:00.000Z"
        }),
        serde_json::json!({
            "type": "malware",
            "spec_version": "2.1",
            "id": "malware--d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
            "created": "2020-01-01T00:00:00.000Z",
            "modified": "2020-01-01T00:00:00.000Z",
            "name": "Fixture malware",
            "is_family": false
        }),
        serde_json::json!({
            "type": "relationship",
            "spec_version": "2.1",
            "id": "relationship--6f9619ff-8b86-d011-b42d-00cf4fc964ff",
            "created": "2020-01-01T00:00:00.000Z",
            "modified": "2020-01-01T00:00:00.000Z",
            "relationship_type": "indicates",
            "source_ref": "indicator--e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
            "target_ref": "malware--d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb"
        }),
    ]);
    let preview = preview_import(parse_bundle(&bundle).unwrap(), &[]).unwrap();
    manager
        .commit_stix_import(project.id(), &commit_import(&preview, &[]).unwrap(), 1_100)
        .unwrap();
    let objects = manager.list_stix_objects(project.id(), 1_200).unwrap();
    let indicator_id = objects
        .iter()
        .find(|object| object.object_type() == "indicator")
        .unwrap()
        .local_id();

    assert_eq!(
        manager
            .delete_stix_object(project.id(), indicator_id, 1_300)
            .unwrap_err()
            .code(),
        LifecycleErrorCode::StixObjectInUse
    );
    assert_eq!(
        manager
            .list_stix_objects(project.id(), 1_400)
            .unwrap()
            .len(),
        3
    );
}

#[test]
fn attack_and_atlas_observations_coexist_only_in_the_unlocked_project() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys).unwrap();
    let project = manager.create_project("Combined mapping", 1_000).unwrap();
    let enterprise = MitreTechniqueReference::new(
        MitreCatalog::AttackEnterprise,
        "19.1",
        "T1059.001",
        Some("TA0002"),
    )
    .unwrap();
    let atlas = MitreTechniqueReference::new(
        MitreCatalog::Atlas,
        "2026.06",
        "AML.T0000",
        Some("AML.TA0002"),
    )
    .unwrap();

    let observed = manager
        .create_technique_observation(
            project.id(),
            enterprise,
            catalog(MitreCatalog::AttackEnterprise).unwrap(),
            TechniqueAssessment::Observed,
            TechniqueOutcome::Successful,
            AnalyticConfidence::High,
            "Endpoint telemetry confirmed PowerShell execution.",
            Some(1_100),
            Some(1_200),
            2_000,
        )
        .unwrap();
    manager
        .create_technique_observation(
            project.id(),
            atlas,
            catalog(MitreCatalog::Atlas).unwrap(),
            TechniqueAssessment::Suspected,
            TechniqueOutcome::Unknown,
            AnalyticConfidence::Low,
            "Model behavior is consistent with an ATLAS technique.",
            None,
            None,
            2_100,
        )
        .unwrap();
    let revised = manager
        .update_technique_observation(
            project.id(),
            observed.id(),
            observed.revision(),
            TechniqueAssessment::Observed,
            TechniqueOutcome::Prevented,
            AnalyticConfidence::High,
            "Endpoint controls prevented the observed PowerShell execution.",
            Some(1_100),
            Some(1_300),
            2_200,
        )
        .unwrap();

    let observations = manager
        .list_technique_observations(project.id(), 2_300)
        .unwrap();
    assert_eq!(observations.len(), 2);
    assert!(observations.contains(&revised));
    assert!(
        observations
            .iter()
            .any(|entry| { entry.reference().catalog() == MitreCatalog::Atlas })
    );

    manager.lock_project(project.id()).unwrap();
    assert_eq!(
        manager
            .list_technique_observations(project.id(), 2_400)
            .unwrap_err()
            .code(),
        LifecycleErrorCode::ProjectLocked
    );
}

#[test]
fn mapping_import_is_atomic_preserves_revisions_and_requires_explicit_replacement() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys).unwrap();
    let source = manager.create_project("Mapping source", 1_000).unwrap();
    let target = manager.create_project("Mapping target", 1_100).unwrap();
    let enterprise = catalog(MitreCatalog::AttackEnterprise).unwrap();
    let created = manager
        .create_technique_observation(
            source.id(),
            MitreTechniqueReference::new(
                MitreCatalog::AttackEnterprise,
                "19.1",
                "T1059",
                Some("TA0002"),
            )
            .unwrap(),
            enterprise,
            TechniqueAssessment::Observed,
            TechniqueOutcome::Successful,
            AnalyticConfidence::High,
            "Command execution confirmed.",
            None,
            None,
            2_000,
        )
        .unwrap();
    let exported = export_mapping_file(
        &manager
            .list_technique_observations(source.id(), 2_100)
            .unwrap(),
        2_200,
    )
    .unwrap();
    let mapping = import_mapping_file(&exported).unwrap();

    let first = manager
        .import_technique_observations(target.id(), mapping.observations(), false, 2_300)
        .unwrap();
    assert_eq!((first.imported(), first.skipped()), (1, 0));
    assert_eq!(
        manager
            .list_technique_observations(target.id(), 2_400)
            .unwrap(),
        mapping.observations()
    );

    let skipped = manager
        .import_technique_observations(target.id(), mapping.observations(), false, 2_500)
        .unwrap();
    assert_eq!((skipped.imported(), skipped.skipped()), (0, 1));

    let revised = manager
        .update_technique_observation(
            source.id(),
            created.id(),
            created.revision(),
            TechniqueAssessment::Suspected,
            TechniqueOutcome::Attempted,
            AnalyticConfidence::Medium,
            "Command execution remains under review.",
            None,
            None,
            2_600,
        )
        .unwrap();
    let replaced = manager
        .import_technique_observations(target.id(), std::slice::from_ref(&revised), true, 2_700)
        .unwrap();
    assert_eq!((replaced.imported(), replaced.skipped()), (1, 0));
    assert_eq!(
        manager
            .list_technique_observations(target.id(), 2_800)
            .unwrap(),
        vec![revised]
    );

    manager.lock_project(target.id()).unwrap();
    assert_eq!(
        manager
            .import_technique_observations(target.id(), mapping.observations(), true, 2_900)
            .unwrap_err()
            .code(),
        LifecycleErrorCode::ProjectLocked
    );
}

#[test]
fn mapping_deletion_is_revision_checked_and_does_not_touch_catalog_data() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys).unwrap();
    let project = manager.create_project("Mapping deletion", 1_000).unwrap();
    let enterprise = catalog(MitreCatalog::AttackEnterprise).unwrap();
    let created = manager
        .create_technique_observation(
            project.id(),
            MitreTechniqueReference::new(
                MitreCatalog::AttackEnterprise,
                "19.1",
                "T1059",
                Some("TA0002"),
            )
            .unwrap(),
            enterprise,
            TechniqueAssessment::Suspected,
            TechniqueOutcome::Unknown,
            AnalyticConfidence::Medium,
            "Mapping added by mistake.",
            None,
            None,
            2_000,
        )
        .unwrap();
    let revised = manager
        .update_technique_observation(
            project.id(),
            created.id(),
            created.revision(),
            TechniqueAssessment::Observed,
            TechniqueOutcome::Successful,
            AnalyticConfidence::High,
            "Newer analyst conclusion.",
            None,
            None,
            2_100,
        )
        .unwrap();

    assert_eq!(
        manager
            .delete_technique_observation(project.id(), revised.id(), created.revision(), 2_200)
            .unwrap_err()
            .code(),
        LifecycleErrorCode::RevisionConflict
    );
    assert_eq!(
        manager
            .list_technique_observations(project.id(), 2_300)
            .unwrap(),
        vec![revised.clone()]
    );

    manager
        .delete_technique_observation(project.id(), revised.id(), revised.revision(), 2_400)
        .unwrap();
    assert!(
        manager
            .list_technique_observations(project.id(), 2_500)
            .unwrap()
            .is_empty()
    );
    assert!(
        enterprise
            .techniques()
            .iter()
            .any(|item| item.id() == "T1059")
    );
}

#[test]
fn confirmed_stix_export_promotes_local_drafts_in_the_project() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys).unwrap();
    let project = manager.create_project("STIX export", 1_000).unwrap();
    let draft = StixDraft::new(
        LocalId::parse("d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb").unwrap(),
        "domain-name",
        serde_json::json!({"value": "draft.example"}),
    )
    .unwrap();
    manager
        .save_stix_draft(project.id(), &draft, 2_000)
        .unwrap();

    let preview = preview_project_export(
        &manager.list_stix_objects(project.id(), 2_100).unwrap(),
        &manager.list_stix_drafts(project.id(), 2_200).unwrap(),
    )
    .unwrap();
    let committed = commit_project_export(&preview).unwrap();
    manager
        .promote_stix_drafts(project.id(), &committed.generated_objects().unwrap(), 2_300)
        .unwrap();

    assert!(
        manager
            .list_stix_drafts(project.id(), 2_400)
            .unwrap()
            .is_empty()
    );
    let objects = manager.list_stix_objects(project.id(), 2_500).unwrap();
    assert_eq!(objects.len(), 1);
    assert_eq!(objects[0].local_id(), draft.local_id());
}

#[test]
fn committed_stix_objects_open_as_identity_preserving_revision_drafts() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys).unwrap();
    let project = manager.create_project("STIX revisions", 1_000).unwrap();
    let raw = serde_json::json!({
        "type": "indicator",
        "spec_version": "2.1",
        "id": "indicator--e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
        "created": "2020-01-01T00:00:00.000Z",
        "modified": "2020-01-01T00:00:00.000Z",
        "pattern": "[domain-name:value = 'evil.example']",
        "pattern_type": "stix",
        "valid_from": "2020-01-01T00:00:00.000Z"
    });
    let preview = preview_import(
        parse_bundle(&stix_bundle_from_objects(vec![raw])).unwrap(),
        &[],
    )
    .unwrap();
    manager
        .commit_stix_import(project.id(), &commit_import(&preview, &[]).unwrap(), 2_000)
        .unwrap();
    let object = manager.list_stix_objects(project.id(), 2_100).unwrap()[0].clone();

    let draft = manager
        .create_stix_revision_draft(project.id(), object.local_id(), 2_200)
        .unwrap();
    assert_eq!(draft.local_id(), object.local_id());
    assert_eq!(draft.replaces_stix_id(), Some(object.stix_id()));

    let updated = manager
        .update_stix_draft(
            project.id(),
            draft.local_id(),
            "indicator",
            serde_json::json!({
                "created": "2020-01-01T00:00:00.000Z",
                "modified": "2020-01-02T00:00:00.000Z",
                "pattern": "[domain-name:value = 'revised.example']",
                "pattern_type": "stix",
                "valid_from": "2020-01-01T00:00:00.000Z"
            }),
            None,
            2_300,
        )
        .unwrap();
    assert_eq!(updated.replaces_stix_id(), Some(object.stix_id()));
    assert_eq!(
        manager.list_stix_drafts(project.id(), 2_400).unwrap(),
        vec![updated]
    );
}

#[test]
fn relationship_drafts_require_existing_stix_endpoint_local_ids() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys).unwrap();
    let project = manager.create_project("STIX relationships", 1_000).unwrap();
    let preview = preview_import(parse_bundle(&stix_bundle()).unwrap(), &[]).unwrap();
    let commit = commit_import(&preview, &[]).unwrap();
    manager
        .commit_stix_import(project.id(), &commit, 2_000)
        .unwrap();
    let imported = manager.list_stix_objects(project.id(), 2_100).unwrap();
    let source_id = imported[0].local_id();
    let target = StixDraft::new(
        LocalId::parse("d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb").unwrap(),
        "domain-name",
        serde_json::json!({"value": "draft.example"}),
    )
    .unwrap();
    manager
        .save_stix_draft(project.id(), &target, 2_200)
        .unwrap();

    let valid = StixDraft::new_relationship(
        LocalId::parse("6f9619ff-8b86-d011-b42d-00cf4fc964ff").unwrap(),
        SemanticRelationshipDraft::new(source_id, target.local_id(), "resolves-to").unwrap(),
        serde_json::json!({"description": "Observed resolution"}),
    )
    .unwrap();
    manager
        .save_stix_draft(project.id(), &valid, 2_300)
        .unwrap();

    assert_eq!(
        manager
            .delete_stix_draft(project.id(), target.local_id(), 2_350)
            .unwrap_err()
            .code(),
        LifecycleErrorCode::StixDraftInUse
    );
    assert!(
        manager
            .list_stix_drafts(project.id(), 2_360)
            .unwrap()
            .iter()
            .any(|draft| draft.local_id() == target.local_id())
    );

    let missing_endpoint = StixDraft::new_relationship(
        LocalId::parse("7a9619ff-8b86-d011-b42d-00cf4fc964ff").unwrap(),
        SemanticRelationshipDraft::new(
            source_id,
            LocalId::parse("8a9619ff-8b86-d011-b42d-00cf4fc964ff").unwrap(),
            "resolves-to",
        )
        .unwrap(),
        serde_json::json!({}),
    )
    .unwrap();
    assert_eq!(
        manager
            .save_stix_draft(project.id(), &missing_endpoint, 2_400)
            .unwrap_err()
            .code(),
        LifecycleErrorCode::InvalidStix
    );
}

#[test]
fn project_deletion_requires_a_lock_and_removes_data_and_device_credentials() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys.clone()).unwrap();
    let created = manager.create_project("Disposable project", 1_000).unwrap();
    let project_directory = directory.0.join(created.id().to_string());

    let error = manager.delete_project(created.id()).unwrap_err();
    assert_eq!(error.code(), LifecycleErrorCode::ProjectMustBeLocked);
    assert!(project_directory.is_dir());
    assert!(keys.contains(created.id()));

    manager.lock_project(created.id()).unwrap();
    manager.delete_project(created.id()).unwrap();

    assert!(!project_directory.exists());
    assert!(!keys.contains(created.id()));
    assert!(manager.list_projects().unwrap().is_empty());
    assert_eq!(
        manager.project(created.id()).unwrap_err().code(),
        LifecycleErrorCode::ProjectNotFound
    );
}

#[test]
fn denied_device_credential_deletion_preserves_the_project_and_key() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys.clone()).unwrap();
    let created = manager.create_project("Consent required", 1_000).unwrap();
    let project_directory = directory.0.join(created.id().to_string());
    manager.lock_project(created.id()).unwrap();
    keys.reject_deletes.store(true, Ordering::Relaxed);

    let error = manager.delete_project(created.id()).unwrap_err();

    assert_eq!(error.code(), LifecycleErrorCode::CredentialUnavailable);
    assert!(project_directory.is_dir());
    assert!(keys.contains(created.id()));
    assert_eq!(
        manager.project(created.id()).unwrap().name(),
        Some("Consent required")
    );
}

#[test]
fn wrong_credential_fails_closed_without_damaging_the_project() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys.clone()).unwrap();
    let created = manager
        .create_project("Wrong key proof", 1_785_342_000_000)
        .unwrap();
    let correct_key = keys.key_for(created.id());
    manager.lock_project(created.id()).unwrap();

    keys.replace(created.id(), [0xAA; 32]);
    let error = manager
        .unlock_project(created.id(), 1_785_342_001_000)
        .unwrap_err();
    assert_eq!(error.code(), LifecycleErrorCode::InvalidKeyOrCorrupt);
    assert!(manager.project(created.id()).unwrap().locked());

    keys.replace(created.id(), correct_key);
    assert_eq!(
        manager
            .unlock_project(created.id(), 1_785_342_002_000)
            .unwrap()
            .name(),
        Some("Wrong key proof")
    );
}

#[test]
fn failed_credential_storage_rolls_back_the_new_project() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    keys.reject_writes.store(true, Ordering::Relaxed);
    let mut manager = ProjectManager::new(directory.0.clone(), keys).unwrap();

    let error = manager
        .create_project("Must roll back", 1_785_342_000_000)
        .unwrap_err();
    assert_eq!(error.code(), LifecycleErrorCode::CredentialUnavailable);
    assert_eq!(fs::read_dir(&directory.0).unwrap().count(), 0);
}

#[test]
fn idle_projects_lock_at_the_configured_deadline() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys).unwrap();
    let created = manager.create_project("Idle lock", 1_000).unwrap();

    assert!(manager.lock_idle_projects(1_499, 500).is_empty());
    assert_eq!(manager.lock_idle_projects(1_500, 500), vec![created.id()]);
    assert!(manager.project(created.id()).unwrap().locked());
}

#[test]
fn application_shutdown_locks_every_open_project() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys).unwrap();
    let first = manager.create_project("First open project", 1_000).unwrap();
    let second = manager
        .create_project("Second open project", 1_100)
        .unwrap();

    let locked = manager.lock_all_projects();

    let mut expected = vec![first.id(), second.id()];
    expected.sort_by_key(ToString::to_string);
    assert_eq!(locked, expected);
    assert!(manager.project(first.id()).unwrap().locked());
    assert!(manager.project(second.id()).unwrap().locked());
    assert!(manager.lock_all_projects().is_empty());
}

#[test]
fn project_discovery_returns_bounded_display_names_without_opening_databases() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let created_id = {
        let mut manager = ProjectManager::new(directory.0.clone(), keys.clone()).unwrap();
        manager
            .create_project("Encrypted discovery name", 1_000)
            .unwrap()
            .id()
    };
    fs::create_dir(directory.0.join("not-a-project")).unwrap();

    let manager = ProjectManager::new(directory.0.clone(), keys).unwrap();
    let projects = manager.list_projects().unwrap();

    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].id(), created_id);
    assert_eq!(projects[0].name(), Some("Encrypted discovery name"));
    assert_eq!(projects[0].unlock_method(), UnlockMethod::Device);
    assert!(projects[0].locked());
}

#[test]
fn legacy_manifests_remain_discoverable_without_a_display_name() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys.clone()).unwrap();
    let created = manager.create_project("Legacy project", 1_000).unwrap();
    manager.lock_project(created.id()).unwrap();

    fs::write(
        directory
            .0
            .join(created.id().to_string())
            .join("manifest.json"),
        format!(r#"{{"format_version":1,"project_id":"{}"}}"#, created.id()),
    )
    .unwrap();

    let projects = manager.list_projects().unwrap();
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].name(), None);
    assert_eq!(projects[0].unlock_method(), UnlockMethod::Device);
}

#[test]
fn passphrase_projects_wrap_random_keys_without_using_the_os_key_store() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys.clone()).unwrap();

    let created = manager
        .create_passphrase_project("Protected project", "correct horse battery staple", 1_000)
        .unwrap();
    assert_eq!(created.unlock_method(), UnlockMethod::Passphrase);
    assert!(!keys.contains(created.id()));

    let manifest = fs::read_to_string(
        directory
            .0
            .join(created.id().to_string())
            .join("manifest.json"),
    )
    .unwrap();
    assert!(manifest.contains(r#""unlock_method":"passphrase""#));
    assert!(manifest.contains(r#""algorithm":"argon2id""#));
    assert!(manifest.contains("wrapped_project_key"));
    assert!(!manifest.contains("correct horse battery staple"));

    manager.lock_project(created.id()).unwrap();
    let error = manager.unlock_project(created.id(), 2_000).unwrap_err();
    assert_eq!(error.code(), LifecycleErrorCode::PassphraseRequired);

    let reopened = manager
        .unlock_project_with_passphrase(created.id(), "correct horse battery staple", 3_000)
        .unwrap();
    assert_eq!(reopened.name(), Some("Protected project"));
    assert_eq!(reopened.unlock_method(), UnlockMethod::Passphrase);
}

#[test]
fn wrong_passphrases_fail_closed_without_damaging_wrapped_keys() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys).unwrap();
    let created = manager
        .create_passphrase_project(
            "Wrong passphrase proof",
            "a sufficiently long password",
            1_000,
        )
        .unwrap();
    manager.lock_project(created.id()).unwrap();

    let error = manager
        .unlock_project_with_passphrase(created.id(), "this is not the password", 2_000)
        .unwrap_err();
    assert_eq!(error.code(), LifecycleErrorCode::InvalidPassphraseOrCorrupt);
    assert!(manager.project(created.id()).unwrap().locked());

    assert_eq!(
        manager
            .unlock_project_with_passphrase(created.id(), "a sufficiently long password", 3_000,)
            .unwrap()
            .name(),
        Some("Wrong passphrase proof")
    );
}

#[test]
fn tampered_wrapped_keys_fail_authentication_without_touching_the_database() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys).unwrap();
    let created = manager
        .create_passphrase_project("Tamper proof", "a sufficiently long password", 1_000)
        .unwrap();
    manager.lock_project(created.id()).unwrap();

    let project_directory = directory.0.join(created.id().to_string());
    let database_path = project_directory.join("project.sheut");
    let database_before = fs::read(&database_path).unwrap();
    let manifest_path = project_directory.join("manifest.json");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    let wrapped_key = manifest["passphrase_key_wrap"]["wrapped_project_key"]
        .as_str()
        .unwrap();
    let replacement = if wrapped_key.starts_with('0') {
        "1"
    } else {
        "0"
    };
    manifest["passphrase_key_wrap"]["wrapped_project_key"] =
        serde_json::Value::String(format!("{replacement}{}", &wrapped_key[1..]));
    fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();

    let error = manager
        .unlock_project_with_passphrase(created.id(), "a sufficiently long password", 2_000)
        .unwrap_err();
    assert_eq!(error.code(), LifecycleErrorCode::InvalidPassphraseOrCorrupt);
    assert_eq!(fs::read(database_path).unwrap(), database_before);
}

#[test]
fn recovery_points_are_encrypted_internal_files_listed_without_paths() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys).unwrap();
    let created = manager.create_project("Recovery source", 1_000).unwrap();

    let recovery_point = manager.create_project_backup(created.id(), 2_000).unwrap();
    assert_eq!(recovery_point.created_at_unix_ms(), 2_000);

    let backup_directory = directory.0.join(created.id().to_string()).join("backups");
    let files: Vec<_> = fs::read_dir(&backup_directory)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    assert_eq!(files.len(), 1);
    assert!(
        !fs::read(&files[0])
            .unwrap()
            .starts_with(b"SQLite format 3\0")
    );

    let error = manager
        .restore_device_project_backup(created.id(), recovery_point.id(), 2_500)
        .unwrap_err();
    assert_eq!(error.code(), LifecycleErrorCode::ProjectMustBeLocked);

    fs::write(backup_directory.join("not-a-backup"), b"ignored").unwrap();
    manager.lock_project(created.id()).unwrap();
    let listed = manager.list_project_backups(created.id()).unwrap();
    assert_eq!(listed, vec![recovery_point]);

    let error = manager
        .create_project_backup(created.id(), 3_000)
        .unwrap_err();
    assert_eq!(error.code(), LifecycleErrorCode::ProjectLocked);
}

#[test]
fn a_selected_recovery_point_replaces_corruption_and_keeps_a_rollback_copy() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys).unwrap();
    let created = manager.create_project("Recoverable", 1_000).unwrap();
    let recovery_point = manager.create_project_backup(created.id(), 2_000).unwrap();

    let project_directory = directory.0.join(created.id().to_string());
    let database_path = project_directory.join("project.sheut");
    manager.lock_project(created.id()).unwrap();
    fs::write(&database_path, b"corrupted project bytes").unwrap();
    assert_eq!(
        manager
            .unlock_project(created.id(), 3_000)
            .unwrap_err()
            .code(),
        LifecycleErrorCode::InvalidKeyOrCorrupt
    );

    let missing_backup = LocalId::parse("6f9619ff-8b86-d011-b42d-00cf4fc964ff").unwrap();
    let error = manager
        .restore_device_project_backup(created.id(), missing_backup, 3_500)
        .unwrap_err();
    assert_eq!(error.code(), LifecycleErrorCode::BackupNotFound);

    manager
        .restore_device_project_backup(created.id(), recovery_point.id(), 4_000)
        .unwrap();
    assert_eq!(
        manager.unlock_project(created.id(), 5_000).unwrap().name(),
        Some("Recoverable")
    );
    let rollback_files: Vec<_> = fs::read_dir(project_directory.join("recovery"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    assert_eq!(rollback_files.len(), 1);
    assert_eq!(
        fs::read(&rollback_files[0]).unwrap(),
        b"corrupted project bytes"
    );
}

#[test]
fn passphrase_recovery_rejects_the_wrong_passphrase_without_mutation() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys).unwrap();
    let created = manager
        .create_passphrase_project("Passphrase recovery", "a sufficiently long password", 1_000)
        .unwrap();
    let recovery_point = manager.create_project_backup(created.id(), 2_000).unwrap();
    manager.lock_project(created.id()).unwrap();

    let project_directory = directory.0.join(created.id().to_string());
    let database_path = project_directory.join("project.sheut");
    let database_before = fs::read(&database_path).unwrap();
    let error = manager
        .restore_passphrase_project_backup(
            created.id(),
            recovery_point.id(),
            "not the correct passphrase",
            3_000,
        )
        .unwrap_err();
    assert_eq!(error.code(), LifecycleErrorCode::InvalidPassphraseOrCorrupt);
    assert_eq!(fs::read(&database_path).unwrap(), database_before);

    manager
        .restore_passphrase_project_backup(
            created.id(),
            recovery_point.id(),
            "a sufficiently long password",
            4_000,
        )
        .unwrap();
}

#[test]
fn passphrases_are_bounded_before_expensive_key_derivation() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys).unwrap();

    let too_short = manager
        .create_passphrase_project("Short password", "too short", 1_000)
        .unwrap_err();
    assert_eq!(too_short.code(), LifecycleErrorCode::InvalidPassphrase);

    let too_long = "x".repeat(1_025);
    let error = manager
        .create_passphrase_project("Long password", &too_long, 1_000)
        .unwrap_err();
    assert_eq!(error.code(), LifecycleErrorCode::InvalidPassphrase);
}

#[test]
fn document_edits_round_trip_and_stale_revisions_fail_closed() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys).unwrap();
    let project = manager.create_project("Document project", 1_000).unwrap();

    let document = manager
        .create_document(project.id(), DocumentKind::Investigation, 1_100)
        .unwrap();
    assert_eq!(document.revision(), Revision::new(1).unwrap());
    assert_eq!(
        manager.list_documents(project.id(), 1_200).unwrap(),
        vec![document.clone()]
    );

    let edited_root = serde_json::json!({
        "type": "doc",
        "content": [
            {
                "type": "callout",
                "attrs": {"tone": "info"},
                "content": [{
                    "type": "paragraph",
                    "content": [{"type": "text", "text": "Persisted finding"}]
                }]
            },
            {
                "type": "table",
                "content": [{
                    "type": "tableRow",
                    "content": [{
                        "type": "tableCell",
                        "content": [{
                            "type": "paragraph",
                            "content": [{"type": "text", "text": "Round trip"}]
                        }]
                    }]
                }]
            }
        ]
    });
    let saved = manager
        .save_document(
            project.id(),
            document.id(),
            Revision::new(1).unwrap(),
            edited_root.clone(),
            1_300,
        )
        .unwrap();
    assert_eq!(saved.revision(), Revision::new(2).unwrap());
    assert_eq!(saved.root(), &edited_root);

    let stale = manager
        .save_document(
            project.id(),
            document.id(),
            Revision::new(1).unwrap(),
            serde_json::json!({"type": "doc", "content": []}),
            1_400,
        )
        .unwrap_err();
    assert_eq!(stale.code(), LifecycleErrorCode::RevisionConflict);

    manager.lock_project(project.id()).unwrap();
    let locked = manager.list_documents(project.id(), 1_500).unwrap_err();
    assert_eq!(locked.code(), LifecycleErrorCode::ProjectLocked);
    manager.unlock_project(project.id(), 1_600).unwrap();
    assert_eq!(
        manager
            .load_document(project.id(), document.id(), 1_700)
            .unwrap(),
        saved
    );
}

#[test]
fn legacy_freeform_reports_stay_encrypted_but_are_not_exposed_or_mutated() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys.clone()).unwrap();
    let project = manager
        .create_project("Compatibility project", 1_000)
        .unwrap();
    let investigation = manager
        .create_document(project.id(), DocumentKind::Investigation, 1_100)
        .unwrap();
    assert_eq!(
        manager
            .create_document(project.id(), DocumentKind::Report, 1_200)
            .unwrap_err()
            .code(),
        LifecycleErrorCode::InvalidDocument
    );

    manager.lock_project(project.id()).unwrap();
    let legacy = DocumentEnvelope::new(
        LocalId::parse("e7c44850-9f67-4d26-b7e3-0d4ee82339ef").unwrap(),
        DocumentKind::Report,
        Revision::new(1).unwrap(),
        serde_json::json!({
            "type": "doc",
            "content": [{
                "type": "paragraph",
                "content": [{"type": "text", "text": "Preserved legacy content"}]
            }]
        }),
    )
    .unwrap();
    let database = directory
        .0
        .join(project.id().to_string())
        .join("project.sheut");
    let key = keys.key_for(project.id());
    let mut store = EncryptedStore::open(&database, &key).unwrap();
    store.save_document_at(&legacy, None, 1_300).unwrap();
    drop(store);

    manager.unlock_project(project.id(), 1_400).unwrap();
    assert_eq!(
        manager.list_documents(project.id(), 1_500).unwrap(),
        vec![investigation]
    );
    assert_eq!(
        manager
            .load_document(project.id(), legacy.id(), 1_600)
            .unwrap_err()
            .code(),
        LifecycleErrorCode::InvalidDocument
    );

    manager.lock_project(project.id()).unwrap();
    let mut store = EncryptedStore::open(&database, &key).unwrap();
    assert_eq!(
        store.load_document(legacy.id()).unwrap(),
        Some(legacy.clone())
    );
    assert!(store.soft_delete_document(legacy.id(), 1_700).unwrap());
    assert_eq!(
        store.load_document_record(legacy.id()).unwrap(),
        Some(legacy.clone())
    );
    drop(store);

    manager.unlock_project(project.id(), 1_800).unwrap();
    assert_eq!(
        manager
            .restore_document(project.id(), legacy.id(), 1_900)
            .unwrap_err()
            .code(),
        LifecycleErrorCode::InvalidDocument
    );
    manager.lock_project(project.id()).unwrap();
    let store = EncryptedStore::open(&database, &key).unwrap();
    assert_eq!(
        store.load_document_record(legacy.id()).unwrap(),
        Some(legacy)
    );
}

#[test]
fn document_history_compares_snapshots_and_restores_as_a_new_revision() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys).unwrap();
    let project = manager.create_project("History project", 1_000).unwrap();
    let original = manager
        .create_document(project.id(), DocumentKind::AnalystNote, 1_100)
        .unwrap();
    let baseline = manager
        .save_document(
            project.id(),
            original.id(),
            original.revision(),
            serde_json::json!({
                "type": "doc",
                "content": [{
                    "type": "paragraph",
                    "content": [{"type": "text", "text": "Initial finding"}]
                }]
            }),
            1_200,
        )
        .unwrap();
    let edited = manager
        .save_document(
            project.id(),
            original.id(),
            baseline.revision(),
            serde_json::json!({
                "type": "doc",
                "content": [{
                    "type": "paragraph",
                    "content": [{"type": "text", "text": "Changed finding"}]
                }]
            }),
            1_300,
        )
        .unwrap();

    let revisions = manager
        .list_document_revisions(project.id(), original.id(), 1_400)
        .unwrap();
    assert_eq!(revisions.len(), 3);
    assert_eq!(revisions[0].revision(), edited.revision());
    assert_eq!(revisions[1].revision(), baseline.revision());

    let diff = manager
        .compare_document_revisions(
            project.id(),
            original.id(),
            baseline.revision(),
            edited.revision(),
            1_500,
        )
        .unwrap();
    assert_eq!(diff.from_revision(), baseline.revision());
    assert_eq!(diff.to_revision(), edited.revision());
    assert_eq!(
        diff.segments()
            .iter()
            .map(|segment| (segment.kind(), segment.text()))
            .collect::<Vec<_>>(),
        vec![
            (DocumentTextDiffKind::Removed, "Initial"),
            (DocumentTextDiffKind::Added, "Changed"),
            (DocumentTextDiffKind::Unchanged, " finding"),
        ]
    );
    assert!(!diff.simplified());

    let restored = manager
        .restore_document_revision(
            project.id(),
            original.id(),
            baseline.revision(),
            edited.revision(),
            1_600,
        )
        .unwrap();
    assert_eq!(restored.revision(), Revision::new(4).unwrap());
    assert_eq!(restored.root(), baseline.root());

    let activity = manager
        .list_document_activity(project.id(), original.id(), 1_700)
        .unwrap();
    assert_eq!(activity.len(), 4);
    assert_eq!(activity[0].kind(), DocumentActivityKind::RestoredRevision);
    assert_eq!(activity[0].revision(), restored.revision());
    assert_eq!(activity[0].source_revision(), Some(baseline.revision()));
    assert_eq!(activity[1].kind(), DocumentActivityKind::Edited);
    assert_eq!(activity[2].kind(), DocumentActivityKind::Edited);
    assert_eq!(activity[3].kind(), DocumentActivityKind::Created);
}

#[test]
fn document_deletion_requires_an_unlocked_project_and_can_be_undone() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys).unwrap();
    let project = manager.create_project("Deletion project", 1_000).unwrap();
    let document = manager
        .create_document(project.id(), DocumentKind::Investigation, 1_100)
        .unwrap();

    manager
        .delete_document(project.id(), document.id(), 1_200)
        .unwrap();
    assert_eq!(
        manager
            .load_document(project.id(), document.id(), 1_300)
            .unwrap_err()
            .code(),
        LifecycleErrorCode::DocumentNotFound
    );
    assert_eq!(
        manager
            .delete_document(project.id(), document.id(), 1_400)
            .unwrap_err()
            .code(),
        LifecycleErrorCode::DocumentNotFound
    );

    let restored = manager
        .restore_document(project.id(), document.id(), 1_450)
        .unwrap();
    assert_eq!(restored, document);
    assert_eq!(
        manager
            .load_document(project.id(), document.id(), 1_475)
            .unwrap(),
        document
    );

    manager.lock_project(project.id()).unwrap();
    assert_eq!(
        manager
            .delete_document(project.id(), document.id(), 1_500)
            .unwrap_err()
            .code(),
        LifecycleErrorCode::ProjectLocked
    );
}

#[test]
fn document_images_survive_reopen_and_are_deleted_with_their_document() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys.clone()).unwrap();
    let project = manager.create_project("Image project", 1_000).unwrap();
    let document = manager
        .create_document(project.id(), DocumentKind::Investigation, 1_100)
        .unwrap();
    let image = TEST_PNG.to_vec();

    let metadata = manager
        .create_image_attachment(
            project.id(),
            document.id(),
            "evidence.png",
            image.clone(),
            1_200,
        )
        .unwrap();
    assert_eq!(metadata.document_id(), document.id());
    assert_eq!(metadata.file_name(), "evidence.png");
    let report_root = serde_json::json!({
        "type": "doc",
        "content": [
            {
                "type": "heading",
                "attrs": {"level": 1},
                "content": [{"type": "text", "text": "Operation Midnight Echo"}]
            },
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": "Analysts observed evil[.]example."}]
            },
            {
                "type": "imageAttachment",
                "attrs": {
                    "attachmentId": metadata.id(),
                    "alt": "Evidence screenshot",
                    "title": null
                }
            }
        ]
    });
    let saved = manager
        .save_document(
            project.id(),
            document.id(),
            document.revision(),
            report_root,
            1_250,
        )
        .unwrap();
    assert_eq!(
        manager
            .load_image_attachment(project.id(), document.id(), metadata.id(), 1_300)
            .unwrap(),
        (metadata.clone(), image.clone())
    );

    assert_eq!(
        manager
            .create_image_attachment(
                project.id(),
                document.id(),
                "malicious.svg",
                b"<svg onload=alert(1)>".to_vec(),
                1_400,
            )
            .unwrap_err()
            .code(),
        LifecycleErrorCode::InvalidAttachment
    );
    manager.lock_project(project.id()).unwrap();
    assert_eq!(
        manager
            .load_image_attachment(project.id(), document.id(), metadata.id(), 1_500)
            .unwrap_err()
            .code(),
        LifecycleErrorCode::ProjectLocked
    );
    drop(manager);

    let mut reopened = ProjectManager::new(directory.0.clone(), keys).unwrap();
    reopened.unlock_project(project.id(), 1_600).unwrap();
    assert_eq!(
        reopened
            .load_document(project.id(), document.id(), 1_700)
            .unwrap(),
        saved
    );
    assert_eq!(
        reopened
            .load_image_attachment(project.id(), document.id(), metadata.id(), 1_800)
            .unwrap(),
        (metadata.clone(), image.clone())
    );

    reopened
        .delete_document(project.id(), document.id(), 1_900)
        .unwrap();
    assert_eq!(
        reopened
            .load_image_attachment(project.id(), document.id(), metadata.id(), 2_000)
            .unwrap_err()
            .code(),
        LifecycleErrorCode::AttachmentNotFound
    );
    reopened
        .restore_document(project.id(), document.id(), 2_100)
        .unwrap();
    assert_eq!(
        reopened
            .load_image_attachment(project.id(), document.id(), metadata.id(), 2_200)
            .unwrap(),
        (metadata, image)
    );
}

#[test]
fn evidence_images_survive_reopen_and_are_scoped_to_their_project() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys.clone()).unwrap();
    let project = manager
        .create_project("Guided image project", 1_000)
        .unwrap();
    let other_project = manager.create_project("Other project", 1_100).unwrap();
    let image = TEST_PNG.to_vec();

    let metadata = manager
        .create_evidence_image(project.id(), "evidence.png", image.clone(), 1_200)
        .unwrap();
    assert_eq!(metadata.file_name(), "evidence.png");
    assert_eq!(
        manager
            .load_evidence_image(project.id(), metadata.id(), 1_300)
            .unwrap(),
        (metadata.clone(), image.clone())
    );
    assert_eq!(
        manager.list_evidence_files(project.id(), 1_400).unwrap(),
        vec![metadata.clone()]
    );
    let duplicate = manager
        .create_evidence_image(
            project.id(),
            "same-bytes-different-name.png",
            image.clone(),
            1_450,
        )
        .unwrap();
    assert_eq!(duplicate, metadata);
    assert_eq!(
        manager
            .list_evidence_files(project.id(), 1_475)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        manager
            .load_evidence_image(other_project.id(), metadata.id(), 1_500)
            .unwrap_err()
            .code(),
        LifecycleErrorCode::AttachmentNotFound
    );
    assert_eq!(
        manager
            .create_evidence_image(
                project.id(),
                "malicious.svg",
                b"<svg onload=alert(1)>".to_vec(),
                1_600,
            )
            .unwrap_err()
            .code(),
        LifecycleErrorCode::InvalidAttachment
    );
    manager.lock_project(project.id()).unwrap();
    drop(manager);

    let mut reopened = ProjectManager::new(directory.0.clone(), keys).unwrap();
    reopened.unlock_project(project.id(), 1_700).unwrap();
    assert_eq!(
        reopened
            .load_evidence_image(project.id(), metadata.id(), 1_800)
            .unwrap(),
        (metadata, image)
    );
}

#[test]
fn generic_evidence_files_are_deduplicated_without_entering_the_graph() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys).unwrap();
    let project = manager.create_project("Archive evidence", 1_000).unwrap();
    let payload = b"PK\x03\x04captured-site-backup".to_vec();

    let first = manager
        .create_evidence_file(project.id(), "captured-site.zip", payload.clone(), 1_100)
        .unwrap();
    let duplicate = manager
        .create_evidence_file(project.id(), "renamed.zip", payload.clone(), 1_200)
        .unwrap();

    assert_eq!(first, duplicate);
    assert_eq!(first.media_type(), "application/zip");
    assert_eq!(
        manager
            .load_evidence_image(project.id(), first.id(), 1_250)
            .unwrap_err()
            .code(),
        LifecycleErrorCode::InvalidAttachment
    );
    assert_eq!(
        manager
            .load_evidence_file(project.id(), first.id(), 1_300)
            .unwrap(),
        (first, payload)
    );
}

#[test]
fn evidence_metadata_can_be_revised_and_then_deleted_inside_one_project() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys).unwrap();
    let project = manager.create_project("Evidence lifecycle", 1_000).unwrap();
    let evidence = manager
        .create_evidence_file(
            project.id(),
            "capture.zip",
            b"PK\x03\x04captured bytes".to_vec(),
            1_100,
        )
        .unwrap();
    let revised = manager
        .update_evidence_metadata(
            project.id(),
            evidence.id(),
            Revision::new(1).unwrap(),
            EvidenceMetadataInput::new(
                "Piracy storefront capture",
                "Landing page evidence",
                "Analyst capture",
                Some("2026-07-31".to_owned()),
                "https://piracy.example/",
                vec!["piracy".to_owned()],
                "Original bytes retained",
            )
            .unwrap(),
            1_200,
        )
        .unwrap();
    assert_eq!(revised.revision(), Revision::new(2).unwrap());

    manager
        .delete_evidence_file(project.id(), evidence.id(), revised.revision(), 1_300)
        .unwrap();
    assert_eq!(
        manager
            .load_evidence_file(project.id(), evidence.id(), 1_400)
            .unwrap_err()
            .code(),
        LifecycleErrorCode::AttachmentNotFound
    );
}

#[test]
fn custom_report_templates_copy_a_builtin_and_survive_reopen() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys.clone()).unwrap();
    let project = manager.create_project("Custom reports", 1_000).unwrap();
    let base = manager
        .list_report_templates(project.id(), 1_100)
        .unwrap()
        .into_iter()
        .find(|template| template.name() == "Campaign Report")
        .unwrap();
    let base_section_count = base.sections().len();
    let custom_section: ReportTemplateSection = serde_json::from_value(serde_json::json!({
        "key": "custom_social_profiles",
        "title": "Social profiles",
        "optional": true,
        "fields": [{
            "key": "custom_social_profiles_table",
            "label": "Social profiles",
            "help_text": null,
            "kind": "repeatable_rows",
            "required": false,
            "columns": ["Platform", "Handle", "Profile link", "Source"]
        }]
    }))
    .unwrap();

    let created = manager
        .create_custom_report_template(
            project.id(),
            base.id(),
            "Piracy Ecosystem Report",
            "Tracks sites, infrastructure, identities, and social profiles.",
            vec![custom_section],
            1_200,
        )
        .unwrap();
    assert_eq!(created.revision().get(), 1);
    assert_eq!(created.sections().len(), base_section_count + 1);
    assert_eq!(
        created.sections().last().unwrap().key(),
        "custom_social_profiles"
    );

    manager.lock_project(project.id()).unwrap();
    drop(manager);
    let mut reopened = ProjectManager::new(directory.0.clone(), keys).unwrap();
    reopened.unlock_project(project.id(), 1_300).unwrap();
    let restored = reopened
        .list_report_templates(project.id(), 1_400)
        .unwrap()
        .into_iter()
        .find(|template| template.id() == created.id())
        .unwrap();
    assert_eq!(restored, created);
    let report = reopened
        .create_guided_report(project.id(), restored.id(), 1_500)
        .unwrap();
    assert_eq!(report.template_id(), restored.id());
    assert_eq!(
        report.fields().get("report_number"),
        Some(&GuidedReportFieldValue::Text("RPT-0001".to_owned()))
    );
    assert!(
        report
            .included_sections()
            .iter()
            .any(|key| key == "custom_social_profiles")
    );
}

#[test]
fn guided_report_deletion_requires_an_unlocked_project_and_can_be_undone() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys).unwrap();
    let project = manager.create_project("Report deletion", 1_000).unwrap();
    let template = manager
        .list_report_templates(project.id(), 1_100)
        .unwrap()
        .into_iter()
        .find(|template| template.builtin() == Some(BuiltinReportTemplate::BlankGuidedReport))
        .unwrap();
    let report = manager
        .create_guided_report(project.id(), template.id(), 1_200)
        .unwrap();

    manager
        .delete_guided_report(project.id(), report.id(), 1_300)
        .unwrap();
    assert!(
        manager
            .list_guided_reports(project.id(), 1_400)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        manager
            .delete_guided_report(project.id(), report.id(), 1_500)
            .unwrap_err()
            .code(),
        LifecycleErrorCode::DocumentNotFound
    );

    let restored = manager
        .restore_guided_report(project.id(), report.id(), 1_600)
        .unwrap();
    assert_eq!(restored, report);

    manager.lock_project(project.id()).unwrap();
    assert_eq!(
        manager
            .delete_guided_report(project.id(), report.id(), 1_700)
            .unwrap_err()
            .code(),
        LifecycleErrorCode::ProjectLocked
    );
}

#[test]
fn guided_report_numbers_use_template_prefixes_and_are_never_reused() {
    let directory = TestDirectory::new();
    let keys = FakeKeyStore::default();
    let mut manager = ProjectManager::new(directory.0.clone(), keys.clone()).unwrap();
    let project = manager.create_project("Report numbering", 1_000).unwrap();
    let templates = manager.list_report_templates(project.id(), 1_100).unwrap();
    let expected = [
        ("Threat Actor Profile", "TAP-0001"),
        ("Intrusion Analysis", "IA-0001"),
        ("Campaign Report", "CR-0001"),
        ("Executive Report", "ER-0001"),
        ("Blank Guided Report", "RPT-0001"),
        ("Illicit Ecosystem Report", "IER-0001"),
    ];
    for (offset, (template_name, expected_number)) in expected.into_iter().enumerate() {
        let template = templates
            .iter()
            .find(|template| template.name() == template_name)
            .unwrap();
        let report = manager
            .create_guided_report(
                project.id(),
                template.id(),
                1_200 + i64::try_from(offset).unwrap() * 100,
            )
            .unwrap();
        assert_eq!(
            report.fields().get("report_number"),
            Some(&GuidedReportFieldValue::Text(expected_number.to_owned()))
        );
        assert_eq!(report.revision(), Revision::new(1).unwrap());
    }

    let campaign = templates
        .iter()
        .find(|template| template.name() == "Campaign Report")
        .unwrap();
    let second = manager
        .create_guided_report(project.id(), campaign.id(), 1_800)
        .unwrap();
    assert_eq!(
        second.fields().get("report_number"),
        Some(&GuidedReportFieldValue::Text("CR-0002".to_owned()))
    );

    manager
        .delete_guided_report(project.id(), second.id(), 1_900)
        .unwrap();
    manager.lock_project(project.id()).unwrap();
    drop(manager);

    let mut reopened = ProjectManager::new(directory.0.clone(), keys).unwrap();
    reopened.unlock_project(project.id(), 2_000).unwrap();
    let third = reopened
        .create_guided_report(project.id(), campaign.id(), 2_100)
        .unwrap();
    assert_eq!(
        third.fields().get("report_number"),
        Some(&GuidedReportFieldValue::Text("CR-0003".to_owned()))
    );
    assert_eq!(third.revision(), Revision::new(1).unwrap());
}
