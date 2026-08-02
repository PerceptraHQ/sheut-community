use std::io::Cursor;

use image::{DynamicImage, ImageFormat};
use sheut_core::{
    AnalyticConfidence, CatalogReference, DocumentEnvelope, DocumentKind, DomainErrorCode,
    GraphViewport, GraphWorkspace, ImageAttachmentMetadata, ImageMediaType, LocalId, MitreCatalog,
    MitreTechniqueReference, Position, ProjectMetadata, Revision, SemanticRelationshipDraft,
    TechniqueAssessment, TechniqueObservation, TechniqueOutcome, TlpMarking, VisualLink,
    WorkspaceItem, WorkspaceItemKind, WorkspaceMode, render_document,
};

const PROJECT_ID: &str = "6f9619ff-8b86-d011-b42d-00cf4fc964ff";
const WORKSPACE_ID: &str = "4f3d8e34-7c64-4d41-8b68-d7a334e1a884";
const SOURCE_ID: &str = "e7c44850-9f67-4d26-b7e3-0d4ee82339ef";
const TARGET_ID: &str = "d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb";

#[test]
fn local_ids_require_canonical_uuid_strings() {
    assert_eq!(LocalId::parse(PROJECT_ID).unwrap().to_string(), PROJECT_ID);

    let error = LocalId::parse("../../project.db").unwrap_err();
    assert_eq!(error.code(), DomainErrorCode::InvalidLocalId);
    assert_eq!(error.to_string(), "invalid_local_id");
}

#[test]
fn revisions_are_positive_and_advance_without_wrapping() {
    assert_eq!(Revision::new(1).unwrap().get(), 1);
    assert_eq!(Revision::new(1).unwrap().next().unwrap().get(), 2);
    assert_eq!(
        Revision::new(0).unwrap_err().code(),
        DomainErrorCode::InvalidRevision
    );
    assert_eq!(
        Revision::new(u64::MAX).unwrap().next().unwrap_err().code(),
        DomainErrorCode::RevisionOverflow
    );
}

#[test]
fn project_metadata_rejects_blank_or_control_character_names() {
    let id = LocalId::parse(PROJECT_ID).unwrap();

    assert_eq!(
        ProjectMetadata::new(id, "   ", 1_785_342_000_000)
            .unwrap_err()
            .code(),
        DomainErrorCode::InvalidName
    );
    assert_eq!(
        ProjectMetadata::new(id, "Case\nname", 1_785_342_000_000)
            .unwrap_err()
            .code(),
        DomainErrorCode::InvalidName
    );

    let metadata = ProjectMetadata::new(id, "  Operation Shadow  ", 1_785_342_000_000).unwrap();
    assert_eq!(metadata.name(), "Operation Shadow");
    assert_eq!(metadata.default_tlp_marking(), TlpMarking::Amber);
}

#[test]
fn projects_store_an_explicit_default_tlp_and_legacy_projects_remain_clear() {
    let id = LocalId::parse(PROJECT_ID).unwrap();
    let metadata = ProjectMetadata::new_with_default_tlp(
        id,
        "Operation Shadow",
        TlpMarking::Green,
        1_785_342_000_000,
    )
    .unwrap();
    assert_eq!(metadata.default_tlp_marking(), TlpMarking::Green);
    assert_eq!(
        serde_json::to_value(&metadata).unwrap()["default_tlp_marking"],
        "green"
    );

    let legacy = serde_json::json!({
        "id": PROJECT_ID,
        "name": "Legacy project",
        "created_at_unix_ms": 1_785_342_000_000_i64
    });
    let legacy: ProjectMetadata = serde_json::from_value(legacy).unwrap();
    assert_eq!(legacy.default_tlp_marking(), TlpMarking::Clear);

    let updated = metadata.with_default_tlp_marking(TlpMarking::Red);
    assert_eq!(updated.default_tlp_marking(), TlpMarking::Red);
}

