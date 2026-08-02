use std::{
    collections::{BTreeMap, HashMap},
    io::{Cursor, Read},
};

use sheut_core::{
    BrandProfile, BrandProfileInput, BrandTypeface, BuiltinReportTemplate, ContentDensity,
    CoverTreatment, DocumentEnvelope, DocumentKind, GuidedReport, GuidedReportFieldValue, LocalId,
    PageFurniture, PageOrientation, PaperSize, PublicationFormat, PublicationSettings,
    PublicationSnapshot, PublicationSource, Revision, SectionTreatment, TableTreatment, TlpMarking,
    built_in_report_templates, report_template_catalog,
};
use sheut_publish::{
    PublicationAssets, PublicationBlock, PublicationIr, render_publication,
    render_publication_with_assets,
};
use zip::ZipArchive;

fn id(value: &str) -> LocalId {
    LocalId::parse(value).unwrap()
}

fn brand() -> BrandProfile {
    BrandProfile::project_default(
        id("110b83fb-9fdb-4133-a29b-e75725bb6d0c"),
        "Perceptra",
        1_000,
    )
    .unwrap()
}

fn brand_with_typefaces(heading: BrandTypeface, body: BrandTypeface) -> BrandProfile {
    BrandProfile::new(
        id("110b83fb-9fdb-4133-a29b-e75725bb6d0c"),
        BrandProfileInput {
            name: "Perceptra Editorial".to_owned(),
            organization_name: "Perceptra".to_owned(),
            contact: None,
            primary_color: "#133C55".to_owned(),
            secondary_color: "#386FA4".to_owned(),
            accent_color: "#59A5D8".to_owned(),
            text_color: "#111827".to_owned(),
            background_color: "#FFFFFF".to_owned(),
            heading_typeface: heading,
            body_typeface: body,
            mono_typeface: BrandTypeface::GeistMono,
            default_paper_size: PaperSize::A4,
            default_orientation: PageOrientation::Portrait,
            cover_treatment: CoverTreatment::Editorial,
            density: ContentDensity::Comfortable,
            table_treatment: TableTreatment::Grid,
            section_treatment: SectionTreatment::Band,
            page_furniture: PageFurniture::default(),
        },
        1_000,
    )
    .unwrap()
}

fn freeform_document() -> DocumentEnvelope {
    DocumentEnvelope::new(
        id("e7c44850-9f67-4d26-b7e3-0d4ee82339ef"),
        DocumentKind::Investigation,
        Revision::new(4).unwrap(),
        serde_json::json!({
            "type": "doc",
            "content": [
                {"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Operation Midnight Echo"}]},
                {"type": "paragraph", "content": [{"type": "text", "text": "Observed <script> remains text, not code."}]},
                {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Evidence"}]},
                {"type": "table", "content": [
                    {"type": "tableRow", "content": [
                        {"type": "tableHeader", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Indicator"}]}]},
                        {"type": "tableHeader", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Confidence"}]}]}
                    ]},
                    {"type": "tableRow", "content": [
                        {"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "evil[.]example"}]}]},
                        {"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "High"}]}]}
                    ]}
                ]}
            ]
        }),
    )
    .unwrap()
}

fn rich_text_document() -> DocumentEnvelope {
    DocumentEnvelope::new(
        id("04c230e7-e13f-4f68-a8b4-da72a31bcb13"),
        DocumentKind::Investigation,
        Revision::new(1).unwrap(),
        serde_json::json!({
            "type": "doc",
            "content": [
                {"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Formatted assessment"}]},
                {"type": "paragraph", "content": [
                    {"type": "text", "text": "This finding is "},
                    {"type": "text", "text": "high confidence", "marks": [{"type": "bold"}]},
                    {"type": "text", "text": " and "},
                    {"type": "text", "text": "time sensitive", "marks": [{"type": "italic"}]},
                    {"type": "text", "text": ". Review the "},
                    {"type": "text", "text": "video evidence", "marks": [{"type": "link", "attrs": {"href": "https://video.example/evidence/123"}}]},
                    {"type": "text", "text": "."}
                ]}
            ]
        }),
    )
    .unwrap()
}

fn document_with_an_intentional_paragraph_gap() -> DocumentEnvelope {
    DocumentEnvelope::new(
        id("d88e4ac8-4a0d-4e3c-bfe6-430a46fa7a92"),
        DocumentKind::Investigation,
        Revision::new(1).unwrap(),
        serde_json::json!({
            "type": "doc",
            "content": [
                {"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Assessment"}]},
                {"type": "paragraph", "content": [{"type": "text", "text": "First paragraph."}]},
                {"type": "paragraph"},
                {"type": "paragraph", "content": [{"type": "text", "text": "Second paragraph."}]}
            ]
        }),
    )
    .unwrap()
}

