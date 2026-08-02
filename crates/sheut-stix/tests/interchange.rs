use serde_json::json;
use sheut_core::{LocalId, SemanticRelationshipDraft};
use sheut_stix::{
    DuplicateDecision, ExistingStixObject, StixDraft, StixErrorCode, commit_draft_export,
    commit_existing_export, commit_import, commit_project_export, parse_bundle,
    preview_draft_export, preview_existing_export, preview_import, preview_project_export,
    supported_object_types,
};

const EXISTING_LOCAL_ID: &str = "019b0dc2-34c8-7c31-a2e5-c447222ce0b9";
const INDICATOR_ID: &str = "indicator--e7c44850-9f67-4d26-b7e3-0d4ee82339ef";
const OASIS_APT1: &[u8] = include_bytes!("fixtures/apt1.json");

fn indicator(pattern: &str) -> serde_json::Value {
    json!({
        "type": "indicator",
        "spec_version": "2.1",
        "id": INDICATOR_ID,
        "created": "2020-01-01T00:00:00.000Z",
        "modified": "2020-01-01T00:00:00.000Z",
        "pattern": pattern,
        "pattern_type": "stix",
        "valid_from": "2020-01-01T00:00:00.000Z",
        "x_sheut_score": 73
    })
}

fn bundle(objects: Vec<serde_json::Value>) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "type": "bundle",
        "id": "bundle--d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
        "objects": objects
    }))
    .unwrap()
}

#[test]
fn valid_stix_21_preserves_custom_properties() {
    let parsed = parse_bundle(&bundle(vec![indicator(
        "[domain-name:value = 'evil.example']",
    )]))
    .unwrap();

    assert_eq!(parsed.objects().len(), 1);
    assert_eq!(parsed.objects()[0].raw()["x_sheut_score"], 73);
    assert_eq!(parsed.objects()[0].stix_id(), INDICATOR_ID);
}

#[test]
fn stix_20_invalid_patterns_and_untrusted_limits_fail_closed() {
    let stix_20 = bundle(vec![json!({
        "type": "ipv4-addr",
        "id": "ipv4-addr--d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
        "value": "198.51.100.4"
    })]);
    assert_eq!(
        parse_bundle(&stix_20).unwrap_err().code(),
        StixErrorCode::UnsupportedSpecVersion
    );

    let invalid_pattern = bundle(vec![indicator("[domain-name:value = ]")]);
    assert_eq!(
        parse_bundle(&invalid_pattern).unwrap_err().code(),
        StixErrorCode::ValidationFailed
    );

    let mut nested = json!("leaf");
    for _ in 0..70 {
        nested = json!({"x": nested});
    }
    let too_deep = bundle(vec![json!({
        "type": "x-test",
        "spec_version": "2.1",
        "id": "x-test--e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
        "x_nested": nested
    })]);
    assert_eq!(
        parse_bundle(&too_deep).unwrap_err().code(),
        StixErrorCode::LimitExceeded
    );
}

#[test]
fn relationship_endpoints_still_require_domain_or_observable_objects() {
    let invalid = bundle(vec![json!({
        "type": "relationship",
        "spec_version": "2.1",
        "id": "relationship--c733c22a-d4d9-4664-9f58-21c688cd3c4b",
        "created": "2020-01-01T00:00:00.000Z",
        "modified": "2020-01-01T00:00:00.000Z",
        "relationship_type": "related-to",
        "source_ref": "relationship--6598bf44-1c10-4218-af9f-75b5b71c23a7",
        "target_ref": INDICATOR_ID
    })]);

    assert_eq!(
        parse_bundle(&invalid).unwrap_err().code(),
        StixErrorCode::ValidationFailed
    );
}

#[test]
fn duplicate_import_requires_an_explicit_commit_decision() {
    let mut existing_raw = indicator("[domain-name:value = 'old.example']");
    existing_raw["x_existing"] = json!(true);
    let mut incoming_raw = indicator("[domain-name:value = 'new.example']");
    incoming_raw["x_incoming"] = json!(true);
    let existing =
        ExistingStixObject::new(LocalId::parse(EXISTING_LOCAL_ID).unwrap(), existing_raw).unwrap();
    let preview = preview_import(
        parse_bundle(&bundle(vec![incoming_raw])).unwrap(),
        std::slice::from_ref(&existing),
    )
    .unwrap();
    assert_eq!(preview.duplicates(), 1);
    assert_eq!(
        commit_import(&preview, &[]).unwrap_err().code(),
        StixErrorCode::DuplicateDecisionRequired
    );
    assert_eq!(
        commit_import(&preview, &[DuplicateDecision::Cancel])
            .unwrap_err()
            .code(),
        StixErrorCode::Cancelled
    );

    let merged = commit_import(&preview, &[DuplicateDecision::MergeSupportedFields]).unwrap();
    assert_eq!(merged.upserts().len(), 1);
    assert_eq!(merged.upserts()[0].local_id(), existing.local_id());
    assert_eq!(merged.upserts()[0].raw()["x_existing"], true);
    assert_eq!(merged.upserts()[0].raw()["x_incoming"], true);

    let kept = commit_import(&preview, &[DuplicateDecision::KeepExisting]).unwrap();
    assert!(kept.upserts().is_empty());
    assert_eq!(kept.skipped(), 1);

    let replaced = commit_import(&preview, &[DuplicateDecision::ReplaceVersion]).unwrap();
    assert_eq!(replaced.upserts()[0].local_id(), existing.local_id());
    assert_eq!(
        replaced.upserts()[0].raw()["pattern"],
        "[domain-name:value = 'new.example']"
    );
}