#[test]
fn structured_documents_have_a_version_kind_and_revision() {
    let document = DocumentEnvelope::new(
        LocalId::parse(SOURCE_ID).unwrap(),
        DocumentKind::Investigation,
        Revision::new(3).unwrap(),
        serde_json::json!({"type": "doc", "content": []}),
    )
    .unwrap();

    let json = serde_json::to_value(&document).unwrap();
    assert_eq!(json["schema_version"], 1);
    assert_eq!(json["kind"], "investigation");
    assert_eq!(json["revision"], 3);
    assert_eq!(
        serde_json::from_value::<DocumentEnvelope>(json).unwrap(),
        document
    );
}

#[test]
fn structured_documents_render_escaped_html_and_plain_text() {
    let document = DocumentEnvelope::new(
        LocalId::parse(SOURCE_ID).unwrap(),
        DocumentKind::Investigation,
        Revision::new(1).unwrap(),
        serde_json::json!({
            "type": "doc",
            "content": [
                {
                    "type": "heading",
                    "attrs": {"level": 1},
                    "content": [{"type": "text", "text": "Operation <Shadow>"}]
                },
                {
                    "type": "paragraph",
                    "content": [
                        {"type": "text", "text": "Evidence & notes", "marks": [{"type": "bold"}]},
                        {"type": "text", "text": " "},
                        {
                            "type": "text",
                            "text": "source",
                            "marks": [{
                                "type": "link",
                                "attrs": {
                                    "href": "https://example.com/a?x=1&y=2",
                                    "target": "_blank",
                                    "onclick": "steal()"
                                }
                            }]
                        }
                    ]
                }
            ]
        }),
    )
    .unwrap();

    let rendered = render_document(&document);
    assert_eq!(
        rendered.html(),
        "<h1>Operation &lt;Shadow&gt;</h1><p><strong>Evidence &amp; notes</strong> <a href=\"https://example.com/a?x=1&amp;y=2\">source</a></p>"
    );
    assert_eq!(
        rendered.plain_text(),
        "Operation <Shadow>\nEvidence & notes source"
    );
    assert!(!rendered.html().contains("onclick"));
    assert!(!rendered.html().contains("target="));
}

#[test]
fn text_alignment_is_bounded_and_preserved_in_derived_html() {
    let document = DocumentEnvelope::new(
        LocalId::parse(SOURCE_ID).unwrap(),
        DocumentKind::Report,
        Revision::new(1).unwrap(),
        serde_json::json!({
            "type": "doc",
            "content": [{
                "type": "paragraph",
                "attrs": {"textAlign": "center"},
                "content": [{"type": "text", "text": "Centered finding"}]
            }]
        }),
    )
    .unwrap();

    assert_eq!(
        render_document(&document).html(),
        "<p style=\"text-align:center\">Centered finding</p>"
    );
    let justified = DocumentEnvelope::new(
        LocalId::parse(SOURCE_ID).unwrap(),
        DocumentKind::Report,
        Revision::new(1).unwrap(),
        serde_json::json!({
            "type": "doc",
            "content": [{
                "type": "heading",
                "attrs": {"level": 3, "textAlign": "justify"},
                "content": [{"type": "text", "text": "Justified section"}]
            }]
        }),
    )
    .unwrap();
    assert_eq!(
        render_document(&justified).html(),
        "<h3 style=\"text-align:justify\">Justified section</h3>"
    );
    assert_eq!(
        DocumentEnvelope::new(
            LocalId::parse(SOURCE_ID).unwrap(),
            DocumentKind::Report,
            Revision::new(1).unwrap(),
            serde_json::json!({
                "type": "doc",
                "content": [{
                    "type": "paragraph",
                    "attrs": {"textAlign": "expression(alert(1))"},
                    "content": [{"type": "text", "text": "Unsafe"}]
                }]
            }),
        )
        .unwrap_err()
        .code(),
        DomainErrorCode::InvalidDocument
    );
}