fn snapshot(
    format: PublicationFormat,
    paper_size: PaperSize,
    orientation: PageOrientation,
) -> PublicationSnapshot {
    let settings = PublicationSettings::from_brand(&brand(), format)
        .with_paper_size(paper_size)
        .with_orientation(orientation)
        .with_tlp_marking(Some(TlpMarking::Amber))
        .with_output_file_name(format!("report.{}", format.extension()))
        .unwrap();
    PublicationSnapshot::new(
        id("ec6ed71e-a754-4b32-b692-50f03f00154f"),
        PublicationSource::FreeformDocument {
            document_id: freeform_document().id(),
            revision: Revision::new(4).unwrap(),
        },
        settings,
        2_000,
    )
    .unwrap()
}

fn docx_document_xml(bytes: &[u8]) -> String {
    docx_archive_entry(bytes, "word/document.xml")
}

fn docx_archive_entry(bytes: &[u8], name: &str) -> String {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut xml = String::new();
    archive
        .by_name(name)
        .unwrap()
        .read_to_string(&mut xml)
        .unwrap();
    xml
}

fn docx_run_containing<'a>(document_xml: &'a str, text: &str) -> &'a str {
    let text_offset = document_xml
        .find(text)
        .expect("DOCX contains expected text");
    let run_start = document_xml[..text_offset]
        .rfind("<w:r>")
        .expect("text belongs to a run");
    let run_end = document_xml[text_offset..]
        .find("</w:r>")
        .map(|offset| text_offset + offset + "</w:r>".len())
        .expect("run is closed");
    &document_xml[run_start..run_end]
}

fn first_pdf_media_box(bytes: &[u8]) -> (f32, f32) {
    let pdf = String::from_utf8_lossy(bytes);
    let start = pdf.find("/MediaBox").expect("PDF has a media box");
    let values = pdf[start..]
        .chars()
        .skip_while(|character| *character != '[')
        .skip(1)
        .take_while(|character| *character != ']')
        .collect::<String>();
    let values = values
        .split_whitespace()
        .map(|value| value.parse::<f32>().unwrap())
        .collect::<Vec<_>>();
    (values[2], values[3])
}

fn narrative(text: &str) -> GuidedReportFieldValue {
    GuidedReportFieldValue::Narrative(serde_json::json!({
        "type": "doc",
        "content": [{
            "type": "paragraph",
            "content": [{"type": "text", "text": text}]
        }]
    }))
}

#[test]
fn double_enter_preserves_one_internal_paragraph_gap_in_publication_ir() {
    let publication =
        PublicationIr::from_freeform(&document_with_an_intentional_paragraph_gap()).unwrap();
    let assessment = publication
        .sections()
        .iter()
        .find(|section| section.title() == "Analysis")
        .unwrap();

    assert!(matches!(
        assessment.blocks(),
        [
            PublicationBlock::Paragraph(_),
            PublicationBlock::ParagraphGap,
            PublicationBlock::Paragraph(_)
        ]
    ));

    let html = String::from_utf8(
        render_publication(
            &publication,
            &snapshot(
                PublicationFormat::Html,
                PaperSize::A4,
                PageOrientation::Portrait,
            ),
            Some(&brand()),
        )
        .unwrap(),
    )
    .unwrap();
    assert!(html.contains(
        "First paragraph.</p><div class=\"paragraph-gap\" aria-hidden=\"true\"></div><p>Second paragraph."
    ));

    let docx = render_publication(
        &publication,
        &snapshot(
            PublicationFormat::Docx,
            PaperSize::A4,
            PageOrientation::Portrait,
        ),
        Some(&brand()),
    )
    .unwrap();
    let document_xml = docx_document_xml(&docx);
    let first = document_xml.find("First paragraph.").unwrap();
    let second = document_xml.find("Second paragraph.").unwrap();
    let between = &document_xml[first..second];
    assert_eq!(between.matches("<w:p ").count(), 2);

    let pdf = render_publication(
        &publication,
        &snapshot(
            PublicationFormat::Pdf,
            PaperSize::A4,
            PageOrientation::Portrait,
        ),
        Some(&brand()),
    )
    .unwrap();
    assert!(pdf.starts_with(b"%PDF-"));
}