#[test]
fn imported_custom_properties_round_trip_semantically() {
    let raw = indicator("[domain-name:value = 'evil.example']");
    let imported =
        ExistingStixObject::new(LocalId::parse(EXISTING_LOCAL_ID).unwrap(), raw.clone()).unwrap();

    let preview = preview_existing_export(&[imported]).unwrap();
    let committed = commit_existing_export(&preview).unwrap();
    let reparsed = parse_bundle(committed.bytes()).unwrap();

    assert_eq!(reparsed.objects()[0].raw(), &raw);
    assert!(committed.generated_ids().is_empty());
}

#[test]
fn project_export_combines_imported_objects_and_valid_drafts() {
    let existing = ExistingStixObject::new(
        LocalId::parse(EXISTING_LOCAL_ID).unwrap(),
        indicator("[domain-name:value = 'existing.example']"),
    )
    .unwrap();
    let draft = StixDraft::new(
        LocalId::parse("d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb").unwrap(),
        "domain-name",
        json!({"value": "draft.example"}),
    )
    .unwrap();
    let draft_local_id = draft.local_id();

    let preview = preview_project_export(&[existing], &[draft]).unwrap();
    assert_eq!(preview.object_count(), 2);
    let committed = commit_project_export(&preview).unwrap();
    let parsed = parse_bundle(committed.bytes()).unwrap();

    assert_eq!(parsed.objects().len(), 2);
    assert_eq!(committed.generated_ids().len(), 1);
    let promoted = committed.generated_objects().unwrap();
    assert_eq!(promoted.len(), 1);
    assert_eq!(promoted[0].local_id(), draft_local_id);
    assert_eq!(
        promoted[0].stix_id(),
        committed.generated_ids()[0].stix_id()
    );
    assert!(
        parsed
            .objects()
            .iter()
            .any(|object| object.raw()["value"] == "draft.example")
    );
}

#[test]
fn revision_draft_replaces_the_committed_version_and_preserves_its_stix_id() {
    let existing = ExistingStixObject::new(
        LocalId::parse(EXISTING_LOCAL_ID).unwrap(),
        indicator("[domain-name:value = 'old.example']"),
    )
    .unwrap();
    let mut revised_properties = existing.raw().as_object().unwrap().clone();
    for reserved in ["type", "spec_version", "id"] {
        revised_properties.remove(reserved);
    }
    revised_properties.insert("modified".to_owned(), json!("2020-01-02T00:00:00.000Z"));
    revised_properties.insert(
        "pattern".to_owned(),
        json!("[domain-name:value = 'revised.example']"),
    );
    let draft = StixDraft::new_revision(
        &existing,
        serde_json::Value::Object(revised_properties),
        None,
    )
    .unwrap();

    assert_eq!(draft.local_id(), existing.local_id());
    assert_eq!(draft.replaces_stix_id(), Some(existing.stix_id()));
    assert!(!draft.properties().contains_key("id"));

    let preview = preview_project_export(std::slice::from_ref(&existing), &[draft]).unwrap();
    assert_eq!(preview.object_count(), 1);
    let committed = commit_project_export(&preview).unwrap();
    let parsed = parse_bundle(committed.bytes()).unwrap();

    assert_eq!(parsed.objects().len(), 1);
    assert_eq!(parsed.objects()[0].stix_id(), INDICATOR_ID);
    assert_eq!(
        parsed.objects()[0].raw()["pattern"],
        "[domain-name:value = 'revised.example']"
    );
    assert_eq!(committed.generated_ids()[0].stix_id(), INDICATOR_ID);
}

