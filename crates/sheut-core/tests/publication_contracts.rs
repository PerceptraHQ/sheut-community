use sheut_core::{
    BrandAssetRole, BrandProfile, BrandProfileInput, BrandTypeface, BuiltinReportTemplate,
    ContentDensity, CoverTreatment, EvidenceFileMetadata, EvidenceMetadataInput, GuidedReport,
    GuidedReportFieldValue, LocalId, PageFurniture, PageOrientation, PaperSize, ProjectMetadata,
    PublicationFormat, PublicationRecord, PublicationReleaseEntry, PublicationSettings,
    PublicationSnapshot, PublicationSource, PublicationStatus, ReportSectionDisposition, Revision,
    SectionTreatment, TableTreatment, TlpMarking, built_in_report_templates,
    report_template_catalog, report_template_revision,
};

fn id(value: &str) -> LocalId {
    LocalId::parse(value).unwrap()
}

#[test]
fn illicit_ecosystem_catalog_exposes_revision_four_guidance_and_preserves_old_revisions() {
    let template = report_template_catalog()
        .into_iter()
        .find(|template| template.name() == "Illicit Ecosystem Report")
        .unwrap();
    assert_eq!(template.builtin(), None);
    assert_eq!(template.revision(), Revision::new(4).unwrap());
    let sections = template
        .sections()
        .iter()
        .map(|section| section.key())
        .collect::<Vec<_>>();
    assert_eq!(
        sections,
        [
            "report_administration",
            "executive_summary",
            "key_findings",
            "scope_methodology_source_handling",
            "assessment",
            "intelligence_gaps",
            "intelligence_requirements",
            "timeline",
            "ecosystem_actor_overview",
            "identities_roles",
            "social_profiles",
            "site_inventory",
            "infrastructure",
            "certificates",
            "relationships_supporting_evidence",
            "media_file_evidence",
            "indicators_observables",
            "attack_mappings",
            "detections",
            "recommended_actions",
            "evidence_appendix",
        ]
    );
    assert!(
        template.sections().iter().all(|section| !section
            .title()
            .chars()
            .next()
            .is_some_and(char::is_numeric))
    );
    assert!(template.sections().iter().all(|section| {
        section
            .guidance()
            .is_some_and(|text| !text.trim().is_empty())
    }));

    let intelligence_gaps = template
        .sections()
        .iter()
        .find(|section| section.key() == "intelligence_gaps")
        .unwrap();
    assert_eq!(intelligence_gaps.title(), "Intelligence gaps");
    assert_eq!(
        intelligence_gaps
            .fields()
            .iter()
            .find(|field| field.key() == "legacy_intelligence_gaps")
            .unwrap()
            .label(),
        "Intelligence gaps narrative"
    );

    let historical = report_template_revision(template.id(), Revision::new(3).unwrap()).unwrap();
    let historical_intelligence_gaps = historical
        .sections()
        .iter()
        .find(|section| section.key() == "intelligence_gaps")
        .unwrap();
    assert_eq!(
        historical_intelligence_gaps.title(),
        "Key Intelligence Gaps"
    );
    assert_eq!(
        historical_intelligence_gaps
            .fields()
            .iter()
            .find(|field| field.key() == "legacy_intelligence_gaps")
            .unwrap()
            .label(),
        "Legacy intelligence gaps narrative"
    );

    let administration = template
        .sections()
        .iter()
        .find(|section| section.key() == "report_administration")
        .unwrap();
    let report_number = administration
        .fields()
        .iter()
        .find(|field| field.key() == "report_number")
        .unwrap();
    assert_eq!(report_number.label(), "Report ID");
    assert!(report_number.required());
    let authors = administration
        .fields()
        .iter()
        .find(|field| field.key() == "authors")
        .unwrap();
    assert_eq!(authors.label(), "Authors");
    let producing_organisation = administration
        .fields()
        .iter()
        .find(|field| field.key() == "producing_organization")
        .unwrap();
    assert_eq!(producing_organisation.label(), "Producing organisation");
    assert!(
        administration
            .fields()
            .iter()
            .all(|field| field.key() != "report_status"),
        "publication status belongs to the publication snapshot"
    );

    let scope = template
        .sections()
        .iter()
        .find(|section| section.key() == "scope_methodology_source_handling")
        .unwrap();
    assert_eq!(scope.fields()[0].key(), "purpose_scope");
    assert_eq!(scope.fields()[0].label(), scope.title());

    let assessment = template
        .sections()
        .iter()
        .find(|section| section.key() == "assessment")
        .unwrap();
    assert_eq!(assessment.fields()[0].key(), "overall_assessment");
    assert_eq!(assessment.fields()[0].label(), assessment.title());

    let revision_one = report_template_revision(template.id(), Revision::new(1).unwrap()).unwrap();
    let revision_two = report_template_revision(template.id(), Revision::new(2).unwrap()).unwrap();
    let revision_three =
        report_template_revision(template.id(), Revision::new(3).unwrap()).unwrap();
    assert_eq!(revision_two.revision(), Revision::new(2).unwrap());
    assert_eq!(revision_three.revision(), Revision::new(3).unwrap());
    let revision_one_sections = revision_one
        .sections()
        .iter()
        .map(|section| section.key())
        .collect::<Vec<_>>();
    for legacy_key in [
        "site_inventory",
        "infrastructure",
        "certificates",
        "identities",
        "social_profiles",
        "media_evidence",
        "relationships_evidence",
        "evidence_appendix",
    ] {
        assert!(revision_one_sections.contains(&legacy_key));
    }

    let social_profiles = template
        .sections()
        .iter()
        .find(|section| section.key() == "social_profiles")
        .unwrap();
    assert_eq!(
        social_profiles.fields()[0].columns(),
        [
            "Platform",
            "Handle",
            "Profile URL or platform identifier",
            "First observed",
            "Last observed",
            "Observed purpose",
            "Linked identities",
            "Linked websites",
            "Relevant posts or comments",
            "Control or ownership confidence",
            "Current status",
            "Preservation status",
            "Evidence references",
        ]
    );
    let media_evidence = template
        .sections()
        .iter()
        .find(|section| section.key() == "media_file_evidence")
        .unwrap();
    assert!(
        media_evidence.fields()[0]
            .columns()
            .contains(&"SHA-256".to_owned())
    );
}