#[test]
fn freeform_content_uses_one_ir_for_responsive_html_docx_and_typst_pdf() {
    let publication = PublicationIr::from_freeform(&freeform_document()).unwrap();
    assert_eq!(publication.title(), "Operation Midnight Echo");

    let html = render_publication(
        &publication,
        &snapshot(
            PublicationFormat::Html,
            PaperSize::A4,
            PageOrientation::Portrait,
        ),
        Some(&brand()),
    )
    .unwrap();
    let html = String::from_utf8(html).unwrap();
    assert!(html.contains("Content-Security-Policy"));
    assert!(html.contains("@page { size: A4 portrait;"));
    assert!(html.contains("class=\"brand-lockup\""));
    assert!(html.contains("class=\"report-banner\""));
    assert!(html.contains("class=\"table-of-contents\""));
    assert!(!html.contains("counter-reset:contents"));
    assert!(!html.contains("counter(contents"));
    assert!(html.contains("class=\"section-band\""));
    assert!(html.contains("@page cover"));
    assert!(html.contains("Report ID"));
    assert!(!html.contains("Report number"));
    assert!(html.contains(TlpMarking::Amber.distribution_statement()));
    assert!(html.contains("--tlp-bg:#000000;--tlp-fg:#FFC000"));
    assert!(!html.contains("MITRE Engenuity"));
    assert!(!html.contains("Center for Threat-Informed Defense"));
    assert!(html.contains("Observed &lt;script&gt; remains text, not code."));
    assert!(!html.contains("<script>"));

    let docx = render_publication(
        &publication,
        &snapshot(
            PublicationFormat::Docx,
            PaperSize::A4,
            PageOrientation::Portrait,
        ),
        Some(&brand()),
    )
    .unwrap();
    let document_xml = docx_document_xml(&docx);
    assert!(document_xml.contains("w:w=\"11906\""));
    assert!(document_xml.contains("w:h=\"16838\""));
    assert!(document_xml.contains("Operation Midnight Echo"));
    assert!(document_xml.contains("TABLE OF CONTENTS"));
    assert!(document_xml.contains("TOC \\o &quot;1-1&quot; \\h"));
    assert!(document_xml.matches("w:pageBreakBefore").count() >= 2);
    assert!(document_xml.contains("REPORT ID"));
    assert!(!document_xml.contains("REPORT NUMBER"));
    assert!(document_xml.contains(TlpMarking::Amber.distribution_statement()));
    assert_eq!(document_xml.matches("DRAFT").count(), 1);
    assert!(document_xml.contains("w:titlePg"));
    assert!(document_xml.contains("w:fill=\"000000\""));
    assert!(document_xml.contains("w:color w:val=\"FFC000\""));

    let pdf = render_publication(
        &publication,
        &snapshot(
            PublicationFormat::Pdf,
            PaperSize::A4,
            PageOrientation::Portrait,
        ),
        Some(&brand()),
    )
    .unwrap();
    assert!(pdf.starts_with(b"%PDF-"));
    let (width, height) = first_pdf_media_box(&pdf);
    assert!((width - 595.28).abs() < 0.2, "width was {width}");
    assert!((height - 841.89).abs() < 0.2, "height was {height}");
}

