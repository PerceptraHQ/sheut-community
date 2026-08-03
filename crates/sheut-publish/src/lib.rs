#![forbid(unsafe_code)]

//! HTML, DOCX, and Typst/PDF renderers over one validated publication model.
//! Analyst content is passed as inert data and never evaluated as markup or template source.

use std::{
    collections::{BTreeMap, HashMap},
    error::Error,
    fmt,
    io::Cursor,
};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use docx_rs::{
    AbstractNumbering, AlignmentType, Docx, Footer, Header, Hyperlink, HyperlinkType, IndentLevel,
    Level, LevelJc, LevelText, NumberFormat, Numbering, NumberingId, PageMargin, PageNum,
    PageOrientationType, Paragraph, Pic, Run, RunFonts, Shading, SpecialIndentType, Start, Table,
    TableAlignmentType, TableCell, TableLayoutType, TableOfContents, TableRow, VAlignType,
    WidthType,
};
use serde_json::Value as JsonValue;
use sheut_core::{
    BrandProfile, BrandTypeface, CoverTreatment, DocumentEnvelope, EvidenceFileMetadata,
    GuidedReport, GuidedReportFieldValue, GuidedReportLinkedRows, ImageMediaType, LocalId,
    PageOrientation, ProjectDataReference, ProjectDataReferenceKind, PublicationFormat,
    PublicationSnapshot, ReportFieldKind, ReportTemplateDefinition, render_document,
};
use typst::foundations::{Bytes, Dict, IntoValue, Smart};
use typst_as_lib::TypstEngine;

const GEIST_FONT: &[u8] = include_bytes!("../../../src-tauri/assets/fonts/Geist-Variable.ttf");
const GEIST_MONO_FONT: &[u8] =
    include_bytes!("../../../src-tauri/assets/fonts/GeistMono-Variable.ttf");
const SOURCE_SERIF_FONT: &[u8] =
    include_bytes!("../../../src-tauri/assets/fonts/SourceSerif4-Variable.ttf");
const SHEUT_MARK: &[u8] = include_bytes!("../../../src-tauri/icons/128x128@2x.png");
const MAX_COMPARABLE_TABLE_COLUMNS: usize = 5;

#[derive(Debug, Clone, PartialEq, Eq)]
struct EvidenceReferenceSummary {
    id: LocalId,
    label: String,
    section_titles: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PublicationFonts {
    heading: &'static str,
    body: &'static str,
    mono: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct EvidenceImageBounds {
    max_width_emu: u32,
    max_height_emu: u32,
    max_height_mm: u32,
}

fn evidence_image_bounds(page_width_twips: u32, page_height_twips: u32) -> EvidenceImageBounds {
    // Reserve physical space for margins, caption, and page furniture in every
    // renderer so an oversized figure cannot overlap the footer.
    const HORIZONTAL_MARGINS_TWIPS: u32 = 1_588;
    const VERTICAL_MARGINS_AND_CAPTION_TWIPS: u32 = 3_060;
    const EMU_PER_TWIP: u32 = 635;
    const TENTHS_OF_MILLIMETRES_PER_INCH: u64 = 254;
    const TWIPS_PER_INCH: u64 = 1_440;

    let max_width_twips = page_width_twips.saturating_sub(HORIZONTAL_MARGINS_TWIPS);
    let max_height_twips = page_height_twips.saturating_sub(VERTICAL_MARGINS_AND_CAPTION_TWIPS);
    EvidenceImageBounds {
        max_width_emu: max_width_twips.saturating_mul(EMU_PER_TWIP),
        max_height_emu: max_height_twips.saturating_mul(EMU_PER_TWIP),
        max_height_mm: u32::try_from(
            u64::from(max_height_twips).saturating_mul(TENTHS_OF_MILLIMETRES_PER_INCH)
                / (TWIPS_PER_INCH * 10),
        )
        .unwrap_or(u32::MAX),
    }
}

fn evidence_image_bounds_for_snapshot(snapshot: &PublicationSnapshot) -> EvidenceImageBounds {
    let (mut width, mut height) = snapshot.paper_size().docx_twips();
    if snapshot.orientation() == PageOrientation::Landscape {
        std::mem::swap(&mut width, &mut height);
    }
    evidence_image_bounds(width, height)
}

fn fit_image_dimensions(width: u32, height: u32, max_width: u32, max_height: u32) -> (u32, u32) {
    if width == 0 || height == 0 || max_width == 0 || max_height == 0 {
        return (0, 0);
    }
    if width <= max_width && height <= max_height {
        return (width, height);
    }

    // Compare aspect ratios with integer cross-products. This avoids floating-
    // point drift while u128 keeps attacker-influenced dimensions from wrapping.
    if u128::from(max_width) * u128::from(height) <= u128::from(max_height) * u128::from(width) {
        let scaled_height = u128::from(height) * u128::from(max_width) / u128::from(width);
        (
            max_width,
            u32::try_from(scaled_height).unwrap_or(max_height).max(1),
        )
    } else {
        let scaled_width = u128::from(width) * u128::from(max_height) / u128::from(height);
        (
            u32::try_from(scaled_width).unwrap_or(max_width).max(1),
            max_height,
        )
    }
}

fn emu_to_whole_mm(value: u32) -> i64 {
    const EMU_PER_MILLIMETRE: u64 = 36_000;
    i64::try_from((u64::from(value) + EMU_PER_MILLIMETRE / 2) / EMU_PER_MILLIMETRE)
        .unwrap_or(i64::MAX)
        .max(1)
}

impl PublicationFonts {
    fn from_brand(brand: Option<&BrandProfile>) -> Self {
        Self {
            heading: brand.map_or("Geist", |profile| typeface_name(profile.heading_typeface())),
            body: brand.map_or("Source Serif 4", |profile| {
                typeface_name(profile.body_typeface())
            }),
            mono: brand.map_or("Geist Mono", |profile| {
                typeface_name(profile.mono_typeface())
            }),
        }
    }
}

const fn typeface_name(typeface: BrandTypeface) -> &'static str {
    match typeface {
        BrandTypeface::Geist => "Geist",
        BrandTypeface::GeistMono => "Geist Mono",
        BrandTypeface::SourceSerif4 => "Source Serif 4",
    }
}

const TYPST_TEMPLATE: &str = r##"
#import sys: inputs

#let primary = rgb(inputs.primary)
#let secondary = rgb(inputs.secondary)
#let accent = rgb(inputs.accent)
#let ink = rgb(inputs.text_color)
#let paper = rgb(inputs.background_color)
#let rule = rgb("#B8C2CC")
#let band = rgb(inputs.band_color)
#let muted = rgb(75, 85, 99)
#let tlp-fg = rgb(inputs.tlp_foreground)
#let tlp-bg = rgb(inputs.tlp_background)
#let report-number = if inputs.report_number == "" { "DRAFT" } else { inputs.report_number }
#let publication-date = if inputs.publication_date == "" { "Publication date not set" } else { inputs.publication_date }
#let criticality = if inputs.criticality == "" { "Criticality: Not set" } else { "Criticality: " + inputs.criticality }
#let authors = if inputs.authors == "" { "Author not set" } else { inputs.authors }
#let author-label = if inputs.author_label == "" { "AUTHOR" } else { upper(inputs.author_label) }
#let report-version = if inputs.report_version == "" { "Draft" } else { inputs.report_version }

#set document(
  title: inputs.title,
  author: inputs.pdf_author,
  description: inputs.eyebrow,
)

#let tlp-badge = if inputs.marking == "" { none } else {
  box(
    inset: (x: 7pt, y: 4pt),
    fill: tlp-bg,
    stroke: 0.6pt + tlp-fg,
    radius: 1.5pt,
  )[
    #text(font: inputs.heading_font, size: 12pt, weight: 760, fill: tlp-fg, inputs.marking)
  ]
}

#let section-band(title) = block(
  width: 100%,
  inset: (x: 8pt, y: 6pt),
  fill: band,
)[
  #align(center)[#text(
    font: inputs.heading_font,
    size: 10pt,
    weight: 720,
    tracking: 0.14em,
    fill: ink,
    upper(title),
  )]
]

#let render-inline(spans) = spans.map(span => {
  let styled = text(
    font: inputs.body_font,
    weight: if span.bold { 700 } else { 400 },
    style: if span.italic { "italic" } else { "normal" },
    span.text,
  )
  if span.href == "" { styled } else { link(span.href, styled) }
}).join()

#let render-block(item) = {
  if item.kind == "paragraph" {
    block(below: 6pt)[#render-inline(item.spans)]
  } else if item.kind == "paragraph-gap" {
    block(height: 8pt)[]
  } else if item.kind == "label" {
    block(below: 6pt)[
      #text(font: inputs.heading_font, weight: 680, item.label + ":") #item.text
    ]
  } else if item.kind == "subheading" {
    block(above: 10pt, below: 5pt, breakable: false)[
      #text(font: inputs.heading_font, size: 13pt, weight: 700, fill: primary, item.text)
    ]
  } else if item.kind == "callout" {
    block(
      width: 100%,
      inset: (x: 9pt, y: 7pt),
      below: 7pt,
      fill: rgb("#F3F6F8"),
      stroke: (left: 2.5pt + secondary),
    )[#render-inline(item.spans)]
  } else if item.kind == "list" {
    block(below: 6pt)[
      #set list(indent: 12pt, body-indent: 5pt, spacing: 3pt)
      #list(..item.items.map(spans => [#render-inline(spans)]))
    ]
  } else if item.kind == "metadata-table" {
    block(width: 100%, below: 8pt)[
      #set text(font: inputs.body_font, size: 9pt, hyphenate: false)
      #table(
        columns: (30%, 70%),
        inset: (x: 6pt, y: 6pt),
        stroke: 0.45pt + rule,
        fill: (x, _) => if x == 0 { rgb("#F1F4F6") } else { paper },
        ..item.cells.enumerate().map(((index, value)) => if calc.even(index) {
          text(font: inputs.heading_font, size: 8pt, weight: 700, upper(value))
        } else {
          value
        }),
      )
    ]
  } else if item.kind == "table" {
    block(width: 100%, below: 8pt)[
      #set text(font: inputs.body_font, size: 8.2pt, hyphenate: false)
      #table(
        columns: item.columns,
        inset: (x: 4pt, y: 4.5pt),
        stroke: 0.35pt + rule,
        fill: (x, y) => if y == 0 { rgb("#F1F4F6") } else { paper },
        table.header(..item.headers.map(value => text(
          font: inputs.heading_font,
          size: 7.2pt,
          weight: 700,
          tracking: 0.035em,
          upper(value),
        ))),
        ..item.cells,
      )
    ]
  } else if item.kind == "structured-records" {
    block(width: 100%, below: 8pt)[
      #text(font: inputs.heading_font, size: 10pt, weight: 700, fill: primary, item.label)
      #v(4pt)
      #for (index, record) in item.records.enumerate() {
        block(
          width: 100%,
          inset: 7pt,
          below: 6pt,
          fill: rgb("#F7F9FA"),
          stroke: 0.45pt + rule,
          radius: 2pt,
          breakable: false,
        )[
          #text(
            font: inputs.heading_font,
            size: 8pt,
            weight: 700,
            tracking: 0.025em,
            fill: primary,
            "RECORD " + str(index + 1) + " · " + record.title,
          )
          #v(4pt)
          #set text(font: inputs.body_font, size: 8.5pt, hyphenate: false)
          #table(
            columns: (31%, 69%),
            inset: (x: 4pt, y: 3.5pt),
            stroke: (x, y) => if y == 0 { none } else { (top: 0.3pt + rule) },
            ..record.cells.enumerate().map(((cell-index, cell)) => if calc.even(cell-index) {
              text(font: inputs.heading_font, size: 7.2pt, weight: 700, upper(cell))
            } else {
              cell
            }),
          )
        ]
      }
    ]
  } else if item.kind == "reference-list" {
    block(width: 100%, below: 8pt)[
      #if item.label != "" {
        text(font: inputs.heading_font, size: 10pt, weight: 700, fill: primary, item.label)
        v(4pt)
      }
      #for reference in item.items {
        block(
          width: 100%,
          inset: (x: 7pt, y: 5pt),
          below: 4pt,
          fill: rgb("#F7F9FA"),
          stroke: (left: 2pt + secondary),
        )[
          #text(font: inputs.heading_font, size: 8.5pt, weight: 700, reference.title) \
          #text(font: inputs.body_font, size: 8pt, fill: muted, reference.detail)
        ]
      }
    ]
  } else if item.kind == "evidence-index" {
    block(width: 100%, below: 8pt)[
      #for entry in item.items {
        block(
          width: 100%,
          inset: 7pt,
          below: 6pt,
          fill: rgb("#F7F9FA"),
          stroke: 0.45pt + rule,
          radius: 2pt,
          breakable: false,
        )[
          #text(font: inputs.heading_font, size: 9pt, weight: 700, fill: primary, entry.title)
          #v(4pt)
          #set text(font: inputs.body_font, size: 8.2pt, hyphenate: false)
          #table(
            columns: (25%, 75%),
            inset: (x: 4pt, y: 3pt),
            stroke: (x, y) => if y == 0 { none } else { (top: 0.3pt + rule) },
            ..entry.cells.enumerate().map(((cell-index, cell)) => if calc.even(cell-index) {
              text(font: inputs.heading_font, size: 7pt, weight: 700, upper(cell))
            } else {
              cell
            }),
          )
          #if entry.has_image {
            v(5pt)
            align(center)[
              image(
                entry.bytes,
                width: entry.width_mm * 1mm,
                height: entry.height_mm * 1mm,
                fit: "contain",
                alt: entry.title,
              )
              v(3pt)
              text(
                font: inputs.body_font,
                size: 7.5pt,
                style: "italic",
                fill: muted,
                "Evidence image — " + entry.title,
              )
            ]
          }
        ]
      }
    ]
  } else if item.kind == "evidence-image" {
    block(width: 100%, below: 8pt, breakable: false)[
      #align(center)[
        #image(
          item.bytes,
          width: item.width_mm * 1mm,
          height: item.height_mm * 1mm,
          fit: "contain",
          alt: item.alt,
        )
        #v(3pt)
        #text(font: inputs.body_font, size: 7.5pt, style: "italic", fill: muted, item.caption)
      ]
    ]
  }
}

#let render-section(section) = [
  #heading(level: 1, outlined: true, section.title)
  #v(7pt)
  #for item in section.blocks { render-block(item) }
  #v(9pt)
]

#let render-administration(section) = [
  #heading(level: 1, outlined: false, section.title)
  #v(7pt)
  #for item in section.blocks { render-block(item) }
  #v(9pt)
]

#let running-top = context block(width: 100%)[
  #grid(
    columns: (1fr, 1fr, 1fr),
    align: (left + horizon, center + horizon, right + horizon),
    text(font: inputs.heading_font, size: 7.3pt, weight: 550, report-number),
    align(center)[#tlp-badge],
    text(font: inputs.heading_font, size: 7.3pt, weight: 550, criticality),
  )
  #v(5pt)
  #line(length: 100%, stroke: 0.55pt + ink)
]

#let running-bottom = context block(width: 100%)[
  #line(length: 100%, stroke: 0.55pt + ink)
  #v(5pt)
  #grid(
    columns: (1fr, 1fr, 1fr),
    align: (left + horizon, center + horizon, right + horizon),
    [],
    align(center)[#tlp-badge],
    text(font: inputs.heading_font, size: 8pt)[Page #counter(page).display("1")],
  )
]