#[test]
fn relationship_drafts_resolve_stable_local_endpoints_only_during_export() {
    let source = StixDraft::new(
        LocalId::parse("e7c44850-9f67-4d26-b7e3-0d4ee82339ef").unwrap(),
        "domain-name",
        json!({"value": "example.test"}),
    )
    .unwrap();
    let target = StixDraft::new(
        LocalId::parse("d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb").unwrap(),
        "ipv4-addr",
        json!({"value": "198.51.100.4"}),
    )
    .unwrap();
    let semantic =
        SemanticRelationshipDraft::new(source.local_id(), target.local_id(), "resolves-to")
            .unwrap();
    let relationship = StixDraft::new_relationship(
        LocalId::parse("6f9619ff-8b86-d011-b42d-00cf4fc964ff").unwrap(),
        semantic,
        json!({
            "created": "2020-01-01T00:00:00.000Z",
            "modified": "2020-01-01T00:00:00.000Z",
            "description": "DNS observation"
        }),
    )
    .unwrap();

    let preview = preview_project_export(&[], &[source, target, relationship]).unwrap();
    let committed = commit_project_export(&preview).unwrap();
    let parsed = parse_bundle(committed.bytes()).unwrap();
    let relationship = parsed
        .objects()
        .iter()
        .find(|object| object.object_type() == "relationship")
        .unwrap();

    assert_eq!(relationship.raw()["relationship_type"], "resolves-to");
    assert!(
        relationship.raw()["source_ref"]
            .as_str()
            .unwrap()
            .starts_with("domain-name--")
    );
    assert!(
        relationship.raw()["target_ref"]
            .as_str()
            .unwrap()
            .starts_with("ipv4-addr--")
    );
}

#[test]
fn export_preview_has_no_stix_ids_and_commit_generates_a_valid_bundle() {
    let draft = StixDraft::new(
        LocalId::parse(EXISTING_LOCAL_ID).unwrap(),
        "indicator",
        json!({
            "created": "2020-01-01T00:00:00.000Z",
            "modified": "2020-01-01T00:00:00.000Z",
            "pattern": "[domain-name:value = 'evil.example']",
            "pattern_type": "stix",
            "valid_from": "2020-01-01T00:00:00.000Z"
        }),
    )
    .unwrap();
    let preview = preview_draft_export(&[draft]).unwrap();
    assert_eq!(preview.object_count(), 1);

    let committed = commit_draft_export(&preview).unwrap();
    let value: serde_json::Value = serde_json::from_slice(committed.bytes()).unwrap();
    assert!(value["id"].as_str().unwrap().starts_with("bundle--"));
    assert!(
        value["objects"][0]["id"]
            .as_str()
            .unwrap()
            .starts_with("indicator--")
    );
    assert_eq!(committed.generated_ids().len(), 1);
    parse_bundle(committed.bytes()).unwrap();
}

#[test]
fn authored_scos_use_deterministic_stix_uuidv5_ids_without_leaking_local_ids() {
    let first_local_id = LocalId::parse("e7c44850-9f67-4d26-b7e3-0d4ee82339ef").unwrap();
    let second_local_id = LocalId::parse("d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb").unwrap();
    let first = StixDraft::new(
        first_local_id,
        "domain-name",
        json!({"value": "example.test"}),
    )
    .unwrap();
    let second = StixDraft::new(
        second_local_id,
        "domain-name",
        json!({"value": "example.test"}),
    )
    .unwrap();

    let first_export = commit_draft_export(&preview_draft_export(&[first]).unwrap()).unwrap();
    let second_export = commit_draft_export(&preview_draft_export(&[second]).unwrap()).unwrap();
    let first_id = first_export.generated_ids()[0].stix_id();
    let second_id = second_export.generated_ids()[0].stix_id();
    let uuid = uuid::Uuid::parse_str(first_id.split_once("--").unwrap().1).unwrap();

    assert_eq!(uuid.get_version_num(), 5);
    assert_eq!(first_id, second_id);
    assert!(!String::from_utf8_lossy(first_export.bytes()).contains(&first_local_id.to_string()));
}

#[test]
fn supported_type_table_covers_all_built_in_stix_21_types() {
    let types = supported_object_types();
    assert_eq!(types.len(), 42);
    assert!(types.contains(&"indicator"));
    assert!(types.contains(&"note"));
    assert!(types.contains(&"x509-certificate"));
}

#[test]
fn official_oasis_apt1_bundle_is_interoperable() {
    let parsed = parse_bundle(OASIS_APT1).unwrap();

    assert_eq!(parsed.objects().len(), 76);
    assert!(
        parsed
            .objects()
            .iter()
            .any(|object| object.object_type() == "intrusion-set" && object.raw()["name"] == "APT1")
    );
    assert!(
        parsed
            .objects()
            .iter()
            .any(|object| object.object_type() == "relationship")
    );
}
