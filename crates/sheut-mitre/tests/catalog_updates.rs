use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{Value, json};
use sheut_core::MitreCatalog;
use sheut_mitre::{
    CatalogOrigin, CatalogStore, MAX_MITRE_SOURCE_BYTES, MitreCatalogErrorCode,
    compile_official_catalog,
};

struct TestDirectory(PathBuf);

static NEXT_TEST_DIRECTORY: AtomicU64 = AtomicU64::new(0);

impl TestDirectory {
    fn new() -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let sequence = NEXT_TEST_DIRECTORY.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "sheut-mitre-catalog-test-{}-{nonce}-{sequence}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn source_bundle(version: &str) -> Value {
    json!({
        "type": "bundle",
        "id": "bundle--40f9f7b3-e1b2-45a3-9e20-bdd1f8118a53",
        "objects": [
            {
                "type": "x-mitre-collection",
                "spec_version": "2.1",
                "name": "Enterprise ATT&CK",
                "x_mitre_version": version
            },
            {
                "type": "x-mitre-matrix",
                "spec_version": "2.1",
                "id": "x-mitre-matrix--40f9f7b3-e1b2-45a3-9e20-bdd1f8118a54",
                "name": "Enterprise ATT&CK",
                "tactic_refs": [
                    "x-mitre-tactic--40f9f7b3-e1b2-45a3-9e20-bdd1f8118a56",
                    "x-mitre-tactic--40f9f7b3-e1b2-45a3-9e20-bdd1f8118a55"
                ]
            },
            {
                "type": "x-mitre-tactic",
                "spec_version": "2.1",
                "id": "x-mitre-tactic--40f9f7b3-e1b2-45a3-9e20-bdd1f8118a55",
                "name": "Execution",
                "description": "Run adversary-controlled code.",
                "x_mitre_shortname": "execution",
                "external_references": [
                    { "source_name": "mitre-attack", "external_id": "TA0002" }
                ]
            },
            {
                "type": "x-mitre-tactic",
                "spec_version": "2.1",
                "id": "x-mitre-tactic--40f9f7b3-e1b2-45a3-9e20-bdd1f8118a56",
                "name": "Reconnaissance",
                "description": "Gather information for targeting.",
                "x_mitre_shortname": "reconnaissance",
                "external_references": [
                    { "source_name": "mitre-attack", "external_id": "TA0043" }
                ]
            },
            {
                "type": "attack-pattern",
                "spec_version": "2.1",
                "name": "Command and Scripting Interpreter",
                "description": "Use command interpreters.",
                "kill_chain_phases": [
                    { "kill_chain_name": "mitre-attack", "phase_name": "execution" }
                ],
                "x_mitre_platforms": ["Linux", "Windows"],
                "external_references": [
                    { "source_name": "mitre-attack", "external_id": "T1059" }
                ]
            },
            {
                "type": "attack-pattern",
                "spec_version": "2.1",
                "name": "PowerShell",
                "description": "Use PowerShell.",
                "kill_chain_phases": [
                    { "kill_chain_name": "mitre-attack", "phase_name": "execution" }
                ],
                "x_mitre_platforms": ["Windows"],
                "external_references": [
                    { "source_name": "mitre-attack", "external_id": "T1059.001" }
                ]
            }
        ]
    })
}

#[test]
fn official_stix_bundle_compiles_to_a_bounded_catalog_snapshot() {
    let payload = serde_json::to_vec(&source_bundle("20.0")).unwrap();

    let snapshot = compile_official_catalog(&payload).unwrap();

    assert_eq!(snapshot.catalog(), MitreCatalog::AttackEnterprise);
    assert_eq!(snapshot.version(), "20.0");
    assert_eq!(snapshot.tactics().len(), 2);
    assert_eq!(snapshot.tactics()[0].id(), "TA0043");
    assert_eq!(snapshot.tactics()[1].id(), "TA0002");
    assert_eq!(snapshot.techniques().len(), 2);
    assert_eq!(snapshot.techniques()[1].id(), "T1059.001");
    assert_eq!(snapshot.techniques()[1].tactic_ids(), &["TA0002"]);
    assert_eq!(snapshot.source().sha256().len(), 64);
    assert_eq!(
        snapshot.source().url(),
        "https://github.com/mitre-attack/attack-stix-data/releases/download/v20.0/enterprise-attack.json"
    );
}

#[test]
fn catalog_compiler_rejects_non_stix_21_and_oversized_sources() {
    let mut bundle = source_bundle("20.0");
    bundle["objects"][1]["spec_version"] = json!("2.0");
    let error = compile_official_catalog(&serde_json::to_vec(&bundle).unwrap()).unwrap_err();
    assert_eq!(error.code(), MitreCatalogErrorCode::InvalidCatalog);

    let oversized = vec![b' '; MAX_MITRE_SOURCE_BYTES + 1];
    let error = compile_official_catalog(&oversized).unwrap_err();
    assert_eq!(error.code(), MitreCatalogErrorCode::LimitExceeded);
}

#[test]
fn catalog_store_installs_reopens_and_restores_the_bundled_snapshot() {
    let directory = TestDirectory::new();
    let store = CatalogStore::new(directory.path()).unwrap();
    let snapshot =
        compile_official_catalog(&serde_json::to_vec(&source_bundle("20.0")).unwrap()).unwrap();

    assert_eq!(
        store
            .status(MitreCatalog::AttackEnterprise)
            .unwrap()
            .origin(),
        CatalogOrigin::Bundled
    );
    store.install(&snapshot).unwrap();

    let reopened = CatalogStore::new(directory.path()).unwrap();
    assert_eq!(
        reopened
            .active(MitreCatalog::AttackEnterprise)
            .unwrap()
            .version(),
        "20.0"
    );
    assert_eq!(
        reopened
            .status(MitreCatalog::AttackEnterprise)
            .unwrap()
            .origin(),
        CatalogOrigin::LocalFile
    );

    let installed_path = fs::read_dir(directory.path())
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    fs::write(installed_path, b"corrupt catalog update").unwrap();
    assert_eq!(
        reopened
            .active(MitreCatalog::AttackEnterprise)
            .unwrap()
            .version(),
        "19.1"
    );

    reopened.install(&snapshot).unwrap();
    reopened.reset(MitreCatalog::AttackEnterprise).unwrap();
    assert_eq!(
        reopened
            .active(MitreCatalog::AttackEnterprise)
            .unwrap()
            .version(),
        "19.1"
    );
}

#[test]
fn legacy_compiled_catalog_order_falls_back_to_the_corrected_bundle() {
    let directory = TestDirectory::new();
    let store = CatalogStore::new(directory.path()).unwrap();
    let snapshot =
        compile_official_catalog(&serde_json::to_vec(&source_bundle("20.0")).unwrap()).unwrap();
    store.install(&snapshot).unwrap();
    let installed_path = fs::read_dir(directory.path())
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let mut installation: Value =
        serde_json::from_slice(&fs::read(&installed_path).unwrap()).unwrap();
    installation["schemaVersion"] = json!(1);
    fs::write(installed_path, serde_json::to_vec(&installation).unwrap()).unwrap();

    let active = store.active(MitreCatalog::AttackEnterprise).unwrap();
    assert_eq!(active.version(), "19.1");
    assert_eq!(active.tactics()[0].name(), "Reconnaissance");
}