#[test]
fn analyst_formatting_marks_and_task_lists_round_trip_through_rust() {
    let document = DocumentEnvelope::new(
        LocalId::parse(SOURCE_ID).unwrap(),
        DocumentKind::Investigation,
        Revision::new(1).unwrap(),
        serde_json::json!({
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [{
                        "type": "text",
                        "text": "TLP AMBER x2 H2O",
                        "marks": [
                            {"type": "highlight"},
                            {"type": "superscript"},
                            {"type": "subscript"}
                        ]
                    }]
                },
                {
                    "type": "taskList",
                    "content": [{
                        "type": "taskItem",
                        "attrs": {"checked": true},
                        "content": [{
                            "type": "paragraph",
                            "content": [{"type": "text", "text": "Validate evidence"}]
                        }]
                    }]
                }
            ]
        }),
    )
    .unwrap();

    assert_eq!(
        render_document(&document).html(),
        "<p><sub><sup><mark>TLP AMBER x2 H2O</mark></sup></sub></p><ul data-type=\"taskList\"><li data-checked=\"true\"><p>Validate evidence</p></li></ul>"
    );
    assert_eq!(
        render_document(&document).plain_text(),
        "TLP AMBER x2 H2O\n[x] Validate evidence"
    );

    for invalid_content in [
        serde_json::json!({"type": "taskList", "content": []}),
        serde_json::json!({
            "type": "taskList",
            "content": [{"type": "taskItem", "attrs": {"checked": false}, "content": []}]
        }),
    ] {
        assert_eq!(
            DocumentEnvelope::new(
                LocalId::parse(SOURCE_ID).unwrap(),
                DocumentKind::Investigation,
                Revision::new(1).unwrap(),
                serde_json::json!({"type": "doc", "content": [invalid_content]}),
            )
            .unwrap_err()
            .code(),
            DomainErrorCode::InvalidDocument
        );
    }
}

#[test]
fn tables_and_callouts_render_from_canonical_json() {
    let document = DocumentEnvelope::new(
        LocalId::parse(SOURCE_ID).unwrap(),
        DocumentKind::Investigation,
        Revision::new(1).unwrap(),
        serde_json::json!({
            "type": "doc",
            "content": [
                {
                    "type": "callout",
                    "attrs": {"tone": "info"},
                    "content": [{
                        "type": "paragraph",
                        "content": [{"type": "text", "text": "Validate before sharing"}]
                    }]
                },
                {
                    "type": "table",
                    "content": [
                        {
                            "type": "tableRow",
                            "content": [
                                {
                                    "type": "tableHeader",
                                    "content": [{
                                        "type": "paragraph",
                                        "content": [{"type": "text", "text": "Indicator"}]
                                    }]
                                },
                                {
                                    "type": "tableHeader",
                                    "content": [{
                                        "type": "paragraph",
                                        "content": [{"type": "text", "text": "Status"}]
                                    }]
                                }
                            ]
                        },
                        {
                            "type": "tableRow",
                            "content": [
                                {
                                    "type": "tableCell",
                                    "content": [{
                                        "type": "paragraph",
                                        "content": [{"type": "text", "text": "evil[.]example"}]
                                    }]
                                },
                                {
                                    "type": "tableCell",
                                    "content": [{
                                        "type": "paragraph",
                                        "content": [{"type": "text", "text": "Confirmed"}]
                                    }]
                                }
                            ]
                        }
                    ]
                }
            ]
        }),
    )
    .unwrap();

    let rendered = render_document(&document);
    assert_eq!(
        rendered.html(),
        "<aside data-sheut-callout=\"info\"><p>Validate before sharing</p></aside><table><tbody><tr><th><p>Indicator</p></th><th><p>Status</p></th></tr><tr><td><p>evil[.]example</p></td><td><p>Confirmed</p></td></tr></tbody></table>"
    );
    assert_eq!(
        rendered.plain_text(),
        "Validate before sharing\nIndicator\tStatus\nevil[.]example\tConfirmed"
    );
}