#[test]
fn illicit_report_administration_uses_snapshot_version_and_tlp_in_every_renderer() {
    let template = report_template_catalog()
        .into_iter()
        .find(|template| template.name() == "Illicit Ecosystem Report")
        .unwrap();
    let report =
        GuidedReport::new_blank(id("e7c44850-9f67-4d26-b7e3-0d4ee82339ef"), &template, 1_000)
            .unwrap()
            .revise_fields(
                &template,
                Revision::new(1).unwrap(),
                "Illicit streaming ecosystem assessment",
                BTreeMap::from([
                    (
                        "publication_date".to_owned(),
                        GuidedReportFieldValue::Text("2026-08-02".to_owned()),
                    ),
                    (
                        "authors".to_owned(),
                        GuidedReportFieldValue::Text("Alex Morgan".to_owned()),
                    ),
                    (
                        "investigation_period".to_owned(),
                        GuidedReportFieldValue::Text("January to July 2026".to_owned()),
                    ),
                    (
                        "confidence_terminology".to_owned(),
                        GuidedReportFieldValue::Text(
                            "High, moderate and low confidence".to_owned(),
                        ),
                    ),
                    (
                        "report_scope".to_owned(),
                        narrative("Defined investigative scope."),
                    ),
                    (
                        "executive_summary".to_owned(),
                        narrative("Three-paragraph bottom line up front."),
                    ),
                    (
                        "key_findings".to_owned(),
                        narrative("Key analytical findings."),
                    ),
                    (
                        "purpose_scope".to_owned(),
                        narrative("Collection scope and methodology."),
                    ),
                    (
                        "overall_assessment".to_owned(),
                        narrative("Assessment connecting actors, sites and infrastructure."),
                    ),
                    (
                        "overall_confidence".to_owned(),
                        GuidedReportFieldValue::Text("high".to_owned()),
                    ),
                    (
                        "recommended_actions".to_owned(),
                        narrative("Preserve device, platform and monetisation records."),
                    ),
                ]),
                2_000,
            )
            .unwrap();
    let publication = PublicationIr::from_guided(&report, &template).unwrap();
    let administration_rows = publication
        .sections()
        .iter()
        .find(|section| section.key() == "report_administration")
        .and_then(|section| {
            section.blocks().iter().find_map(|block| match block {
                PublicationBlock::MetadataTable { rows } => Some(rows),
                _ => None,
            })
        })
        .unwrap();
    assert!(
        administration_rows
            .iter()
            .any(|(label, value)| label == "Overall confidence" && value == "High")
    );

    let html = String::from_utf8(
        render_publication(
            &publication,
            &snapshot(
                PublicationFormat::Html,
                PaperSize::A4,
                PageOrientation::Portrait,
            ),
            Some(&brand()),
        )
        .unwrap(),
    )
    .unwrap();
    assert!(html.contains("<table class=\"metadata-table\">"));
    assert!(
        html.contains("<th scope=\"row\">Title</th><td>Illicit streaming ecosystem assessment")
    );
    assert!(html.contains("<th scope=\"row\">Version</th><td>1.0"));
    assert!(html.contains("<th scope=\"row\">Handling marking</th><td>TLP:AMBER"));
    assert!(html.contains("<th scope=\"row\">Overall confidence</th><td>High"));
    assert!(!html.contains("<h3>Purpose and scope</h3>"));
    assert!(!html.contains("<h3>Overall assessment</h3>"));
    let administration_position = html.find("report-administration-title").unwrap();
    let contents_position = html.find("contents-title").unwrap();
    assert!(administration_position < contents_position);
    assert!(
        !html[contents_position..html.find("</nav>").unwrap()].contains("Report Administration")
    );

    let docx = render_publication(
        &publication,
        &snapshot(
            PublicationFormat::Docx,
            PaperSize::A4,
            PageOrientation::Portrait,
        ),
        Some(&brand()),
    )
    .unwrap();
    let document_xml = docx_document_xml(&docx);
    assert!(document_xml.contains(">Title<"));
    assert!(document_xml.contains(">Version<"));
    assert!(document_xml.contains(">Handling marking<"));
    assert!(document_xml.contains(">Overall confidence<"));
    assert!(document_xml.contains(">High<"));
    assert!(!document_xml.contains("Purpose and scope"));
    assert!(!document_xml.contains("Overall assessment"));
    assert!(
        document_xml.find("REPORT ADMINISTRATION").unwrap()
            < document_xml.find("TABLE OF CONTENTS").unwrap()
    );

    let pdf = render_publication(
        &publication,
        &snapshot(
            PublicationFormat::Pdf,
            PaperSize::A4,
            PageOrientation::Portrait,
        ),
        Some(&brand()),
    )
    .unwrap();
    assert!(pdf.starts_with(b"%PDF"));
}