#[test]
fn every_current_report_template_exposes_a_report_id_field() {
    for template in report_template_catalog() {
        let report_id_fields = template
            .sections()
            .iter()
            .flat_map(|section| section.fields())
            .filter(|field| field.key() == "report_number")
            .collect::<Vec<_>>();
        assert_eq!(
            report_id_fields.len(),
            1,
            "{} must expose exactly one Report ID field",
            template.name()
        );
        assert_eq!(report_id_fields[0].label(), "Report ID");
    }
}

#[test]
fn illicit_ecosystem_upgrade_is_explicit_revisioned_and_preserves_source_content() {
    let template_id = id("6fba43e4-fcac-5b12-b37a-17aa0d4e99ca");
    let old_template = report_template_revision(template_id, Revision::new(1).unwrap()).unwrap();
    let current_template =
        report_template_revision(template_id, Revision::new(4).unwrap()).unwrap();
    let report = GuidedReport::new_blank(
        id("e7c44850-9f67-4d26-b7e3-0d4ee82339ef"),
        &old_template,
        1_000,
    )
    .unwrap()
    .revise_fields(
        &old_template,
        Revision::new(1).unwrap(),
        "Example Illicit Ecosystem",
        BTreeMap::from([
            (
                "key_points".to_owned(),
                GuidedReportFieldValue::Narrative(serde_json::json!({
                    "type": "doc",
                    "content": [{
                        "type": "paragraph",
                        "content": [{"type": "text", "text": "Supported finding"}]
                    }]
                })),
            ),
            (
                "campaign_name".to_owned(),
                GuidedReportFieldValue::Text("Legacy campaign label".to_owned()),
            ),
        ]),
        2_000,
    )
    .unwrap();

    let upgraded = report
        .upgrade_illicit_ecosystem_template(
            &old_template,
            &current_template,
            Some("IER-0042"),
            Revision::new(2).unwrap(),
            3_000,
        )
        .unwrap();

    assert_eq!(upgraded.revision(), Revision::new(3).unwrap());
    assert_eq!(upgraded.template_revision(), Revision::new(4).unwrap());
    assert_eq!(
        upgraded.fields().get("report_number"),
        Some(&GuidedReportFieldValue::Text("IER-0042".to_owned()))
    );
    assert_eq!(
        upgraded.fields().get("key_findings"),
        report.fields().get("key_points")
    );
    assert!(matches!(
        upgraded.fields().get("additional_metadata"),
        Some(GuidedReportFieldValue::Rows(rows))
            if rows.iter().any(|row| row.get("Value").is_some_and(|value| value == "Legacy campaign label"))
    ));
    assert_eq!(
        report.template_revision(),
        Revision::new(1).unwrap(),
        "upgrading must not mutate the historical source revision"
    );

    let externally_numbered = report
        .revise_field(
            Revision::new(2).unwrap(),
            "report_number",
            GuidedReportFieldValue::Text("CASE-77".to_owned()),
            2_500,
        )
        .unwrap()
        .upgrade_illicit_ecosystem_template(
            &old_template,
            &current_template,
            Some("IER-0099"),
            Revision::new(3).unwrap(),
            3_500,
        )
        .unwrap();
    assert_eq!(
        externally_numbered.fields().get("report_number"),
        Some(&GuidedReportFieldValue::Text("CASE-77".to_owned()))
    );
}