#[test]
fn image_attachments_are_bounded_typed_and_path_independent() {
    for (format, media_type) in [
        (ImageFormat::Png, ImageMediaType::Png),
        (ImageFormat::Jpeg, ImageMediaType::Jpeg),
        (ImageFormat::WebP, ImageMediaType::Webp),
    ] {
        let mut encoded = Cursor::new(Vec::new());
        DynamicImage::new_rgba8(1, 1)
            .write_to(&mut encoded, format)
            .unwrap();
        assert_eq!(
            ImageMediaType::detect(encoded.get_ref()).unwrap(),
            media_type
        );
        encoded.get_mut().push(0);
        assert_eq!(
            ImageMediaType::detect(encoded.get_ref())
                .unwrap_err()
                .code(),
            DomainErrorCode::InvalidAttachment
        );
    }
    let png = [
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x04, 0x00, 0x00, 0x00, 0xb5,
        0x1c, 0x0c, 0x02, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0x64,
        0xf8, 0x0f, 0x00, 0x01, 0x05, 0x01, 0x01, 0x27, 0x18, 0xe3, 0x66, 0x00, 0x00, 0x00, 0x00,
        0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ];
    assert_eq!(ImageMediaType::detect(&png).unwrap(), ImageMediaType::Png);
    let mut trailing_script = png.to_vec();
    trailing_script.extend_from_slice(b"<script>alert(1)</script>");
    assert_eq!(
        ImageMediaType::detect(&trailing_script).unwrap_err().code(),
        DomainErrorCode::InvalidAttachment
    );
    let mut excessive_width = Cursor::new(Vec::new());
    DynamicImage::new_luma8(8_193, 1)
        .write_to(&mut excessive_width, ImageFormat::Png)
        .unwrap();
    assert_eq!(
        ImageMediaType::detect(excessive_width.get_ref())
            .unwrap_err()
            .code(),
        DomainErrorCode::InvalidAttachment
    );
    assert_eq!(
        ImageMediaType::detect(b"<svg onload=alert(1)>")
            .unwrap_err()
            .code(),
        DomainErrorCode::InvalidAttachment
    );

    let metadata = ImageAttachmentMetadata::new(
        LocalId::parse(TARGET_ID).unwrap(),
        LocalId::parse(SOURCE_ID).unwrap(),
        ImageMediaType::Png,
        "evidence.png",
        png.len() as u64,
    )
    .unwrap();
    assert_eq!(metadata.file_name(), "evidence.png");
    assert_eq!(metadata.media_type(), ImageMediaType::Png);
    assert_eq!(metadata.byte_len(), png.len() as u64);
    assert!(
        ImageAttachmentMetadata::new(
            LocalId::parse(TARGET_ID).unwrap(),
            LocalId::parse(SOURCE_ID).unwrap(),
            ImageMediaType::Png,
            "../../evidence.png",
            png.len() as u64,
        )
        .is_err()
    );
}

#[test]
fn canonical_image_nodes_reference_opaque_attachments_without_paths() {
    let document = DocumentEnvelope::new(
        LocalId::parse(SOURCE_ID).unwrap(),
        DocumentKind::Investigation,
        Revision::new(1).unwrap(),
        serde_json::json!({
            "type": "doc",
            "content": [{
                "type": "imageAttachment",
                "attrs": {
                    "attachmentId": TARGET_ID,
                    "alt": "Screenshot <one>",
                    "title": null
                }
            }]
        }),
    )
    .unwrap();
    let rendered = render_document(&document);
    assert_eq!(
        rendered.html(),
        format!(
            "<figure data-sheut-attachment=\"{TARGET_ID}\"><figcaption>Screenshot &lt;one&gt;</figcaption></figure>"
        )
    );
    assert_eq!(rendered.plain_text(), "[Image: Screenshot <one>]");

    let injected_path = DocumentEnvelope::new(
        LocalId::parse(SOURCE_ID).unwrap(),
        DocumentKind::Investigation,
        Revision::new(1).unwrap(),
        serde_json::json!({
            "type": "doc",
            "content": [{
                "type": "imageAttachment",
                "attrs": {
                    "attachmentId": TARGET_ID,
                    "alt": "unsafe",
                    "title": null,
                    "src": "file:///private/evidence.png"
                }
            }]
        }),
    )
    .unwrap_err();
    assert_eq!(injected_path.code(), DomainErrorCode::InvalidDocument);
}