#[test]
fn publication_snapshot_filters_sections_and_page_furniture() {
    let publication = PublicationIr::from_freeform(&freeform_document()).unwrap();
    let furniture: PageFurniture = serde_json::from_value(serde_json::json!({
        "header": false,
        "footer": false,
        "marking": true,
        "page_numbers": false
    }))
    .unwrap();
    let settings = PublicationSettings::from_brand(&brand(), PublicationFormat::Html)
        .with_tlp_marking(Some(TlpMarking::Amber))
        .with_page_furniture(furniture)
        .with_included_sections(vec!["evidence".to_owned()])
        .with_appendices(vec!["none".to_owned()])
        .with_output_file_name("selected-report.html")
        .unwrap();
    let selected_snapshot = PublicationSnapshot::new(
        id("3cc8c81a-9f07-4f99-9dda-5a56bc78c918"),
        PublicationSource::FreeformDocument {
            document_id: freeform_document().id(),
            revision: Revision::new(4).unwrap(),
        },
        settings,
        2_000,
    )
    .unwrap();

    let html = String::from_utf8(
        render_publication(&publication, &selected_snapshot, Some(&brand())).unwrap(),
    )
    .unwrap();
    assert!(html.contains("evil[.]example"));
    assert!(!html.contains("Observed &lt;script&gt; remains text, not code."));
    assert!(!html.contains("@top-center { content: \"TLP:AMBER\""));
    assert!(!html.contains("@bottom-center { content: \"TLP:AMBER\""));
    assert!(!html.contains("@bottom-right { content: \"Page \" counter(page)"));
    assert!(!html.contains("<footer class=\"page-furniture\">"));
}

#[test]
fn letter_landscape_is_reproduced_in_docx_and_pdf_without_changing_standard() {
    let publication = PublicationIr::from_freeform(&freeform_document()).unwrap();
    let docx = render_publication(
        &publication,
        &snapshot(
            PublicationFormat::Docx,
            PaperSize::Letter,
            PageOrientation::Landscape,
        ),
        Some(&brand()),
    )
    .unwrap();
    let document_xml = docx_document_xml(&docx);
    assert!(document_xml.contains("w:w=\"15840\""));
    assert!(document_xml.contains("w:h=\"12240\""));
    assert!(document_xml.contains("w:orient=\"landscape\""));

    let pdf = render_publication(
        &publication,
        &snapshot(
            PublicationFormat::Pdf,
            PaperSize::Letter,
            PageOrientation::Landscape,
        ),
        Some(&brand()),
    )
    .unwrap();
    let (width, height) = first_pdf_media_box(&pdf);
    assert!((width - 792.0).abs() < 0.2, "width was {width}");
    assert!((height - 612.0).abs() < 0.2, "height was {height}");
}