#[test]
fn illicit_revision_three_upgrade_preserves_prose_dispositions_and_retired_metadata() {
    let template_id = id("6fba43e4-fcac-5b12-b37a-17aa0d4e99ca");
    let source_template = report_template_revision(template_id, Revision::new(3).unwrap()).unwrap();
    let target_template = report_template_revision(template_id, Revision::new(4).unwrap()).unwrap();
    let prose = serde_json::json!({
        "type": "doc",
        "content": [{
            "type": "paragraph",
            "content": [{"type": "text", "text": "Analyst-authored prose remains byte-for-byte structured JSON."}]
        }]
    });
    let report = GuidedReport::new_blank(
        id("e7c44850-9f67-4d26-b7e3-0d4ee82339ef"),
        &source_template,
        1_000,
    )
    .unwrap()
    .revise_fields(
        &source_template,
        Revision::new(1).unwrap(),
        "Example Illicit Ecosystem",
        BTreeMap::from([
            (
                "overall_assessment".to_owned(),
                GuidedReportFieldValue::Narrative(prose.clone()),
            ),
            (
                "report_status".to_owned(),
                GuidedReportFieldValue::Text("Final".to_owned()),
            ),
        ]),
        2_000,
    )
    .unwrap()
    .revise_section_disposition(
        &source_template,
        Revision::new(2).unwrap(),
        "attack_mappings",
        ReportSectionDisposition::NotApplicable,
        3_000,
    )
    .unwrap();

    let upgraded = report
        .upgrade_illicit_ecosystem_template(
            &source_template,
            &target_template,
            None,
            Revision::new(3).unwrap(),
            4_000,
        )
        .unwrap();

    assert_eq!(upgraded.template_revision(), Revision::new(4).unwrap());
    assert_eq!(
        upgraded.fields().get("overall_assessment"),
        Some(&GuidedReportFieldValue::Narrative(prose))
    );
    assert_eq!(
        upgraded.section_disposition("attack_mappings"),
        ReportSectionDisposition::NotApplicable
    );
    assert!(matches!(
        upgraded.fields().get("additional_metadata"),
        Some(GuidedReportFieldValue::Rows(rows))
            if rows.iter().any(|row| {
                row.get("Label").is_some_and(|value| value == "Legacy report_status")
                    && row.get("Value").is_some_and(|value| value == "Final")
            })
    ));
}

#[test]
fn guided_report_section_dispositions_are_validated_and_not_applicable_is_not_incomplete() {
    let template = report_template_catalog()
        .into_iter()
        .find(|template| template.name() == "Illicit Ecosystem Report")
        .unwrap();
    let report =
        GuidedReport::new_blank(id("e7c44850-9f67-4d26-b7e3-0d4ee82339ef"), &template, 1_000)
            .unwrap();

    let revised = report
        .revise_section_disposition(
            &template,
            Revision::new(1).unwrap(),
            "attack_mappings",
            ReportSectionDisposition::NotApplicable,
            2_000,
        )
        .unwrap();

    assert_eq!(
        revised.section_disposition("attack_mappings"),
        ReportSectionDisposition::NotApplicable
    );
    assert!(
        revised
            .readiness_warnings(&template)
            .iter()
            .all(|issue| issue.field_key() != "attack_mappings")
    );
    assert!(
        report
            .revise_section_disposition(
                &template,
                Revision::new(1).unwrap(),
                "executive_summary",
                ReportSectionDisposition::NotApplicable,
                2_000,
            )
            .is_err(),
        "required sections cannot be marked not applicable"
    );
}