#[test]
fn guided_image_nodes_reference_project_evidence_without_rendering_internal_ids() {
    let document = DocumentEnvelope::new(
        LocalId::parse(SOURCE_ID).unwrap(),
        DocumentKind::Report,
        Revision::new(1).unwrap(),
        serde_json::json!({
            "type": "doc",
            "content": [{
                "type": "evidenceImage",
                "attrs": {
                    "evidenceId": TARGET_ID,
                    "alt": "Captured storefront",
                    "title": "Observed 2026-07-31",
                    "placement": "appendix",
                    "appendixKey": "evidence_images",
                    "appendixTitle": "Evidence images"
                }
            }]
        }),
    )
    .unwrap();

    let rendered = render_document(&document);
    assert_eq!(
        rendered.html(),
        "<figure data-sheut-evidence-image><figcaption>Captured storefront</figcaption></figure>"
    );
    assert!(!rendered.html().contains(TARGET_ID));
    assert_eq!(rendered.plain_text(), "[Image: Captured storefront]");

    let invalid_placement = DocumentEnvelope::new(
        LocalId::parse(SOURCE_ID).unwrap(),
        DocumentKind::Report,
        Revision::new(1).unwrap(),
        serde_json::json!({
            "type": "doc",
            "content": [{
                "type": "evidenceImage",
                "attrs": {
                    "evidenceId": TARGET_ID,
                    "alt": "Captured storefront",
                    "title": null,
                    "placement": "execute_archive"
                }
            }]
        }),
    )
    .unwrap_err();
    assert_eq!(invalid_placement.code(), DomainErrorCode::InvalidDocument);
}

#[test]
fn malformed_tables_and_unknown_callout_tones_are_rejected() {
    let id = LocalId::parse(SOURCE_ID).unwrap();
    let revision = Revision::new(1).unwrap();
    let invalid_table = DocumentEnvelope::new(
        id,
        DocumentKind::Investigation,
        revision,
        serde_json::json!({
            "type": "doc",
            "content": [{
                "type": "table",
                "content": [{"type": "paragraph", "content": []}]
            }]
        }),
    )
    .unwrap_err();
    assert_eq!(invalid_table.code(), DomainErrorCode::InvalidDocument);

    let invalid_callout = DocumentEnvelope::new(
        id,
        DocumentKind::Investigation,
        revision,
        serde_json::json!({
            "type": "doc",
            "content": [{
                "type": "callout",
                "attrs": {"tone": "javascript:alert(1)"},
                "content": [{"type": "paragraph", "content": []}]
            }]
        }),
    )
    .unwrap_err();
    assert_eq!(invalid_callout.code(), DomainErrorCode::InvalidDocument);
}

#[test]
fn unsafe_links_render_as_plain_text() {
    let document = DocumentEnvelope::new(
        LocalId::parse(SOURCE_ID).unwrap(),
        DocumentKind::Investigation,
        Revision::new(1).unwrap(),
        serde_json::json!({
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [{
                        "type": "text",
                        "text": "do not run",
                        "marks": [{"type": "link", "attrs": {"href": "javascript:alert(1)"}}]
                    }]
                },
                {
                    "type": "paragraph",
                    "content": [{
                        "type": "text",
                        "text": "control characters are unsafe",
                        "marks": [{"type": "link", "attrs": {"href": "https://safe.example\njavascript:alert(1)"}}]
                    }]
                }
            ]
        }),
    )
    .unwrap();

    let rendered = render_document(&document);
    assert_eq!(
        rendered.html(),
        "<p>do not run</p><p>control characters are unsafe</p>"
    );
    assert!(!rendered.html().contains("javascript"));
}