#set page(
  paper: inputs.paper,
  flipped: inputs.landscape,
  margin: 0mm,
  header: none,
  footer: none,
  numbering: none,
  fill: paper,
)
#set text(font: inputs.body_font, size: 9.5pt, fill: ink, hyphenate: false)
#set par(justify: false, leading: 0.55em)
#set heading(numbering: none)
#show heading.where(level: 1): it => section-band(it.body)

#block(
  width: 100%,
  height: 100%,
  fill: gradient.linear(primary, secondary, angle: 18deg),
  inset: (x: 16mm, top: 15mm, bottom: 14mm),
)[
  #grid(
    columns: (1fr, 1fr, 1fr),
    align: (left + horizon, center + horizon, right + horizon),
    [
      #grid(
        columns: (22pt, auto),
        column-gutter: 7pt,
        align: horizon,
        image(inputs.logo, width: 22pt, height: 22pt, alt: "Sheut mark"),
        [
          #text(font: inputs.heading_font, size: 10pt, weight: 720, tracking: 0.06em, fill: white, upper(inputs.brand_name))
        ],
      )
    ],
    [],
    align(right + horizon)[#tlp-badge],
  )
  #if inputs.has_cover_artwork {
    v(5mm)
    image(inputs.cover_artwork, width: 100%, height: 24mm, fit: "cover", alt: "Cover artwork")
    v(7mm)
  } else {
    v(28mm)
  }
  #grid(
    columns: (0.95fr, 1.05fr),
    column-gutter: 12mm,
    align: top,
    [
      #set par(leading: 0.12em)
      #text(font: inputs.heading_font, size: 40pt, weight: 780, tracking: 0.015em, fill: white, inputs.family)
    ],
    [
      #set par(leading: 0.2em)
      #text(font: inputs.heading_font, size: 21pt, weight: 690, fill: white, inputs.title)
      #v(9mm)
      #text(font: inputs.heading_font, size: 7pt, weight: 600, tracking: 0.08em, fill: luma(220), [DATE OF REPORT])
      #v(2pt)
      #line(length: 100%, stroke: 0.7pt + white)
      #v(3pt)
      #text(font: inputs.heading_font, size: 11pt, weight: 620, fill: white, publication-date)
    ],
  )
  #v(1fr)
  #line(length: 100%, stroke: 0.55pt + luma(195))
  #v(8mm)
  #grid(
    columns: (1.35fr, 0.9fr, 0.55fr),
    column-gutter: 10mm,
    [
      #text(font: inputs.heading_font, size: 6.5pt, weight: 650, tracking: 0.1em, fill: luma(220), author-label) \
      #v(3pt)
      #text(font: inputs.body_font, size: 10pt, weight: 570, fill: white, authors)
    ],
    [
      #text(font: inputs.heading_font, size: 6.5pt, weight: 650, tracking: 0.1em, fill: luma(220), [REPORT ID]) \
      #v(3pt)
      #text(font: inputs.mono_font, size: 14pt, weight: 700, fill: white, report-number)
    ],
    [
      #text(font: inputs.heading_font, size: 6.5pt, weight: 650, tracking: 0.1em, fill: luma(220), [VERSION]) \
      #v(3pt)
      #text(font: inputs.heading_font, size: 14pt, weight: 720, fill: white, report-version)
    ],
  )
  #v(13mm)
  #grid(
    columns: (1fr),
    align: (left + horizon),
    text(font: inputs.heading_font, size: 7pt, weight: 560, fill: luma(210), inputs.distribution),
  )
]

#pagebreak()
#set page(
  paper: inputs.paper,
  flipped: inputs.landscape,
  margin: (x: 14mm, top: 18mm, bottom: 18mm),
  header: if inputs.header { running-top } else { none },
  footer: if inputs.footer { running-bottom } else { none },
  numbering: none,
  fill: paper,
)
#for section in inputs.administration { render-administration(section) }
#if inputs.administration.len() > 0 { pagebreak() }
#if inputs.include_release_history {
  section-band("Release history")
  v(15mm)
  table(
    columns: (auto, 1fr),
    inset: (x: 5pt, y: 6pt),
    stroke: 0.4pt + rule,
    table.header(
      text(font: inputs.heading_font, weight: 700, [VERSION]),
      text(font: inputs.heading_font, weight: 700, [CHANGES]),
    ),
    ..inputs.release_history_cells,
  )
  pagebreak()
}
#section-band("Table of contents")
#v(15mm)
#outline(title: none, depth: 1, indent: auto)

#pagebreak()
#for section in inputs.sections { render-section(section) }
"##;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublishErrorCode {
    InvalidContent,
    RenderFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PublishError {
    code: PublishErrorCode,
}

impl PublishError {
    const fn new(code: PublishErrorCode) -> Self {
        Self { code }
    }

    #[must_use]
    pub const fn code(self) -> PublishErrorCode {
        self.code
    }
}

impl fmt::Display for PublishError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.code {
            PublishErrorCode::InvalidContent => formatter.write_str("invalid_publication_content"),
            PublishErrorCode::RenderFailed => formatter.write_str("publication_render_failed"),
        }
    }
}

impl Error for PublishError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicationIr {
    title: String,
    eyebrow: String,
    metadata: BTreeMap<String, String>,
    sections: Vec<PublicationSection>,
}

impl PublicationIr {
    pub fn from_freeform(document: &DocumentEnvelope) -> Result<Self, PublishError> {
        let fallback = render_document(document)
            .plain_text()
            .lines()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("Untitled document")
            .trim()
            .to_owned();
        let mut title = None;
        let mut sections = Vec::new();
        let mut current = PublicationSection::new("document", "Analysis");
        let mut pending_paragraph_gap = false;
        for node in document
            .root()
            .get("content")
            .and_then(JsonValue::as_array)
            .into_iter()
            .flatten()
        {
            if node.get("type").and_then(JsonValue::as_str) == Some("heading") {
                pending_paragraph_gap = false;
                let text = node_text(node).trim().to_owned();
                let level = node
                    .get("attrs")
                    .and_then(|attrs| attrs.get("level"))
                    .and_then(JsonValue::as_u64)
                    .unwrap_or(2);
                if level == 1 && title.is_none() && !text.is_empty() {
                    title = Some(text);
                    continue;
                }
                if !text.is_empty() {
                    if !current.blocks.is_empty() {
                        sections.push(current);
                    }
                    current = PublicationSection::new(&section_key(&text), &text);
                }
                continue;
            }
            append_content_node(node, &mut current.blocks, &mut pending_paragraph_gap);
        }
        if !current.blocks.is_empty() || sections.is_empty() {
            sections.push(current);
        }
        finalize_evidence_images(&mut sections);
        let eyebrow = match document.kind() {
            sheut_core::DocumentKind::Investigation => "Investigation",
            sheut_core::DocumentKind::AnalystNote => "Analyst note",
            sheut_core::DocumentKind::Report => "Report",
        };
        Self::new(
            title.unwrap_or(fallback),
            eyebrow.to_owned(),
            BTreeMap::new(),
            sections,
        )
    }

    pub fn from_guided(
        report: &GuidedReport,
        template: &ReportTemplateDefinition,
    ) -> Result<Self, PublishError> {
        if report.template_id() != template.id()
            || report.template_revision() != template.revision()
        {
            return Err(PublishError::new(PublishErrorCode::InvalidContent));
        }
        let included = report.included_sections();
        let mut sections = Vec::new();
        let mut evidence_references = Vec::new();
        for definition in template
            .sections()
            .iter()
            .filter(|section| included.iter().any(|key| key == section.key()))
            .filter(|section| {
                report.section_disposition(section.key())
                    == sheut_core::ReportSectionDisposition::Active
            })
        {
            let mut section = PublicationSection::new(definition.key(), definition.title());
            for field in definition.fields() {
                if let Some(GuidedReportFieldValue::ProjectReferences(references)) =
                    report.fields().get(field.key())
                {
                    collect_evidence_references(
                        &mut evidence_references,
                        references,
                        definition.title(),
                    );
                }
                if let Some(GuidedReportFieldValue::LinkedRows(rows)) =
                    report.fields().get(field.key())
                {
                    collect_linked_row_evidence_references(
                        &mut evidence_references,
                        rows,
                        definition.title(),
                    );
                }
            }
            if definition.key() == "report_administration" {
                let mut rows = vec![("Title".to_owned(), report.title().to_owned())];
                for field in definition.fields() {
                    let Some(value) = report.fields().get(field.key()) else {
                        continue;
                    };
                    match value {
                        GuidedReportFieldValue::Text(value) if !value.trim().is_empty() => {
                            rows.push((
                                field.label().to_owned(),
                                front_matter_value(field.kind(), value),
                            ));
                        }
                        GuidedReportFieldValue::Narrative(root) => {
                            let mut blocks = Vec::new();
                            append_document_blocks(root, &mut blocks);
                            let text = publication_blocks_plain_text(&blocks);
                            if !text.is_empty() {
                                rows.push((field.label().to_owned(), text));
                            }
                        }
                        GuidedReportFieldValue::Rows(values)
                            if field.key() == "additional_metadata" =>
                        {
                            rows.extend(values.iter().filter_map(|row| {
                                let label = row.get("Label")?.trim();
                                let value = row.get("Value")?.trim();
                                (!label.is_empty() && !value.is_empty())
                                    .then(|| (label.to_owned(), value.to_owned()))
                            }));
                        }
                        GuidedReportFieldValue::ProjectReferences(references)
                            if !references.is_empty() =>
                        {
                            rows.push((
                                field.label().to_owned(),
                                references
                                    .iter()
                                    .map(|reference| reference.label())
                                    .collect::<Vec<_>>()
                                    .join(", "),
                            ));
                        }
                        _ => {}
                    }
                }
                section
                    .blocks
                    .push(PublicationBlock::MetadataTable { rows });
                sections.push(section);
                continue;
            }
            for field in definition.fields() {
                let Some(value) = report.fields().get(field.key()) else {
                    continue;
                };
                match value {
                    GuidedReportFieldValue::Text(value) if !value.trim().is_empty() => {
                        section.blocks.push(PublicationBlock::LabeledText {
                            label: field.label().to_owned(),
                            text: value.trim().to_owned(),
                        });
                    }
                    GuidedReportFieldValue::Narrative(root) => {
                        let mut blocks = Vec::new();
                        append_document_blocks(root, &mut blocks);
                        if blocks.is_empty() {
                            continue;
                        }
                        if !field.label().eq_ignore_ascii_case(definition.title()) {
                            section
                                .blocks
                                .push(PublicationBlock::Subheading(field.label().to_owned()));
                        }
                        section.blocks.extend(blocks);
                    }
                    GuidedReportFieldValue::Rows(rows) if !rows.is_empty() => {
                        if let Some(block) = guided_rows_block(field.label(), field.columns(), rows)
                        {
                            section.blocks.push(block);
                        }
                    }
                    GuidedReportFieldValue::LinkedRows(rows) if !rows.rows().is_empty() => {
                        if let Some(block) =
                            guided_rows_block(field.label(), field.columns(), rows.rows())
                        {
                            section.blocks.push(block);
                        }
                    }
                    GuidedReportFieldValue::ProjectReferences(references)
                        if !references.is_empty() && definition.key() != "evidence_appendix" =>
                    {
                        section.blocks.push(PublicationBlock::ReferenceList {
                            label: Some(field.label().to_owned()),
                            items: references
                                .iter()
                                .map(|reference| {
                                    (
                                        reference.label().to_owned(),
                                        reference_kind_label(reference.kind()).to_owned(),
                                    )
                                })
                                .collect(),
                        });
                    }
                    _ => {}
                }
            }
            if !section.blocks.is_empty() {
                sections.push(section);
            }
        }
        collect_evidence_images(&mut evidence_references, &sections);
        append_evidence_reference_index(&mut sections, evidence_references);
        finalize_evidence_images(&mut sections);
        sections.retain(|section| !section.blocks.is_empty());
        let metadata = [
            "report_number",
            "publication_date",
            "authors",
            "report_version",
            "criticality",
            "timeframe",
        ]
        .into_iter()
        .filter_map(|key| match report.fields().get(key) {
            Some(GuidedReportFieldValue::Text(value)) if !value.trim().is_empty() => {
                Some((key.to_owned(), value.trim().to_owned()))
            }
            _ => None,
        })
        .collect();
        Self::new(
            report.title().to_owned(),
            template.name().to_owned(),
            metadata,
            sections,
        )
    }

    fn new(
        title: String,
        eyebrow: String,
        metadata: BTreeMap<String, String>,
        sections: Vec<PublicationSection>,
    ) -> Result<Self, PublishError> {
        if title.trim().is_empty()
            || title.chars().count() > 200
            || title.chars().any(|character| character == '\0')
            || eyebrow.trim().is_empty()
            || eyebrow.chars().count() > 120
            || sections.len() > 256
        {
            return Err(PublishError::new(PublishErrorCode::InvalidContent));
        }
        Ok(Self {
            title: title.trim().to_owned(),
            eyebrow: eyebrow.trim().to_owned(),
            metadata,
            sections,
        })
    }

    #[must_use]
    pub fn title(&self) -> &str {
        &self.title
    }

    #[must_use]
    pub fn eyebrow(&self) -> &str {
        &self.eyebrow
    }

    #[must_use]
    pub fn metadata(&self, key: &str) -> Option<&str> {
        self.metadata.get(key).map(String::as_str)
    }

    #[must_use]
    pub fn sections(&self) -> &[PublicationSection] {
        &self.sections
    }

    #[must_use]
    pub fn evidence_image_ids(&self) -> Vec<LocalId> {
        self.sections
            .iter()
            .flat_map(PublicationSection::blocks)
            .filter_map(|block| match block {
                PublicationBlock::EvidenceImage { evidence_id, .. } => Some(*evidence_id),
                _ => None,
            })
            .collect()
    }

    #[must_use]
    pub fn evidence_ids(&self) -> Vec<LocalId> {
        let mut ids = Vec::new();
        for block in self.sections.iter().flat_map(PublicationSection::blocks) {
            match block {
                PublicationBlock::EvidenceImage { evidence_id, .. } => {
                    if !ids.contains(evidence_id) {
                        ids.push(*evidence_id);
                    }
                }
                PublicationBlock::EvidenceIndex { items } => {
                    for item in items {
                        if !ids.contains(&item.evidence_id) {
                            ids.push(item.evidence_id);
                        }
                    }
                }
                _ => {}
            }
        }
        ids
    }

    fn selected_for(&self, snapshot: &PublicationSnapshot) -> Self {
        let body_selection = snapshot.included_sections();
        let appendix_selection = snapshot.appendices();
        let mut sections = self
            .sections
            .iter()
            .filter(|section| {
                if let Some(key) = section.key.strip_prefix("appendix_") {
                    appendix_selection.is_empty()
                        || appendix_selection
                            .iter()
                            .any(|selected| selected == key || selected == section.key())
                } else {
                    body_selection.is_empty()
                        || body_selection
                            .iter()
                            .any(|selected| selected == section.key())
                }
            })
            .cloned()
            .collect::<Vec<_>>();
        if let Some(administration) = sections
            .iter_mut()
            .find(|section| section.key == "report_administration")
        {
            if let Some(rows) = administration.blocks.iter_mut().find_map(|block| {
                if let PublicationBlock::MetadataTable { rows } = block {
                    Some(rows)
                } else {
                    None
                }
            }) {
                upsert_metadata_row(
                    rows,
                    "Version",
                    snapshot.release_version(),
                    Some("Authors or producing organisation"),
                );
                if let Some(marking) = snapshot.tlp_marking() {
                    upsert_metadata_row(rows, "Handling marking", marking.label(), Some("Version"));
                }
                return Self {
                    title: self.title.clone(),
                    eyebrow: self.eyebrow.clone(),
                    metadata: self.metadata.clone(),
                    sections,
                };
            }
            let insert_at = administration
                .blocks
                .iter()
                .position(|block| {
                    matches!(
                        block,
                        PublicationBlock::LabeledText { label, .. } if label == "Authors"
                    )
                })
                .map_or(administration.blocks.len(), |index| index.saturating_add(1));
            let mut snapshot_values = vec![PublicationBlock::LabeledText {
                label: "Version".to_owned(),
                text: snapshot.release_version().to_owned(),
            }];
            if let Some(marking) = snapshot.tlp_marking() {
                snapshot_values.push(PublicationBlock::LabeledText {
                    label: "Handling marking".to_owned(),
                    text: marking.label().to_owned(),
                });
            }
            administration
                .blocks
                .splice(insert_at..insert_at, snapshot_values);
        }
        Self {
            title: self.title.clone(),
            eyebrow: self.eyebrow.clone(),
            metadata: self.metadata.clone(),
            sections,
        }
    }
}