#[test]
fn evidence_files_are_bounded_project_assets_with_integrity_metadata() {
    let evidence = EvidenceFileMetadata::new(
        id("04c230e7-e13f-4f68-a8b4-da72a31bcb13"),
        "application/zip",
        "evidence.png",
        1_024,
        "a".repeat(64),
        1_000,
    )
    .unwrap();

    assert_eq!(evidence.file_name(), "evidence.png");
    assert_eq!(evidence.sha256(), "a".repeat(64));
    assert!(
        EvidenceFileMetadata::new(
            id("04c230e7-e13f-4f68-a8b4-da72a31bcb13"),
            "application/zip",
            "../evidence.png",
            1_024,
            "a".repeat(64),
            1_000,
        )
        .is_err()
    );
}

#[test]
fn evidence_metadata_is_revisioned_and_validates_dates_urls_and_tags() {
    let evidence = EvidenceFileMetadata::new(
        id("04c230e7-e13f-4f68-a8b4-da72a31bcb13"),
        "application/zip",
        "capture.zip",
        1_024,
        "a".repeat(64),
        1_000,
    )
    .unwrap();
    let revised = evidence
        .updated(
            Revision::new(1).unwrap(),
            EvidenceMetadataInput::new(
                "Storefront redirect capture",
                "Landing page before the redirect.",
                "Analyst capture",
                Some("2026-07-31".to_owned()),
                "https://piracy.example/",
                vec!["Piracy".to_owned(), "piracy".to_owned()],
                "Preserve the original archive.",
            )
            .unwrap(),
            1_100,
        )
        .unwrap();

    assert_eq!(revised.revision(), Revision::new(2).unwrap());
    assert_eq!(revised.title(), "Storefront redirect capture");
    assert_eq!(revised.captured_at(), Some("2026-07-31"));
    assert_eq!(revised.tags(), &["piracy"]);
    assert!(
        EvidenceMetadataInput::new(
            "Capture",
            "",
            "",
            Some("2026-02-30".to_owned()),
            "javascript:alert(1)",
            vec![],
            "",
        )
        .is_err()
    );
}

#[test]
fn evidence_media_types_are_detected_from_bounded_inert_content() {
    assert_eq!(
        sheut_core::detect_evidence_media_type("collection.zip", b"PK\x03\x04archive").unwrap(),
        "application/zip"
    );
    assert_eq!(
        sheut_core::detect_evidence_media_type("capture.mp4", b"\0\0\0\x18ftypisomdata").unwrap(),
        "video/mp4"
    );
    assert_eq!(
        sheut_core::detect_evidence_media_type("notes.txt", b"human readable evidence").unwrap(),
        "text/plain"
    );
    assert!(
        sheut_core::detect_evidence_media_type("empty.zip", b"").is_err(),
        "empty evidence is rejected"
    );
}

#[test]
fn built_in_templates_cover_the_guided_report_taxonomy() {
    let templates = built_in_report_templates();
    let keys = templates
        .iter()
        .map(|template| template.builtin())
        .collect::<Vec<_>>();

    assert_eq!(
        keys,
        vec![
            Some(BuiltinReportTemplate::ThreatActorProfile),
            Some(BuiltinReportTemplate::IntrusionAnalysis),
            Some(BuiltinReportTemplate::CampaignReport),
            Some(BuiltinReportTemplate::ExecutiveReport),
            Some(BuiltinReportTemplate::BlankGuidedReport),
        ]
    );
    assert_eq!(templates[0].name(), "Threat Actor Profile");
    assert_eq!(templates[1].name(), "Intrusion Analysis");
    assert_eq!(templates[2].name(), "Campaign Report");
    assert_eq!(templates[3].name(), "Executive Report");
    for template in [&templates[0], &templates[2], &templates[3]] {
        assert_eq!(
            template
                .sections()
                .iter()
                .find(|section| section.key() == "intelligence_gaps")
                .unwrap()
                .title(),
            "Intelligence gaps"
        );
    }
    let campaign_sections = templates[2]
        .sections()
        .iter()
        .map(|section| section.key())
        .collect::<Vec<_>>();
    assert_eq!(
        campaign_sections,
        vec![
            "executive_summary",
            "key_points",
            "assessment",
            "intelligence_gaps",
            "attack_mappings",
            "timeline",
            "indicators",
            "detections",
            "intelligence_requirements",
            "data_sources",
            "campaign_metadata",
        ]
    );
    let campaign_metadata = templates[2]
        .sections()
        .iter()
        .find(|section| section.key() == "campaign_metadata")
        .unwrap();
    let metadata_fields = campaign_metadata
        .fields()
        .iter()
        .map(|field| field.key())
        .collect::<Vec<_>>();
    assert!(metadata_fields.contains(&"publication_date"));
    assert!(metadata_fields.contains(&"authors"));
    assert!(metadata_fields.contains(&"report_version"));

    let actor_sections = templates[0]
        .sections()
        .iter()
        .map(|section| section.key())
        .collect::<Vec<_>>();
    assert_eq!(
        actor_sections,
        vec![
            "executive_summary",
            "key_points",
            "assessment",
            "actor_summary",
            "timeline",
            "intelligence_gaps",
            "attack_mappings",
            "victims",
            "indicators",
            "detections",
            "intelligence_requirements",
            "data_sources",
            "actor_metadata",
        ]
    );
}