#[test]
fn documents_reject_raw_html_and_excessive_nesting() {
    let id = LocalId::parse(SOURCE_ID).unwrap();
    let revision = Revision::new(1).unwrap();
    let raw_html = DocumentEnvelope::new(
        id,
        DocumentKind::Investigation,
        revision,
        serde_json::json!({
            "type": "doc",
            "content": [{"type": "html", "content": "<script>alert(1)</script>"}]
        }),
    )
    .unwrap_err();
    assert_eq!(raw_html.code(), DomainErrorCode::InvalidDocument);

    let mut nested = serde_json::json!({"type": "paragraph"});
    for _ in 0..70 {
        nested = serde_json::json!({"type": "blockquote", "content": [nested]});
    }
    let too_deep = DocumentEnvelope::new(
        id,
        DocumentKind::Investigation,
        revision,
        serde_json::json!({"type": "doc", "content": [nested]}),
    )
    .unwrap_err();
    assert_eq!(too_deep.code(), DomainErrorCode::InvalidDocument);
}

#[test]
fn workspace_membership_is_not_object_ownership() {
    let item = WorkspaceItem::new(
        LocalId::parse(WORKSPACE_ID).unwrap(),
        LocalId::parse(SOURCE_ID).unwrap(),
        WorkspaceItemKind::Document,
        Position::new(24.5, -12.0).unwrap(),
        true,
    );

    let json = serde_json::to_value(&item).unwrap();
    assert_eq!(json["workspace_id"], WORKSPACE_ID);
    assert_eq!(json["item_id"], SOURCE_ID);
    assert_eq!(json["pinned"], true);
    assert!(json.get("owner_id").is_none());
}

#[test]
fn graph_workspaces_are_revisioned_and_validate_viewports() {
    let workspace = GraphWorkspace::new(
        LocalId::parse(WORKSPACE_ID).unwrap(),
        "APT1 investigation",
        WorkspaceMode::View,
        GraphViewport::new(40.0, -25.0, 1.25).unwrap(),
        1_785_342_000_000,
    )
    .unwrap();

    let json = serde_json::to_value(&workspace).unwrap();
    assert_eq!(json["schema_version"], 1);
    assert_eq!(json["revision"], 1);
    assert_eq!(json["mode"], "view");
    assert_eq!(json["viewport"]["zoom"], 1.25);
    assert_eq!(workspace.name(), "APT1 investigation");

    assert_eq!(
        GraphViewport::new(0.0, 0.0, 0.01).unwrap_err().code(),
        DomainErrorCode::InvalidViewport
    );
    assert_eq!(
        Position::new(1_000_001.0, 0.0).unwrap_err().code(),
        DomainErrorCode::InvalidPosition
    );
}

#[test]
fn graph_contract_deserialization_cannot_bypass_bounds() {
    let invalid_viewport = serde_json::json!({"x": 0, "y": 0, "zoom": 99});
    assert!(serde_json::from_value::<GraphViewport>(invalid_viewport).is_err());

    let invalid_item = serde_json::json!({
        "workspace_id": WORKSPACE_ID,
        "item_id": SOURCE_ID,
        "item_kind": "intelligence",
        "position": {"x": 1e20, "y": 0},
        "pinned": false
    });
    assert!(serde_json::from_value::<WorkspaceItem>(invalid_item).is_err());

    let invalid_workspace = serde_json::json!({
        "schema_version": 1,
        "id": WORKSPACE_ID,
        "name": " ",
        "revision": 1,
        "mode": "build",
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "created_at_unix_ms": 1,
        "updated_at_unix_ms": 1,
        "deleted_at_unix_ms": null
    });
    assert!(serde_json::from_value::<GraphWorkspace>(invalid_workspace).is_err());
}

