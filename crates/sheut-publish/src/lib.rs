#![forbid(unsafe_code)]

//! Typst/PDF rendering over one validated publication model.
//! Analyst content is passed as inert data and never evaluated as markup or template source.

use std::{
    collections::{BTreeMap, HashMap},
    error::Error,
    fmt,
    io::Cursor,
};

use image::ImageReader;
use serde_json::Value as JsonValue;
use sheut_core::{
    BrandProfile, BrandTypeface, CoverTreatment, DocumentEnvelope, EvidenceFileMetadata,
    ImageMediaType, LocalId, PageOrientation, PublicationSnapshot, PublicationStatus,
    render_document,
};
use typst::foundations::{Bytes, Dict, IntoValue, Smart};
use typst_as_lib::TypstEngine;

const GEIST_FONT: &[u8] = include_bytes!("../../../src-tauri/assets/fonts/Geist-Variable.ttf");
const GEIST_MONO_FONT: &[u8] =
    include_bytes!("../../../src-tauri/assets/fonts/GeistMono-Variable.ttf");
const SOURCE_SERIF_FONT: &[u8] =
    include_bytes!("../../../src-tauri/assets/fonts/SourceSerif4-Variable.ttf");
const SHEUT_MARK: &[u8] = include_bytes!("../../../src-tauri/icons/128x128@2x.png");
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
    let (width_points, height_points) = snapshot.paper_size().portrait_points();
    let (mut width, mut height) = (
        (width_points * 20.0).round() as u32,
        (height_points * 20.0).round() as u32,
    );
    if snapshot.orientation() == PageOrientation::Landscape {
        std::mem::swap(&mut width, &mut height);
    }
    evidence_image_bounds(width, height)
}

fn image_dimensions_emu(bytes: &[u8]) -> (u32, u32) {
    const EMU_PER_PIXEL: u32 = 9_525;
    ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .ok()
        .and_then(|reader| reader.into_dimensions().ok())
        .map(|(width, height)| {
            (
                width.saturating_mul(EMU_PER_PIXEL),
                height.saturating_mul(EMU_PER_PIXEL),
            )
        })
        .unwrap_or((EMU_PER_PIXEL, EMU_PER_PIXEL))
}

fn author_label(authors: &str) -> &'static str {
    if authors.contains(';') || authors.contains('\n') {
        "Authors"
    } else if authors.trim().is_empty() {
        ""
    } else {
        "Author"
    }
}

const fn publication_status_label(status: PublicationStatus) -> &'static str {
    match status {
        PublicationStatus::Draft => "Draft",
        PublicationStatus::Final => "Final",
    }
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
#let authors = inputs.authors
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
  let selected-font = if span.font_family == "geist" {
    "Geist"
  } else if span.font_family == "source_serif_4" {
    "Source Serif 4"
  } else if span.font_family == "geist_mono" {
    "Geist Mono"
  } else if span.code {
    inputs.mono_font
  } else {
    inputs.body_font
  }
  let weight = if span.bold { 700 } else { 400 }
  let slant = if span.italic { "italic" } else { "normal" }
  let styled = if span.font_size > 0 and span.color != "" {
    text(font: selected-font, size: span.font_size * 1pt, fill: rgb(span.color), weight: weight, style: slant, span.text)
  } else if span.font_size > 0 {
    text(font: selected-font, size: span.font_size * 1pt, weight: weight, style: slant, span.text)
  } else if span.color != "" {
    text(font: selected-font, fill: rgb(span.color), weight: weight, style: slant, span.text)
  } else {
    text(font: selected-font, weight: weight, style: slant, span.text)
  }
  let styled = if span.code { box(inset: (x: 2pt, y: 0.5pt), fill: rgb("#E9EDF0"), styled) } else { styled }
  let styled = if span.project_reference {
    box(inset: (x: 3pt, y: 1pt), fill: rgb("#EEF2F5"), stroke: 0.35pt + rule, radius: 1pt, styled)
  } else { styled }
  let styled = if span.underline { underline(styled) } else { styled }
  let styled = if span.strike { strike(styled) } else { styled }
  let styled = if span.highlight { highlight(fill: rgb("#F5D547"), styled) } else { styled }
  let styled = if span.subscript { sub(styled) } else if span.superscript { super(styled) } else { styled }
  if span.evidence_anchor != "" {
    context {
      let targets = query(metadata.where(value: span.evidence_anchor))
      if targets.len() > 0 {
        link(targets.first().location(), styled)
      } else {
        styled
      }
    }
  } else if span.href == "" {
    styled
  } else {
    link(span.href, styled)
  }
}).join()

#let render-aligned(alignment, body) = {
  if alignment == "center" {
    align(center, body)
  } else if alignment == "right" {
    align(right, body)
  } else if alignment == "justify" {
    block(width: 100%)[#set par(justify: true); #body]
  } else {
    body
  }
}

#let render-styled-paragraph(item) = block(
  width: 100%,
  below: item.paragraph_spacing * 1pt,
)[
  #set par(leading: (item.line_spacing - 1) * 1em + 0.55em)
  #render-aligned(item.alignment, render-inline(item.spans))
]

#let render-document-table(item) = block(width: 100%, below: 8pt)[
  #let table-columns = if item.widths.len() == item.columns {
    item.widths.map(width => width * 1fr)
  } else {
    item.columns
  }
  #set text(font: inputs.body_font, size: 8.2pt, hyphenate: false)
  #table(
    columns: table-columns,
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

#let render-block(item) = {
  if item.kind == "paragraph" {
    block(below: 6pt)[#render-inline(item.spans)]
  } else if item.kind == "styled-paragraph" {
    render-styled-paragraph(item)
  } else if item.kind == "aligned-paragraph" {
    block(width: 100%, below: 6pt)[#render-aligned(item.alignment, render-inline(item.spans))]
  } else if item.kind == "code-block" {
    block(width: 100%, inset: 7pt, below: 7pt, fill: rgb("#E9EDF0"), stroke: 0.4pt + rule)[
      #text(font: inputs.mono_font, size: 8.5pt, item.spans.map(span => span.text).join())
    ]
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
  } else if item.kind == "heading" {
    block(below: item.paragraph_spacing * 1pt)[
      #set par(leading: (item.line_spacing - 1) * 1em + 0.55em)
      #render-aligned(item.alignment, heading(level: item.level, outlined: true, render-inline(item.spans)))
    ]
  } else if item.kind == "page-break" {
    pagebreak()
  } else if item.kind == "horizontal-rule" {
    block(width: 100%, above: 6pt, below: 8pt)[#line(length: 100%, stroke: 0.6pt + rule)]
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
  } else if item.kind == "ordered-list" {
    block(below: 6pt)[
      #set enum(indent: 12pt, body-indent: 5pt, spacing: 3pt)
      #enum(..item.items.map(spans => [#render-inline(spans)]))
    ]
  } else if item.kind == "task-list" {
    block(below: 6pt)[
      #set list(marker: none, indent: 0pt, body-indent: 0pt, spacing: 3pt)
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
    if item.layout == "landscape-page" and not inputs.landscape {
      pagebreak(weak: true)
      set page(flipped: true)
      render-document-table(item)
      pagebreak(weak: true)
      set page(flipped: inputs.landscape)
    } else {
      render-document-table(item)
    }
  } else if item.kind == "mitre-snapshot" {
    block(width: 100%, below: 8pt, breakable: false)[
      #set text(font: inputs.body_font, size: 8.2pt, hyphenate: false)
      #table(
        columns: (22%, 28%, 50%),
        inset: (x: 4pt, y: 4.5pt),
        stroke: 0.35pt + rule,
        fill: (x, y) => if y == 0 { rgb("#F1F4F6") } else { paper },
        table.header(
          text(font: inputs.heading_font, size: 7.2pt, weight: 700, [TECHNIQUE ID]),
          text(font: inputs.heading_font, size: 7.2pt, weight: 700, [TECHNIQUE]),
          text(font: inputs.heading_font, size: 7.2pt, weight: 700, [EXPLANATION]),
        ),
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
        [
        #metadata(entry.anchor)
        #block(
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
              #image(
                entry.bytes,
                width: entry.width_mm * 1mm,
                height: entry.height_mm * 1mm,
                fit: "contain",
                alt: entry.title,
              )
              #v(3pt)
              #text(
                font: inputs.body_font,
                size: 7.5pt,
                style: "italic",
                fill: muted,
                "Evidence image — " + entry.title,
              )
            ]
          }
        ]
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
  } else if item.kind == "document-image" {
    block(width: 100%, below: 8pt, breakable: false)[
      #align(center)[
        #image(
          item.bytes,
          width: item.width_mm * 1mm,
          height: item.height_mm * 1mm,
          fit: "contain",
          alt: item.alt,
        )
        #if item.caption != "" {
          v(3pt)
          text(font: inputs.body_font, size: 7.5pt, style: "italic", fill: muted, item.caption)
        }
      ]
    ]
  }
}

