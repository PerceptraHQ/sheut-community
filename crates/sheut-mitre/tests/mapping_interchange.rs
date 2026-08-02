use sheut_core::{
    AnalyticConfidence, LocalId, MitreCatalog, MitreTechniqueReference, TechniqueAssessment,
    TechniqueObservation, TechniqueOutcome,
};
use sheut_mitre::{
    MAX_MAPPING_FILE_BYTES, MappingErrorCode, export_mapping_file, export_navigator_projection,
    import_mapping_file, preview_navigator_import,
};

fn observation(
    id: &str,
    catalog: MitreCatalog,
    version: &str,
    technique_id: &str,
    tactic_id: Option<&str>,
    narrative: &str,
) -> TechniqueObservation {
    TechniqueObservation::new(
        LocalId::parse(id).expect("test ID is valid"),
        MitreTechniqueReference::new(catalog, version, technique_id, tactic_id)
            .expect("test reference is valid"),
        TechniqueAssessment::Observed,
        TechniqueOutcome::Successful,
        AnalyticConfidence::High,
        narrative,
        Some(1_700_000_000_000),
        Some(1_700_000_100_000),
        1_700_000_200_000,
    )
    .expect("test observation is valid")
}

#[test]
fn sheut_mapping_round_trips_every_observation_field() {
    let observations = vec![observation(
        "018f0000-0000-7000-8000-000000000001",
        MitreCatalog::AttackEnterprise,
        "19.1",
        "T1059",
        Some("TA0002"),
        "Execution was confirmed from local evidence.",
    )];

    let bytes = export_mapping_file(&observations, 1_700_000_300_000)
        .expect("mapping export should succeed");
    let imported = import_mapping_file(&bytes).expect("mapping import should succeed");

    assert_eq!(imported.exported_at_unix_ms(), 1_700_000_300_000);
    assert_eq!(imported.observations(), observations);
}

#[test]
fn mapping_import_is_bounded_versioned_and_rejects_duplicate_local_ids() {
    let duplicate = r#"{
      "format":"sheut-mitre-mapping",
      "formatVersion":1,
      "exportedAtUnixMs":1700000300000,
      "observations":[
        {
          "id":"018f0000-0000-7000-8000-000000000001",
          "reference":{"catalog":"attack_enterprise","version":"19.1","techniqueId":"T1059","tacticId":"TA0002"},
          "assessment":"observed","outcome":"successful","confidence":"high",
          "narrative":"First","firstSeenUnixMs":null,"lastSeenUnixMs":null,
          "revision":1,"createdAtUnixMs":1700000200000,"updatedAtUnixMs":1700000200000
        },
        {
          "id":"018f0000-0000-7000-8000-000000000001",
          "reference":{"catalog":"attack_enterprise","version":"19.1","techniqueId":"T1059","tacticId":"TA0002"},
          "assessment":"suspected","outcome":"unknown","confidence":"low",
          "narrative":"Second","firstSeenUnixMs":null,"lastSeenUnixMs":null,
          "revision":1,"createdAtUnixMs":1700000200000,"updatedAtUnixMs":1700000200000
        }
      ]
    }"#;
    assert_eq!(
        import_mapping_file(duplicate.as_bytes())
            .expect_err("duplicate IDs must fail")
            .code(),
        MappingErrorCode::InvalidMapping
    );

    let oversized = vec![b' '; MAX_MAPPING_FILE_BYTES + 1];
    assert_eq!(
        import_mapping_file(&oversized)
            .expect_err("oversized mappings must fail")
            .code(),
        MappingErrorCode::LimitExceeded
    );
}

#[test]
fn navigator_projection_is_catalog_specific_and_import_is_only_a_preview() {
    let catalog =
        sheut_mitre::catalog(MitreCatalog::AttackEnterprise).expect("bundled catalog should load");
    let observations = vec![observation(
        "018f0000-0000-7000-8000-000000000002",
        MitreCatalog::AttackEnterprise,
        "19.1",
        "T1059",
        Some("TA0002"),
        "Command execution was observed.",
    )];

    let bytes = export_navigator_projection("Operation Northwind", catalog, &observations)
        .expect("Navigator projection should succeed");
    let value: serde_json::Value = serde_json::from_slice(&bytes).expect("valid JSON");
    assert_eq!(value["domain"], "enterprise-attack");
    assert_eq!(value["versions"]["layer"], "4.5");
    assert_eq!(value["techniques"][0]["techniqueID"], "T1059");
    assert_eq!(value["techniques"][0]["tactic"], "execution");
    assert_eq!(
        value["techniques"][0]["metadata"][0]["name"],
        "Sheut observations"
    );

    let preview =
        preview_navigator_import(&bytes, catalog).expect("the generated projection should preview");
    assert_eq!(preview.catalog(), MitreCatalog::AttackEnterprise);
    assert_eq!(preview.entries().len(), 1);
    assert_eq!(preview.entries()[0].reference().technique_id(), "T1059");
    assert_eq!(
        preview.entries()[0].comment(),
        "Command execution was observed."
    );
}

#[test]
fn navigator_projection_bounds_aggregated_comments_and_points_to_lossless_mapping() {
    let catalog =
        sheut_mitre::catalog(MitreCatalog::AttackEnterprise).expect("bundled catalog should load");
    let observations = vec![
        observation(
            "018f0000-0000-7000-8000-000000000003",
            MitreCatalog::AttackEnterprise,
            "19.1",
            "T1059",
            Some("TA0002"),
            &"A".repeat(3_000),
        ),
        observation(
            "018f0000-0000-7000-8000-000000000004",
            MitreCatalog::AttackEnterprise,
            "19.1",
            "T1059",
            Some("TA0002"),
            &"B".repeat(3_000),
        ),
    ];

    let bytes = export_navigator_projection("Bounded projection", catalog, &observations)
        .expect("projection should stay exportable");
    let preview = preview_navigator_import(&bytes, catalog)
        .expect("an exported projection must remain importable");
    let comment = preview.entries()[0].comment();
    assert!(comment.chars().count() <= 4_000);
    assert!(comment.contains("lossless Sheut mapping"));
}

#[test]
fn navigator_import_accepts_official_atlas_shape_and_rejects_domain_mismatch() {
    let atlas = sheut_mitre::catalog(MitreCatalog::Atlas).expect("bundled catalog should load");
    let layer = br#"{
      "name":"ATLAS assessment",
      "versions":{"navigator":"4.6.4","layer":"4.3"},
      "domain":"atlas-atlas",
      "techniques":[{"techniqueID":"AML.T0000","comment":"Reviewed locally"}]
    }"#;
    let preview = preview_navigator_import(layer, atlas).expect("ATLAS 4.3 layer should preview");
    assert_eq!(preview.catalog(), MitreCatalog::Atlas);
    assert_eq!(preview.entries().len(), 1);

    let enterprise =
        sheut_mitre::catalog(MitreCatalog::AttackEnterprise).expect("bundled catalog should load");
    assert_eq!(
        preview_navigator_import(layer, enterprise)
            .expect_err("domain mismatch must fail")
            .code(),
        MappingErrorCode::InvalidNavigatorLayer
    );
}