#[test]
fn visual_links_and_semantic_relationships_are_distinct_contracts() {
    let visual = VisualLink::new(
        LocalId::parse("d8c735f2-4f6b-4fd7-bcfa-52b5cfad9de5").unwrap(),
        LocalId::parse(WORKSPACE_ID).unwrap(),
        LocalId::parse(SOURCE_ID).unwrap(),
        LocalId::parse(TARGET_ID).unwrap(),
        Some("supports"),
    )
    .unwrap();
    let semantic = SemanticRelationshipDraft::new(
        LocalId::parse(SOURCE_ID).unwrap(),
        LocalId::parse(TARGET_ID).unwrap(),
        "indicates",
    )
    .unwrap();

    assert_eq!(serde_json::to_value(&visual).unwrap()["kind"], "visual");
    assert_eq!(
        serde_json::to_value(&visual).unwrap()["id"],
        "d8c735f2-4f6b-4fd7-bcfa-52b5cfad9de5"
    );
    assert_eq!(
        serde_json::to_value(&semantic).unwrap()["kind"],
        "semantic_relationship_draft"
    );
    assert_eq!(visual.label(), Some("supports"));
    assert_eq!(semantic.relationship_type(), "indicates");
}

#[test]
fn links_reject_self_references_and_unbounded_labels() {
    let source = LocalId::parse(SOURCE_ID).unwrap();

    assert_eq!(
        VisualLink::new(
            LocalId::parse("d8c735f2-4f6b-4fd7-bcfa-52b5cfad9de5").unwrap(),
            LocalId::parse(WORKSPACE_ID).unwrap(),
            source,
            source,
            None,
        )
        .unwrap_err()
        .code(),
        DomainErrorCode::SelfLink
    );
    assert_eq!(
        SemanticRelationshipDraft::new(source, LocalId::parse(TARGET_ID).unwrap(), "x".repeat(65))
            .unwrap_err()
            .code(),
        DomainErrorCode::InvalidRelationshipType
    );
}

#[test]
fn catalog_references_are_typed_and_non_blank() {
    let reference =
        CatalogReference::new("mitre-attack-enterprise", "19.1", "attack-pattern", "T1059")
            .unwrap();

    assert_eq!(reference.catalog(), "mitre-attack-enterprise");
    assert_eq!(reference.version(), "19.1");
    assert_eq!(reference.external_id(), "T1059");
    assert_eq!(
        CatalogReference::new("mitre-attack-enterprise", "19.1", "attack-pattern", " ")
            .unwrap_err()
            .code(),
        DomainErrorCode::InvalidCatalogReference
    );
}

#[test]
fn mitre_references_keep_enterprise_and_atlas_namespaces_distinct() {
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
        "AML.T0051.000",
        Some("AML.TA0004"),
    )
    .unwrap();

    assert_ne!(enterprise, atlas);
    assert_eq!(enterprise.technique_id(), "T1059.001");
    assert_eq!(atlas.technique_id(), "AML.T0051.000");
    assert_eq!(atlas.tactic_id(), Some("AML.TA0004"));
    assert_eq!(
        MitreTechniqueReference::new(MitreCatalog::Atlas, "2026.06", "T1059", Some("AML.TA0004"),)
            .unwrap_err()
            .code(),
        DomainErrorCode::InvalidCatalogReference
    );
}