#[test]
fn brand_profile_typefaces_control_html_docx_and_pdf_output() {
    let publication = PublicationIr::from_freeform(&freeform_document()).unwrap();
    let profile = brand_with_typefaces(BrandTypeface::SourceSerif4, BrandTypeface::Geist);

    let html = render_publication(
        &publication,
        &snapshot(
            PublicationFormat::Html,
            PaperSize::A4,
            PageOrientation::Portrait,
        ),
        Some(&profile),
    )
    .unwrap();
    let html = String::from_utf8(html).unwrap();
    assert!(html.contains("--heading-font:'Source Serif 4'"));
    assert!(html.contains("--body-font:'Geist'"));

    let docx = render_publication(
        &publication,
        &snapshot(
            PublicationFormat::Docx,
            PaperSize::A4,
            PageOrientation::Portrait,
        ),
        Some(&profile),
    )
    .unwrap();
    let document_xml = docx_document_xml(&docx);
    assert!(document_xml.contains("w:ascii=\"Source Serif 4\""));
    assert!(document_xml.contains("w:ascii=\"Geist\""));

    let pdf = render_publication(
        &publication,
        &snapshot(
            PublicationFormat::Pdf,
            PaperSize::A4,
            PageOrientation::Portrait,
        ),
        Some(&profile),
    )
    .unwrap();
    assert!(pdf.starts_with(b"%PDF-"));
}

#[test]
fn rich_text_marks_survive_html_docx_and_pdf_publication() {
    let publication = PublicationIr::from_freeform(&rich_text_document()).unwrap();

    let html = render_publication(
        &publication,
        &snapshot(
            PublicationFormat::Html,
            PaperSize::A4,
            PageOrientation::Portrait,
        ),
        Some(&brand()),
    )
    .unwrap();
    let html = String::from_utf8(html).unwrap();
    assert!(html.contains("<strong>high confidence</strong>"));
    assert!(html.contains("<em>time sensitive</em>"));
    assert!(html.contains("<a href=\"https://video.example/evidence/123\">video evidence</a>"));

    let docx = render_publication(
        &publication,
        &snapshot(
            PublicationFormat::Docx,
            PaperSize::A4,
            PageOrientation::Portrait,
        ),
        Some(&brand()),
    )
    .unwrap();
    let document_xml = docx_document_xml(&docx);
    assert!(docx_run_containing(&document_xml, "high confidence").contains("<w:b"));
    assert!(docx_run_containing(&document_xml, "time sensitive").contains("<w:i"));
    assert!(document_xml.contains("video evidence"));
    let document_relationships = docx_archive_entry(&docx, "word/_rels/document.xml.rels");
    assert!(document_relationships.contains("https://video.example/evidence/123"));

    let pdf = render_publication(
        &publication,
        &snapshot(
            PublicationFormat::Pdf,
            PaperSize::A4,
            PageOrientation::Portrait,
        ),
        Some(&brand()),
    )
    .unwrap();
    assert!(pdf.starts_with(b"%PDF-"));
}

#[test]
fn guided_campaign_reports_flow_through_the_same_publication_ir() {
    let template = built_in_report_templates()
        .into_iter()
        .find(|template| template.builtin() == Some(BuiltinReportTemplate::CampaignReport))
        .unwrap();
    let report =
        GuidedReport::new_blank(id("e7c44850-9f67-4d26-b7e3-0d4ee82339ef"), &template, 1_000)
            .unwrap()
            .revise_field(
                Revision::new(1).unwrap(),
                "campaign_name",
                GuidedReportFieldValue::Text("Operation Midnight Echo".to_owned()),
                2_000,
            )
            .unwrap()
            .revise_field(
                Revision::new(2).unwrap(),
                "publication_date",
                GuidedReportFieldValue::Text("2026-07-31".to_owned()),
                3_000,
            )
            .unwrap()
            .revise_field(
                Revision::new(3).unwrap(),
                "authors",
                GuidedReportFieldValue::Text("M. Analyst; R. Reviewer".to_owned()),
                4_000,
            )
            .unwrap()
            .revise_field(
                Revision::new(4).unwrap(),
                "report_version",
                GuidedReportFieldValue::Text("1.2".to_owned()),
                5_000,
            )
            .unwrap();
    let publication = PublicationIr::from_guided(&report, &template).unwrap();

    assert_eq!(publication.title(), "Operation Midnight Echo");
    assert_eq!(publication.metadata("publication_date"), Some("2026-07-31"));
    assert_eq!(
        publication.metadata("authors"),
        Some("M. Analyst; R. Reviewer")
    );
    assert_eq!(publication.metadata("report_version"), Some("1.2"));
    assert!(
        publication
            .sections()
            .iter()
            .all(|section| section.title() != "Executive summary")
    );
}

