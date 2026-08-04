use image::{DynamicImage, ImageFormat};
use sheut_core::{
    BrandProfile, DocumentEnvelope, DocumentKind, PageOrientation, PaperSize, PublicationFormat,
    PublicationSettings, PublicationSnapshot, PublicationSource, ReportAuthor, ReportProperties,
    Revision, TlpMarking,
};
use sheut_publish::{
    PublicationAssets, PublicationBlock, PublicationIr, PublicationTableLayout, PublishErrorCode,
    render_publication, render_publication_with_assets,
};
use std::io::Cursor;

fn id(value: &str) -> sheut_core::LocalId {
    sheut_core::LocalId::parse(value).unwrap()
}

fn brand() -> BrandProfile {
    BrandProfile::project_default(
        id("110b83fb-9fdb-4133-a29b-e75725bb6d0c"),
        "Perceptra",
        1_000,
    )
    .unwrap()
}

fn snapshot(document: &DocumentEnvelope, paper_size: PaperSize) -> PublicationSnapshot {
    let settings = PublicationSettings::from_brand(&brand(), PublicationFormat::Pdf)
        .with_paper_size(paper_size)
        .with_orientation(PageOrientation::Portrait)
        .with_tlp_marking(Some(TlpMarking::Amber))
        .with_output_file_name("report.pdf")
        .unwrap();
    PublicationSnapshot::new(
        id("ec6ed71e-a754-4b32-b692-50f03f00154f"),
        PublicationSource::FreeformDocument {
            document_id: document.id(),
            revision: document.revision(),
        },
        settings,
        2_000,
    )
    .unwrap()
}