#[test]
fn guided_reports_are_revisioned_drafts_and_report_advisory_readiness() {
    let template = built_in_report_templates()
        .into_iter()
        .find(|template| template.builtin() == Some(BuiltinReportTemplate::CampaignReport))
        .unwrap();
    let report =
        GuidedReport::new_blank(id("e7c44850-9f67-4d26-b7e3-0d4ee82339ef"), &template, 1_000)
            .unwrap();

    assert_eq!(report.revision(), Revision::new(1).unwrap());
    let warnings = report.readiness_warnings(&template);
    assert!(warnings.iter().any(|warning| {
        warning.section_key() == "executive_summary"
            && warning.field_key() == "executive_summary"
            && warning.message() == "Add recommended content to Executive summary."
    }));

    let report = report
        .revise_field(
            Revision::new(1).unwrap(),
            "campaign_name",
            GuidedReportFieldValue::Text("Operation Midnight Echo".to_owned()),
            2_000,
        )
        .unwrap();

    assert_eq!(report.revision(), Revision::new(2).unwrap());
    assert_eq!(report.title(), "Operation Midnight Echo");
    assert_eq!(report.updated_at_unix_ms(), 2_000);
}

#[test]
fn guided_report_initial_fields_are_validated_without_consuming_a_revision() {
    let template = built_in_report_templates()
        .into_iter()
        .find(|template| template.builtin() == Some(BuiltinReportTemplate::CampaignReport))
        .unwrap();
    let report = GuidedReport::new_blank_with_fields(
        id("e7c44850-9f67-4d26-b7e3-0d4ee82339ef"),
        &template,
        BTreeMap::from([(
            "report_number".to_owned(),
            GuidedReportFieldValue::Text("CR-0001".to_owned()),
        )]),
        1_000,
    )
    .unwrap();

    assert_eq!(report.revision(), Revision::new(1).unwrap());
    assert_eq!(
        report.fields().get("report_number"),
        Some(&GuidedReportFieldValue::Text("CR-0001".to_owned()))
    );
    assert!(
        GuidedReport::new_blank_with_fields(
            id("d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb"),
            &template,
            BTreeMap::from([(
                "unknown_field".to_owned(),
                GuidedReportFieldValue::Text("not accepted".to_owned()),
            )]),
            1_000,
        )
        .is_err()
    );
}

#[test]
fn guided_report_bulk_edits_are_single_revision_and_template_typed() {
    let template = built_in_report_templates()
        .into_iter()
        .find(|template| template.builtin() == Some(BuiltinReportTemplate::CampaignReport))
        .unwrap();
    let report =
        GuidedReport::new_blank(id("e7c44850-9f67-4d26-b7e3-0d4ee82339ef"), &template, 1_000)
            .unwrap();
    let changes = BTreeMap::from([
        (
            "campaign_name".to_owned(),
            GuidedReportFieldValue::Text("Midnight Echo".to_owned()),
        ),
        (
            "timeframe".to_owned(),
            GuidedReportFieldValue::Text("April to July 2026".to_owned()),
        ),
    ]);

    let revised = report
        .revise_fields(
            &template,
            Revision::new(1).unwrap(),
            "Operation Midnight Echo",
            changes,
            2_000,
        )
        .unwrap();

    assert_eq!(revised.revision(), Revision::new(2).unwrap());
    assert_eq!(revised.title(), "Operation Midnight Echo");
    assert!(
        report
            .revise_fields(
                &template,
                Revision::new(1).unwrap(),
                "Operation Midnight Echo",
                BTreeMap::from([(
                    "campaign_name".to_owned(),
                    GuidedReportFieldValue::Rows(Vec::new()),
                )]),
                2_000,
            )
            .is_err()
    );
}