#[test]
fn guided_reports_omit_empty_optional_content_and_blank_table_rows() {
    let template = built_in_report_templates()
        .into_iter()
        .find(|template| template.builtin() == Some(BuiltinReportTemplate::CampaignReport))
        .unwrap();
    let report =
        GuidedReport::new_blank(id("e7c44850-9f67-4d26-b7e3-0d4ee82339ef"), &template, 1_000)
            .unwrap()
            .revise_field(
                Revision::new(1).unwrap(),
                "executive_summary",
                GuidedReportFieldValue::Narrative(serde_json::json!({
                    "type": "doc",
                    "content": [{
                        "type": "paragraph",
                        "content": [{"type": "text", "text": "Verified campaign summary."}]
                    }]
                })),
                2_000,
            )
            .unwrap()
            .revise_field(
                Revision::new(2).unwrap(),
                "data_sources",
                GuidedReportFieldValue::Rows(vec![BTreeMap::from([
                    ("Source".to_owned(), "  ".to_owned()),
                    ("Type".to_owned(), String::new()),
                    ("Reference".to_owned(), String::new()),
                    ("Accessed".to_owned(), String::new()),
                ])]),
                3_000,
            )
            .unwrap();

    let publication = PublicationIr::from_guided(&report, &template).unwrap();

    assert_eq!(publication.sections().len(), 1);
    assert_eq!(publication.sections()[0].title(), "Executive summary");

    let html = String::from_utf8(
        render_publication(
            &publication,
            &snapshot(
                PublicationFormat::Html,
                PaperSize::A4,
                PageOrientation::Portrait,
            ),
            Some(&brand()),
        )
        .unwrap(),
    )
    .unwrap();
    assert!(!html.contains("Key intelligence gaps"));
    assert!(!html.contains("Data sources"));

    let docx = render_publication(
        &publication,
        &snapshot(
            PublicationFormat::Docx,
            PaperSize::A4,
            PageOrientation::Portrait,
        ),
        Some(&brand()),
    )
    .unwrap();
    let document_xml = docx_document_xml(&docx);
    assert!(!document_xml.contains("KEY INTELLIGENCE GAPS"));
    assert!(!document_xml.contains("DATA SOURCES"));

    let pdf = render_publication(
        &publication,
        &snapshot(
            PublicationFormat::Pdf,
            PaperSize::A4,
            PageOrientation::Portrait,
        ),
        Some(&brand()),
    )
    .unwrap();
    assert!(pdf.starts_with(b"%PDF"));
}

#[test]
fn every_guided_template_omits_unfilled_sections_before_rendering() {
    for template in report_template_catalog() {
        let report =
            GuidedReport::new_blank(id("e7c44850-9f67-4d26-b7e3-0d4ee82339ef"), &template, 1_000)
                .unwrap();
        let publication = PublicationIr::from_guided(&report, &template).unwrap();

        for section in template
            .sections()
            .iter()
            .filter(|section| section.key() != "report_administration")
        {
            assert!(
                publication
                    .sections()
                    .iter()
                    .all(|rendered| rendered.key() != section.key()),
                "{} retained empty section {}",
                template.name(),
                section.title()
            );
        }
        assert!(
            publication
                .sections()
                .iter()
                .all(|section| !section.blocks().is_empty()),
            "{} retained a section without publication blocks",
            template.name()
        );

        let html = render_publication(
            &publication,
            &snapshot(
                PublicationFormat::Html,
                PaperSize::A4,
                PageOrientation::Portrait,
            ),
            Some(&brand()),
        )
        .unwrap();
        assert!(html.starts_with(b"<!doctype html>"));

        let docx = render_publication(
            &publication,
            &snapshot(
                PublicationFormat::Docx,
                PaperSize::A4,
                PageOrientation::Portrait,
            ),
            Some(&brand()),
        )
        .unwrap();
        assert!(docx.starts_with(b"PK"));

        let pdf = render_publication(
            &publication,
            &snapshot(
                PublicationFormat::Pdf,
                PaperSize::A4,
                PageOrientation::Portrait,
            ),
            Some(&brand()),
        )
        .unwrap();
        assert!(pdf.starts_with(b"%PDF"));
    }
}

