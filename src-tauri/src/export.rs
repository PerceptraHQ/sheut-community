use serde::{Deserialize, Serialize};
use sheut_core::{BrandProfile, DocumentEnvelope, PublicationFormat, PublicationSnapshot};
#[cfg(test)]
use sheut_core::{
    LocalId, PageOrientation, PaperSize, PublicationSettings, PublicationSource, TlpMarking,
    render_document,
};
use sheut_publish::{PublicationAssets, PublicationIr, render_publication_with_assets};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum ExportFormat {
    Pdf,
}

impl ExportFormat {
    pub(super) const fn from_publication_format(format: PublicationFormat) -> Self {
        match format {
            PublicationFormat::Pdf => Self::Pdf,
        }
    }

    pub(super) const fn extension(self) -> &'static str {
        match self {
            Self::Pdf => "pdf",
        }
    }

    pub(super) const fn filter_name(self) -> &'static str {
        match self {
            Self::Pdf => "PDF document",
        }
    }

    pub(super) const fn publication_format(self) -> PublicationFormat {
        match self {
            Self::Pdf => PublicationFormat::Pdf,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub(super) struct ExportOutcome {
    saved: bool,
}

impl ExportOutcome {
    pub(super) const fn saved() -> Self {
        Self { saved: true }
    }

    pub(super) const fn cancelled() -> Self {
        Self { saved: false }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct ExportError;

#[cfg(test)]
pub(super) fn export_bytes(
    document: &DocumentEnvelope,
    brand: &BrandProfile,
    assets: &PublicationAssets,
    marking: TlpMarking,
    format: ExportFormat,
    paper_size: PaperSize,
    orientation: PageOrientation,
) -> Result<Vec<u8>, ExportError> {
    let publication_format = format.publication_format();
    let settings = PublicationSettings::from_brand(brand, publication_format)
        .with_paper_size(paper_size)
        .with_orientation(orientation)
        .with_tlp_marking(Some(marking));
    let snapshot = PublicationSnapshot::new(
        LocalId::parse("ec6ed71e-a754-4b32-b692-50f03f00154f").map_err(|_| ExportError)?,
        PublicationSource::FreeformDocument {
            document_id: document.id(),
            revision: document.revision(),
        },
        settings,
        0,
    )
    .map_err(|_| ExportError)?;
    render_freeform_snapshot(document, &snapshot, brand, assets)
}

pub(super) fn render_freeform_snapshot(
    document: &DocumentEnvelope,
    snapshot: &PublicationSnapshot,
    brand: &BrandProfile,
    assets: &PublicationAssets,
) -> Result<Vec<u8>, ExportError> {
    let publication = PublicationIr::from_freeform(document).map_err(|_| ExportError)?;
    render_publication_with_assets(&publication, snapshot, Some(brand), Some(assets))
        .map_err(|_| ExportError)
}

#[cfg(test)]
pub(super) fn suggested_file_name(document: &DocumentEnvelope, format: ExportFormat) -> String {
    let rendered = render_document(document);
    let title = rendered
        .plain_text()
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("Sheut document");
    let stem = safe_file_stem(title);
    format!("{stem}.{}", format.extension())
}

pub(super) fn requested_file_name(value: &str, format: ExportFormat) -> String {
    let value = value.trim();
    let extension = format!(".{}", format.extension());
    let stem = if value.to_ascii_lowercase().ends_with(&extension) {
        &value[..value.len() - extension.len()]
    } else {
        value
    };
    format!("{}.{}", safe_file_stem(stem), format.extension())
}

fn safe_file_stem(value: &str) -> String {
    let mut result = String::new();
    let mut separator_pending = false;
    for character in value.trim().chars().take(96) {
        if character.is_alphanumeric() || character == '_' || character == '-' {
            if separator_pending && !result.is_empty() && !result.ends_with('-') {
                result.push('-');
            }
            separator_pending = false;
            result.push(character);
        } else {
            separator_pending = true;
        }
    }
    let result = result.trim_matches(['-', '.', ' ']);
    let result = if result.is_empty() {
        "Sheut-document"
    } else {
        result
    };
    if is_windows_reserved_name(result) {
        format!("Sheut-{result}")
    } else {
        result.to_owned()
    }
}

fn is_windows_reserved_name(value: &str) -> bool {
    matches!(
        value.to_ascii_uppercase().as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

#[cfg(test)]
mod tests {
    use sheut_core::{
        BrandProfile, DocumentEnvelope, DocumentKind, LocalId, PageOrientation, PaperSize,
        Revision, TlpMarking,
    };
    use sheut_publish::PublicationAssets;

    use super::{ExportFormat, export_bytes, requested_file_name, suggested_file_name};

    fn fixture_document(text: &str) -> DocumentEnvelope {
        DocumentEnvelope::new(
            LocalId::parse("e7c44850-9f67-4d26-b7e3-0d4ee82339ef").unwrap(),
            DocumentKind::Investigation,
            Revision::new(1).unwrap(),
            serde_json::json!({
                "type": "doc",
                "content": [
                    {
                        "type": "heading",
                        "attrs": {"level": 1},
                        "content": [{"type": "text", "text": text}]
                    },
                    {
                        "type": "paragraph",
                        "content": [{"type": "text", "text": "Observed <script> remains text."}]
                    }
                ]
            }),
        )
        .unwrap()
    }

    #[test]
    fn freeform_exports_use_the_unified_offline_pipeline() {
        let document = fixture_document("Operation Midnight Echo");
        let brand = BrandProfile::project_default(
            LocalId::parse("110b83fb-9fdb-4133-a29b-e75725bb6d0c").unwrap(),
            "Sheut",
            0,
        )
        .unwrap();
        let assets = PublicationAssets::default();
        let pdf = export_bytes(
            &document,
            &brand,
            &assets,
            TlpMarking::Green,
            ExportFormat::Pdf,
            PaperSize::Letter,
            PageOrientation::Landscape,
        )
        .unwrap();
        assert!(pdf.starts_with(b"%PDF-"));
    }

    #[test]
    fn suggested_names_cannot_escape_the_native_save_directory() {
        let document = fixture_document("../../Operation: Shadow\\Evidence");
        assert_eq!(
            suggested_file_name(&document, ExportFormat::Pdf),
            "Operation-Shadow-Evidence.pdf"
        );
    }

    #[test]
    fn requested_names_are_bounded_to_a_safe_stem_and_selected_extension() {
        assert_eq!(
            requested_file_name("../../Incident response.pdf", ExportFormat::Pdf),
            "Incident-response.pdf"
        );
        assert_eq!(
            requested_file_name("   ", ExportFormat::Pdf),
            "Sheut-document.pdf"
        );
    }
}