#[test]
fn guided_report_rejects_malformed_supplied_dates_and_confidence_values() {
    let template = built_in_report_templates()
        .into_iter()
        .find(|template| template.builtin() == Some(BuiltinReportTemplate::CampaignReport))
        .unwrap();
    let report =
        GuidedReport::new_blank(id("e7c44850-9f67-4d26-b7e3-0d4ee82339ef"), &template, 1_000)
            .unwrap();

    for (field, value) in [
        ("publication_date", "2026-02-30"),
        ("confidence", "certain"),
    ] {
        assert!(
            report
                .revise_fields(
                    &template,
                    Revision::new(1).unwrap(),
                    "Operation Midnight Echo",
                    BTreeMap::from([(
                        field.to_owned(),
                        GuidedReportFieldValue::Text(value.to_owned()),
                    )]),
                    2_000,
                )
                .is_err(),
            "{field} must reject {value}"
        );
    }
}

#[test]
fn illicit_ecosystem_rows_accept_the_templates_human_readable_columns() {
    let template = report_template_catalog()
        .into_iter()
        .find(|template| template.name() == "Illicit Ecosystem Report")
        .unwrap();
    let report =
        GuidedReport::new_blank(id("e7c44850-9f67-4d26-b7e3-0d4ee82339ef"), &template, 1_000)
            .unwrap();
    let site = BTreeMap::from([
        ("Domain or URL".to_owned(), "stream-hub.example".to_owned()),
        ("Purpose".to_owned(), "Pirated streaming portal".to_owned()),
        ("First observed".to_owned(), "2026-05-03".to_owned()),
        ("Last observed".to_owned(), "2026-07-31".to_owned()),
        ("Current status".to_owned(), "Active".to_owned()),
        ("Hosting and DNS".to_owned(), "ExampleHost VPS".to_owned()),
        ("Evidence references".to_owned(), "EVIDENCE-A.1".to_owned()),
    ]);

    let revised = report
        .revise_fields(
            &template,
            Revision::new(1).unwrap(),
            "Example Streaming Ecosystem",
            BTreeMap::from([(
                "site_inventory".to_owned(),
                GuidedReportFieldValue::Rows(vec![site]),
            )]),
            2_000,
        )
        .unwrap();

    assert_eq!(revised.revision(), Revision::new(2).unwrap());
    assert!(
        report
            .revise_fields(
                &template,
                Revision::new(1).unwrap(),
                "Example Streaming Ecosystem",
                BTreeMap::from([(
                    "site_inventory".to_owned(),
                    GuidedReportFieldValue::Rows(vec![BTreeMap::from([(
                        "Unexpected column".to_owned(),
                        "untrusted value".to_owned(),
                    )])]),
                )]),
                2_000,
            )
            .is_err()
    );
}

#[test]
fn publication_overrides_do_not_mutate_brand_defaults() {
    let profile = BrandProfile::project_default(
        id("110b83fb-9fdb-4133-a29b-e75725bb6d0c"),
        "Perceptra",
        1_000,
    )
    .unwrap();
    assert_eq!(profile.default_paper_size(), PaperSize::A4);
    assert_eq!(profile.default_orientation(), PageOrientation::Portrait);

    let settings = PublicationSettings::from_brand(&profile, PublicationFormat::Pdf)
        .with_paper_size(PaperSize::Letter)
        .with_orientation(PageOrientation::Landscape)
        .with_tlp_marking(Some(TlpMarking::AmberStrict))
        .with_output_file_name("operation-midnight-echo.pdf")
        .unwrap();
    let snapshot = PublicationSnapshot::new(
        id("ec6ed71e-a754-4b32-b692-50f03f00154f"),
        PublicationSource::GuidedReport {
            report_id: id("e7c44850-9f67-4d26-b7e3-0d4ee82339ef"),
            revision: Revision::new(3).unwrap(),
        },
        settings,
        3_000,
    )
    .unwrap();

    assert_eq!(snapshot.paper_size(), PaperSize::Letter);
    assert_eq!(snapshot.orientation(), PageOrientation::Landscape);
    assert_eq!(snapshot.tlp_marking(), Some(TlpMarking::AmberStrict));
    assert_eq!(snapshot.brand_profile_revision().unwrap().revision, 1);
    assert_eq!(profile.default_paper_size(), PaperSize::A4);
    assert_eq!(profile.default_orientation(), PageOrientation::Portrait);
}