#[test]
fn guided_evidence_images_render_from_project_assets_without_leaking_internal_ids() {
    const PNG: &[u8] = &[
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x04, 0x00, 0x00, 0x00, 0xb5,
        0x1c, 0x0c, 0x02, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41, 0x54, 0x78, 0xda, 0x63, 0x64,
        0xf8, 0x0f, 0x00, 0x01, 0x05, 0x01, 0x01, 0x27, 0x18, 0xe3, 0x66, 0x00, 0x00, 0x00, 0x00,
        0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ];
    let evidence_id = id("21a6b93a-06ac-4f91-b0a3-46b58af592d1");
    let appendix_evidence_id = id("04c230e7-e13f-4f68-a8b4-da72a31bcb13");
    let template = built_in_report_templates()
        .into_iter()
        .find(|template| template.builtin() == Some(BuiltinReportTemplate::CampaignReport))
        .unwrap();
    let report =
        GuidedReport::new_blank(id("e7c44850-9f67-4d26-b7e3-0d4ee82339ef"), &template, 1_000)
            .unwrap()
            .revise_field(
                Revision::new(1).unwrap(),
                "executive_summary",
                GuidedReportFieldValue::Narrative(serde_json::json!({
                    "type": "doc",
                    "content": [
                        {
                            "type": "evidenceImage",
                            "attrs": {
                                "evidenceId": evidence_id,
                                "alt": "Captured storefront",
                                "title": "Observed landing page",
                                "placement": "inline",
                                "appendixKey": null,
                                "appendixTitle": null
                            }
                        },
                        {
                            "type": "evidenceImage",
                            "attrs": {
                                "evidenceId": appendix_evidence_id,
                                "alt": "Archive overview",
                                "title": null,
                                "placement": "appendix",
                                "appendixKey": "evidence_images",
                                "appendixTitle": "Evidence images"
                            }
                        }
                    ]
                })),
                2_000,
            )
            .unwrap();
    let publication = PublicationIr::from_guided(&report, &template).unwrap();
    assert_eq!(
        publication.sections().last().unwrap().title(),
        "Appendix A — Evidence images"
    );
    let assets = PublicationAssets {
        evidence_images: HashMap::from([
            (evidence_id, PNG.to_vec()),
            (appendix_evidence_id, PNG.to_vec()),
        ]),
        ..PublicationAssets::default()
    };

    let html = String::from_utf8(
        render_publication_with_assets(
            &publication,
            &snapshot(
                PublicationFormat::Html,
                PaperSize::A4,
                PageOrientation::Portrait,
            ),
            Some(&brand()),
            Some(&assets),
        )
        .unwrap(),
    )
    .unwrap();
    assert!(html.contains("data:image/png;base64,"));
    assert!(html.contains("--evidence-image-max-height:243mm"));
    assert!(
        html.contains(
            "@media print{.evidence-image img{max-height:var(--evidence-image-max-height)}"
        )
    );
    assert!(html.contains("Figure 1. Captured storefront — Observed landing page"));
    assert!(html.contains("Figure A.1. Archive overview"));
    assert!(!html.contains(&evidence_id.to_string()));

    let docx = render_publication_with_assets(
        &publication,
        &snapshot(
            PublicationFormat::Docx,
            PaperSize::A4,
            PageOrientation::Portrait,
        ),
        Some(&brand()),
        Some(&assets),
    )
    .unwrap();
    let document_xml = docx_document_xml(&docx);
    assert!(document_xml.contains("Figure 1. Captured storefront — Observed landing page"));
    assert!(document_xml.contains("Figure A.1. Archive overview"));
    assert!(document_xml.contains("<a:blip"));

    let pdf = render_publication_with_assets(
        &publication,
        &snapshot(
            PublicationFormat::Pdf,
            PaperSize::A4,
            PageOrientation::Portrait,
        ),
        Some(&brand()),
        Some(&assets),
    )
    .unwrap();
    assert!(pdf.starts_with(b"%PDF-"));
}