#let render-section(section) = [
  #if section.title != "" {
    heading(level: 1, outlined: true, section.title)
    v(7pt)
  }
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
    columns: (1fr, auto, 1fr),
    align: (left + horizon, center + horizon, right + horizon),
    text(font: inputs.heading_font, size: 7.3pt, weight: 550, report-number),
    align(center + horizon)[#tlp-badge],
    [],
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
    if inputs.page_numbers { text(font: inputs.heading_font, size: 8pt)[Page #counter(page).display("1")] } else { [] },
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
      #text(font: inputs.heading_font, size: 32pt, weight: 780, tracking: 0.012em, fill: white, inputs.family)
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
    if authors == "" { [] } else {[
      #text(font: inputs.heading_font, size: 6.5pt, weight: 650, tracking: 0.1em, fill: luma(220), author-label) \
      #v(3pt)
      #stack(
        dir: ttb,
        spacing: 2pt,
        ..authors.split("\n").map(author => text(
          font: inputs.body_font,
          size: 10pt,
          weight: 570,
          fill: white,
          author,
        )),
      )
    ]},
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
#counter(page).update(1)
#set page(
  paper: inputs.paper,
  flipped: inputs.landscape,
  margin: (x: 14mm, top: 18mm, bottom: 18mm),
  header: if inputs.header { running-top } else { none },
  footer: if inputs.footer or inputs.page_numbers { running-bottom } else { none },
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
#outline(title: none, depth: 3, indent: auto)

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
        if document.kind() == sheut_core::DocumentKind::Report {
            let properties = document
                .report_properties()
                .ok_or_else(|| PublishError::new(PublishErrorCode::InvalidContent))?;
            let authors = properties
                .authors()
                .iter()
                .map(|author| {
                    author.role().map_or_else(
                        || author.name().to_owned(),
                        |role| format!("{} — {role}", author.name()),
                    )
                })
                .collect::<Vec<_>>()
                .join("\n");
            let mut administration =
                PublicationSection::new("report_administration", "Report administration");
            let mut rows = vec![
                ("Report ID".to_owned(), properties.report_id().to_owned()),
                ("Title".to_owned(), properties.title().to_owned()),
                ("Issue date".to_owned(), properties.issue_date().to_owned()),
            ];
            if !authors.is_empty() {
                rows.push(("Authors".to_owned(), authors.clone()));
            }
            if let Some(organisation) = properties.producing_organisation() {
                rows.push(("Producing organisation".to_owned(), organisation.to_owned()));
            }
            administration
                .blocks
                .push(PublicationBlock::MetadataTable { rows });
            let mut body = PublicationSection::new("document", "");
            append_document_blocks(document.root(), &mut body.blocks);
            let mut body_sections = vec![body];
            finalize_graph_snapshots(&mut body_sections);
            finalize_evidence_images(&mut body_sections);
            finalize_evidence_references(&mut body_sections);
            let metadata = BTreeMap::from([
                (
                    "report_number".to_owned(),
                    properties.report_id().to_owned(),
                ),
                (
                    "publication_date".to_owned(),
                    properties.issue_date().to_owned(),
                ),
                ("authors".to_owned(), authors),
            ]);
            return Self::new(
                properties.title().to_owned(),
                "Report".to_owned(),
                metadata,
                std::iter::once(administration)
                    .chain(body_sections)
                    .collect(),
            );
        }
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
        finalize_graph_snapshots(&mut sections);
        finalize_evidence_references(&mut sections);
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

    #[must_use]
    pub fn document_image_ids(&self) -> Vec<LocalId> {
        let mut ids = Vec::new();
        for block in self.sections.iter().flat_map(PublicationSection::blocks) {
            let attachment_id = match block {
                PublicationBlock::ImageAttachment { attachment_id, .. }
                | PublicationBlock::GraphSnapshot { attachment_id, .. } => Some(*attachment_id),
                _ => None,
            };
            if let Some(attachment_id) = attachment_id
                && !ids.contains(&attachment_id)
            {
                ids.push(attachment_id);
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
                if matches!(
                    section.key.as_str(),
                    "appendix_evidence_details" | "appendix_analytical_figures"
                ) {
                    return true;
                }
                if let Some(key) = section.key.strip_prefix("appendix_") {
                    appendix_selection.is_empty()
                        || appendix_selection
                            .iter()
                            .any(|selected| selected == key || selected == section.key())
                } else {
                    section.key == "document"
                        || body_selection.is_empty()
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
                upsert_metadata_row(
                    rows,
                    "Status",
                    publication_status_label(snapshot.publication_status()),
                    Some("Version"),
                );
                if let Some(marking) = snapshot.tlp_marking() {
                    upsert_metadata_row(rows, "Handling marking", marking.label(), Some("Status"));
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
            let mut snapshot_values = vec![
                PublicationBlock::LabeledText {
                    label: "Version".to_owned(),
                    text: snapshot.release_version().to_owned(),
                },
                PublicationBlock::LabeledText {
                    label: "Status".to_owned(),
                    text: publication_status_label(snapshot.publication_status()).to_owned(),
                },
            ];
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
    StyledParagraph {
        text: PublicationRichText,
        alignment: PublicationTextAlignment,
        style: PublicationParagraphStyle,
    },
    AlignedParagraph {
        text: PublicationRichText,
        alignment: PublicationTextAlignment,
    },
    CodeBlock(PublicationRichText),
    ParagraphGap,
    LabeledText {
        label: String,
        text: String,
    },
    MetadataTable {
        rows: Vec<(String, String)>,
    },
    Subheading(String),
    Heading {
        level: u8,
        text: String,
        rich_text: PublicationRichText,
        alignment: PublicationTextAlignment,
        style: PublicationParagraphStyle,
    },
    PageBreak,
    HorizontalRule,
    Callout(PublicationRichText),
    List(Vec<PublicationRichText>),
    OrderedList(Vec<PublicationRichText>),
    TaskList(Vec<PublicationRichText>),
    Table {
        headers: Vec<String>,
        rows: Vec<Vec<String>>,
        widths: Vec<u16>,
        layout: PublicationTableLayout,
    },
    MitreSnapshot {
        observations: Vec<PublicationMitreObservation>,
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
    ImageAttachment {
        attachment_id: LocalId,
        alt: String,
        title: Option<String>,
    },
    GraphSnapshot {
        attachment_id: LocalId,
        workspace_id: LocalId,
        workspace_revision: u64,
        workspace_name: String,
        placement: GraphSnapshotPlacement,
        alt: String,
        title: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GraphSnapshotPlacement {
    Inline,
    Appendix,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicationMitreObservation {
    observation_id: LocalId,
    revision: u64,
    catalog: String,
    catalog_version: String,
    technique_id: String,
    technique_name: String,
    explanation: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicationProjectReference {
    source_kind: String,
    source_id: LocalId,
    source_version: Option<String>,
    display: String,
    snapshot: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublicationTableLayout {
    FitPage,
    LandscapePage,
}

impl PublicationTableLayout {
    const fn typst_name(self) -> &'static str {
        match self {
            Self::FitPage => "fit-page",
            Self::LandscapePage => "landscape-page",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicationParagraphStyle {
    line_spacing: String,
    paragraph_spacing_pt: u8,
}

impl PublicationParagraphStyle {
    fn from_node(node: &JsonValue) -> Self {
        let attrs = node.get("attrs").and_then(JsonValue::as_object);
        let line_spacing = attrs
            .and_then(|attrs| attrs.get("lineSpacing"))
            .and_then(JsonValue::as_f64)
            .map_or_else(|| "1".to_owned(), format_bounded_spacing);
        let paragraph_spacing_pt = attrs
            .and_then(|attrs| attrs.get("paragraphSpacing"))
            .and_then(JsonValue::as_u64)
            .and_then(|value| u8::try_from(value).ok())
            .unwrap_or(6);
        Self {
            line_spacing,
            paragraph_spacing_pt,
        }
    }

    fn is_default(&self) -> bool {
        self.line_spacing == "1" && self.paragraph_spacing_pt == 6
    }
}

fn format_bounded_spacing(value: f64) -> String {
    if (value - 1.15).abs() < 0.001 {
        "1.15".to_owned()
    } else if (value - 1.5).abs() < 0.001 {
        "1.5".to_owned()
    } else if (value - 2.0).abs() < 0.001 {
        "2".to_owned()
    } else {
        "1".to_owned()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublicationTextAlignment {
    Left,
    Center,
    Right,
    Justify,
}

impl PublicationTextAlignment {
    fn from_node(node: &JsonValue) -> Self {
        match node
            .get("attrs")
            .and_then(|attrs| attrs.get("textAlign"))
            .and_then(JsonValue::as_str)
        {
            Some("center") => Self::Center,
            Some("right") => Self::Right,
            Some("justify") => Self::Justify,
            _ => Self::Left,
        }
    }

    const fn typst_name(self) -> &'static str {
        match self {
            Self::Left => "left",
            Self::Center => "center",
            Self::Right => "right",
            Self::Justify => "justify",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EvidenceIndexItem {
    evidence_id: LocalId,
    label: String,
    section_titles: Vec<String>,
    anchor: String,
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
        spans.retain(|span| !span.text.is_empty() || span.evidence_id.is_some());
        spans
            .iter()
            .any(|span| !span.text.trim().is_empty() || span.evidence_id.is_some())
            .then_some(Self { spans })
    }

    #[must_use]
    pub fn spans(&self) -> &[PublicationInlineSpan] {
        &self.spans
    }

    fn prepend(&mut self, prefix: &str) {
        if let Some(first) = self.spans.first_mut() {
            first.text.insert_str(0, prefix);
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicationInlineSpan {
    text: String,
    bold: bool,
    italic: bool,
    underline: bool,
    strike: bool,
    code: bool,
    highlight: bool,
    subscript: bool,
    superscript: bool,
    font_family: Option<String>,
    font_size: Option<u8>,
    color: Option<String>,
    project_reference: Option<PublicationProjectReference>,
    href: Option<String>,
    evidence_id: Option<LocalId>,
    evidence_label: Option<String>,
    evidence_number: Option<u32>,
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
    pub const fn underline(&self) -> bool {
        self.underline
    }

    #[must_use]
    pub const fn strike(&self) -> bool {
        self.strike
    }

    #[must_use]
    pub const fn code(&self) -> bool {
        self.code
    }

    #[must_use]
    pub const fn highlight(&self) -> bool {
        self.highlight
    }

    #[must_use]
    pub const fn subscript(&self) -> bool {
        self.subscript
    }

    #[must_use]
    pub const fn superscript(&self) -> bool {
        self.superscript
    }

    #[must_use]
    pub fn font_family(&self) -> Option<&str> {
        self.font_family.as_deref()
    }

    #[must_use]
    pub const fn font_size(&self) -> Option<u8> {
        self.font_size
    }

    #[must_use]
    pub fn color(&self) -> Option<&str> {
        self.color.as_deref()
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
    pub document_images: HashMap<LocalId, Vec<u8>>,
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
    render_pdf(&publication, snapshot, brand, assets)
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
        if let PublicationBlock::ImageAttachment { attachment_id, .. } = block {
            let bytes = assets
                .and_then(|assets| assets.document_images.get(attachment_id))
                .ok_or_else(|| PublishError::new(PublishErrorCode::InvalidContent))?;
            ImageMediaType::detect(bytes)
                .map_err(|_| PublishError::new(PublishErrorCode::InvalidContent))?;
        }
        if let PublicationBlock::GraphSnapshot { attachment_id, .. } = block {
            let bytes = assets
                .and_then(|assets| assets.document_images.get(attachment_id))
                .ok_or_else(|| PublishError::new(PublishErrorCode::InvalidContent))?;
            ImageMediaType::detect(bytes)
                .map_err(|_| PublishError::new(PublishErrorCode::InvalidContent))?;
        }
    }
    Ok(())
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
    let report_number = publication.metadata("report_number");
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
        cover_family(&publication.eyebrow, report_number).into_value(),
    );
    inputs.insert(
        "report_number".into(),
        report_number.unwrap_or("").into_value(),
    );
    inputs.insert(
        "publication_date".into(),
        publication
            .metadata("publication_date")
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

fn cover_family(eyebrow: &str, report_number: Option<&str>) -> String {
    report_number
        .filter(|value| !value.trim().is_empty())
        .map_or_else(
            || publication_family(eyebrow).to_uppercase(),
            |_| "THREAT INTELLIGENCE REPORT".to_owned(),
        )
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
        PublicationBlock::StyledParagraph {
            text,
            alignment,
            style,
        } => {
            value.insert("kind".into(), "styled-paragraph".into_value());
            value.insert("spans".into(), typst_rich_text(text).into_value());
            value.insert("alignment".into(), alignment.typst_name().into_value());
            value.insert(
                "line_spacing".into(),
                style
                    .line_spacing
                    .parse::<f64>()
                    .unwrap_or(1.0)
                    .into_value(),
            );
            value.insert(
                "paragraph_spacing".into(),
                i64::from(style.paragraph_spacing_pt).into_value(),
            );
        }
        PublicationBlock::AlignedParagraph { text, alignment } => {
            value.insert("kind".into(), "aligned-paragraph".into_value());
            value.insert("spans".into(), typst_rich_text(text).into_value());
            value.insert("alignment".into(), alignment.typst_name().into_value());
        }
        PublicationBlock::CodeBlock(text) => {
            value.insert("kind".into(), "code-block".into_value());
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
        PublicationBlock::Heading {
            level,
            text,
            rich_text,
            alignment,
            style,
        } => {
            value.insert("kind".into(), "heading".into_value());
            value.insert("level".into(), i64::from(*level).into_value());
            value.insert("text".into(), text.clone().into_value());
            value.insert("spans".into(), typst_rich_text(rich_text).into_value());
            value.insert("alignment".into(), alignment.typst_name().into_value());
            value.insert(
                "line_spacing".into(),
                style
                    .line_spacing
                    .parse::<f64>()
                    .unwrap_or(1.0)
                    .into_value(),
            );
            value.insert(
                "paragraph_spacing".into(),
                i64::from(style.paragraph_spacing_pt).into_value(),
            );
        }
        PublicationBlock::PageBreak => {
            value.insert("kind".into(), "page-break".into_value());
        }
        PublicationBlock::HorizontalRule => {
            value.insert("kind".into(), "horizontal-rule".into_value());
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
        PublicationBlock::OrderedList(items) => {
            value.insert("kind".into(), "ordered-list".into_value());
            value.insert(
                "items".into(),
                items
                    .iter()
                    .map(typst_rich_text)
                    .collect::<Vec<_>>()
                    .into_value(),
            );
        }
        PublicationBlock::TaskList(items) => {
            value.insert("kind".into(), "task-list".into_value());
            value.insert(
                "items".into(),
                items
                    .iter()
                    .map(typst_rich_text)
                    .collect::<Vec<_>>()
                    .into_value(),
            );
        }
        PublicationBlock::Table {
            headers,
            rows,
            widths,
            layout,
        } => {
            value.insert("kind".into(), "table".into_value());
            value.insert(
                "columns".into(),
                i64::try_from(headers.len()).unwrap_or(1).into_value(),
            );
            value.insert("headers".into(), headers.clone().into_value());
            value.insert(
                "widths".into(),
                widths
                    .iter()
                    .map(|width| i64::from(*width))
                    .collect::<Vec<_>>()
                    .into_value(),
            );
            value.insert("layout".into(), layout.typst_name().into_value());
            value.insert(
                "cells".into(),
                rows.iter()
                    .flatten()
                    .cloned()
                    .collect::<Vec<_>>()
                    .into_value(),
            );
        }
        PublicationBlock::MitreSnapshot { observations } => {
            value.insert("kind".into(), "mitre-snapshot".into_value());
            value.insert(
                "cells".into(),
                observations
                    .iter()
                    .flat_map(|observation| {
                        [
                            observation.technique_id.clone(),
                            observation.technique_name.clone(),
                            observation.explanation.clone(),
                        ]
                    })
                    .collect::<Vec<_>>()
                    .into_value(),
            );
            value.insert(
                "observations".into(),
                observations
                    .iter()
                    .map(|observation| {
                        let mut snapshot = Dict::new();
                        snapshot.insert(
                            "observation_id".into(),
                            observation.observation_id.to_string().into_value(),
                        );
                        snapshot.insert(
                            "revision".into(),
                            i64::try_from(observation.revision)
                                .unwrap_or(i64::MAX)
                                .into_value(),
                        );
                        snapshot.insert("catalog".into(), observation.catalog.clone().into_value());
                        snapshot.insert(
                            "catalog_version".into(),
                            observation.catalog_version.clone().into_value(),
                        );
                        snapshot
                    })
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
                    .enumerate()
                    .map(|(index, item)| {
                        let mut entry = Dict::new();
                        entry.insert(
                            "title".into(),
                            format!(
                                "[{}] {}",
                                index.saturating_add(1),
                                evidence_index_title(item, assets)
                            )
                            .into_value(),
                        );
                        entry.insert("anchor".into(), item.anchor.clone().into_value());
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
                            let (image_width, image_height) = image_dimensions_emu(bytes);
                            let (width, height) = fit_image_dimensions(
                                image_width,
                                image_height,
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
            let (image_width, image_height) = image_dimensions_emu(bytes);
            let (width, height) = fit_image_dimensions(
                image_width,
                image_height,
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
        PublicationBlock::ImageAttachment {
            attachment_id,
            alt,
            title,
        } => {
            let bytes = assets
                .and_then(|assets| assets.document_images.get(attachment_id))
                .expect("document images are validated before rendering");
            let (image_width, image_height) = image_dimensions_emu(bytes);
            let (width, height) = fit_image_dimensions(
                image_width,
                image_height,
                evidence_image_bounds.max_width_emu,
                evidence_image_bounds.max_height_emu,
            );
            value.insert("kind".into(), "document-image".into_value());
            value.insert("bytes".into(), Bytes::new(bytes.clone()).into_value());
            value.insert("width_mm".into(), emu_to_whole_mm(width).into_value());
            value.insert("height_mm".into(), emu_to_whole_mm(height).into_value());
            value.insert("alt".into(), alt.clone().into_value());
            value.insert(
                "caption".into(),
                title.as_deref().unwrap_or_default().into_value(),
            );
        }
        PublicationBlock::GraphSnapshot {
            attachment_id,
            workspace_name,
            workspace_revision,
            alt,
            title,
            ..
        } => {
            let bytes = assets
                .and_then(|assets| assets.document_images.get(attachment_id))
                .expect("graph images are validated before rendering");
            let (image_width, image_height) = image_dimensions_emu(bytes);
            let (width, height) = fit_image_dimensions(
                image_width,
                image_height,
                evidence_image_bounds.max_width_emu,
                evidence_image_bounds.max_height_emu,
            );
            value.insert("kind".into(), "document-image".into_value());
            value.insert("bytes".into(), Bytes::new(bytes.clone()).into_value());
            value.insert("width_mm".into(), emu_to_whole_mm(width).into_value());
            value.insert("height_mm".into(), emu_to_whole_mm(height).into_value());
            value.insert("alt".into(), alt.clone().into_value());
            value.insert(
                "caption".into(),
                format!("{title} — {workspace_name}, revision {workspace_revision}").into_value(),
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
            value.insert(
                "text".into(),
                span.evidence_number
                    .map_or_else(|| span.text().to_owned(), |number| format!("[{number}]"))
                    .into_value(),
            );
            value.insert("bold".into(), span.bold().into_value());
            value.insert("italic".into(), span.italic().into_value());
            value.insert("underline".into(), span.underline().into_value());
            value.insert("strike".into(), span.strike().into_value());
            value.insert("code".into(), span.code().into_value());
            value.insert("highlight".into(), span.highlight().into_value());
            value.insert("subscript".into(), span.subscript().into_value());
            value.insert("superscript".into(), span.superscript().into_value());
            value.insert(
                "font_family".into(),
                span.font_family().unwrap_or("").into_value(),
            );
            value.insert(
                "font_size".into(),
                i64::from(span.font_size().unwrap_or(0)).into_value(),
            );
            value.insert("color".into(), span.color().unwrap_or("").into_value());
            value.insert(
                "project_reference".into(),
                span.project_reference.is_some().into_value(),
            );
            if let Some(reference) = &span.project_reference {
                value.insert(
                    "project_source_kind".into(),
                    reference.source_kind.clone().into_value(),
                );
                value.insert(
                    "project_source_id".into(),
                    reference.source_id.to_string().into_value(),
                );
                value.insert(
                    "project_source_version".into(),
                    reference
                        .source_version
                        .as_deref()
                        .unwrap_or("")
                        .into_value(),
                );
                value.insert(
                    "project_display".into(),
                    reference.display.clone().into_value(),
                );
                value.insert(
                    "project_snapshot".into(),
                    reference
                        .snapshot
                        .iter()
                        .map(|(key, value)| (key.clone().into(), value.clone().into_value()))
                        .collect::<Dict>()
                        .into_value(),
                );
            }
            value.insert("href".into(), span.href().unwrap_or("").into_value());
            value.insert(
                "evidence_anchor".into(),
                span.evidence_id
                    .map(|id| format!("evidence-{id}"))
                    .unwrap_or_default()
                    .into_value(),
            );
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
        let alignment = PublicationTextAlignment::from_node(node);
        let style = PublicationParagraphStyle::from_node(node);
        Some(
            if alignment == PublicationTextAlignment::Left && style.is_default() {
                PublicationBlock::Paragraph(text)
            } else {
                PublicationBlock::StyledParagraph {
                    text,
                    alignment,
                    style,
                }
            },
        )
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
        "heading" => {
            let text = node_text(node).trim().to_owned();
            let rich_text = PublicationRichText::from_node(node)?;
            let level = node
                .get("attrs")
                .and_then(|attrs| attrs.get("level"))
                .and_then(JsonValue::as_u64)
                .and_then(|level| u8::try_from(level).ok())?;
            (!text.is_empty() && (1..=3).contains(&level)).then_some(PublicationBlock::Heading {
                level,
                text,
                rich_text,
                alignment: PublicationTextAlignment::from_node(node),
                style: PublicationParagraphStyle::from_node(node),
            })
        }
        "pageBreak" => Some(PublicationBlock::PageBreak),
        "horizontalRule" => Some(PublicationBlock::HorizontalRule),
        "paragraph" => PublicationRichText::from_node(node).map(PublicationBlock::Paragraph),
        "codeBlock" => PublicationRichText::from_node(node).map(PublicationBlock::CodeBlock),
        "blockquote" | "callout" => {
            PublicationRichText::from_node(node).map(PublicationBlock::Callout)
        }
        "bulletList" | "orderedList" | "taskList" => {
            let node_type = node_type.to_owned();
            let items = node
                .get("content")
                .and_then(JsonValue::as_array)
                .into_iter()
                .flatten()
                .filter_map(|item| {
                    let mut text = PublicationRichText::from_node(item)?;
                    if node_type == "taskList" {
                        let checked = item
                            .get("attrs")
                            .and_then(|attrs| attrs.get("checked"))
                            .and_then(JsonValue::as_bool)
                            .unwrap_or(false);
                        text.prepend(if checked { "☒ " } else { "☐ " });
                    }
                    Some(text)
                })
                .collect::<Vec<_>>();
            (!items.is_empty()).then_some(match node_type.as_str() {
                "orderedList" => PublicationBlock::OrderedList(items),
                "taskList" => PublicationBlock::TaskList(items),
                _ => PublicationBlock::List(items),
            })
        }
        "table" => table_from_node(node),
        "mitreSnapshot" => mitre_snapshot_from_node(node),
        "imageAttachment" => image_attachment_from_node(node),
        "evidenceImage" => evidence_image_from_node(node),
        "graphSnapshot" => graph_snapshot_from_node(node),
        _ => None,
    }
}

fn image_attachment_from_node(node: &JsonValue) -> Option<PublicationBlock> {
    let attrs = node.get("attrs")?.as_object()?;
    let attachment_id = LocalId::parse(attrs.get("attachmentId")?.as_str()?).ok()?;
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
    Some(PublicationBlock::ImageAttachment {
        attachment_id,
        alt: alt.to_owned(),
        title,
    })
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

fn graph_snapshot_from_node(node: &JsonValue) -> Option<PublicationBlock> {
    let attrs = node.get("attrs")?.as_object()?;
    Some(PublicationBlock::GraphSnapshot {
        attachment_id: LocalId::parse(attrs.get("attachmentId")?.as_str()?).ok()?,
        workspace_id: LocalId::parse(attrs.get("workspaceId")?.as_str()?).ok()?,
        workspace_revision: attrs.get("workspaceRevision")?.as_u64()?,
        workspace_name: attrs.get("workspaceName")?.as_str()?.to_owned(),
        placement: match attrs.get("placement")?.as_str()? {
            "inline" => GraphSnapshotPlacement::Inline,
            "appendix" => GraphSnapshotPlacement::Appendix,
            _ => return None,
        },
        alt: attrs.get("alt")?.as_str()?.to_owned(),
        title: attrs.get("title")?.as_str()?.to_owned(),
    })
}

fn finalize_graph_snapshots(sections: &mut Vec<PublicationSection>) {
    let mut appendix_blocks = Vec::new();
    for section in sections.iter_mut() {
        let mut retained = Vec::with_capacity(section.blocks.len());
        for block in section.blocks.drain(..) {
            if matches!(
                block,
                PublicationBlock::GraphSnapshot {
                    placement: GraphSnapshotPlacement::Appendix,
                    ..
                }
            ) {
                appendix_blocks.push(block);
            } else {
                retained.push(block);
            }
        }
        section.blocks = retained;
    }
    if !appendix_blocks.is_empty() {
        let mut appendix =
            PublicationSection::new("appendix_analytical_figures", "Analytical figures");
        appendix.blocks = appendix_blocks;
        sections.push(appendix);
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

fn finalize_evidence_references(sections: &mut Vec<PublicationSection>) {
    let mut items = Vec::<EvidenceIndexItem>::new();
    for section in sections.iter_mut() {
        let section_title = if section.title.trim().is_empty() {
            "Report body".to_owned()
        } else {
            section.title.clone()
        };
        for block in &mut section.blocks {
            match block {
                PublicationBlock::Paragraph(text)
                | PublicationBlock::CodeBlock(text)
                | PublicationBlock::Callout(text)
                | PublicationBlock::StyledParagraph { text, .. }
                | PublicationBlock::AlignedParagraph { text, .. } => {
                    number_evidence_spans(text, &section_title, &mut items);
                }
                PublicationBlock::List(entries)
                | PublicationBlock::OrderedList(entries)
                | PublicationBlock::TaskList(entries) => {
                    for text in entries {
                        number_evidence_spans(text, &section_title, &mut items);
                    }
                }
                PublicationBlock::EvidenceImage {
                    evidence_id, alt, ..
                } => {
                    register_evidence_reference(*evidence_id, alt, &section_title, &mut items);
                }
                _ => {}
            }
        }
    }
    if items.is_empty() {
        return;
    }
    let mut appendix = PublicationSection::new(
        "appendix_evidence_details",
        "Evidence extracts and methodology details",
    );
    appendix
        .blocks
        .push(PublicationBlock::EvidenceIndex { items });
    sections.push(appendix);
}

fn number_evidence_spans(
    text: &mut PublicationRichText,
    section_title: &str,
    items: &mut Vec<EvidenceIndexItem>,
) {
    for span in &mut text.spans {
        let Some(evidence_id) = span.evidence_id else {
            continue;
        };
        let label = span.evidence_label.as_deref().unwrap_or("Evidence");
        span.evidence_number = Some(register_evidence_reference(
            evidence_id,
            label,
            section_title,
            items,
        ));
    }
}

fn register_evidence_reference(
    evidence_id: LocalId,
    label: &str,
    section_title: &str,
    items: &mut Vec<EvidenceIndexItem>,
) -> u32 {
    if let Some(index) = items
        .iter()
        .position(|item| item.evidence_id == evidence_id)
    {
        if !items[index]
            .section_titles
            .iter()
            .any(|title| title == section_title)
        {
            items[index].section_titles.push(section_title.to_owned());
        }
        return u32::try_from(index.saturating_add(1)).unwrap_or(u32::MAX);
    }
    items.push(EvidenceIndexItem {
        evidence_id,
        label: label.to_owned(),
        section_titles: vec![section_title.to_owned()],
        anchor: format!("evidence-{evidence_id}"),
    });
    u32::try_from(items.len()).unwrap_or(u32::MAX)
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
        details.push(("Evidence ID".to_owned(), metadata.id().to_string()));
        details.push((
            "Evidence revision".to_owned(),
            metadata.revision().get().to_string(),
        ));
        details.push(("File name".to_owned(), metadata.file_name().to_owned()));
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
        if !metadata.source_url().trim().is_empty() {
            details.push((
                "Source URL".to_owned(),
                metadata.source_url().trim().to_owned(),
            ));
        }
        if let Some(captured_at) = metadata.captured_at() {
            details.push(("Captured".to_owned(), captured_at.to_owned()));
        }
        if !metadata.tags().is_empty() {
            details.push(("Tags".to_owned(), metadata.tags().join(", ")));
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
    if node.get("type").and_then(JsonValue::as_str) == Some("projectReference") {
        let Some(attrs) = node.get("attrs").and_then(JsonValue::as_object) else {
            return;
        };
        let Some(source_id) = attrs
            .get("sourceId")
            .and_then(JsonValue::as_str)
            .and_then(|value| LocalId::parse(value).ok())
        else {
            return;
        };
        let Some(label) = attrs
            .get("label")
            .and_then(JsonValue::as_str)
            .map(str::trim)
            .filter(|label| !label.is_empty())
        else {
            return;
        };
        let snapshot = attrs
            .get("snapshot")
            .and_then(JsonValue::as_object)
            .map(|snapshot| {
                snapshot
                    .iter()
                    .filter_map(|(key, value)| {
                        value.as_str().map(|value| (key.clone(), value.to_owned()))
                    })
                    .collect::<BTreeMap<_, _>>()
            })
            .unwrap_or_default();
        spans.push(PublicationInlineSpan {
            text: label.to_owned(),
            bold: false,
            italic: false,
            underline: false,
            strike: false,
            code: false,
            highlight: false,
            subscript: false,
            superscript: false,
            font_family: None,
            font_size: None,
            color: None,
            project_reference: Some(PublicationProjectReference {
                source_kind: attrs
                    .get("sourceKind")
                    .and_then(JsonValue::as_str)
                    .unwrap_or("intelligence")
                    .to_owned(),
                source_id,
                source_version: attrs
                    .get("sourceVersion")
                    .and_then(JsonValue::as_str)
                    .map(str::to_owned),
                display: attrs
                    .get("display")
                    .and_then(JsonValue::as_str)
                    .unwrap_or("inline")
                    .to_owned(),
                snapshot,
            }),
            href: None,
            evidence_id: None,
            evidence_label: None,
            evidence_number: None,
        });
        return;
    }
    if node.get("type").and_then(JsonValue::as_str) == Some("evidenceCitation") {
        let Some(attrs) = node.get("attrs").and_then(JsonValue::as_object) else {
            return;
        };
        let Some(evidence_id) = attrs
            .get("evidenceId")
            .and_then(JsonValue::as_str)
            .and_then(|value| LocalId::parse(value).ok())
        else {
            return;
        };
        let Some(label) = attrs
            .get("label")
            .and_then(JsonValue::as_str)
            .map(str::trim)
            .filter(|label| !label.is_empty())
        else {
            return;
        };
        spans.push(PublicationInlineSpan {
            text: String::new(),
            bold: false,
            italic: false,
            underline: false,
            strike: false,
            code: false,
            highlight: false,
            subscript: false,
            superscript: false,
            font_family: None,
            font_size: None,
            color: None,
            project_reference: None,
            href: None,
            evidence_id: Some(evidence_id),
            evidence_label: Some(label.to_owned()),
            evidence_number: None,
        });
        return;
    }
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
        let underline = has_mark("underline");
        let strike = has_mark("strike");
        let code = has_mark("code");
        let highlight = has_mark("highlight");
        let subscript = has_mark("subscript");
        let superscript = has_mark("superscript");
        let text_style = marks
            .iter()
            .find(|mark| mark.get("type").and_then(JsonValue::as_str) == Some("textStyle"));
        let font_family = text_style
            .and_then(|mark| mark.get("attrs"))
            .and_then(|attrs| attrs.get("fontFamily"))
            .and_then(JsonValue::as_str)
            .map(str::to_owned);
        let font_size = text_style
            .and_then(|mark| mark.get("attrs"))
            .and_then(|attrs| attrs.get("fontSize"))
            .and_then(JsonValue::as_u64)
            .and_then(|value| u8::try_from(value).ok());
        let color = text_style
            .and_then(|mark| mark.get("attrs"))
            .and_then(|attrs| attrs.get("color"))
            .and_then(JsonValue::as_str)
            .map(str::to_owned);
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
        if let Some(last) = spans.last_mut().filter(|last| {
            last.bold == bold
                && last.italic == italic
                && last.underline == underline
                && last.strike == strike
                && last.code == code
                && last.highlight == highlight
                && last.subscript == subscript
                && last.superscript == superscript
                && last.font_family == font_family
                && last.font_size == font_size
                && last.color == color
                && last.project_reference.is_none()
                && last.href == href
                && last.evidence_id.is_none()
        }) {
            last.text.push_str(text);
        } else {
            spans.push(PublicationInlineSpan {
                text: text.to_owned(),
                bold,
                italic,
                underline,
                strike,
                code,
                highlight,
                subscript,
                superscript,
                font_family,
                font_size,
                color,
                project_reference: None,
                href,
                evidence_id: None,
                evidence_label: None,
                evidence_number: None,
            });
        }
        return;
    }
    if node.get("type").and_then(JsonValue::as_str) == Some("hardBreak") {
        spans.push(PublicationInlineSpan {
            text: "\n".to_owned(),
            bold: false,
            italic: false,
            underline: false,
            strike: false,
            code: false,
            highlight: false,
            subscript: false,
            superscript: false,
            font_family: None,
            font_size: None,
            color: None,
            project_reference: None,
            href: None,
            evidence_id: None,
            evidence_label: None,
            evidence_number: None,
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
    let requested_landscape = node
        .get("attrs")
        .and_then(|attrs| attrs.get("layout"))
        .and_then(JsonValue::as_str)
        == Some("landscape-page");
    let widths = node
        .get("content")
        .and_then(JsonValue::as_array)
        .and_then(|rows| rows.first())
        .and_then(|row| row.get("content"))
        .and_then(JsonValue::as_array)
        .map(|cells| {
            cells
                .iter()
                .map(|cell| {
                    cell.get("attrs")
                        .and_then(|attrs| attrs.get("colwidth"))
                        .and_then(JsonValue::as_array)
                        .and_then(|widths| widths.first())
                        .and_then(JsonValue::as_u64)
                        .and_then(|width| u16::try_from(width).ok())
                        .unwrap_or(1)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
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
    let layout = if requested_landscape
        && (headers.len() >= 6
            || widths
                .iter()
                .map(|width| usize::from(*width))
                .sum::<usize>()
                >= 720)
    {
        PublicationTableLayout::LandscapePage
    } else {
        PublicationTableLayout::FitPage
    };
    Some(PublicationBlock::Table {
        headers: headers.clone(),
        rows,
        widths,
        layout,
    })
}

fn mitre_snapshot_from_node(node: &JsonValue) -> Option<PublicationBlock> {
    let observations = node
        .get("attrs")?
        .get("observations")?
        .as_array()?
        .iter()
        .filter_map(|observation| {
            let observation_id =
                LocalId::parse(observation.get("observationId")?.as_str()?).ok()?;
            Some(PublicationMitreObservation {
                observation_id,
                revision: observation.get("revision")?.as_u64()?,
                catalog: observation.get("catalog")?.as_str()?.to_owned(),
                catalog_version: observation.get("catalogVersion")?.as_str()?.to_owned(),
                technique_id: observation.get("techniqueId")?.as_str()?.to_owned(),
                technique_name: observation.get("techniqueName")?.as_str()?.to_owned(),
                explanation: observation.get("explanation")?.as_str()?.to_owned(),
            })
        })
        .collect::<Vec<_>>();
    (!observations.is_empty()).then_some(PublicationBlock::MitreSnapshot { observations })
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

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::io::Cursor;

    use image::{DynamicImage, ImageFormat};
    use sheut_core::{
        BrandProfile, EvidenceFileMetadata, EvidenceMetadataInput, LocalId, PublicationFormat,
        PublicationReleaseEntry, PublicationSettings, PublicationSnapshot, PublicationSource,
        PublicationStatus, Revision,
    };
    use typst::layout::{Frame, FrameItem};
    use typst_as_lib::TypstEngine;

    use super::{
        EvidenceIndexItem, GEIST_FONT, GEIST_MONO_FONT, PublicationAssets, PublicationBlock,
        PublicationInlineSpan, PublicationIr, PublicationRichText, PublicationSection,
        SOURCE_SERIF_FONT, TYPST_TEMPLATE, author_label, cover_family, evidence_image_bounds,
        fit_image_dimensions, table_from_node, typst_inputs,
    };

    fn collect_frame_content(
        frame: &Frame,
        text: &mut String,
        image_count: &mut usize,
        link_count: &mut usize,
    ) {
        for (_, item) in frame.items() {
            match item {
                FrameItem::Group(group) => {
                    collect_frame_content(&group.frame, text, image_count, link_count);
                }
                FrameItem::Text(item) => text.push_str(&item.text),
                FrameItem::Image(..) => *image_count += 1,
                FrameItem::Link(..) => *link_count += 1,
                FrameItem::Shape(..) | FrameItem::Tag(..) => {}
            }
        }
    }

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
    fn report_cover_uses_a_descriptive_product_label_instead_of_a_generic_family() {
        assert_eq!(
            cover_family("Report", Some("RPT-0042")),
            "THREAT INTELLIGENCE REPORT"
        );
        assert_eq!(cover_family("Analyst note", None), "ANALYST NOTE");
        assert!(
            TYPST_TEMPLATE
                .contains("size: 32pt, weight: 780, tracking: 0.012em, fill: white, inputs.family")
        );
    }

    #[test]
    fn report_administration_includes_release_status_from_publication_snapshot() {
        let profile = BrandProfile::project_default(
            LocalId::parse("110b83fb-9fdb-4133-a29b-e75725bb6d0c").unwrap(),
            "Example organization",
            1_000,
        )
        .unwrap();
        let settings = PublicationSettings::from_brand(&profile, PublicationFormat::Pdf)
            .with_release("2.0", PublicationStatus::Final, false, Vec::new())
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
        let mut administration =
            PublicationSection::new("report_administration", "Report administration");
        administration.blocks.push(PublicationBlock::MetadataTable {
            rows: vec![("Report ID".to_owned(), "RPT-0042".to_owned())],
        });
        let publication = PublicationIr::new(
            "Example report".to_owned(),
            "Report".to_owned(),
            BTreeMap::new(),
            vec![administration],
        )
        .unwrap()
        .selected_for(&snapshot);

        let PublicationBlock::MetadataTable { rows } = &publication.sections[0].blocks[0] else {
            panic!("report administration must remain a metadata table");
        };
        assert!(rows.contains(&("Version".to_owned(), "2.0".to_owned())));
        assert!(rows.contains(&("Status".to_owned(), "Final".to_owned())));
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
        assert!(TYPST_TEMPLATE.contains("table.header(..item.headers.map"));
        assert!(
            TYPST_TEMPLATE
                .contains("if item.layout == \"landscape-page\" and not inputs.landscape")
        );
        assert!(TYPST_TEMPLATE.contains("set page(flipped: true)"));
        assert!(
            TYPST_TEMPLATE.contains("render-document-table(item)\n      pagebreak(weak: true)")
        );
    }

    #[test]
    fn running_header_centers_tlp_handling_in_the_furniture_band() {
        assert!(TYPST_TEMPLATE.contains("columns: (1fr, auto, 1fr)"));
        assert!(
            TYPST_TEMPLATE.contains("align: (left + horizon, center + horizon, right + horizon)")
        );
        assert!(TYPST_TEMPLATE.contains("align(center + horizon)[#tlp-badge]"));
    }

    #[test]
    fn narrow_tables_cannot_force_a_landscape_page() {
        let narrow = serde_json::json!({
            "type": "table",
            "attrs": {"layout": "landscape-page"},
            "content": [
                {"type": "tableRow", "content": [
                    {"type": "tableHeader", "attrs": {"colwidth": [200]}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "A"}]}]},
                    {"type": "tableHeader", "attrs": {"colwidth": [220]}, "content": [{"type": "paragraph", "content": [{"type": "text", "text": "B"}]}]}
                ]},
                {"type": "tableRow", "content": [
                    {"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "1"}]}]},
                    {"type": "tableCell", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "2"}]}]}
                ]}
            ]
        });
        let Some(PublicationBlock::Table { layout, .. }) = table_from_node(&narrow) else {
            panic!("table must project into publication IR");
        };
        assert_eq!(layout, super::PublicationTableLayout::FitPage);
    }

    #[test]
    fn evidence_index_preview_executes_typst_image_content_instead_of_printing_source() {
        let evidence_id = LocalId::parse("f8edb3d1-6705-4f64-9260-d7dc888f0512").unwrap();
        let profile = BrandProfile::project_default(
            LocalId::parse("110b83fb-9fdb-4133-a29b-e75725bb6d0c").unwrap(),
            "Example organization",
            1_000,
        )
        .unwrap();
        let settings = PublicationSettings::from_brand(&profile, PublicationFormat::Pdf);
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
        let mut section = PublicationSection::new(
            "appendix_evidence_details",
            "Evidence extracts and methodology details",
        );
        section.blocks.push(PublicationBlock::EvidenceIndex {
            items: vec![EvidenceIndexItem {
                evidence_id,
                label: "Captured storefront".to_owned(),
                section_titles: vec!["Assessment".to_owned()],
                anchor: "evidence-f8edb3d1".to_owned(),
            }],
        });
        let mut body = PublicationSection::new("document", "");
        body.blocks.push(PublicationBlock::EvidenceImage {
            evidence_id,
            alt: "Captured storefront".to_owned(),
            title: Some("Landing page before redirect".to_owned()),
            placement: super::EvidenceImagePlacement::Inline,
            figure_label: "1".to_owned(),
        });
        let publication = PublicationIr::new(
            "Evidence report".to_owned(),
            "Report".to_owned(),
            BTreeMap::new(),
            vec![body, section],
        )
        .unwrap();
        let mut png = Cursor::new(Vec::new());
        DynamicImage::new_rgb8(32, 18)
            .write_to(&mut png, ImageFormat::Png)
            .unwrap();
        let mut assets = PublicationAssets::default();
        assets.evidence_images.insert(evidence_id, png.into_inner());
        assets.evidence_metadata.insert(
            evidence_id,
            EvidenceFileMetadata::from_parts(
                evidence_id,
                Revision::new(4).unwrap(),
                "image/png",
                "storefront.png",
                1_024,
                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                EvidenceMetadataInput::new(
                    "Captured storefront",
                    "Landing page before redirect.",
                    "Analyst capture",
                    Some("2026-08-04".to_owned()),
                    "https://evidence.example/storefront",
                    vec!["phishing".to_owned(), "storefront".to_owned()],
                    "Preserve the original viewport and redirect chain.",
                )
                .unwrap(),
                1_000,
                2_000,
            )
            .unwrap(),
        );
        let engine = TypstEngine::builder()
            .main_file(TYPST_TEMPLATE)
            .fonts([GEIST_FONT, GEIST_MONO_FONT, SOURCE_SERIF_FONT])
            .build();
        let document = engine
            .compile_with_input(typst_inputs(
                &publication,
                &snapshot,
                Some(&profile),
                Some(&assets),
            ))
            .output
            .expect("evidence appendix must compile");
        typst_pdf::pdf(&document, &Default::default()).unwrap();
        let mut rendered_text = String::new();
        let mut image_count = 0;
        let mut link_count = 0;
        for page in document.pages() {
            collect_frame_content(
                &page.frame,
                &mut rendered_text,
                &mut image_count,
                &mut link_count,
            );
        }

        assert!(
            image_count >= 2,
            "the body figure and appendix preview must both render image frames"
        );
        assert!(rendered_text.contains("Figure 1."));
        assert!(rendered_text.contains("Evidence image"));
        assert!(rendered_text.contains("ANALYST NOTES"));
        assert!(rendered_text.contains("Preserve the original viewport and redirect chain."));
        assert!(rendered_text.contains("Analyst capture"));
        assert!(rendered_text.contains("0123456789abcdef"));
        assert!(!rendered_text.contains("entry.bytes"));
        assert!(!rendered_text.contains("width_mm"));
    }

    #[test]
    fn evidence_citations_add_an_internal_link_to_the_appendix_entry() {
        let evidence_id = LocalId::parse("f8edb3d1-6705-4f64-9260-d7dc888f0512").unwrap();
        let profile = BrandProfile::project_default(
            LocalId::parse("110b83fb-9fdb-4133-a29b-e75725bb6d0c").unwrap(),
            "Example organization",
            1_000,
        )
        .unwrap();
        let settings = PublicationSettings::from_brand(&profile, PublicationFormat::Pdf);
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
        let compile_link_count = |with_citation: bool| {
            let mut body = PublicationSection::new("document", "");
            if with_citation {
                body.blocks
                    .push(PublicationBlock::Paragraph(PublicationRichText {
                        spans: vec![PublicationInlineSpan {
                            text: String::new(),
                            bold: false,
                            italic: false,
                            underline: false,
                            strike: false,
                            code: false,
                            highlight: false,
                            subscript: false,
                            superscript: false,
                            font_family: None,
                            font_size: None,
                            color: None,
                            project_reference: None,
                            href: None,
                            evidence_id: Some(evidence_id),
                            evidence_label: Some("Captured storefront".to_owned()),
                            evidence_number: Some(1),
                        }],
                    }));
            }
            let mut appendix = PublicationSection::new(
                "appendix_evidence_details",
                "Evidence extracts and methodology details",
            );
            appendix.blocks.push(PublicationBlock::EvidenceIndex {
                items: vec![EvidenceIndexItem {
                    evidence_id,
                    label: "Captured storefront".to_owned(),
                    section_titles: vec!["Assessment".to_owned()],
                    anchor: format!("evidence-{evidence_id}"),
                }],
            });
            let publication = PublicationIr::new(
                "Evidence report".to_owned(),
                "Report".to_owned(),
                BTreeMap::new(),
                vec![body, appendix],
            )
            .unwrap();
            let engine = TypstEngine::builder()
                .main_file(TYPST_TEMPLATE)
                .fonts([GEIST_FONT, GEIST_MONO_FONT, SOURCE_SERIF_FONT])
                .build();
            let document = engine
                .compile_with_input(typst_inputs(&publication, &snapshot, Some(&profile), None))
                .output
                .unwrap();
            typst_pdf::pdf(&document, &Default::default()).unwrap();
            let mut text = String::new();
            let mut image_count = 0;
            let mut link_count = 0;
            for page in document.pages() {
                collect_frame_content(&page.frame, &mut text, &mut image_count, &mut link_count);
            }
            link_count
        };

        assert_eq!(compile_link_count(true), compile_link_count(false) + 1);
    }

    #[test]
    fn typst_cover_masthead_uses_saved_brand_name_without_a_fixed_product_label() {
        assert!(TYPST_TEMPLATE.contains("upper(inputs.brand_name)"));
        assert!(!TYPST_TEMPLATE.contains("INTELLIGENCE PRODUCT"));
    }

    #[test]
    fn analyst_text_that_looks_like_typst_is_rendered_as_inert_literal_content() {
        let profile = BrandProfile::project_default(
            LocalId::parse("110b83fb-9fdb-4133-a29b-e75725bb6d0c").unwrap(),
            "Example organization",
            1_000,
        )
        .unwrap();
        let settings = PublicationSettings::from_brand(&profile, PublicationFormat::Pdf);
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
        let injected = "#eval(system.inputs) #set page(fill: red)";
        let mut body = PublicationSection::new("document", "");
        body.blocks
            .push(PublicationBlock::Paragraph(PublicationRichText {
                spans: vec![PublicationInlineSpan {
                    text: injected.to_owned(),
                    bold: false,
                    italic: false,
                    underline: false,
                    strike: false,
                    code: false,
                    highlight: false,
                    subscript: false,
                    superscript: false,
                    font_family: None,
                    font_size: None,
                    color: None,
                    project_reference: None,
                    href: None,
                    evidence_id: None,
                    evidence_label: None,
                    evidence_number: None,
                }],
            }));
        let publication = PublicationIr::new(
            "Injection regression".to_owned(),
            "Report".to_owned(),
            BTreeMap::new(),
            vec![body],
        )
        .unwrap();
        let engine = TypstEngine::builder()
            .main_file(TYPST_TEMPLATE)
            .fonts([GEIST_FONT, GEIST_MONO_FONT, SOURCE_SERIF_FONT])
            .build();
        let document = engine
            .compile_with_input(typst_inputs(&publication, &snapshot, Some(&profile), None))
            .output
            .expect("typed analyst text must compile without becoming Typst source");
        typst_pdf::pdf(&document, &Default::default()).unwrap();
        let mut rendered_text = String::new();
        let mut image_count = 0;
        let mut link_count = 0;
        for page in document.pages() {
            collect_frame_content(
                &page.frame,
                &mut rendered_text,
                &mut image_count,
                &mut link_count,
            );
        }
        assert!(rendered_text.contains(injected));
    }

    #[test]
    fn landscape_table_followed_by_page_break_does_not_create_an_empty_page() {
        let profile = BrandProfile::project_default(
            LocalId::parse("110b83fb-9fdb-4133-a29b-e75725bb6d0c").unwrap(),
            "Example organization",
            1_000,
        )
        .unwrap();
        let settings = PublicationSettings::from_brand(&profile, PublicationFormat::Pdf);
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
        let mut body = PublicationSection::new("document", "");
        body.blocks.push(PublicationBlock::Table {
            headers: vec!["Indicator".to_owned(), "Assessment".to_owned()],
            rows: vec![vec!["example.test".to_owned(), "Malicious".to_owned()]],
            widths: vec![360, 420],
            layout: super::PublicationTableLayout::LandscapePage,
        });
        body.blocks.push(PublicationBlock::PageBreak);
        body.blocks
            .push(PublicationBlock::Paragraph(PublicationRichText {
                spans: vec![PublicationInlineSpan {
                    text: "Next authored page".to_owned(),
                    bold: false,
                    italic: false,
                    underline: false,
                    strike: false,
                    code: false,
                    highlight: false,
                    subscript: false,
                    superscript: false,
                    font_family: None,
                    font_size: None,
                    color: None,
                    project_reference: None,
                    href: None,
                    evidence_id: None,
                    evidence_label: None,
                    evidence_number: None,
                }],
            }));
        let publication = PublicationIr::new(
            "Pagination regression".to_owned(),
            "Report".to_owned(),
            BTreeMap::new(),
            vec![body],
        )
        .unwrap();
        let engine = TypstEngine::builder()
            .main_file(TYPST_TEMPLATE)
            .fonts([GEIST_FONT, GEIST_MONO_FONT, SOURCE_SERIF_FONT])
            .build();
        let document = engine
            .compile_with_input(typst_inputs(&publication, &snapshot, Some(&profile), None))
            .output
            .expect("landscape pagination fixture must compile");
        typst_pdf::pdf(&document, &Default::default()).unwrap();
        assert_eq!(document.pages().len(), 4);
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