fn front_matter_value(kind: ReportFieldKind, value: &str) -> String {
    let value = value.trim();
    if !matches!(kind, ReportFieldKind::Choice | ReportFieldKind::Confidence) {
        return value.to_owned();
    }

    let value = value.replace('_', " ");
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return value;
    };
    first.to_uppercase().chain(characters).collect()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicationSection {
    key: String,
    title: String,
    blocks: Vec<PublicationBlock>,
}

impl PublicationSection {
    fn new(key: &str, title: &str) -> Self {
        Self {
            key: key.to_owned(),
            title: title.to_owned(),
            blocks: Vec::new(),
        }
    }

    #[must_use]
    pub fn key(&self) -> &str {
        &self.key
    }

    #[must_use]
    pub fn title(&self) -> &str {
        &self.title
    }

    #[must_use]
    pub fn blocks(&self) -> &[PublicationBlock] {
        &self.blocks
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PublicationBlock {
    Paragraph(PublicationRichText),
    ParagraphGap,
    LabeledText {
        label: String,
        text: String,
    },
    MetadataTable {
        rows: Vec<(String, String)>,
    },
    Subheading(String),
    Callout(PublicationRichText),
    List(Vec<PublicationRichText>),
    Table {
        headers: Vec<String>,
        rows: Vec<Vec<String>>,
    },
    StructuredRecords {
        label: String,
        records: Vec<Vec<(String, String)>>,
    },
    ReferenceList {
        label: Option<String>,
        items: Vec<(String, String)>,
    },
    EvidenceIndex {
        items: Vec<EvidenceIndexItem>,
    },
    EvidenceImage {
        evidence_id: LocalId,
        alt: String,
        title: Option<String>,
        placement: EvidenceImagePlacement,
        figure_label: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EvidenceIndexItem {
    evidence_id: LocalId,
    label: String,
    section_titles: Vec<String>,
}

impl EvidenceIndexItem {
    #[must_use]
    pub const fn evidence_id(&self) -> LocalId {
        self.evidence_id
    }

    #[must_use]
    pub fn label(&self) -> &str {
        &self.label
    }

    #[must_use]
    pub fn section_titles(&self) -> &[String] {
        &self.section_titles
    }
}

fn publication_blocks_plain_text(blocks: &[PublicationBlock]) -> String {
    blocks
        .iter()
        .filter_map(|block| {
            let text = match block {
                PublicationBlock::Paragraph(text) | PublicationBlock::Callout(text) => text
                    .spans()
                    .iter()
                    .map(PublicationInlineSpan::text)
                    .collect::<String>(),
                PublicationBlock::ParagraphGap => String::new(),
                PublicationBlock::LabeledText { label, text } => format!("{label}: {text}"),
                PublicationBlock::MetadataTable { rows } => rows
                    .iter()
                    .map(|(label, value)| format!("{label}: {value}"))
                    .collect::<Vec<_>>()
                    .join("\n"),
                PublicationBlock::Subheading(text) => text.clone(),
                PublicationBlock::List(items) => items
                    .iter()
                    .map(|item| {
                        item.spans()
                            .iter()
                            .map(PublicationInlineSpan::text)
                            .collect::<String>()
                    })
                    .collect::<Vec<_>>()
                    .join("\n"),
                PublicationBlock::Table { headers, rows } => std::iter::once(headers.join(" | "))
                    .chain(rows.iter().map(|row| row.join(" | ")))
                    .collect::<Vec<_>>()
                    .join("\n"),
                PublicationBlock::StructuredRecords { label, records } => {
                    std::iter::once(label.clone())
                        .chain(records.iter().flat_map(|record| {
                            record
                                .iter()
                                .map(|(field, value)| format!("{field}: {value}"))
                        }))
                        .collect::<Vec<_>>()
                        .join("\n")
                }
                PublicationBlock::ReferenceList { label, items } => label
                    .iter()
                    .cloned()
                    .chain(
                        items
                            .iter()
                            .map(|(title, detail)| format!("{title}: {detail}")),
                    )
                    .collect::<Vec<_>>()
                    .join("\n"),
                PublicationBlock::EvidenceIndex { items } => items
                    .iter()
                    .map(|item| {
                        format!(
                            "{}: Cited in {}",
                            item.label,
                            item.section_titles.join("; ")
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n"),
                PublicationBlock::EvidenceImage {
                    alt,
                    title,
                    figure_label,
                    ..
                } => numbered_evidence_caption(figure_label, alt, title.as_deref()),
            };
            let text = text.trim();
            (!text.is_empty()).then(|| text.to_owned())
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn upsert_metadata_row(
    rows: &mut Vec<(String, String)>,
    label: &str,
    value: &str,
    after_label: Option<&str>,
) {
    rows.retain(|(existing, _)| !existing.eq_ignore_ascii_case(label));
    let insert_at = after_label
        .and_then(|after| {
            rows.iter()
                .position(|(existing, _)| existing.eq_ignore_ascii_case(after))
        })
        .map_or(rows.len(), |index| index.saturating_add(1));
    rows.insert(insert_at, (label.to_owned(), value.to_owned()));
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EvidenceImagePlacement {
    Inline,
    Appendix { key: String, title: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicationRichText {
    spans: Vec<PublicationInlineSpan>,
}

impl PublicationRichText {
    fn from_node(node: &JsonValue) -> Option<Self> {
        let mut spans = Vec::new();
        append_inline_spans(node, &mut spans);
        spans.retain(|span| !span.text.is_empty());
        spans
            .iter()
            .any(|span| !span.text.trim().is_empty())
            .then_some(Self { spans })
    }

    #[must_use]
    pub fn spans(&self) -> &[PublicationInlineSpan] {
        &self.spans
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicationInlineSpan {
    text: String,
    bold: bool,
    italic: bool,
    href: Option<String>,
}

impl PublicationInlineSpan {
    #[must_use]
    pub fn text(&self) -> &str {
        &self.text
    }

    #[must_use]
    pub const fn bold(&self) -> bool {
        self.bold
    }

    #[must_use]
    pub const fn italic(&self) -> bool {
        self.italic
    }

    #[must_use]
    pub fn href(&self) -> Option<&str> {
        self.href.as_deref()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PublicationAssets {
    pub logo: Option<Vec<u8>>,
    pub compact_mark: Option<Vec<u8>>,
    pub cover_artwork: Option<Vec<u8>>,
    pub evidence_images: HashMap<LocalId, Vec<u8>>,
    pub evidence_metadata: HashMap<LocalId, EvidenceFileMetadata>,
}

pub fn render_publication(
    publication: &PublicationIr,
    snapshot: &PublicationSnapshot,
    brand: Option<&BrandProfile>,
) -> Result<Vec<u8>, PublishError> {
    render_publication_with_assets(publication, snapshot, brand, None)
}

pub fn render_publication_with_assets(
    publication: &PublicationIr,
    snapshot: &PublicationSnapshot,
    brand: Option<&BrandProfile>,
    assets: Option<&PublicationAssets>,
) -> Result<Vec<u8>, PublishError> {
    let publication = publication.selected_for(snapshot);
    validate_evidence_images(&publication, assets)?;
    match snapshot.format() {
        PublicationFormat::Html => {
            Ok(render_html(&publication, snapshot, brand, assets).into_bytes())
        }
        PublicationFormat::Docx => render_docx(&publication, snapshot, brand, assets),
        PublicationFormat::Pdf => render_pdf(&publication, snapshot, brand, assets),
    }
}

fn validate_evidence_images(
    publication: &PublicationIr,
    assets: Option<&PublicationAssets>,
) -> Result<(), PublishError> {
    for block in publication
        .sections()
        .iter()
        .flat_map(PublicationSection::blocks)
    {
        if let PublicationBlock::EvidenceImage { evidence_id, .. } = block {
            let bytes = assets
                .and_then(|assets| assets.evidence_images.get(evidence_id))
                .ok_or_else(|| PublishError::new(PublishErrorCode::InvalidContent))?;
            ImageMediaType::detect(bytes)
                .map_err(|_| PublishError::new(PublishErrorCode::InvalidContent))?;
        }
    }
    Ok(())
}

fn render_html(
    publication: &PublicationIr,
    snapshot: &PublicationSnapshot,
    brand: Option<&BrandProfile>,
    assets: Option<&PublicationAssets>,
) -> String {
    let paper = match snapshot.paper_size() {
        sheut_core::PaperSize::A4 => "A4",
        sheut_core::PaperSize::Letter => "Letter",
    };
    let orientation = match snapshot.orientation() {
        PageOrientation::Portrait => "portrait",
        PageOrientation::Landscape => "landscape",
    };
    let evidence_image_bounds = evidence_image_bounds_for_snapshot(snapshot);
    let brand_name = brand.map_or("Sheut", BrandProfile::organization_name);
    let fonts = PublicationFonts::from_brand(brand);
    let heading_font = BASE64_STANDARD.encode(GEIST_FONT);
    let body_font = BASE64_STANDARD.encode(SOURCE_SERIF_FONT);
    let mono_font = BASE64_STANDARD.encode(GEIST_MONO_FONT);
    let logo_bytes = assets
        .and_then(|assets| assets.logo.as_deref().or(assets.compact_mark.as_deref()))
        .unwrap_or(SHEUT_MARK);
    let logo = BASE64_STANDARD.encode(logo_bytes);
    let logo_media_type =
        ImageMediaType::detect(logo_bytes).map_or("image/png", ImageMediaType::as_str);
    let cover_artwork = brand
        .filter(|brand| brand.cover_treatment() == CoverTreatment::Artwork)
        .and_then(|_| assets.and_then(|assets| assets.cover_artwork.as_deref()))
        .map(|bytes| {
            let media_type =
                ImageMediaType::detect(bytes).map_or("image/png", ImageMediaType::as_str);
            format!(
                "<img class=\"cover-artwork\" src=\"data:{media_type};base64,{}\" alt=\"\">",
                BASE64_STANDARD.encode(bytes)
            )
        })
        .unwrap_or_default();
    let primary = brand.map_or("#133C55", BrandProfile::primary_color);
    let secondary = brand.map_or("#386FA4", BrandProfile::secondary_color);
    let accent = brand.map_or("#59A5D8", BrandProfile::accent_color);
    let band_color = tint_hex(accent, 0.68);
    let family = publication_family(publication.eyebrow());
    let report_number = publication.metadata("report_number").unwrap_or("DRAFT");
    let publication_date = publication
        .metadata("publication_date")
        .unwrap_or("Publication date not set");
    let authors = publication.metadata("authors").unwrap_or("Author not set");
    let authors_label = author_label(authors);
    let report_version = snapshot.release_version();
    let furniture = snapshot.page_furniture();
    let tlp_marking = snapshot.tlp_marking().filter(|_| furniture.marking());
    let tlp_label = tlp_marking.map_or("", sheut_core::TlpMarking::label);
    let (tlp_foreground, tlp_background) = tlp_marking
        .map(tlp_colors)
        .unwrap_or(("#111111", "transparent"));
    let page_header_rule = if furniture.header() && tlp_marking.is_some() {
        format!(
            "@top-center {{ content: \"{tlp_label}\"; color: {tlp_foreground}; background: {tlp_background}; font: 700 12pt '{heading}'; padding: 1.5mm 2mm; }}",
            heading = fonts.heading
        )
    } else {
        String::new()
    };
    let page_footer_marking_rule = if furniture.footer() && tlp_marking.is_some() {
        format!(
            "@bottom-center {{ content: \"{tlp_label}\"; color: {tlp_foreground}; background: {tlp_background}; font: 700 12pt '{heading}'; padding: 1.5mm 2mm; }}",
            heading = fonts.heading
        )
    } else {
        String::new()
    };
    let page_number_rule = if furniture.page_numbers() {
        format!(
            "@bottom-right {{ content: \"Page \" counter(page); font: 500 8pt '{heading}'; }}",
            heading = fonts.heading
        )
    } else {
        String::new()
    };
    let mut body = String::new();
    body.push_str("<header class=\"report-banner\">");
    body.push_str(&cover_artwork);
    body.push_str("<div class=\"banner-top\"><div class=\"brand-lockup\"><img src=\"data:");
    body.push_str(logo_media_type);
    body.push_str(";base64,");
    body.push_str(&logo);
    body.push_str("\" alt=\"Sheut mark\"><span><strong>");
    body.push_str(&escape_html(brand_name));
    body.push_str("</strong></span></div>");
    if let Some(tlp_marking) = tlp_marking {
        body.push_str("<div class=\"tlp-badge\" style=\"--tlp-bg:");
        body.push_str(tlp_background);
        body.push_str(";--tlp-fg:");
        body.push_str(tlp_foreground);
        body.push_str("\"><strong>");
        body.push_str(tlp_marking.label());
        body.push_str("</strong><span class=\"sr-only\">");
        body.push_str(&escape_html(tlp_marking.distribution_statement()));
        body.push_str("</span></div>");
    }
    body.push_str("</div><div class=\"cover-grid\"><p class=\"report-family\">");
    body.push_str(&escape_html(&family));
    body.push_str("</p><div><h1>");
    body.push_str(&escape_html(publication.title()));
    body.push_str("</h1><dl class=\"cover-meta\"><dt>Date of report</dt><dd>");
    body.push_str(&escape_html(publication_date));
    body.push_str("</dd></dl></div></div><dl class=\"cover-footer\"><div><dt>");
    body.push_str(authors_label);
    body.push_str("</dt><dd>");
    body.push_str(&escape_html(authors));
    body.push_str("</dd></div><div><dt>Report ID</dt><dd>");
    body.push_str(&escape_html(report_number));
    body.push_str("</dd></div><div><dt>Version</dt><dd>");
    body.push_str(&escape_html(report_version));
    body.push_str("</dd></div></dl>");
    if let Some(marking) = tlp_marking {
        body.push_str("<p class=\"cover-distribution\">");
        body.push_str(&escape_html(marking.distribution_statement()));
        body.push_str("</p>");
    }
    body.push_str("</header>");
    if let Some(administration) = publication
        .sections
        .iter()
        .find(|section| section.key == "report_administration")
    {
        body.push_str("<section id=\"section-report_administration\" class=\"report-administration\" aria-labelledby=\"report-administration-title\"><h2 id=\"report-administration-title\" class=\"section-band\">Report Administration</h2>");
        for block in &administration.blocks {
            render_html_block(block, assets, &mut body);
        }
        body.push_str("</section>");
    }
    if snapshot.include_release_history() && !snapshot.release_history().is_empty() {
        body.push_str("<section class=\"release-history\" aria-labelledby=\"release-history-title\"><h2 id=\"release-history-title\" class=\"section-band\">Release history</h2><table><thead><tr><th scope=\"col\">Version</th><th scope=\"col\">Changes</th></tr></thead><tbody>");
        for release in snapshot.release_history() {
            body.push_str("<tr><td>v");
            body.push_str(&escape_html(release.version()));
            body.push_str("</td><td>");
            body.push_str(&escape_html(release.change_note()));
            body.push_str("</td></tr>");
        }
        body.push_str("</tbody></table></section>");
    }
    body.push_str("<nav class=\"table-of-contents\" aria-labelledby=\"contents-title\"><h2 id=\"contents-title\" class=\"section-band\">Table of contents</h2><ol>");
    for section in publication
        .sections
        .iter()
        .filter(|section| section.key != "report_administration")
    {
        body.push_str("<li><a href=\"#section-");
        body.push_str(&escape_html(&section.key));
        body.push_str("\">");
        body.push_str(&escape_html(&section.title));
        body.push_str("</a></li>");
    }
    body.push_str("</ol></nav><main>");
    for section in publication
        .sections
        .iter()
        .filter(|section| section.key != "report_administration")
    {
        body.push_str("<section id=\"section-");
        body.push_str(&escape_html(&section.key));
        body.push_str("\" data-section=\"");
        body.push_str(&escape_html(&section.key));
        body.push_str("\"><h2 class=\"section-band\">");
        body.push_str(&escape_html(&section.title));
        body.push_str("</h2>");
        for block in &section.blocks {
            render_html_block(block, assets, &mut body);
        }
        body.push_str("</section>");
    }
    body.push_str("</main>");
    if furniture.footer() || furniture.page_numbers() {
        body.push_str("<footer class=\"page-furniture\"><span>");
        if furniture.footer() {
            body.push_str(&escape_html(report_number));
        }
        body.push_str("</span><span>");
        if furniture.footer() && tlp_marking.is_some() {
            body.push_str("<strong class=\"tlp-footer-badge\" style=\"--tlp-bg:");
            body.push_str(tlp_background);
            body.push_str(";--tlp-fg:");
            body.push_str(tlp_foreground);
            body.push_str("\">");
            body.push_str(tlp_label);
            body.push_str("</strong>");
        }
        body.push_str("</span><span>");
        if furniture.page_numbers() {
            body.push_str("Page <span class=\"page-number\"></span>");
        }
        body.push_str("</span></footer>");
    }
    // The export is intentionally self-contained. CSP forbids scripts, network
    // fetches, frames, and plugins; only embedded images, fonts, and CSS remain.
    format!(
        concat!(
            "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">",
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
            "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'\">",
            "<title>{title}</title><style>",
            "@font-face{{font-family:'Geist';src:url(data:font/ttf;base64,{heading_font}) format('truetype');font-weight:100 900}}",
            "@font-face{{font-family:'Source Serif 4';src:url(data:font/ttf;base64,{body_font}) format('truetype');font-weight:200 900}}",
            "@font-face{{font-family:'Geist Mono';src:url(data:font/ttf;base64,{mono_font}) format('truetype');font-weight:100 900}}",
            "@page {{ size: {paper} {orientation}; margin: 18mm 14mm; {page_header_rule}{page_footer_marking_rule}{page_number_rule} }}",
            "@page cover {{ size: {paper} {orientation}; margin: 0; @top-center {{ content: none; }} @bottom-center {{ content: none; }} @bottom-right {{ content: none; }} }}",
            ":root{{color-scheme:light;font-family:var(--body-font),serif;color:#111827;background:#fff;--heading-font:'{heading_family}';--body-font:'{body_family}';--mono-font:'{mono_family}';--primary:{primary};--secondary:{secondary};--band:{band_color};--evidence-image-max-height:{evidence_image_max_height_mm}mm}}",
            "*{{box-sizing:border-box}}body{{margin:0;background:#fff}}.sr-only{{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}}",
            ".report-banner{{position:relative;display:flex;min-height:100vh;overflow:hidden;flex-direction:column;padding:2rem max(1.5rem,calc((100vw - 900px)/2));color:#fff;background:linear-gradient(112deg,var(--primary),var(--secondary));page:cover}}.report-banner>*:not(.cover-artwork){{position:relative;z-index:1}}.cover-artwork{{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.38}}",
            ".banner-top,.brand-lockup,.cover-grid,.page-furniture{{display:flex}}.banner-top{{align-items:flex-start;justify-content:space-between;gap:2rem}}",
            ".brand-lockup{{align-items:center;gap:.65rem;text-transform:uppercase}}.brand-lockup img{{width:2.1rem;height:2.1rem}}.brand-lockup span{{display:grid}}.brand-lockup strong{{font-size:.85rem;letter-spacing:.08em}}",
            ".tlp-badge,.tlp-footer-badge{{padding:.35rem .6rem;border:1px solid var(--tlp-fg);border-radius:2px;color:var(--tlp-fg);background:var(--tlp-bg);font-size:.75rem;letter-spacing:.07em}}",
            ".cover-grid{{display:grid;grid-template-columns:minmax(14rem,.85fr) minmax(18rem,1.15fr);gap:clamp(2rem,8vw,7rem);align-items:start;margin-top:clamp(4rem,12vh,8rem)}}",
            ".report-family{{margin:0;font-size:clamp(2.4rem,6vw,4.8rem);font-weight:750;line-height:.92;letter-spacing:.035em}}h1{{margin:0;max-width:22ch;font-size:clamp(1.35rem,3vw,2.25rem);font-weight:560;line-height:1.02}}h1,h2,h3,.report-family,.brand-lockup,.cover-meta,.cover-footer,.page-furniture,.tlp-badge{{font-family:var(--heading-font),sans-serif}}",
            ".cover-meta{{margin:2.2rem 0 0;max-width:17rem}}.cover-meta dt{{font-size:.65rem;letter-spacing:.1em;text-transform:uppercase;color:#dbe5ed}}.cover-meta dd{{margin:.3rem 0 0;padding-top:.35rem;border-top:1px solid #fff;font-size:.9rem}}",
            ".cover-footer{{display:grid;grid-template-columns:2fr 1fr 1fr;gap:2rem;margin:auto 0 0}}.cover-footer div{{min-width:0}}.cover-footer dt{{font-size:.62rem;font-weight:650;letter-spacing:.12em;text-transform:uppercase;color:#dbe5ed}}.cover-footer dd{{margin:.4rem 0 0;font-size:.86rem}}",
            ".cover-distribution{{margin:1.15rem 0 0;padding-top:.7rem;border-top:1px solid rgba(255,255,255,.55);font-family:var(--heading-font),sans-serif;font-size:.68rem;line-height:1.35;color:#eef4f7}}",
            ".report-administration,.release-history,.table-of-contents,main{{width:min(100% - 2rem,900px);margin:0 auto}}.report-administration,.release-history,.table-of-contents{{min-height:100vh;padding:3rem 0}}.report-administration .label{{font-weight:680}}.report-administration .metadata-table{{margin-top:1.25rem;font-size:.88rem}}.report-administration .metadata-table th{{width:30%;font-family:var(--heading-font),sans-serif;font-size:.72rem;letter-spacing:.045em}}.report-administration .metadata-table td{{white-space:pre-line}}.release-history table{{margin-top:2.5rem}}.table-of-contents ol{{margin:2.5rem 0 0;padding:0;list-style:none}}.table-of-contents li{{border-bottom:1px solid #d5dce1}}.table-of-contents a{{display:block;padding:.85rem .25rem;color:inherit;font-family:var(--heading-font),sans-serif;font-weight:620;text-decoration:none}}",
            "main{{padding:2.5rem 0 4rem}}section{{margin:0 0 1.65rem}}.section-band{{margin:0 0 .9rem;padding:.48rem .8rem;background:var(--band);color:#111827;text-align:center;font-size:1rem;font-weight:730;letter-spacing:.16em;text-transform:uppercase}}",
            "h3{{margin:1.15rem 0 .45rem;color:var(--primary);font-size:1.15rem;line-height:1.25}}p,li,td{{font-family:var(--body-font),serif;font-size:.94rem;line-height:1.48}}.label{{font-family:var(--heading-font),sans-serif;font-weight:680}}aside{{border-left:3px solid var(--secondary);background:#f1f4f6;padding:.75rem 1rem;font-family:var(--body-font),serif}}",
            ".paragraph-gap{{height:.8rem}}",
            ".table-wrap{{overflow-x:auto}}table{{width:100%;border-collapse:collapse;font-size:.82rem}}th,td{{border:1px solid #bcc5cc;padding:.5rem;text-align:left;vertical-align:top}}th{{background:#f1f4f6;font-size:.72rem;letter-spacing:.035em;text-transform:uppercase}}.structured-records,.reference-list,.evidence-index{{margin:1rem 0}}.structured-records>h3,.reference-list>h3{{margin-bottom:.65rem}}.structured-record,.evidence-index-item{{margin:.6rem 0;padding:.8rem;border:1px solid #c7d0d7;border-radius:.2rem;background:#f7f9fa;break-inside:avoid}}.structured-record h4,.evidence-index-item h4{{margin:0 0 .55rem;color:var(--primary);font-family:var(--heading-font),sans-serif;font-size:.78rem;letter-spacing:.035em;text-transform:uppercase}}.structured-record dl,.reference-list,.evidence-index-item dl{{display:grid;gap:0}}.structured-record dl,.evidence-index-item dl{{grid-template-columns:minmax(9rem,30%) 1fr;margin:0}}.structured-record dt,.structured-record dd,.evidence-index-item dt,.evidence-index-item dd{{margin:0;padding:.38rem .45rem;border-top:1px solid #d8dee3}}.structured-record dt,.evidence-index-item dt{{font-family:var(--heading-font),sans-serif;font-size:.71rem;font-weight:700;text-transform:uppercase}}.reference-item{{margin:.45rem 0;padding:.55rem .7rem;border-left:3px solid var(--secondary);background:#f7f9fa;break-inside:avoid}}.reference-item dt{{font-family:var(--heading-font),sans-serif;font-weight:700}}.reference-item dd{{margin:.18rem 0 0;color:#4b5563;font-size:.8rem}}.evidence-image{{margin:1rem 0;break-inside:avoid}}.evidence-image img{{display:block;max-width:100%;max-height:70vh;margin:auto;object-fit:contain}}.evidence-image figcaption{{margin-top:.4rem;color:#4b5563;font-size:.78rem;text-align:center}}",
            ".page-furniture{{width:min(100% - 2rem,900px);margin:0 auto 1rem;padding-top:.55rem;border-top:1px solid #111827;justify-content:space-between;gap:1rem;font-size:.72rem}}.page-furniture>span{{display:grid;flex:1}}.page-furniture>span:nth-child(2){{text-align:center}}.page-furniture>span:last-child{{text-align:right}}.page-furniture small{{margin-top:.25rem}}",
            "@media(max-width:650px){{.cover-grid{{grid-template-columns:1fr;gap:2rem;margin-top:3rem}}.report-family{{max-width:10ch}}.cover-footer{{grid-template-columns:1fr 1fr}}.cover-footer div:first-child{{grid-column:1/-1}}.page-furniture{{flex-direction:column}}.page-furniture>span,.page-furniture>span:nth-child(2),.page-furniture>span:last-child{{text-align:left}}}}",
            "@media print{{.evidence-image img{{max-height:var(--evidence-image-max-height)}}.report-banner{{height:100vh;min-height:0;margin:0;padding:15mm 16mm 14mm;break-after:page}}.report-administration,.release-history,.table-of-contents{{width:auto;height:calc(100vh - 36mm);min-height:0;padding:0;break-after:page}}.release-history table,.table-of-contents ol{{margin-top:15mm}}main{{width:auto;margin:0;padding:0}}section{{break-inside:auto}}.section-band{{break-after:avoid}}.table-wrap{{overflow:visible}}.page-furniture{{display:none}}}}",
            "</style></head><body>{body}</body></html>"
        ),
        title = escape_html(publication.title()),
        heading_font = heading_font,
        body_font = body_font,
        mono_font = mono_font,
        heading_family = fonts.heading,
        body_family = fonts.body,
        mono_family = fonts.mono,
        paper = paper,
        orientation = orientation,
        page_header_rule = page_header_rule,
        page_footer_marking_rule = page_footer_marking_rule,
        page_number_rule = page_number_rule,
        primary = primary,
        secondary = secondary,
        band_color = band_color,
        evidence_image_max_height_mm = evidence_image_bounds.max_height_mm,
        body = body,
    )
}

fn render_html_block(
    block: &PublicationBlock,
    assets: Option<&PublicationAssets>,
    output: &mut String,
) {
    match block {
        PublicationBlock::Paragraph(text) => {
            output.push_str("<p>");
            render_html_rich_text(text, output);
            output.push_str("</p>");
        }
        PublicationBlock::ParagraphGap => {
            output.push_str("<div class=\"paragraph-gap\" aria-hidden=\"true\"></div>");
        }
        PublicationBlock::LabeledText { label, text } => {
            output.push_str("<p><span class=\"label\">");
            output.push_str(&escape_html(label));
            output.push_str(":</span> ");
            output.push_str(&escape_html(text));
            output.push_str("</p>");
        }
        PublicationBlock::MetadataTable { rows } => {
            output.push_str("<table class=\"metadata-table\"><tbody>");
            for (label, value) in rows {
                output.push_str("<tr><th scope=\"row\">");
                output.push_str(&escape_html(label));
                output.push_str("</th><td>");
                output.push_str(&escape_html(value));
                output.push_str("</td></tr>");
            }
            output.push_str("</tbody></table>");
        }
        PublicationBlock::Subheading(text) => {
            output.push_str("<h3>");
            output.push_str(&escape_html(text));
            output.push_str("</h3>");
        }
        PublicationBlock::Callout(text) => {
            output.push_str("<aside>");
            render_html_rich_text(text, output);
            output.push_str("</aside>");
        }
        PublicationBlock::List(items) => {
            output.push_str("<ul>");
            for item in items {
                output.push_str("<li>");
                render_html_rich_text(item, output);
                output.push_str("</li>");
            }
            output.push_str("</ul>");
        }
        PublicationBlock::Table { headers, rows } => {
            output.push_str("<div class=\"table-wrap\"><table><thead><tr>");
            for header in headers {
                output.push_str("<th scope=\"col\">");
                output.push_str(&escape_html(header));
                output.push_str("</th>");
            }
            output.push_str("</tr></thead><tbody>");
            for row in rows {
                output.push_str("<tr>");
                for cell in row {
                    output.push_str("<td>");
                    output.push_str(&escape_html(cell));
                    output.push_str("</td>");
                }
                output.push_str("</tr>");
            }
            output.push_str("</tbody></table></div>");
        }
        PublicationBlock::StructuredRecords { label, records } => {
            output.push_str("<div class=\"structured-records\"><h3>");
            output.push_str(&escape_html(label));
            output.push_str("</h3>");
            for (index, record) in records.iter().enumerate() {
                output.push_str("<article class=\"structured-record\"><h4>Record ");
                output.push_str(&(index.saturating_add(1)).to_string());
                if let Some((_, title)) = record.first() {
                    output.push_str(" · ");
                    output.push_str(&escape_html(title));
                }
                output.push_str("</h4><dl>");
                for (field, value) in record {
                    output.push_str("<dt>");
                    output.push_str(&escape_html(field));
                    output.push_str("</dt><dd>");
                    output.push_str(&escape_html(value));
                    output.push_str("</dd>");
                }
                output.push_str("</dl></article>");
            }
            output.push_str("</div>");
        }
        PublicationBlock::ReferenceList { label, items } => {
            output.push_str("<div class=\"reference-list\">");
            if let Some(label) = label {
                output.push_str("<h3>");
                output.push_str(&escape_html(label));
                output.push_str("</h3>");
            }
            output.push_str("<dl>");
            for (title, detail) in items {
                output.push_str("<div class=\"reference-item\"><dt>");
                output.push_str(&escape_html(title));
                output.push_str("</dt><dd>");
                output.push_str(&escape_html(detail));
                output.push_str("</dd></div>");
            }
            output.push_str("</dl></div>");
        }
        PublicationBlock::EvidenceIndex { items } => {
            output.push_str("<div class=\"evidence-index\">");
            for item in items {
                output.push_str("<article class=\"evidence-index-item\"><h4>");
                output.push_str(&escape_html(evidence_index_title(item, assets)));
                output.push_str("</h4><dl>");
                for (label, value) in evidence_index_details(item, assets) {
                    output.push_str("<dt>");
                    output.push_str(&escape_html(&label));
                    output.push_str("</dt><dd>");
                    output.push_str(&escape_html(&value));
                    output.push_str("</dd>");
                }
                output.push_str("</dl>");
                if let Some(bytes) =
                    assets.and_then(|assets| assets.evidence_images.get(&item.evidence_id))
                    && let Ok(media_type) = ImageMediaType::detect(bytes)
                {
                    output.push_str("<figure class=\"evidence-image\"><img src=\"data:");
                    output.push_str(media_type.as_str());
                    output.push_str(";base64,");
                    output.push_str(&BASE64_STANDARD.encode(bytes));
                    output.push_str("\" alt=\"");
                    output.push_str(&escape_html(evidence_index_title(item, assets)));
                    output.push_str("\"><figcaption>Evidence image — ");
                    output.push_str(&escape_html(evidence_index_title(item, assets)));
                    output.push_str("</figcaption></figure>");
                }
                output.push_str("</article>");
            }
            output.push_str("</div>");
        }
        PublicationBlock::EvidenceImage {
            evidence_id,
            alt,
            title,
            figure_label,
            ..
        } => {
            let bytes = assets
                .and_then(|assets| assets.evidence_images.get(evidence_id))
                .expect("evidence images are validated before rendering");
            let media_type = ImageMediaType::detect(bytes)
                .expect("evidence images are validated before rendering")
                .as_str();
            output.push_str("<figure class=\"evidence-image\"><img src=\"data:");
            output.push_str(media_type);
            output.push_str(";base64,");
            output.push_str(&BASE64_STANDARD.encode(bytes));
            output.push_str("\" alt=\"");
            output.push_str(&escape_html(alt));
            output.push_str("\"><figcaption>");
            output.push_str(&escape_html(&numbered_evidence_caption(
                figure_label,
                alt,
                title.as_deref(),
            )));
            output.push_str("</figcaption></figure>");
        }
    }
}

fn render_html_rich_text(text: &PublicationRichText, output: &mut String) {
    for span in text.spans() {
        if let Some(href) = span.href() {
            output.push_str("<a href=\"");
            output.push_str(&escape_html(href));
            output.push_str("\">");
        }
        if span.bold() {
            output.push_str("<strong>");
        }
        if span.italic() {
            output.push_str("<em>");
        }
        output.push_str(&escape_html(span.text()));
        if span.italic() {
            output.push_str("</em>");
        }
        if span.bold() {
            output.push_str("</strong>");
        }
        if span.href().is_some() {
            output.push_str("</a>");
        }
    }
}

fn render_docx(
    publication: &PublicationIr,
    snapshot: &PublicationSnapshot,
    brand: Option<&BrandProfile>,
    assets: Option<&PublicationAssets>,
) -> Result<Vec<u8>, PublishError> {
    let (mut width, mut height) = snapshot.paper_size().docx_twips();
    if snapshot.orientation() == PageOrientation::Landscape {
        std::mem::swap(&mut width, &mut height);
    }
    let evidence_image_bounds = evidence_image_bounds(width, height);
    let orientation = match snapshot.orientation() {
        PageOrientation::Portrait => PageOrientationType::Portrait,
        PageOrientation::Landscape => PageOrientationType::Landscape,
    };
    let furniture = snapshot.page_furniture();
    let brand_name = brand.map_or("Sheut", BrandProfile::organization_name);
    let fonts = PublicationFonts::from_brand(brand);
    let primary = brand.map_or("133C55", BrandProfile::primary_color);
    let primary = primary.trim_start_matches('#');
    let band = tint_hex(brand.map_or("#59A5D8", BrandProfile::accent_color), 0.68);
    let band = band.trim_start_matches('#');
    let family = publication_family(publication.eyebrow());
    let report_number = publication.metadata("report_number").unwrap_or("DRAFT");
    let publication_date = publication
        .metadata("publication_date")
        .unwrap_or("Publication date not set");
    let authors = publication.metadata("authors").unwrap_or("Author not set");
    let authors_label = author_label(authors);
    let report_version = snapshot.release_version();
    let tlp_marking = snapshot.tlp_marking().filter(|_| furniture.marking());
    let content_width = width.saturating_sub(1_588) as usize;
    let bullet_numbering = AbstractNumbering::new(2).add_level(
        Level::new(
            0,
            Start::new(1),
            NumberFormat::new("bullet"),
            LevelText::new("•"),
            LevelJc::new("left"),
        )
        .indent(Some(420), Some(SpecialIndentType::Hanging(240)), None, None),
    );
    let mut document = Docx::new()
        .page_size(width, height)
        .page_orient(orientation)
        .page_margin(
            PageMargin::new()
                .top(1_020)
                .bottom(1_020)
                .left(794)
                .right(794)
                .header(510)
                .footer(510),
        )
        .default_size(20)
        .default_fonts(run_fonts(fonts.body))
        .add_abstract_numbering(bullet_numbering)
        .add_numbering(Numbering::new(2, 2));
    if furniture.header() || tlp_marking.is_some() {
        let mut header = Header::new();
        if furniture.header() && tlp_marking.is_none() {
            header = header.add_paragraph(
                Paragraph::new()
                    .align(AlignmentType::Center)
                    .add_run(heading_run(fonts, brand_name).size(16)),
            );
        }
        if let Some(marking) = tlp_marking {
            header = header.add_paragraph(
                Paragraph::new()
                    .align(AlignmentType::Center)
                    .add_run(tlp_docx_run(fonts, marking)),
            );
        }
        document = document.header(header);
    }
    if furniture.footer() || furniture.page_numbers() || tlp_marking.is_some() {
        let mut footer = Footer::new();
        if let Some(marking) = tlp_marking {
            footer = footer.add_paragraph(
                Paragraph::new()
                    .align(AlignmentType::Center)
                    .add_run(tlp_docx_run(fonts, marking)),
            );
        }
        if furniture.page_numbers() {
            footer = footer.add_paragraph(
                Paragraph::new()
                    .align(AlignmentType::Right)
                    .add_run(heading_run(fonts, "Page ").size(16))
                    .add_page_num(PageNum::new()),
            );
        }
        document = document.footer(footer);
    }
    document = document
        .first_header(Header::new().add_paragraph(Paragraph::new()))
        .first_footer(Footer::new().add_paragraph(Paragraph::new()));
    let lockup_width = content_width * 3 / 4;
    let marking_width = content_width - lockup_width;
    let logo = assets
        .and_then(|assets| assets.logo.as_ref().or(assets.compact_mark.as_ref()))
        .cloned()
        .unwrap_or_else(|| SHEUT_MARK.to_vec());
    let cover_lockup = Table::without_borders(vec![TableRow::new(vec![
        TableCell::new()
            .add_paragraph(
                Paragraph::new()
                    .add_run(Run::new().add_image(Pic::new_with_dimensions(logo, 42, 42)))
                    .add_run(
                        heading_run(fonts, format!("  {}", brand_name.to_uppercase()))
                            .bold()
                            .size(20)
                            .color("FFFFFF"),
                    ),
            )
            .vertical_align(VAlignType::Center)
            .shading(Shading::new().fill(primary))
            .width(lockup_width, WidthType::Dxa),
        TableCell::new()
            .add_paragraph(Paragraph::new().align(AlignmentType::Right).add_run(
                tlp_marking.map_or_else(
                    || heading_run(fonts, ""),
                    |marking| tlp_docx_run(fonts, marking),
                ),
            ))
            .vertical_align(VAlignType::Center)
            .shading(Shading::new().fill(primary))
            .width(marking_width, WidthType::Dxa),
    ])])
    .set_grid(vec![lockup_width, marking_width])
    .layout(TableLayoutType::Fixed)
    .width(content_width, WidthType::Dxa);
    document = document.add_table(cover_lockup);
    if brand.is_some_and(|brand| brand.cover_treatment() == CoverTreatment::Artwork)
        && let Some(artwork) = assets.and_then(|assets| assets.cover_artwork.as_ref())
    {
        document =
            document.add_paragraph(Paragraph::new().align(AlignmentType::Center).add_run(
                Run::new().add_image(Pic::new_with_dimensions(artwork.clone(), 620, 180)),
            ));
    }
    document = document
        .add_paragraph(
            shaded_paragraph(primary).add_run(heading_run(fonts, "").size(18).color("FFFFFF")),
        )
        .add_paragraph(
            shaded_paragraph(primary).add_run(
                heading_run(fonts, family.to_uppercase())
                    .bold()
                    .size(58)
                    .color("FFFFFF"),
            ),
        )
        .add_paragraph(
            shaded_paragraph(primary).add_run(
                heading_run(fonts, publication.title())
                    .bold()
                    .size(34)
                    .color("FFFFFF"),
            ),
        )
        .add_paragraph(
            shaded_paragraph(primary).add_run(
                heading_run(fonts, format!("DATE OF REPORT  |  {publication_date}"))
                    .bold()
                    .size(19)
                    .color("FFFFFF"),
            ),
        )
        .add_paragraph(
            shaded_paragraph(primary).add_run(heading_run(fonts, "").size(140).color("FFFFFF")),
        )
        .add_paragraph(cover_metadata_paragraph(
            fonts,
            fonts.body,
            primary,
            authors_label,
            authors,
        ))
        .add_paragraph(cover_metadata_paragraph(
            fonts,
            fonts.mono,
            primary,
            "Report ID",
            report_number,
        ))
        .add_paragraph(cover_metadata_paragraph(
            fonts,
            fonts.body,
            primary,
            "Version",
            report_version,
        ))
        .add_paragraph(
            shaded_paragraph(primary).add_run(
                heading_run(
                    fonts,
                    tlp_marking.map_or("", sheut_core::TlpMarking::distribution_statement),
                )
                .size(15)
                .color("EAF1F5"),
            ),
        );
    if let Some(administration) = publication
        .sections
        .iter()
        .find(|section| section.key == "report_administration")
    {
        document = document.add_paragraph(
            shaded_paragraph(band)
                .page_break_before(true)
                .keep_next(true)
                .align(AlignmentType::Center)
                .add_run(
                    heading_run(fonts, "REPORT ADMINISTRATION")
                        .bold()
                        .size(25)
                        .color("111827"),
                ),
        );
        for block in &administration.blocks {
            document = add_docx_block(
                document,
                block,
                fonts,
                assets,
                evidence_image_bounds,
                content_width,
            );
        }
    }
    if snapshot.include_release_history() && !snapshot.release_history().is_empty() {
        let mut rows = vec![TableRow::new(vec![
            TableCell::new().add_paragraph(
                Paragraph::new().add_run(heading_run(fonts, "VERSION").bold().size(18)),
            ),
            TableCell::new().add_paragraph(
                Paragraph::new().add_run(heading_run(fonts, "CHANGES").bold().size(18)),
            ),
        ])];
        rows.extend(snapshot.release_history().iter().map(|release| {
            TableRow::new(vec![
                TableCell::new().add_paragraph(
                    Paragraph::new()
                        .add_run(body_run(fonts, format!("v{}", release.version())).size(19)),
                ),
                TableCell::new().add_paragraph(
                    Paragraph::new().add_run(body_run(fonts, release.change_note()).size(19)),
                ),
            ])
        }));
        document = document
            .add_paragraph(
                shaded_paragraph(band)
                    .page_break_before(true)
                    .keep_next(true)
                    .align(AlignmentType::Center)
                    .add_run(
                        heading_run(fonts, "RELEASE HISTORY")
                            .bold()
                            .size(25)
                            .color("111827"),
                    ),
            )
            .add_table(
                Table::new(rows)
                    .set_grid(vec![1_800, content_width.saturating_sub(1_800)])
                    .align(TableAlignmentType::Center)
                    .width(content_width, WidthType::Dxa)
                    .style("TableGrid"),
            );
    }
    document = document
        .add_paragraph(
            shaded_paragraph(band)
                .page_break_before(true)
                .keep_next(true)
                .align(AlignmentType::Center)
                .add_run(
                    heading_run(fonts, "TABLE OF CONTENTS")
                        .bold()
                        .size(25)
                        .color("111827"),
                ),
        )
        .add_table_of_contents(
            TableOfContents::new()
                .heading_styles_range(1, 1)
                .hyperlink()
                .auto()
                .dirty(),
        );
    for (index, section) in publication
        .sections
        .iter()
        .filter(|section| section.key != "report_administration")
        .enumerate()
    {
        let mut heading = shaded_paragraph(band)
            .style("Heading1")
            .keep_next(true)
            .align(AlignmentType::Center)
            .add_run(
                heading_run(fonts, section.title.to_uppercase())
                    .bold()
                    .size(25)
                    .color("111827"),
            );
        if index == 0 {
            heading = heading.page_break_before(true);
        }
        document = document.add_paragraph(heading);
        for block in &section.blocks {
            document = add_docx_block(
                document,
                block,
                fonts,
                assets,
                evidence_image_bounds,
                content_width,
            );
        }
    }
    let mut bytes = Cursor::new(Vec::new());
    document
        .build()
        .pack(&mut bytes)
        .map_err(|_| PublishError::new(PublishErrorCode::RenderFailed))?;
    Ok(bytes.into_inner())
}

fn heading_run(fonts: PublicationFonts, text: impl Into<String>) -> Run {
    font_run(fonts.heading, text)
}

fn body_run(fonts: PublicationFonts, text: impl Into<String>) -> Run {
    font_run(fonts.body, text)
}

fn font_run(font: &'static str, text: impl Into<String>) -> Run {
    Run::new().fonts(run_fonts(font)).add_text(text)
}

fn run_fonts(font: &'static str) -> RunFonts {
    RunFonts::new().ascii(font).hi_ansi(font).cs(font)
}

fn author_label(authors: &str) -> &'static str {
    let author_count = authors
        .split([';', '\n'])
        .filter(|author| !author.trim().is_empty())
        .take(2)
        .count();
    if author_count > 1 {
        "Authors"
    } else {
        "Author"
    }
}

fn cover_metadata_paragraph(
    fonts: PublicationFonts,
    value_font: &'static str,
    fill: &str,
    label: &str,
    value: &str,
) -> Paragraph {
    shaded_paragraph(fill)
        .add_run(
            heading_run(fonts, format!("{}  ", label.to_uppercase()))
                .bold()
                .size(15)
                .color("D7E3EA"),
        )
        .add_run(font_run(value_font, value).size(20).color("FFFFFF"))
}

fn tlp_docx_run(fonts: PublicationFonts, marking: sheut_core::TlpMarking) -> Run {
    let (foreground, background) = tlp_colors(marking);
    heading_run(fonts, marking.label())
        .bold()
        .size(24)
        .color(foreground.trim_start_matches('#'))
        .shading(Shading::new().fill(background.trim_start_matches('#')))
}

fn shaded_paragraph(fill: &str) -> Paragraph {
    let mut paragraph = Paragraph::new();
    paragraph.property = paragraph.property.shading(Shading::new().fill(fill));
    paragraph
}

fn add_docx_block(
    document: Docx,
    block: &PublicationBlock,
    fonts: PublicationFonts,
    assets: Option<&PublicationAssets>,
    evidence_image_bounds: EvidenceImageBounds,
    content_width: usize,
) -> Docx {
    match block {
        PublicationBlock::Paragraph(text) => {
            document.add_paragraph(add_docx_rich_text(Paragraph::new(), text, fonts, false))
        }
        PublicationBlock::ParagraphGap => document.add_paragraph(Paragraph::new()),
        PublicationBlock::LabeledText { label, text } => document.add_paragraph(
            Paragraph::new()
                .add_run(heading_run(fonts, format!("{label}: ")).bold().size(20))
                .add_run(body_run(fonts, text).size(20)),
        ),
        PublicationBlock::MetadataTable { rows } => {
            let label_width = content_width.saturating_mul(3) / 10;
            let value_width = content_width.saturating_sub(label_width);
            let table_rows = rows
                .iter()
                .map(|(label, value)| {
                    TableRow::new(vec![
                        TableCell::new()
                            .add_paragraph(
                                Paragraph::new().add_run(heading_run(fonts, label).bold().size(17)),
                            )
                            .vertical_align(VAlignType::Center)
                            .shading(Shading::new().fill("F1F4F6"))
                            .width(label_width, WidthType::Dxa),
                        TableCell::new()
                            .add_paragraph(
                                Paragraph::new().add_run(body_run(fonts, value).size(19)),
                            )
                            .vertical_align(VAlignType::Center)
                            .width(value_width, WidthType::Dxa),
                    ])
                })
                .collect();
            document.add_table(
                Table::new(table_rows)
                    .set_grid(vec![label_width, value_width])
                    .align(TableAlignmentType::Center)
                    .width(content_width, WidthType::Dxa)
                    .style("TableGrid"),
            )
        }
        PublicationBlock::Subheading(text) => document.add_paragraph(
            Paragraph::new()
                .style("Heading2")
                .keep_next(true)
                .add_run(heading_run(fonts, text).bold().size(26).color("133C55")),
        ),
        PublicationBlock::Callout(text) => document.add_paragraph(add_docx_rich_text(
            shaded_paragraph("F1F4F6"),
            text,
            fonts,
            true,
        )),
        PublicationBlock::List(items) => items.iter().fold(document, |document, item| {
            document.add_paragraph(add_docx_rich_text(
                Paragraph::new().numbering(NumberingId::new(2), IndentLevel::new(0)),
                item,
                fonts,
                false,
            ))
        }),
        PublicationBlock::Table { headers, rows } => {
            let column_width = content_width
                .checked_div(headers.len())
                .unwrap_or(content_width);
            let mut table_rows = Vec::with_capacity(rows.len() + 1);
            table_rows.push(TableRow::new(
                headers
                    .iter()
                    .map(|header| {
                        TableCell::new()
                            .add_paragraph(
                                Paragraph::new()
                                    .align(AlignmentType::Center)
                                    .add_run(heading_run(fonts, header).bold().size(17)),
                            )
                            .vertical_align(VAlignType::Center)
                            .shading(Shading::new().fill("E6EDF2"))
                            .width(column_width, WidthType::Dxa)
                    })
                    .collect(),
            ));
            table_rows.extend(rows.iter().map(|row| {
                TableRow::new(
                    row.iter()
                        .map(|cell| {
                            TableCell::new()
                                .add_paragraph(
                                    Paragraph::new().add_run(body_run(fonts, cell).size(18)),
                                )
                                .vertical_align(VAlignType::Center)
                                .width(column_width, WidthType::Dxa)
                        })
                        .collect(),
                )
            }));
            document.add_table(
                Table::new(table_rows)
                    .set_grid(vec![column_width; headers.len()])
                    .align(TableAlignmentType::Center)
                    .width(content_width, WidthType::Dxa)
                    .style("TableGrid"),
            )
        }
        PublicationBlock::StructuredRecords { label, records } => {
            let document = document.add_paragraph(
                Paragraph::new()
                    .keep_next(true)
                    .add_run(heading_run(fonts, label).bold().size(21).color("133C55")),
            );
            records
                .iter()
                .enumerate()
                .fold(document, |document, (index, record)| {
                    let title = record.first().map_or_else(
                        || format!("Record {}", index.saturating_add(1)),
                        |(_, value)| format!("Record {} · {value}", index.saturating_add(1)),
                    );
                    let label_width = content_width.saturating_mul(3) / 10;
                    let value_width = content_width.saturating_sub(label_width);
                    let rows = record
                        .iter()
                        .map(|(field, value)| {
                            TableRow::new(vec![
                                TableCell::new()
                                    .add_paragraph(
                                        Paragraph::new()
                                            .add_run(heading_run(fonts, field).bold().size(16)),
                                    )
                                    .shading(Shading::new().fill("F1F4F6"))
                                    .width(label_width, WidthType::Dxa),
                                TableCell::new()
                                    .add_paragraph(
                                        Paragraph::new().add_run(body_run(fonts, value).size(18)),
                                    )
                                    .width(value_width, WidthType::Dxa),
                            ])
                        })
                        .collect();
                    document
                        .add_paragraph(
                            shaded_paragraph("F7F9FA")
                                .keep_next(true)
                                .add_run(heading_run(fonts, title).bold().size(17).color("133C55")),
                        )
                        .add_table(
                            Table::new(rows)
                                .set_grid(vec![label_width, value_width])
                                .align(TableAlignmentType::Center)
                                .width(content_width, WidthType::Dxa)
                                .style("TableGrid"),
                        )
                })
        }
        PublicationBlock::ReferenceList { label, items } => {
            let document = if let Some(label) = label {
                document.add_paragraph(
                    Paragraph::new()
                        .keep_next(true)
                        .add_run(heading_run(fonts, label).bold().size(21).color("133C55")),
                )
            } else {
                document
            };
            items.iter().fold(document, |document, (title, detail)| {
                document.add_paragraph(
                    shaded_paragraph("F7F9FA")
                        .add_run(heading_run(fonts, title).bold().size(18))
                        .add_run(
                            body_run(fonts, format!("\n{detail}"))
                                .size(17)
                                .color("4B5563"),
                        ),
                )
            })
        }
        PublicationBlock::EvidenceIndex { items } => {
            items.iter().fold(document, |document, item| {
                let label_width = content_width.saturating_mul(25) / 100;
                let value_width = content_width.saturating_sub(label_width);
                let rows = evidence_index_details(item, assets)
                    .into_iter()
                    .map(|(label, value)| {
                        TableRow::new(vec![
                            TableCell::new()
                                .add_paragraph(
                                    Paragraph::new()
                                        .add_run(heading_run(fonts, label).bold().size(16)),
                                )
                                .shading(Shading::new().fill("F1F4F6"))
                                .width(label_width, WidthType::Dxa),
                            TableCell::new()
                                .add_paragraph(
                                    Paragraph::new().add_run(body_run(fonts, value).size(18)),
                                )
                                .width(value_width, WidthType::Dxa),
                        ])
                    })
                    .collect();
                let document = document
                    .add_paragraph(
                        shaded_paragraph("F7F9FA").keep_next(true).add_run(
                            heading_run(fonts, evidence_index_title(item, assets))
                                .bold()
                                .size(18)
                                .color("133C55"),
                        ),
                    )
                    .add_table(
                        Table::new(rows)
                            .set_grid(vec![label_width, value_width])
                            .align(TableAlignmentType::Center)
                            .width(content_width, WidthType::Dxa)
                            .style("TableGrid"),
                    );
                let Some(bytes) =
                    assets.and_then(|assets| assets.evidence_images.get(&item.evidence_id))
                else {
                    return document;
                };
                let mut picture = Pic::new(bytes);
                let fitted_size = fit_image_dimensions(
                    picture.size.0,
                    picture.size.1,
                    evidence_image_bounds.max_width_emu,
                    evidence_image_bounds.max_height_emu,
                );
                picture = picture.size(fitted_size.0, fitted_size.1);
                document
                    .add_paragraph(
                        Paragraph::new()
                            .align(AlignmentType::Center)
                            .add_run(Run::new().add_image(picture)),
                    )
                    .add_paragraph(
                        Paragraph::new().align(AlignmentType::Center).add_run(
                            body_run(
                                fonts,
                                format!("Evidence image — {}", evidence_index_title(item, assets)),
                            )
                            .italic()
                            .size(17)
                            .color("4B5563"),
                        ),
                    )
            })
        }
        PublicationBlock::EvidenceImage {
            evidence_id,
            alt,
            title,
            figure_label,
            ..
        } => {
            let bytes = assets
                .and_then(|assets| assets.evidence_images.get(evidence_id))
                .expect("evidence images are validated before rendering");
            let mut picture = Pic::new(bytes);
            let fitted_size = fit_image_dimensions(
                picture.size.0,
                picture.size.1,
                evidence_image_bounds.max_width_emu,
                evidence_image_bounds.max_height_emu,
            );
            if fitted_size != picture.size {
                picture = picture.size(fitted_size.0, fitted_size.1);
            }
            document
                .add_paragraph(
                    Paragraph::new()
                        .align(AlignmentType::Center)
                        .add_run(Run::new().add_image(picture)),
                )
                .add_paragraph(
                    Paragraph::new().align(AlignmentType::Center).add_run(
                        body_run(
                            fonts,
                            numbered_evidence_caption(figure_label, alt, title.as_deref()),
                        )
                        .italic()
                        .size(17)
                        .color("4B5563"),
                    ),
                )
        }
    }
}

fn add_docx_rich_text(
    mut paragraph: Paragraph,
    text: &PublicationRichText,
    fonts: PublicationFonts,
    force_italic: bool,
) -> Paragraph {
    for span in text.spans() {
        let mut run = body_run(fonts, span.text()).size(20);
        if span.bold() {
            run = run.bold();
        }
        if force_italic || span.italic() {
            run = run.italic();
        }
        if let Some(href) = span.href() {
            run = run.color("0563C1").underline("single");
            let (target, link_type) = href
                .strip_prefix('#')
                .map_or((href, HyperlinkType::External), |anchor| {
                    (anchor, HyperlinkType::Anchor)
                });
            paragraph = paragraph.add_hyperlink(Hyperlink::new(target, link_type).add_run(run));
        } else {
            paragraph = paragraph.add_run(run);
        }
    }
    paragraph
}

fn render_pdf(
    publication: &PublicationIr,
    snapshot: &PublicationSnapshot,
    brand: Option<&BrandProfile>,
    assets: Option<&PublicationAssets>,
) -> Result<Vec<u8>, PublishError> {
    let engine = TypstEngine::builder()
        .main_file(TYPST_TEMPLATE)
        .fonts([GEIST_FONT, GEIST_MONO_FONT, SOURCE_SERIF_FONT])
        .build();
    let warned = engine.compile_with_input(typst_inputs(publication, snapshot, brand, assets));
    let document = warned
        .output
        .map_err(|_| PublishError::new(PublishErrorCode::RenderFailed))?;
    let options = typst_pdf::PdfOptions {
        // `/Creator` identifies the publishing application or organization.
        // Typst remains the renderer, but it is not the owner of the report.
        creator: Smart::Custom(Some(
            brand
                .map_or("Sheut", BrandProfile::organization_name)
                .to_owned(),
        )),
        ..Default::default()
    };
    typst_pdf::pdf(&document, &options)
        .map_err(|_| PublishError::new(PublishErrorCode::RenderFailed))
}

fn typst_inputs(
    publication: &PublicationIr,
    snapshot: &PublicationSnapshot,
    brand: Option<&BrandProfile>,
    assets: Option<&PublicationAssets>,
) -> Dict {
    let mut inputs = Dict::new();
    let fonts = PublicationFonts::from_brand(brand);
    let brand_name = brand.map_or("Sheut", BrandProfile::organization_name);
    inputs.insert("title".into(), publication.title.clone().into_value());
    inputs.insert("eyebrow".into(), publication.eyebrow.clone().into_value());
    inputs.insert(
        "pdf_author".into(),
        publication
            .metadata("authors")
            .filter(|authors| !authors.trim().is_empty())
            .unwrap_or(brand_name)
            .into_value(),
    );
    inputs.insert(
        "family".into(),
        publication_family(&publication.eyebrow).into_value(),
    );
    inputs.insert(
        "report_number".into(),
        publication
            .metadata("report_number")
            .unwrap_or("")
            .into_value(),
    );
    inputs.insert(
        "publication_date".into(),
        publication
            .metadata("publication_date")
            .unwrap_or("")
            .into_value(),
    );
    inputs.insert(
        "criticality".into(),
        publication
            .metadata("criticality")
            .unwrap_or("")
            .into_value(),
    );
    inputs.insert(
        "authors".into(),
        publication.metadata("authors").unwrap_or("").into_value(),
    );
    inputs.insert(
        "author_label".into(),
        author_label(publication.metadata("authors").unwrap_or("")).into_value(),
    );
    inputs.insert(
        "report_version".into(),
        snapshot.release_version().into_value(),
    );
    inputs.insert(
        "paper".into(),
        snapshot.paper_size().typst_name().into_value(),
    );
    inputs.insert(
        "landscape".into(),
        (snapshot.orientation() == PageOrientation::Landscape).into_value(),
    );
    inputs.insert(
        "header".into(),
        snapshot.page_furniture().header().into_value(),
    );
    inputs.insert(
        "page_numbers".into(),
        snapshot.page_furniture().page_numbers().into_value(),
    );
    inputs.insert(
        "footer".into(),
        snapshot.page_furniture().footer().into_value(),
    );
    inputs.insert(
        "include_release_history".into(),
        (snapshot.include_release_history() && !snapshot.release_history().is_empty()).into_value(),
    );
    inputs.insert(
        "release_history_cells".into(),
        snapshot
            .release_history()
            .iter()
            .flat_map(|release| {
                [
                    format!("v{}", release.version()),
                    release.change_note().to_owned(),
                ]
            })
            .collect::<Vec<_>>()
            .into_value(),
    );
    inputs.insert("brand_name".into(), brand_name.into_value());
    inputs.insert("heading_font".into(), fonts.heading.into_value());
    inputs.insert("body_font".into(), fonts.body.into_value());
    inputs.insert("mono_font".into(), fonts.mono.into_value());
    let primary = brand.map_or("#133C55", BrandProfile::primary_color);
    let secondary = brand.map_or("#386FA4", BrandProfile::secondary_color);
    let accent = brand.map_or("#59A5D8", BrandProfile::accent_color);
    let text_color = brand.map_or("#111827", BrandProfile::text_color);
    let background_color = brand.map_or("#FFFFFF", BrandProfile::background_color);
    inputs.insert("primary".into(), primary.into_value());
    inputs.insert("secondary".into(), secondary.into_value());
    inputs.insert("accent".into(), accent.into_value());
    inputs.insert("text_color".into(), text_color.into_value());
    inputs.insert("background_color".into(), background_color.into_value());
    inputs.insert("band_color".into(), tint_hex(accent, 0.68).into_value());
    let logo = assets
        .and_then(|assets| assets.logo.as_ref().or(assets.compact_mark.as_ref()))
        .cloned()
        .unwrap_or_else(|| SHEUT_MARK.to_vec());
    inputs.insert("logo".into(), Bytes::new(logo).into_value());
    let cover_artwork = brand
        .filter(|brand| brand.cover_treatment() == CoverTreatment::Artwork)
        .and_then(|_| assets.and_then(|assets| assets.cover_artwork.as_ref()))
        .cloned();
    inputs.insert(
        "has_cover_artwork".into(),
        cover_artwork.is_some().into_value(),
    );
    inputs.insert(
        "cover_artwork".into(),
        Bytes::new(cover_artwork.unwrap_or_default()).into_value(),
    );
    let marking = snapshot
        .tlp_marking()
        .filter(|_| snapshot.page_furniture().marking());
    let (tlp_foreground, tlp_background) =
        marking.map(tlp_colors).unwrap_or(("#FFFFFF", "#000000"));
    let brand_name = brand.map_or("Sheut", BrandProfile::organization_name);
    let header_text = marking.map_or_else(
        || brand_name.to_owned(),
        |marking| format!("{brand_name} · {}", marking.label()),
    );
    inputs.insert("header_text".into(), header_text.into_value());
    inputs.insert(
        "marking".into(),
        marking
            .map_or("", sheut_core::TlpMarking::label)
            .into_value(),
    );
    inputs.insert(
        "distribution".into(),
        marking
            .map_or("", sheut_core::TlpMarking::distribution_statement)
            .into_value(),
    );
    inputs.insert("tlp_foreground".into(), tlp_foreground.into_value());
    inputs.insert("tlp_background".into(), tlp_background.into_value());
    inputs.insert(
        "administration".into(),
        publication
            .sections
            .iter()
            .filter(|section| section.key == "report_administration")
            .map(|section| {
                typst_section(
                    section,
                    assets,
                    evidence_image_bounds_for_snapshot(snapshot),
                )
            })
            .collect::<Vec<_>>()
            .into_value(),
    );
    inputs.insert(
        "sections".into(),
        publication
            .sections
            .iter()
            .filter(|section| section.key != "report_administration")
            .map(|section| {
                typst_section(
                    section,
                    assets,
                    evidence_image_bounds_for_snapshot(snapshot),
                )
            })
            .collect::<Vec<_>>()
            .into_value(),
    );
    inputs
}

fn publication_family(eyebrow: &str) -> String {
    eyebrow
        .split_once('—')
        .map_or(eyebrow, |(_, family)| family)
        .trim()
        .to_owned()
}

fn tlp_colors(marking: sheut_core::TlpMarking) -> (&'static str, &'static str) {
    (marking.foreground_hex(), marking.background_hex())
}

fn tint_hex(color: &str, white_ratio: f32) -> String {
    let Some((red, green, blue)) = color
        .strip_prefix('#')
        .filter(|value| value.len() == 6)
        .and_then(|value| {
            let color = format!("#{value}");
            Some((
                parse_with(&color, 1..3)?,
                parse_with(&color, 3..5)?,
                parse_with(&color, 5..7)?,
            ))
        })
    else {
        return "#D9EAF3".to_owned();
    };
    let tint = |channel: u8| {
        (f32::from(channel) + (255.0 - f32::from(channel)) * white_ratio).round() as u8
    };
    format!("#{:02X}{:02X}{:02X}", tint(red), tint(green), tint(blue))
}

fn parse_with(color: &str, range: std::ops::Range<usize>) -> Option<u8> {
    u8::from_str_radix(&color[range], 16).ok()
}

fn typst_section(
    section: &PublicationSection,
    assets: Option<&PublicationAssets>,
    evidence_image_bounds: EvidenceImageBounds,
) -> Dict {
    let mut value = Dict::new();
    value.insert("title".into(), section.title.clone().into_value());
    value.insert(
        "blocks".into(),
        section
            .blocks
            .iter()
            .map(|block| typst_block(block, assets, evidence_image_bounds))
            .collect::<Vec<_>>()
            .into_value(),
    );
    value
}

fn typst_block(
    block: &PublicationBlock,
    assets: Option<&PublicationAssets>,
    evidence_image_bounds: EvidenceImageBounds,
) -> Dict {
    let mut value = Dict::new();
    match block {
        PublicationBlock::Paragraph(text) => {
            value.insert("kind".into(), "paragraph".into_value());
            value.insert("spans".into(), typst_rich_text(text).into_value());
        }
        PublicationBlock::ParagraphGap => {
            value.insert("kind".into(), "paragraph-gap".into_value());
        }
        PublicationBlock::LabeledText { label, text } => {
            value.insert("kind".into(), "label".into_value());
            value.insert("label".into(), label.clone().into_value());
            value.insert("text".into(), text.clone().into_value());
        }
        PublicationBlock::MetadataTable { rows } => {
            value.insert("kind".into(), "metadata-table".into_value());
            value.insert(
                "cells".into(),
                rows.iter()
                    .flat_map(|(label, value)| [label.clone(), value.clone()])
                    .collect::<Vec<_>>()
                    .into_value(),
            );
        }
        PublicationBlock::Subheading(text) => {
            value.insert("kind".into(), "subheading".into_value());
            value.insert("text".into(), text.clone().into_value());
        }
        PublicationBlock::Callout(text) => {
            value.insert("kind".into(), "callout".into_value());
            value.insert("spans".into(), typst_rich_text(text).into_value());
        }
        PublicationBlock::List(items) => {
            value.insert("kind".into(), "list".into_value());
            value.insert(
                "items".into(),
                items
                    .iter()
                    .map(typst_rich_text)
                    .collect::<Vec<_>>()
                    .into_value(),
            );
        }
        PublicationBlock::Table { headers, rows } => {
            value.insert("kind".into(), "table".into_value());
            value.insert(
                "columns".into(),
                i64::try_from(headers.len()).unwrap_or(1).into_value(),
            );
            value.insert("headers".into(), headers.clone().into_value());
            value.insert(
                "cells".into(),
                rows.iter()
                    .flatten()
                    .cloned()
                    .collect::<Vec<_>>()
                    .into_value(),
            );
        }
        PublicationBlock::StructuredRecords { label, records } => {
            value.insert("kind".into(), "structured-records".into_value());
            value.insert("label".into(), label.clone().into_value());
            value.insert(
                "records".into(),
                records
                    .iter()
                    .map(|record| {
                        let mut record_value = Dict::new();
                        record_value.insert(
                            "title".into(),
                            record
                                .first()
                                .map(|(_, value)| value.clone())
                                .unwrap_or_else(|| "Untitled".to_owned())
                                .into_value(),
                        );
                        record_value.insert(
                            "cells".into(),
                            record
                                .iter()
                                .flat_map(|(field, value)| [field.clone(), value.clone()])
                                .collect::<Vec<_>>()
                                .into_value(),
                        );
                        record_value
                    })
                    .collect::<Vec<_>>()
                    .into_value(),
            );
        }
        PublicationBlock::ReferenceList { label, items } => {
            value.insert("kind".into(), "reference-list".into_value());
            value.insert(
                "label".into(),
                label.as_deref().unwrap_or_default().into_value(),
            );
            value.insert(
                "items".into(),
                items
                    .iter()
                    .map(|(title, detail)| {
                        let mut reference = Dict::new();
                        reference.insert("title".into(), title.clone().into_value());
                        reference.insert("detail".into(), detail.clone().into_value());
                        reference
                    })
                    .collect::<Vec<_>>()
                    .into_value(),
            );
        }
        PublicationBlock::EvidenceIndex { items } => {
            value.insert("kind".into(), "evidence-index".into_value());
            value.insert(
                "items".into(),
                items
                    .iter()
                    .map(|item| {
                        let mut entry = Dict::new();
                        entry.insert(
                            "title".into(),
                            evidence_index_title(item, assets).into_value(),
                        );
                        entry.insert(
                            "cells".into(),
                            evidence_index_details(item, assets)
                                .into_iter()
                                .flat_map(|(label, value)| [label, value])
                                .collect::<Vec<_>>()
                                .into_value(),
                        );
                        if let Some(bytes) =
                            assets.and_then(|assets| assets.evidence_images.get(&item.evidence_id))
                        {
                            let picture = Pic::new(bytes);
                            let (width, height) = fit_image_dimensions(
                                picture.size.0,
                                picture.size.1,
                                evidence_image_bounds.max_width_emu,
                                evidence_image_bounds.max_height_emu,
                            );
                            entry.insert("has_image".into(), true.into_value());
                            entry.insert("bytes".into(), Bytes::new(bytes.clone()).into_value());
                            entry.insert("width_mm".into(), emu_to_whole_mm(width).into_value());
                            entry.insert("height_mm".into(), emu_to_whole_mm(height).into_value());
                        } else {
                            entry.insert("has_image".into(), false.into_value());
                        }
                        entry
                    })
                    .collect::<Vec<_>>()
                    .into_value(),
            );
        }
        PublicationBlock::EvidenceImage {
            evidence_id,
            alt,
            title,
            figure_label,
            ..
        } => {
            let bytes = assets
                .and_then(|assets| assets.evidence_images.get(evidence_id))
                .expect("evidence images are validated before rendering");
            let picture = Pic::new(bytes);
            let (width, height) = fit_image_dimensions(
                picture.size.0,
                picture.size.1,
                evidence_image_bounds.max_width_emu,
                evidence_image_bounds.max_height_emu,
            );
            value.insert("kind".into(), "evidence-image".into_value());
            value.insert("bytes".into(), Bytes::new(bytes.clone()).into_value());
            value.insert("width_mm".into(), emu_to_whole_mm(width).into_value());
            value.insert("height_mm".into(), emu_to_whole_mm(height).into_value());
            value.insert("alt".into(), alt.clone().into_value());
            value.insert(
                "caption".into(),
                numbered_evidence_caption(figure_label, alt, title.as_deref()).into_value(),
            );
        }
    }
    value
}

fn typst_rich_text(text: &PublicationRichText) -> Vec<Dict> {
    text.spans()
        .iter()
        .map(|span| {
            let mut value = Dict::new();
            value.insert("text".into(), span.text().into_value());
            value.insert("bold".into(), span.bold().into_value());
            value.insert("italic".into(), span.italic().into_value());
            value.insert("href".into(), span.href().unwrap_or("").into_value());
            value
        })
        .collect()
}

fn append_document_blocks(root: &JsonValue, output: &mut Vec<PublicationBlock>) {
    let mut pending_paragraph_gap = false;
    for node in root
        .get("content")
        .and_then(JsonValue::as_array)
        .into_iter()
        .flatten()
    {
        append_content_node(node, output, &mut pending_paragraph_gap);
    }
}

fn append_content_node(
    node: &JsonValue,
    output: &mut Vec<PublicationBlock>,
    pending_paragraph_gap: &mut bool,
) {
    let block = if node.get("type").and_then(JsonValue::as_str) == Some("paragraph") {
        let Some(text) = PublicationRichText::from_node(node) else {
            if !output.is_empty() {
                *pending_paragraph_gap = true;
            }
            return;
        };
        Some(PublicationBlock::Paragraph(text))
    } else {
        block_from_node(node)
    };

    if let Some(block) = block {
        if *pending_paragraph_gap {
            output.push(PublicationBlock::ParagraphGap);
            *pending_paragraph_gap = false;
        }
        output.push(block);
    }
}

fn block_from_node(node: &JsonValue) -> Option<PublicationBlock> {
    let node_type = node.get("type")?.as_str()?;
    match node_type {
        "paragraph" | "codeBlock" => {
            PublicationRichText::from_node(node).map(PublicationBlock::Paragraph)
        }
        "blockquote" | "callout" => {
            PublicationRichText::from_node(node).map(PublicationBlock::Callout)
        }
        "bulletList" | "orderedList" | "taskList" => {
            let items = node
                .get("content")
                .and_then(JsonValue::as_array)
                .into_iter()
                .flatten()
                .filter_map(PublicationRichText::from_node)
                .collect::<Vec<_>>();
            (!items.is_empty()).then_some(PublicationBlock::List(items))
        }
        "table" => table_from_node(node),
        "evidenceImage" => evidence_image_from_node(node),
        _ => None,
    }
}

fn evidence_image_from_node(node: &JsonValue) -> Option<PublicationBlock> {
    let attrs = node.get("attrs")?.as_object()?;
    let evidence_id = LocalId::parse(attrs.get("evidenceId")?.as_str()?).ok()?;
    let alt = attrs.get("alt")?.as_str()?.trim();
    if alt.is_empty() {
        return None;
    }
    let title = attrs
        .get("title")
        .and_then(JsonValue::as_str)
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(str::to_owned);
    let placement = match attrs
        .get("placement")
        .and_then(JsonValue::as_str)
        .unwrap_or("inline")
    {
        "inline" => EvidenceImagePlacement::Inline,
        "appendix" => EvidenceImagePlacement::Appendix {
            key: attrs.get("appendixKey")?.as_str()?.to_owned(),
            title: attrs.get("appendixTitle")?.as_str()?.trim().to_owned(),
        },
        _ => return None,
    };
    Some(PublicationBlock::EvidenceImage {
        evidence_id,
        alt: alt.to_owned(),
        title,
        placement,
        figure_label: String::new(),
    })
}

fn guided_rows_block(
    label: &str,
    headers: &[String],
    rows: &[BTreeMap<String, String>],
) -> Option<PublicationBlock> {
    let populated_rows = rows
        .iter()
        .filter_map(|row| {
            let values = headers
                .iter()
                .map(|column| {
                    row.get(column)
                        .or_else(|| row.get(&section_key(column)))
                        .map(|value| value.trim().to_owned())
                        .unwrap_or_default()
                })
                .collect::<Vec<_>>();
            values
                .iter()
                .any(|value| !value.is_empty())
                .then_some(values)
        })
        .collect::<Vec<_>>();
    if populated_rows.is_empty() {
        return None;
    }

    let visible_columns = headers
        .iter()
        .enumerate()
        .filter(|(index, header)| {
            !header.trim().is_empty()
                && populated_rows
                    .iter()
                    .any(|row| row.get(*index).is_some_and(|value| !value.is_empty()))
        })
        .map(|(index, _)| index)
        .collect::<Vec<_>>();
    if visible_columns.is_empty() {
        return None;
    }

    if visible_columns.len() <= MAX_COMPARABLE_TABLE_COLUMNS {
        return Some(PublicationBlock::Table {
            headers: visible_columns
                .iter()
                .map(|index| headers[*index].trim().to_owned())
                .collect(),
            rows: populated_rows
                .iter()
                .map(|row| {
                    visible_columns
                        .iter()
                        .map(|index| row[*index].clone())
                        .collect()
                })
                .collect(),
        });
    }

    Some(PublicationBlock::StructuredRecords {
        label: label.to_owned(),
        records: populated_rows
            .iter()
            .map(|row| {
                visible_columns
                    .iter()
                    .filter_map(|index| {
                        let value = row[*index].trim();
                        (!value.is_empty())
                            .then(|| (headers[*index].trim().to_owned(), value.to_owned()))
                    })
                    .collect()
            })
            .collect(),
    })
}

fn collect_evidence_references(
    summaries: &mut Vec<EvidenceReferenceSummary>,
    references: &[ProjectDataReference],
    section_title: &str,
) {
    for reference in references
        .iter()
        .filter(|reference| reference.kind() == ProjectDataReferenceKind::Evidence)
    {
        if let Some(summary) = summaries
            .iter_mut()
            .find(|summary| summary.id == reference.id())
        {
            if !summary
                .section_titles
                .iter()
                .any(|title| title == section_title)
            {
                summary.section_titles.push(section_title.to_owned());
            }
        } else {
            summaries.push(EvidenceReferenceSummary {
                id: reference.id(),
                label: reference.label().to_owned(),
                section_titles: vec![section_title.to_owned()],
            });
        }
    }
}

fn collect_linked_row_evidence_references(
    summaries: &mut Vec<EvidenceReferenceSummary>,
    rows: &GuidedReportLinkedRows,
    section_title: &str,
) {
    let references = rows
        .references()
        .iter()
        .map(|reference| reference.reference().clone())
        .collect::<Vec<_>>();
    collect_evidence_references(summaries, &references, section_title);
}

fn collect_evidence_images(
    summaries: &mut Vec<EvidenceReferenceSummary>,
    sections: &[PublicationSection],
) {
    for section in sections {
        for block in &section.blocks {
            let PublicationBlock::EvidenceImage {
                evidence_id,
                alt,
                title,
                ..
            } = block
            else {
                continue;
            };
            let label = title
                .as_deref()
                .filter(|title| !title.trim().is_empty())
                .unwrap_or(alt)
                .trim();
            if let Some(summary) = summaries
                .iter_mut()
                .find(|summary| summary.id == *evidence_id)
            {
                if !summary
                    .section_titles
                    .iter()
                    .any(|existing| existing == section.title())
                {
                    summary.section_titles.push(section.title().to_owned());
                }
                if summary.label.trim().is_empty() && !label.is_empty() {
                    summary.label = label.to_owned();
                }
            } else {
                summaries.push(EvidenceReferenceSummary {
                    id: *evidence_id,
                    label: label.to_owned(),
                    section_titles: vec![section.title().to_owned()],
                });
            }
        }
    }
}

fn append_evidence_reference_index(
    sections: &mut Vec<PublicationSection>,
    references: Vec<EvidenceReferenceSummary>,
) {
    if references.is_empty() {
        return;
    }
    let appendix_index = sections
        .iter()
        .position(|section| section.key == "evidence_appendix")
        .unwrap_or_else(|| {
            sections.push(PublicationSection::new(
                "evidence_appendix",
                "Evidence Appendix",
            ));
            sections.len().saturating_sub(1)
        });
    let appendix = &mut sections[appendix_index];
    let heading = "Evidence index";
    let items = references
        .into_iter()
        .map(|reference| EvidenceIndexItem {
            evidence_id: reference.id,
            label: reference.label,
            section_titles: reference.section_titles,
        })
        .collect();
    let list = PublicationBlock::EvidenceIndex { items };

    if let Some(heading_index) = appendix
        .blocks
        .iter()
        .position(|block| matches!(block, PublicationBlock::Subheading(text) if text == heading))
    {
        let insert_at = appendix
            .blocks
            .iter()
            .enumerate()
            .skip(heading_index.saturating_add(1))
            .find_map(|(index, block)| {
                matches!(block, PublicationBlock::Subheading(_)).then_some(index)
            })
            .unwrap_or(appendix.blocks.len());
        appendix.blocks.insert(insert_at, list);
    } else {
        appendix
            .blocks
            .push(PublicationBlock::Subheading(heading.to_owned()));
        appendix.blocks.push(list);
    }
}

fn finalize_evidence_images(sections: &mut Vec<PublicationSection>) {
    let mut appendices: Vec<(String, String, Vec<PublicationBlock>)> = Vec::new();
    let mut inline_number = 0_u32;
    for section in sections.iter_mut() {
        let mut retained = Vec::with_capacity(section.blocks.len());
        for mut block in section.blocks.drain(..) {
            match &block {
                PublicationBlock::EvidenceImage {
                    placement: EvidenceImagePlacement::Appendix { key, title },
                    ..
                } => {
                    if let Some((_, _, blocks)) = appendices
                        .iter_mut()
                        .find(|(appendix_key, _, _)| appendix_key == key)
                    {
                        blocks.push(block);
                    } else {
                        appendices.push((key.clone(), title.clone(), vec![block]));
                    }
                }
                PublicationBlock::EvidenceImage { .. } => {
                    inline_number = inline_number.saturating_add(1);
                    if let PublicationBlock::EvidenceImage { figure_label, .. } = &mut block {
                        *figure_label = inline_number.to_string();
                    }
                    retained.push(block);
                }
                _ => retained.push(block),
            }
        }
        section.blocks = retained;
    }
    for (index, (key, title, mut blocks)) in appendices.into_iter().enumerate() {
        let letter = appendix_letter(index);
        for (figure_index, block) in blocks.iter_mut().enumerate() {
            if let PublicationBlock::EvidenceImage { figure_label, .. } = block {
                *figure_label = format!("{letter}.{}", figure_index.saturating_add(1));
            }
        }
        let mut appendix = PublicationSection::new(
            &format!("appendix_{key}"),
            &format!("Appendix {letter} — {title}"),
        );
        appendix.blocks = blocks;
        sections.push(appendix);
    }
}

fn appendix_letter(index: usize) -> String {
    let mut number = index.saturating_add(1);
    let mut output = String::new();
    while number > 0 {
        let remainder = (number - 1) % 26;
        output.insert(0, char::from(b'A'.saturating_add(remainder as u8)));
        number = (number - 1) / 26;
    }
    output
}

fn evidence_caption(alt: &str, title: Option<&str>) -> String {
    title
        .filter(|title| !title.eq_ignore_ascii_case(alt))
        .map_or_else(|| alt.to_owned(), |title| format!("{alt} — {title}"))
}

fn numbered_evidence_caption(figure_label: &str, alt: &str, title: Option<&str>) -> String {
    format!("Figure {figure_label}. {}", evidence_caption(alt, title))
}

fn evidence_index_title<'a>(
    item: &'a EvidenceIndexItem,
    assets: Option<&'a PublicationAssets>,
) -> &'a str {
    assets
        .and_then(|assets| assets.evidence_metadata.get(&item.evidence_id))
        .map(EvidenceFileMetadata::title)
        .filter(|title| !title.trim().is_empty())
        .unwrap_or(&item.label)
}

fn evidence_index_details(
    item: &EvidenceIndexItem,
    assets: Option<&PublicationAssets>,
) -> Vec<(String, String)> {
    let mut details = Vec::new();
    if let Some(metadata) =
        assets.and_then(|assets| assets.evidence_metadata.get(&item.evidence_id))
    {
        details.push(("Type".to_owned(), metadata.media_type().to_owned()));
        if !metadata.description().trim().is_empty() {
            details.push((
                "Description".to_owned(),
                metadata.description().trim().to_owned(),
            ));
        }
        if !metadata.source().trim().is_empty() {
            details.push(("Source".to_owned(), metadata.source().trim().to_owned()));
        }
        if let Some(captured_at) = metadata.captured_at() {
            details.push(("Captured".to_owned(), captured_at.to_owned()));
        }
        details.push(("SHA-256".to_owned(), metadata.sha256().to_owned()));
        if !metadata.analyst_notes().trim().is_empty() {
            details.push((
                "Analyst notes".to_owned(),
                metadata.analyst_notes().trim().to_owned(),
            ));
        }
    }
    details.push(("Cited in".to_owned(), item.section_titles.join("; ")));
    details
}

fn append_inline_spans(node: &JsonValue, spans: &mut Vec<PublicationInlineSpan>) {
    if node.get("type").and_then(JsonValue::as_str) == Some("text") {
        let text = node
            .get("text")
            .and_then(JsonValue::as_str)
            .unwrap_or_default();
        if text.is_empty() {
            return;
        }
        let marks = node
            .get("marks")
            .and_then(JsonValue::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default();
        let has_mark = |expected: &str| {
            marks
                .iter()
                .any(|mark| mark.get("type").and_then(JsonValue::as_str) == Some(expected))
        };
        let bold = has_mark("bold");
        let italic = has_mark("italic");
        let href = marks.iter().find_map(|mark| {
            (mark.get("type").and_then(JsonValue::as_str) == Some("link"))
                .then(|| {
                    mark.get("attrs")
                        .and_then(JsonValue::as_object)
                        .and_then(|attrs| attrs.get("href"))
                        .and_then(JsonValue::as_str)
                        .map(str::trim)
                        .filter(|href| is_safe_publication_link(href))
                        .map(str::to_owned)
                })
                .flatten()
        });
        if let Some(last) = spans
            .last_mut()
            .filter(|last| last.bold == bold && last.italic == italic && last.href == href)
        {
            last.text.push_str(text);
        } else {
            spans.push(PublicationInlineSpan {
                text: text.to_owned(),
                bold,
                italic,
                href,
            });
        }
        return;
    }
    if node.get("type").and_then(JsonValue::as_str) == Some("hardBreak") {
        spans.push(PublicationInlineSpan {
            text: "\n".to_owned(),
            bold: false,
            italic: false,
            href: None,
        });
        return;
    }
    if let Some(children) = node.get("content").and_then(JsonValue::as_array) {
        for child in children {
            append_inline_spans(child, spans);
        }
    }
}

fn is_safe_publication_link(href: &str) -> bool {
    let trimmed = href.trim();
    if trimmed.is_empty() || trimmed.chars().any(char::is_control) {
        return false;
    }
    let lowercase = trimmed.to_ascii_lowercase();
    lowercase.starts_with("https://")
        || lowercase.starts_with("http://")
        || lowercase.starts_with("mailto:")
        || (trimmed.starts_with('/') && !trimmed.starts_with("//"))
        || trimmed.starts_with('#')
}

fn table_from_node(node: &JsonValue) -> Option<PublicationBlock> {
    let rows = node
        .get("content")?
        .as_array()?
        .iter()
        .filter_map(|row| {
            row.get("content")?.as_array().map(|cells| {
                cells
                    .iter()
                    .map(|cell| node_text(cell).trim().to_owned())
                    .collect::<Vec<_>>()
            })
        })
        .collect::<Vec<_>>();
    let (headers, rows) = rows.split_first()?;
    if headers.is_empty() || headers.iter().all(|header| header.is_empty()) {
        return None;
    }
    let rows = rows
        .iter()
        .filter(|row| row.iter().any(|cell| !cell.is_empty()))
        .cloned()
        .collect::<Vec<_>>();
    if rows.is_empty() {
        return None;
    }
    Some(PublicationBlock::Table {
        headers: headers.clone(),
        rows,
    })
}

fn node_text(node: &JsonValue) -> String {
    let mut text = node
        .get("text")
        .and_then(JsonValue::as_str)
        .unwrap_or_default()
        .to_owned();
    if let Some(children) = node.get("content").and_then(JsonValue::as_array) {
        for child in children {
            let child_text = node_text(child);
            if !text.is_empty()
                && !child_text.is_empty()
                && !text.chars().last().is_some_and(char::is_whitespace)
            {
                text.push(' ');
            }
            text.push_str(&child_text);
        }
    }
    text
}

fn section_key(value: &str) -> String {
    let mut key = String::new();
    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            key.push(character.to_ascii_lowercase());
        } else if !key.is_empty() && !key.ends_with('_') {
            key.push('_');
        }
    }
    key.trim_matches('_').chars().take(64).collect()
}

fn reference_kind_label(kind: sheut_core::ProjectDataReferenceKind) -> &'static str {
    match kind {
        sheut_core::ProjectDataReferenceKind::Intelligence => "Intelligence",
        sheut_core::ProjectDataReferenceKind::Evidence => "Evidence",
        sheut_core::ProjectDataReferenceKind::Document => "Document",
        sheut_core::ProjectDataReferenceKind::CatalogReference => "Catalog reference",
    }
}

fn escape_html(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(character),
        }
    }
    escaped
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use sheut_core::{
        BrandProfile, LocalId, PublicationFormat, PublicationReleaseEntry, PublicationSettings,
        PublicationSnapshot, PublicationSource, PublicationStatus, Revision,
    };
    use typst_as_lib::TypstEngine;

    use super::{
        GEIST_FONT, GEIST_MONO_FONT, PublicationIr, PublicationSection, SOURCE_SERIF_FONT,
        TYPST_TEMPLATE, author_label, evidence_image_bounds, fit_image_dimensions, typst_inputs,
    };

    #[test]
    fn author_metadata_label_is_singular_or_plural_from_structured_separators() {
        assert_eq!(author_label("Alex Morgan, Threat Intelligence"), "Author");
        assert_eq!(
            author_label("Alex Morgan, Threat Intelligence; Sheut Labs"),
            "Authors"
        );
        assert_eq!(author_label("Alex Morgan\nNoah Chen"), "Authors");
    }

    #[test]
    fn evidence_image_bounds_reserve_caption_space_inside_each_page_orientation() {
        let portrait = evidence_image_bounds(11_906, 16_838);
        let landscape = evidence_image_bounds(16_838, 11_906);

        assert_eq!(portrait.max_width_emu, 6_551_930);
        assert_eq!(portrait.max_height_emu, 8_749_030);
        assert_eq!(portrait.max_height_mm, 243);
        assert_eq!(landscape.max_width_emu, 9_683_750);
        assert_eq!(landscape.max_height_emu, 5_617_210);
        assert_eq!(landscape.max_height_mm, 156);
    }

    #[test]
    fn evidence_image_dimensions_are_bounded_without_changing_aspect_ratio() {
        assert_eq!(
            fit_image_dimensions(10_000_000, 20_000_000, 6_000_000, 8_000_000),
            (4_000_000, 8_000_000)
        );
        assert_eq!(
            fit_image_dimensions(20_000_000, 10_000_000, 6_000_000, 8_000_000),
            (6_000_000, 3_000_000)
        );
        assert_eq!(
            fit_image_dimensions(2_000_000, 1_000_000, 6_000_000, 8_000_000),
            (2_000_000, 1_000_000)
        );
    }

    #[test]
    fn typst_template_renders_intentional_paragraph_gaps_as_fixed_space() {
        assert!(TYPST_TEMPLATE.contains("item.kind == \"paragraph-gap\""));
        assert!(TYPST_TEMPLATE.contains("block(height: 8pt)[]"));
    }

    #[test]
    fn typst_cover_masthead_uses_saved_brand_name_without_a_fixed_product_label() {
        assert!(TYPST_TEMPLATE.contains("upper(inputs.brand_name)"));
        assert!(!TYPST_TEMPLATE.contains("INTELLIGENCE PRODUCT"));
    }

    #[test]
    fn fixed_typst_template_compiles_with_typed_inputs() {
        let profile = BrandProfile::project_default(
            LocalId::parse("110b83fb-9fdb-4133-a29b-e75725bb6d0c").unwrap(),
            "Example organization",
            1_000,
        )
        .unwrap();
        let settings = PublicationSettings::from_brand(&profile, PublicationFormat::Pdf)
            .with_release(
                "2.0",
                PublicationStatus::Final,
                true,
                vec![
                    PublicationReleaseEntry::new("1.0", "Initial release", 1_000).unwrap(),
                    PublicationReleaseEntry::new("2.0", "Major reassessment", 2_000).unwrap(),
                ],
            )
            .unwrap();
        let snapshot = PublicationSnapshot::new(
            LocalId::parse("ec6ed71e-a754-4b32-b692-50f03f00154f").unwrap(),
            PublicationSource::FreeformDocument {
                document_id: LocalId::parse("e7c44850-9f67-4d26-b7e3-0d4ee82339ef").unwrap(),
                revision: Revision::new(1).unwrap(),
            },
            settings,
            2_000,
        )
        .unwrap();
        let publication = PublicationIr::new(
            "Example report".to_owned(),
            "Campaign report".to_owned(),
            BTreeMap::new(),
            vec![PublicationSection::new("overview", "Overview")],
        )
        .unwrap();
        let engine = TypstEngine::builder()
            .main_file(TYPST_TEMPLATE)
            .fonts([GEIST_FONT, GEIST_MONO_FONT, SOURCE_SERIF_FONT])
            .build();
        let compiled =
            engine.compile_with_input(typst_inputs(&publication, &snapshot, Some(&profile), None));

        match compiled.output {
            Ok(document) => {
                typst_pdf::pdf(&document, &Default::default()).unwrap();
            }
            Err(diagnostics) => panic!("Typst template diagnostics: {diagnostics:#?}"),
        }
    }
}