#[test]
fn technique_observations_separate_assessment_outcome_and_revision() {
    let reference = MitreTechniqueReference::new(
        MitreCatalog::AttackEnterprise,
        "19.1",
        "T1059.001",
        Some("TA0002"),
    )
    .unwrap();
    let observation = TechniqueObservation::new(
        LocalId::parse(SOURCE_ID).unwrap(),
        reference,
        TechniqueAssessment::Observed,
        TechniqueOutcome::Prevented,
        AnalyticConfidence::High,
        "PowerShell launched, but application control blocked the payload.",
        Some(1_785_340_000_000),
        Some(1_785_341_000_000),
        1_785_342_000_000,
    )
    .unwrap();

    assert_eq!(observation.assessment(), TechniqueAssessment::Observed);
    assert_eq!(observation.outcome(), TechniqueOutcome::Prevented);
    assert_eq!(observation.confidence(), AnalyticConfidence::High);
    assert_eq!(observation.revision(), Revision::new(1).unwrap());
    let revised = observation
        .revise(
            TechniqueAssessment::Observed,
            TechniqueOutcome::Successful,
            AnalyticConfidence::High,
            "PowerShell executed the decoded command on a second host.",
            Some(1_785_340_000_000),
            Some(1_785_343_000_000),
            1_785_344_000_000,
        )
        .unwrap();
    assert_eq!(revised.revision(), Revision::new(2).unwrap());
    assert_eq!(
        revised.created_at_unix_ms(),
        observation.created_at_unix_ms()
    );
}

#[test]
fn technique_observations_reject_incoherent_or_unbounded_input() {
    let reference = MitreTechniqueReference::new(
        MitreCatalog::Atlas,
        "2026.06",
        "AML.T0051",
        Some("AML.TA0004"),
    )
    .unwrap();

    assert_eq!(
        TechniqueObservation::new(
            LocalId::parse(SOURCE_ID).unwrap(),
            reference.clone(),
            TechniqueAssessment::RuledOut,
            TechniqueOutcome::Successful,
            AnalyticConfidence::Medium,
            "Ruled out",
            None,
            None,
            1_785_342_000_000,
        )
        .unwrap_err()
        .code(),
        DomainErrorCode::InvalidTechniqueObservation
    );
    assert_eq!(
        TechniqueObservation::new(
            LocalId::parse(SOURCE_ID).unwrap(),
            reference,
            TechniqueAssessment::Suspected,
            TechniqueOutcome::Unknown,
            AnalyticConfidence::Low,
            "x".repeat(4_001),
            Some(2),
            Some(1),
            3,
        )
        .unwrap_err()
        .code(),
        DomainErrorCode::InvalidTechniqueObservation
    );
}

#[test]
fn deserialization_cannot_bypass_contract_validation() {
    let blank_project = serde_json::json!({
        "id": PROJECT_ID,
        "name": " ",
        "created_at_unix_ms": 1_785_342_000_000_i64
    });
    assert!(serde_json::from_value::<ProjectMetadata>(blank_project).is_err());

    let unsupported_document_schema = serde_json::json!({
        "schema_version": 2,
        "id": SOURCE_ID,
        "kind": "investigation",
        "revision": 1,
        "root": {"type": "doc", "content": []}
    });
    assert!(serde_json::from_value::<DocumentEnvelope>(unsupported_document_schema).is_err());

    let self_link = serde_json::json!({
        "kind": "visual",
        "workspace_id": WORKSPACE_ID,
        "source_id": SOURCE_ID,
        "target_id": SOURCE_ID,
        "label": null
    });
    assert!(serde_json::from_value::<VisualLink>(self_link).is_err());

    let blank_catalog_reference = serde_json::json!({
        "catalog": "mitre-attack-enterprise",
        "version": "19.1",
        "object_type": "attack-pattern",
        "external_id": " "
    });
    assert!(serde_json::from_value::<CatalogReference>(blank_catalog_reference).is_err());

    let invalid_observation = serde_json::json!({
        "id": SOURCE_ID,
        "reference": {
            "catalog": "atlas",
            "version": "2026.06",
            "techniqueId": "AML.T0051",
            "tacticId": "AML.TA0004"
        },
        "assessment": "ruled_out",
        "outcome": "successful",
        "confidence": "high",
        "narrative": "Invalid combination",
        "firstSeenUnixMs": null,
        "lastSeenUnixMs": null,
        "revision": 1,
        "createdAtUnixMs": 1,
        "updatedAtUnixMs": 1
    });
    assert!(serde_json::from_value::<TechniqueObservation>(invalid_observation).is_err());
}