#[test]
fn later_publications_snapshot_complete_optional_release_history() {
    let profile = BrandProfile::project_default(
        id("110b83fb-9fdb-4133-a29b-e75725bb6d0c"),
        "Example organization",
        1_000,
    )
    .unwrap();
    let history = vec![
        PublicationReleaseEntry::new("1.0", "Initial release", 1_000).unwrap(),
        PublicationReleaseEntry::new("v2.0", "Major reassessment", 2_000).unwrap(),
    ];
    let settings = PublicationSettings::from_brand(&profile, PublicationFormat::Pdf)
        .with_release("2.0", PublicationStatus::Final, true, history)
        .unwrap();
    let snapshot = PublicationSnapshot::new(
        id("ec6ed71e-a754-4b32-b692-50f03f00154f"),
        PublicationSource::GuidedReport {
            report_id: id("e7c44850-9f67-4d26-b7e3-0d4ee82339ef"),
            revision: Revision::new(3).unwrap(),
        },
        settings,
        2_000,
    )
    .unwrap();

    assert_eq!(snapshot.release_version(), "2.0");
    assert_eq!(snapshot.publication_status(), PublicationStatus::Final);
    assert!(snapshot.include_release_history());
    assert_eq!(
        snapshot.release_history()[1].change_note(),
        "Major reassessment"
    );
}

#[test]
fn brand_profiles_are_revisioned_and_keep_assets_out_of_report_content() {
    let input = BrandProfileInput {
        name: "Northwind Editorial".to_owned(),
        organization_name: "Northwind Security".to_owned(),
        contact: Some("intel@northwind.example".to_owned()),
        primary_color: "#133C55".to_owned(),
        secondary_color: "#386FA4".to_owned(),
        accent_color: "#59A5D8".to_owned(),
        text_color: "#111827".to_owned(),
        background_color: "#FFFFFF".to_owned(),
        heading_typeface: BrandTypeface::Geist,
        body_typeface: BrandTypeface::SourceSerif4,
        mono_typeface: BrandTypeface::GeistMono,
        default_paper_size: PaperSize::A4,
        default_orientation: PageOrientation::Portrait,
        cover_treatment: CoverTreatment::Editorial,
        density: ContentDensity::Comfortable,
        table_treatment: TableTreatment::Grid,
        section_treatment: SectionTreatment::Band,
        page_furniture: PageFurniture::default(),
    };
    let profile = BrandProfile::new(
        id("110b83fb-9fdb-4133-a29b-e75725bb6d0c"),
        input.clone(),
        1_000,
    )
    .unwrap();
    let revised = profile
        .revise(
            Revision::new(1).unwrap(),
            BrandProfileInput {
                name: "Northwind Intelligence".to_owned(),
                ..input
            },
            2_000,
        )
        .unwrap()
        .with_asset(
            Revision::new(2).unwrap(),
            BrandAssetRole::Logo,
            id("ec6ed71e-a754-4b32-b692-50f03f00154f"),
            3_000,
        )
        .unwrap();

    assert_eq!(revised.revision(), Revision::new(3).unwrap());
    assert_eq!(revised.name(), "Northwind Intelligence");
    assert_eq!(
        revised.asset_id(BrandAssetRole::Logo),
        Some(id("ec6ed71e-a754-4b32-b692-50f03f00154f"))
    );
}

