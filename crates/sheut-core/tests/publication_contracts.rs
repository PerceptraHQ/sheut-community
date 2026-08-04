use sheut_core::{
    BrandAssetRole, BrandProfile, BrandProfileInput, BrandTypeface, ContentDensity, CoverTreatment,
    EvidenceFileMetadata, EvidenceMetadataInput, LocalId, PageFurniture, PageOrientation,
    PaperSize, ProjectMetadata, PublicationFormat, PublicationRecord, PublicationReleaseEntry,
    PublicationSettings, PublicationSnapshot, PublicationSource, PublicationStatus, Revision,
    SectionTreatment, TableTreatment, TlpMarking,
};

fn id(value: &str) -> LocalId {
    LocalId::parse(value).unwrap()
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
        sheut_core::detect_evidence_media_type("unsupported.docx", b"PK\x03\x04archive").unwrap(),
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
        PublicationSource::FreeformDocument {
            document_id: id("e7c44850-9f67-4d26-b7e3-0d4ee82339ef"),
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
        PublicationSource::FreeformDocument {
            document_id: id("e7c44850-9f67-4d26-b7e3-0d4ee82339ef"),
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
    let settings = PublicationSettings::from_brand(&profile, PublicationFormat::Pdf)
        .with_output_file_name("brief.pdf")
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