fn document_native_report() -> DocumentEnvelope {
    DocumentEnvelope::new_report(
        id("c10e2837-9f06-40f2-875f-951fdd51f926"),
        Revision::new(2).unwrap(),
        serde_json::json!({
            "type": "doc",
            "content": [
                {"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Assessment"}]},
                {"type": "paragraph", "attrs": {"lineSpacing": 1.5, "paragraphSpacing": 12}, "content": [
                    {"type": "text", "text": "Styled finding", "marks": [
                        {"type": "bold"}, {"type": "italic"}, {"type": "underline"},
                        {"type": "strike"}, {"type": "highlight"}, {"type": "code"},
                        {"type": "textStyle", "attrs": {
                            "fontFamily": "geist_mono", "fontSize": 14, "color": "#004b76"
                        }}
                    ]},
                    {"type": "text", "text": "2", "marks": [{"type": "subscript"}]},
                    {"type": "text", "text": "3", "marks": [{"type": "superscript"}]}
                ]},
                {"type": "paragraph", "content": [
                    {"type": "text", "text": "Observed in "},
                    {"type": "evidenceCitation", "attrs": {
                        "evidenceId": "f8edb3d1-6705-4f64-9260-d7dc888f0512",
                        "revision": 4,
                        "label": "Captured storefront",
                        "fileName": "storefront.png",
                        "mediaType": "image/png",
                        "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
                    }},
                    {"type": "text", "text": " and confirmed again "},
                    {"type": "evidenceCitation", "attrs": {
                        "evidenceId": "f8edb3d1-6705-4f64-9260-d7dc888f0512",
                        "revision": 4,
                        "label": "Captured storefront",
                        "fileName": "storefront.png",
                        "mediaType": "image/png",
                        "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
                    }}
                ]},
                {"type": "paragraph", "attrs": {"textAlign": "center"}, "content": [{"type": "text", "text": "Centered assessment"}]},
                {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Infrastructure"}]},
                {"type": "heading", "attrs": {"level": 3}, "content": [{"type": "text", "text": "Hosting"}]},
                {"type": "heading", "attrs": {"level": 2}},
                {"type": "blockquote", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Quoted source"}]}]},
                {"type": "callout", "attrs": {"tone": "info"}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Analyst callout"}]}]},
                {"type": "codeBlock", "content": [{"type": "text", "text": "rule suspicious { condition: true }"}]},
                {"type": "bulletList", "content": [{"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Bullet"}]}]}]},
                {"type": "orderedList", "attrs": {"start": 1}, "content": [{"type": "listItem", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Ordered"}]}]}]},
                {"type": "taskList", "content": [{"type": "taskItem", "attrs": {"checked": true}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Reviewed"}]}]}]},
                {"type": "horizontalRule"},
                {"type": "table", "attrs": {"layout": "landscape-page"}, "content": [
                    {"type": "tableRow", "content": [
                        {"type": "tableHeader", "attrs": {"colspan": 1, "rowspan": 1, "colwidth": [360]}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Indicator"}]}]},
                        {"type": "tableHeader", "attrs": {"colspan": 1, "rowspan": 1, "colwidth": [420]}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Assessment"}]}]}
                    ]},
                    {"type": "tableRow", "content": [
                        {"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "example.test"}]}]},
                        {"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Malicious"}]}]}
                    ]}
                ]},
                {"type": "pageBreak"},
                {"type": "paragraph", "content": [{"type": "text", "text": "New analyst-authored page."}]}
            ]
        }),
        ReportProperties::new(
            "RPT-0042",
            "Operation Night Glass",
            vec![
                ReportAuthor::new("Alex Morgan", Some("Lead analyst")).unwrap(),
                ReportAuthor::new("Noah Chen", Some("Senior analyst")).unwrap(),
            ],
            Some("Perceptra Intelligence"),
            "2026-08-03",
        )
        .unwrap(),
    )
    .unwrap()
}

#[test]
fn document_native_reports_keep_front_matter_heading_levels_and_page_breaks_for_typst() {
    let report = document_native_report();
    let publication = PublicationIr::from_freeform(&report).unwrap();
    assert_eq!(publication.title(), "Operation Night Glass");
    assert_eq!(publication.metadata("report_number"), Some("RPT-0042"));
    assert_eq!(publication.metadata("publication_date"), Some("2026-08-03"));
    assert_eq!(
        publication.metadata("authors"),
        Some("Alex Morgan — Lead analyst\nNoah Chen — Senior analyst"),
        "structured authors must remain separate cover lines",
    );

    let administration = &publication.sections()[0];
    assert_eq!(administration.key(), "report_administration");
    let PublicationBlock::MetadataTable { rows } = &administration.blocks()[0] else {
        panic!("report administration must be a metadata table");
    };
    assert!(
        rows.iter()
            .any(|row| row == &("Report ID".to_owned(), "RPT-0042".to_owned()))
    );
    assert!(rows.iter().any(|row| {
        row == &(
            "Producing organisation".to_owned(),
            "Perceptra Intelligence".to_owned(),
        )
    }));

    let body = publication
        .sections()
        .iter()
        .find(|section| section.key() == "document")
        .unwrap();
    let heading_order = body
        .blocks()
        .iter()
        .filter_map(|block| match block {
            PublicationBlock::Heading { level, text, .. } => Some((*level, text.as_str())),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        heading_order,
        vec![(1, "Assessment"), (2, "Infrastructure"), (3, "Hosting")],
        "the ordered H1-H3 stream is the source of the nested Typst outline",
    );
    assert!(matches!(
        body.blocks()[0],
        PublicationBlock::Heading { level: 1, .. }
    ));
    assert!(body.blocks().iter().any(
        |block| matches!(block, PublicationBlock::Heading { level: 2, text, .. } if text == "Infrastructure")
    ));
    assert!(body.blocks().iter().any(
        |block| matches!(block, PublicationBlock::Heading { level: 3, text, .. } if text == "Hosting")
    ));
    assert_eq!(
        body.blocks()
            .iter()
            .filter(|block| matches!(block, PublicationBlock::Heading { .. }))
            .count(),
        3,
        "blank headings must be omitted from the generated Typst outline",
    );
    assert!(
        body.blocks()
            .iter()
            .any(|block| matches!(block, PublicationBlock::StyledParagraph { .. }))
    );
    let styled_spans = body.blocks().iter().find_map(|block| match block {
        PublicationBlock::StyledParagraph { text, .. }
            if text
                .spans()
                .first()
                .is_some_and(|span| span.text() == "Styled finding") =>
        {
            Some(text.spans())
        }
        _ => None,
    });
    let styled = styled_spans.unwrap().first().unwrap();
    assert_eq!(styled.font_family(), Some("geist_mono"));
    assert_eq!(styled.font_size(), Some(14));
    assert_eq!(styled.color(), Some("#004b76"));
    assert!(
        body.blocks()
            .iter()
            .any(|block| matches!(block, PublicationBlock::CodeBlock(_)))
    );
    assert!(
        body.blocks()
            .iter()
            .any(|block| matches!(block, PublicationBlock::HorizontalRule))
    );
    assert!(
        body.blocks()
            .iter()
            .any(|block| matches!(block, PublicationBlock::OrderedList(_)))
    );
    assert!(
        body.blocks()
            .iter()
            .any(|block| matches!(block, PublicationBlock::TaskList(_)))
    );
    let table = body.blocks().iter().find_map(|block| match block {
        PublicationBlock::Table {
            headers,
            rows,
            widths,
            layout,
        } => Some((headers, rows, widths, layout)),
        _ => None,
    });
    let (headers, rows, widths, layout) = table.expect("document table");
    assert_eq!(headers, &["Indicator", "Assessment"]);
    assert_eq!(
        rows,
        &[vec!["example.test".to_owned(), "Malicious".to_owned()]]
    );
    assert_eq!(widths, &[360, 420]);
    assert_eq!(*layout, PublicationTableLayout::LandscapePage);
    assert!(
        body.blocks()
            .iter()
            .any(|block| matches!(block, PublicationBlock::PageBreak))
    );

    let evidence_appendix = publication
        .sections()
        .iter()
        .find(|section| section.key() == "appendix_evidence_details")
        .expect("referenced Evidence must create an appendix");
    assert_eq!(
        evidence_appendix.title(),
        "Evidence extracts and methodology details"
    );
    let PublicationBlock::EvidenceIndex { items } = &evidence_appendix.blocks()[0] else {
        panic!("Evidence appendix must contain the deterministic index");
    };
    assert_eq!(items.len(), 1, "duplicate citations must be deduplicated");
    assert_eq!(items[0].label(), "Captured storefront");
    assert_eq!(
        publication.evidence_ids(),
        vec![id("f8edb3d1-6705-4f64-9260-d7dc888f0512")]
    );

    let pdf = render_publication(
        &publication,
        &snapshot(&report, PaperSize::A4),
        Some(&brand()),
    )
    .unwrap();
    assert!(pdf.starts_with(b"%PDF"));
}

#[test]
fn investigations_and_notes_also_publish_only_through_typst_pdf() {
    for kind in [DocumentKind::Investigation, DocumentKind::AnalystNote] {
        let document = DocumentEnvelope::new(
            id(if kind == DocumentKind::Investigation {
                "e7c44850-9f67-4d26-b7e3-0d4ee82339ef"
            } else {
                "04c230e7-e13f-4f68-a8b4-da72a31bcb13"
            }),
            kind,
            Revision::new(1).unwrap(),
            serde_json::json!({
                "type": "doc",
                "content": [
                    {"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Formatted assessment"}]},
                    {"type": "paragraph", "content": [
                        {"type": "text", "text": "high confidence", "marks": [{"type": "bold"}]},
                        {"type": "text", "text": " and time sensitive", "marks": [{"type": "italic"}]}
                    ]}
                ]
            }),
        )
        .unwrap();
        let publication = PublicationIr::from_freeform(&document).unwrap();
        let pdf = render_publication(
            &publication,
            &snapshot(&document, PaperSize::Letter),
            Some(&brand()),
        )
        .unwrap();
        assert!(pdf.starts_with(b"%PDF"));
    }
}

#[test]
fn publication_format_rejects_removed_html_and_docx_values() {
    assert!(serde_json::from_str::<PublicationFormat>("\"html\"").is_err());
    assert!(serde_json::from_str::<PublicationFormat>("\"docx\"").is_err());
    assert_eq!(
        serde_json::from_str::<PublicationFormat>("\"pdf\"").unwrap(),
        PublicationFormat::Pdf
    );
}

#[test]
fn frozen_graph_snapshots_publish_from_the_saved_attachment_in_the_figures_appendix() {
    let attachment_id = id("22a415a0-61b2-4b50-904d-d5f180bfc505");
    let report = DocumentEnvelope::new_report(
        id("c10e2837-9f06-40f2-875f-951fdd51f926"),
        Revision::new(1).unwrap(),
        serde_json::json!({
            "type": "doc",
            "content": [{
                "type": "graphSnapshot",
                "attrs": {
                    "attachmentId": attachment_id.to_string(),
                    "workspaceId": "4f3d8e34-7c64-4d41-8b68-d7a334e1a884",
                    "workspaceRevision": 7,
                    "workspaceName": "Infrastructure map",
                    "placement": "appendix",
                    "alt": "Analytical graph snapshot: Infrastructure map",
                    "title": "Infrastructure map · revision 7"
                }
            }]
        }),
        ReportProperties::new(
            "RPT-0043",
            "Frozen graph report",
            Vec::new(),
            None,
            "2026-08-04",
        )
        .unwrap(),
    )
    .unwrap();
    let publication = PublicationIr::from_freeform(&report).unwrap();
    assert_eq!(publication.document_image_ids(), vec![attachment_id]);
    assert!(publication.sections().iter().any(|section| {
        section.key() == "appendix_analytical_figures"
            && matches!(section.blocks(), [PublicationBlock::GraphSnapshot { .. }])
    }));

    assert_eq!(
        render_publication(
            &publication,
            &snapshot(&report, PaperSize::A4),
            Some(&brand()),
        )
        .unwrap_err()
        .code(),
        PublishErrorCode::InvalidContent,
        "a missing frozen graph attachment must block publication",
    );

    let mut png = Cursor::new(Vec::new());
    DynamicImage::new_rgb8(64, 36)
        .write_to(&mut png, ImageFormat::Png)
        .unwrap();
    let mut assets = PublicationAssets::default();
    assets
        .document_images
        .insert(attachment_id, png.into_inner());
    let pdf = render_publication_with_assets(
        &publication,
        &snapshot(&report, PaperSize::A4),
        Some(&brand()),
        Some(&assets),
    )
    .unwrap();
    assert!(pdf.starts_with(b"%PDF"));
}