#[test]
fn publication_records_retain_an_immutable_reproduction_snapshot() {
    let profile = BrandProfile::project_default(
        id("110b83fb-9fdb-4133-a29b-e75725bb6d0c"),
        "Perceptra",
        1_000,
    )
    .unwrap();
    let settings = PublicationSettings::from_brand(&profile, PublicationFormat::Docx)
        .with_output_file_name("brief.docx")
        .unwrap();
    let snapshot = PublicationSnapshot::new(
        id("ec6ed71e-a754-4b32-b692-50f03f00154f"),
        PublicationSource::FreeformDocument {
            document_id: id("e7c44850-9f67-4d26-b7e3-0d4ee82339ef"),
            revision: Revision::new(7).unwrap(),
        },
        settings,
        3_000,
    )
    .unwrap();
    let record = PublicationRecord::new(
        id("2018ed78-c529-4c67-845c-a5f8c0a40570"),
        snapshot.clone(),
        42_000,
        "0d4a1185d2dc5c84c22e9a9f1f1ad21d931aab962f6e942c01a2180a082f6c8d",
    )
    .unwrap();

    assert_eq!(record.snapshot(), &snapshot);
    assert_eq!(record.snapshot().paper_size(), PaperSize::A4);
    assert_eq!(record.snapshot().orientation(), PageOrientation::Portrait);
    assert_eq!(record.byte_len(), 42_000);
}

#[test]
fn project_tlp_is_the_publication_default_without_becoming_brand_content() {
    let profile = BrandProfile::project_default(
        id("110b83fb-9fdb-4133-a29b-e75725bb6d0c"),
        "Perceptra",
        1_000,
    )
    .unwrap();
    let project = ProjectMetadata::new_with_default_tlp(
        id("d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb"),
        "Restricted project",
        TlpMarking::AmberStrict,
        1_000,
    )
    .unwrap();

    let inherited =
        PublicationSettings::from_brand_and_project(&profile, &project, PublicationFormat::Pdf);
    let overridden = inherited.clone().with_tlp_marking(Some(TlpMarking::Clear));

    assert_eq!(inherited.tlp_marking(), Some(TlpMarking::AmberStrict));
    assert_eq!(overridden.tlp_marking(), Some(TlpMarking::Clear));
    assert_eq!(project.default_tlp_marking(), TlpMarking::AmberStrict);
}

#[test]
fn tlp_2_colors_match_the_first_standard_and_keep_amber_strict_distinct() {
    assert_eq!(TlpMarking::Red.foreground_hex(), "#FF2B2B");
    assert_eq!(TlpMarking::Amber.foreground_hex(), "#FFC000");
    assert_eq!(TlpMarking::AmberStrict.foreground_hex(), "#FFC000");
    assert_eq!(TlpMarking::Green.foreground_hex(), "#33FF00");
    assert_eq!(TlpMarking::Clear.foreground_hex(), "#FFFFFF");
    for marking in [
        TlpMarking::Red,
        TlpMarking::Amber,
        TlpMarking::AmberStrict,
        TlpMarking::Green,
        TlpMarking::Clear,
    ] {
        assert_eq!(marking.background_hex(), "#000000");
    }
    assert_eq!(TlpMarking::Amber.label(), "TLP:AMBER");
    assert_eq!(TlpMarking::AmberStrict.label(), "TLP:AMBER+STRICT");
    assert_ne!(
        TlpMarking::Amber.distribution_statement(),
        TlpMarking::AmberStrict.distribution_statement()
    );
}

#[test]
fn malformed_publication_contracts_are_rejected_during_deserialization() {
    let invalid_brand = serde_json::json!({
        "schema_version": 1,
        "id": "110b83fb-9fdb-4133-a29b-e75725bb6d0c",
        "revision": 1,
        "name": "Unsafe",
        "organization": {"name": "Unsafe", "contact": null},
        "assets": {"logo_id": null, "compact_mark_id": null, "cover_artwork_id": null},
        "colors": {
            "primary": "#000000",
            "secondary": "#000000",
            "accent": "#000000",
            "text": "#777777",
            "background": "#777777"
        },
        "typography": {"heading": "geist", "body": "geist", "mono": "geist_mono"},
        "default_paper_size": "a4",
        "default_orientation": "portrait",
        "cover_treatment": "minimal",
        "density": "comfortable",
        "table_treatment": "grid",
        "section_treatment": "rule",
        "page_furniture": {"header": true, "footer": true, "marking": true, "page_numbers": true},
        "created_at_unix_ms": 1000,
        "updated_at_unix_ms": 1000
    });

    assert!(serde_json::from_value::<BrandProfile>(invalid_brand).is_err());
}
use std::collections::BTreeMap;
