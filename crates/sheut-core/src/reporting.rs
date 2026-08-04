use serde::{Deserialize, Serialize};

use super::{
    DomainError, DomainErrorCode, ImageMediaType, LocalId, MAX_EVIDENCE_FILE_BYTES,
    MAX_IMAGE_ATTACHMENT_BYTES, Revision, bounded_text, is_supported_evidence_media_type,
};

const CONTRACT_SCHEMA_VERSION: u16 = 1;
const MAX_FIELD_TEXT_CHARS: usize = 100_000;
const MAX_INCLUDED_ITEMS: usize = 256;
const MAX_BRAND_TEXT_CHARS: usize = 500;
const MAX_EVIDENCE_FILE_NAME_CHARS: usize = 255;
const MAX_EVIDENCE_TITLE_CHARS: usize = 200;
const MAX_EVIDENCE_SOURCE_CHARS: usize = 500;
const MAX_EVIDENCE_URL_CHARS: usize = 4_096;
const MAX_EVIDENCE_TAGS: usize = 32;
const MAX_EVIDENCE_TAG_CHARS: usize = 64;
const MAX_OUTPUT_FILE_NAME_CHARS: usize = 255;
const MAX_OUTPUT_LOCATION_CHARS: usize = 4_096;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectDataReferenceKind {
    Intelligence,
    Evidence,
    Document,
    CatalogReference,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceFileMetadata {
    id: LocalId,
    revision: Revision,
    media_type: String,
    file_name: String,
    byte_len: u64,
    sha256: String,
    title: String,
    description: String,
    source: String,
    captured_at: Option<String>,
    source_url: String,
    tags: Vec<String>,
    analyst_notes: String,
    created_at_unix_ms: i64,
    updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvidenceMetadataInput {
    title: String,
    description: String,
    source: String,
    captured_at: Option<String>,
    source_url: String,
    tags: Vec<String>,
    analyst_notes: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EvidenceFileMetadataWire {
    id: LocalId,
    revision: Revision,
    media_type: String,
    file_name: String,
    byte_len: u64,
    sha256: String,
    title: String,
    description: String,
    source: String,
    captured_at: Option<String>,
    source_url: String,
    tags: Vec<String>,
    analyst_notes: String,
    created_at_unix_ms: i64,
    updated_at_unix_ms: i64,
}

impl<'de> Deserialize<'de> for EvidenceFileMetadata {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = EvidenceFileMetadataWire::deserialize(deserializer)?;
        Self::from_parts(
            wire.id,
            wire.revision,
            wire.media_type,
            wire.file_name,
            wire.byte_len,
            wire.sha256,
            EvidenceMetadataInput {
                title: wire.title,
                description: wire.description,
                source: wire.source,
                captured_at: wire.captured_at,
                source_url: wire.source_url,
                tags: wire.tags,
                analyst_notes: wire.analyst_notes,
            },
            wire.created_at_unix_ms,
            wire.updated_at_unix_ms,
        )
        .map_err(serde::de::Error::custom)
    }
}

impl EvidenceFileMetadata {
    pub fn new(
        id: LocalId,
        media_type: impl AsRef<str>,
        file_name: impl AsRef<str>,
        byte_len: u64,
        sha256: impl AsRef<str>,
        created_at_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        let title = file_name.as_ref().to_owned();
        Self::from_parts(
            id,
            Revision::new(1)?,
            media_type,
            file_name,
            byte_len,
            sha256,
            EvidenceMetadataInput {
                title,
                description: String::new(),
                source: String::new(),
                captured_at: None,
                source_url: String::new(),
                tags: Vec::new(),
                analyst_notes: String::new(),
            },
            created_at_unix_ms,
            created_at_unix_ms,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn from_parts(
        id: LocalId,
        revision: Revision,
        media_type: impl AsRef<str>,
        file_name: impl AsRef<str>,
        byte_len: u64,
        sha256: impl AsRef<str>,
        metadata: EvidenceMetadataInput,
        created_at_unix_ms: i64,
        updated_at_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        let media_type = media_type.as_ref();
        let file_name = bounded_text(
            file_name.as_ref(),
            MAX_EVIDENCE_FILE_NAME_CHARS,
            DomainErrorCode::InvalidAttachment,
        )?;
        let sha256 = sha256.as_ref();
        if file_name == "."
            || file_name == ".."
            || file_name
                .chars()
                .any(|character| matches!(character, '/' | '\\'))
            || !is_supported_evidence_media_type(media_type)
            || !(1..=MAX_EVIDENCE_FILE_BYTES).contains(&byte_len)
            || sha256.len() != 64
            || !sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
            || created_at_unix_ms < 0
            || updated_at_unix_ms < created_at_unix_ms
        {
            return Err(DomainError::new(DomainErrorCode::InvalidAttachment));
        }
        let metadata = metadata.normalized()?;
        Ok(Self {
            id,
            revision,
            media_type: media_type.to_owned(),
            file_name,
            byte_len,
            sha256: sha256.to_ascii_lowercase(),
            title: metadata.title,
            description: metadata.description,
            source: metadata.source,
            captured_at: metadata.captured_at,
            source_url: metadata.source_url,
            tags: metadata.tags,
            analyst_notes: metadata.analyst_notes,
            created_at_unix_ms,
            updated_at_unix_ms,
        })
    }

    pub fn updated(
        &self,
        expected_revision: Revision,
        metadata: EvidenceMetadataInput,
        now_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        if self.revision != expected_revision || now_unix_ms < self.updated_at_unix_ms {
            return Err(DomainError::new(DomainErrorCode::InvalidRevision));
        }
        Self::from_parts(
            self.id,
            expected_revision.next()?,
            &self.media_type,
            &self.file_name,
            self.byte_len,
            &self.sha256,
            metadata,
            self.created_at_unix_ms,
            now_unix_ms,
        )
    }

    #[must_use]
    pub const fn id(&self) -> LocalId {
        self.id
    }

    #[must_use]
    pub const fn revision(&self) -> Revision {
        self.revision
    }

    #[must_use]
    pub fn media_type(&self) -> &str {
        &self.media_type
    }

    #[must_use]
    pub fn file_name(&self) -> &str {
        &self.file_name
    }

    #[must_use]
    pub const fn byte_len(&self) -> u64 {
        self.byte_len
    }

    #[must_use]
    pub fn sha256(&self) -> &str {
        &self.sha256
    }

    #[must_use]
    pub fn title(&self) -> &str {
        &self.title
    }

    #[must_use]
    pub fn description(&self) -> &str {
        &self.description
    }

    #[must_use]
    pub fn source(&self) -> &str {
        &self.source
    }

    #[must_use]
    pub fn captured_at(&self) -> Option<&str> {
        self.captured_at.as_deref()
    }

    #[must_use]
    pub fn source_url(&self) -> &str {
        &self.source_url
    }

    #[must_use]
    pub fn tags(&self) -> &[String] {
        &self.tags
    }

    #[must_use]
    pub fn analyst_notes(&self) -> &str {
        &self.analyst_notes
    }

    #[must_use]
    pub const fn created_at_unix_ms(&self) -> i64 {
        self.created_at_unix_ms
    }

    #[must_use]
    pub const fn updated_at_unix_ms(&self) -> i64 {
        self.updated_at_unix_ms
    }
}

impl EvidenceMetadataInput {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        title: impl Into<String>,
        description: impl Into<String>,
        source: impl Into<String>,
        captured_at: Option<String>,
        source_url: impl Into<String>,
        tags: Vec<String>,
        analyst_notes: impl Into<String>,
    ) -> Result<Self, DomainError> {
        Self {
            title: title.into(),
            description: description.into(),
            source: source.into(),
            captured_at,
            source_url: source_url.into(),
            tags,
            analyst_notes: analyst_notes.into(),
        }
        .normalized()
    }

    fn normalized(self) -> Result<Self, DomainError> {
        let code = DomainErrorCode::InvalidAttachment;
        let title = bounded_text(&self.title, MAX_EVIDENCE_TITLE_CHARS, code)?;
        let description = optional_bounded_text(&self.description, MAX_FIELD_TEXT_CHARS, code)?;
        let source = optional_bounded_text(&self.source, MAX_EVIDENCE_SOURCE_CHARS, code)?;
        let source_url = optional_bounded_text(&self.source_url, MAX_EVIDENCE_URL_CHARS, code)?;
        if !source_url.is_empty()
            && !source_url.starts_with("https://")
            && !source_url.starts_with("http://")
        {
            return Err(DomainError::new(code));
        }
        let captured_at = self
            .captured_at
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        if captured_at
            .as_deref()
            .is_some_and(|value| !is_calendar_date(value))
        {
            return Err(DomainError::new(code));
        }
        if self.tags.len() > MAX_EVIDENCE_TAGS {
            return Err(DomainError::new(code));
        }
        let mut tags = Vec::with_capacity(self.tags.len());
        for tag in self.tags {
            let tag = bounded_text(&tag, MAX_EVIDENCE_TAG_CHARS, code)?.to_lowercase();
            if !tags.contains(&tag) {
                tags.push(tag);
            }
        }
        let analyst_notes = optional_bounded_text(&self.analyst_notes, MAX_FIELD_TEXT_CHARS, code)?;
        Ok(Self {
            title,
            description,
            source,
            captured_at,
            source_url,
            tags,
            analyst_notes,
        })
    }
}

fn optional_bounded_text(
    value: &str,
    max_chars: usize,
    code: DomainErrorCode,
) -> Result<String, DomainError> {
    let value = value.trim();
    if value.chars().count() > max_chars
        || value
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        return Err(DomainError::new(code));
    }
    Ok(value.to_owned())
}

fn is_calendar_date(value: &str) -> bool {
    let mut parts = value.split('-');
    let (Some(year), Some(month), Some(day), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    if year.len() != 4
        || month.len() != 2
        || day.len() != 2
        || !year.bytes().all(|byte| byte.is_ascii_digit())
        || !month.bytes().all(|byte| byte.is_ascii_digit())
        || !day.bytes().all(|byte| byte.is_ascii_digit())
    {
        return false;
    }
    let (Ok(year), Ok(month), Ok(day)) = (
        year.parse::<u32>(),
        month.parse::<u32>(),
        day.parse::<u32>(),
    ) else {
        return false;
    };
    if year == 0 || !(1..=12).contains(&month) {
        return false;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let maximum = match month {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    (1..=maximum).contains(&day)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectDataReference {
    kind: ProjectDataReferenceKind,
    id: LocalId,
    label: String,
}

impl ProjectDataReference {
    #[must_use]
    pub const fn kind(&self) -> ProjectDataReferenceKind {
        self.kind
    }

    #[must_use]
    pub const fn id(&self) -> LocalId {
        self.id
    }

    #[must_use]
    pub fn label(&self) -> &str {
        &self.label
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaperSize {
    A4,
    Letter,
}

impl PaperSize {
    #[must_use]
    pub const fn portrait_points(self) -> (f32, f32) {
        match self {
            Self::A4 => (595.2756, 841.8898),
            Self::Letter => (612.0, 792.0),
        }
    }

    #[must_use]
    pub const fn typst_name(self) -> &'static str {
        match self {
            Self::A4 => "a4",
            Self::Letter => "us-letter",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PageOrientation {
    Portrait,
    Landscape,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PublicationFormat {
    Pdf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TlpMarking {
    Clear,
    Green,
    Amber,
    AmberStrict,
    Red,
}

impl TlpMarking {
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Clear => "TLP:CLEAR",
            Self::Green => "TLP:GREEN",
            Self::Amber => "TLP:AMBER",
            Self::AmberStrict => "TLP:AMBER+STRICT",
            Self::Red => "TLP:RED",
        }
    }

    #[must_use]
    pub const fn distribution_statement(self) -> &'static str {
        match self {
            Self::Clear => "Recipients may share this information without restriction.",
            Self::Green => {
                "Recipients may share this information within their community, but not publicly."
            }
            Self::Amber => {
                "Recipients may share this information only on a need-to-know basis within their organization and with clients."
            }
            Self::AmberStrict => {
                "Recipients may share this information only within their organization on a need-to-know basis."
            }
            Self::Red => {
                "Recipients may not share this information beyond the specific people receiving it."
            }
        }
    }

    /// FIRST TLP 2.0 foreground color. TLP labels use a black background.
    #[must_use]
    pub const fn foreground_hex(self) -> &'static str {
        match self {
            Self::Red => "#FF2B2B",
            Self::Amber | Self::AmberStrict => "#FFC000",
            Self::Green => "#33FF00",
            Self::Clear => "#FFFFFF",
        }
    }

    /// FIRST TLP 2.0 background color for every label.
    #[must_use]
    pub const fn background_hex(self) -> &'static str {
        "#000000"
    }
}

impl PublicationFormat {
    #[must_use]
    pub const fn extension(self) -> &'static str {
        match self {
            Self::Pdf => "pdf",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BrandTypeface {
    Geist,
    GeistMono,
    SourceSerif4,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OrganizationIdentity {
    name: String,
    contact: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct BrandAssets {
    logo_id: Option<LocalId>,
    compact_mark_id: Option<LocalId>,
    cover_artwork_id: Option<LocalId>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BrandAssetRole {
    Logo,
    CompactMark,
    CoverArtwork,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BrandAssetMetadata {
    id: LocalId,
    profile_id: LocalId,
    role: BrandAssetRole,
    media_type: ImageMediaType,
    file_name: String,
    byte_len: u64,
}

impl BrandAssetMetadata {
    pub fn new(
        id: LocalId,
        profile_id: LocalId,
        role: BrandAssetRole,
        media_type: ImageMediaType,
        file_name: impl AsRef<str>,
        byte_len: u64,
    ) -> Result<Self, DomainError> {
        if byte_len == 0 || byte_len > MAX_IMAGE_ATTACHMENT_BYTES {
            return Err(DomainError::new(DomainErrorCode::InvalidBrandProfile));
        }
        Ok(Self {
            id,
            profile_id,
            role,
            media_type,
            file_name: bounded_text(
                file_name.as_ref(),
                255,
                DomainErrorCode::InvalidBrandProfile,
            )?,
            byte_len,
        })
    }

    #[must_use]
    pub const fn id(&self) -> LocalId {
        self.id
    }

    #[must_use]
    pub const fn profile_id(&self) -> LocalId {
        self.profile_id
    }

    #[must_use]
    pub const fn role(&self) -> BrandAssetRole {
        self.role
    }

    #[must_use]
    pub const fn media_type(&self) -> ImageMediaType {
        self.media_type
    }

    #[must_use]
    pub fn file_name(&self) -> &str {
        &self.file_name
    }

    #[must_use]
    pub const fn byte_len(&self) -> u64 {
        self.byte_len
    }
}

impl BrandAssets {
    fn with_asset(mut self, role: BrandAssetRole, asset_id: LocalId) -> Self {
        match role {
            BrandAssetRole::Logo => self.logo_id = Some(asset_id),
            BrandAssetRole::CompactMark => self.compact_mark_id = Some(asset_id),
            BrandAssetRole::CoverArtwork => self.cover_artwork_id = Some(asset_id),
        }
        self
    }

    const fn asset_id(&self, role: BrandAssetRole) -> Option<LocalId> {
        match role {
            BrandAssetRole::Logo => self.logo_id,
            BrandAssetRole::CompactMark => self.compact_mark_id,
            BrandAssetRole::CoverArtwork => self.cover_artwork_id,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BrandColors {
    primary: String,
    secondary: String,
    accent: String,
    text: String,
    background: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BrandTypography {
    heading: BrandTypeface,
    body: BrandTypeface,
    mono: BrandTypeface,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoverTreatment {
    Minimal,
    Editorial,
    Artwork,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContentDensity {
    Compact,
    Comfortable,
    Spacious,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TableTreatment {
    Grid,
    Banded,
    Minimal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SectionTreatment {
    Rule,
    Band,
    Plain,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PageFurniture {
    header: bool,
    footer: bool,
    marking: bool,
    page_numbers: bool,
}

impl Default for PageFurniture {
    fn default() -> Self {
        Self {
            header: true,
            footer: true,
            marking: true,
            page_numbers: true,
        }
    }
}

impl PageFurniture {
    #[must_use]
    pub const fn header(self) -> bool {
        self.header
    }

    #[must_use]
    pub const fn footer(self) -> bool {
        self.footer
    }

    #[must_use]
    pub const fn marking(self) -> bool {
        self.marking
    }

    #[must_use]
    pub const fn page_numbers(self) -> bool {
        self.page_numbers
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrandProfileInput {
    pub name: String,
    pub organization_name: String,
    pub contact: Option<String>,
    pub primary_color: String,
    pub secondary_color: String,
    pub accent_color: String,
    pub text_color: String,
    pub background_color: String,
    pub heading_typeface: BrandTypeface,
    pub body_typeface: BrandTypeface,
    pub mono_typeface: BrandTypeface,
    pub default_paper_size: PaperSize,
    pub default_orientation: PageOrientation,
    pub cover_treatment: CoverTreatment,
    pub density: ContentDensity,
    pub table_treatment: TableTreatment,
    pub section_treatment: SectionTreatment,
    pub page_furniture: PageFurniture,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BrandProfile {
    schema_version: u16,
    id: LocalId,
    revision: Revision,
    name: String,
    organization: OrganizationIdentity,
    assets: BrandAssets,
    colors: BrandColors,
    typography: BrandTypography,
    default_paper_size: PaperSize,
    default_orientation: PageOrientation,
    cover_treatment: CoverTreatment,
    density: ContentDensity,
    table_treatment: TableTreatment,
    section_treatment: SectionTreatment,
    page_furniture: PageFurniture,
    created_at_unix_ms: i64,
    updated_at_unix_ms: i64,
}

#[derive(Deserialize)]
struct BrandProfileWire {
    schema_version: u16,
    id: LocalId,
    revision: Revision,
    name: String,
    organization: OrganizationIdentity,
    assets: BrandAssets,
    colors: BrandColors,
    typography: BrandTypography,
    default_paper_size: PaperSize,
    default_orientation: PageOrientation,
    cover_treatment: CoverTreatment,
    density: ContentDensity,
    table_treatment: TableTreatment,
    section_treatment: SectionTreatment,
    page_furniture: PageFurniture,
    created_at_unix_ms: i64,
    updated_at_unix_ms: i64,
}

impl<'de> Deserialize<'de> for BrandProfile {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = BrandProfileWire::deserialize(deserializer)?;
        Self::restore(wire).map_err(serde::de::Error::custom)
    }
}

impl BrandProfile {
    pub fn new(
        id: LocalId,
        input: BrandProfileInput,
        now_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        Self::from_input(
            id,
            Revision::new(1)?,
            input,
            BrandAssets::default(),
            now_unix_ms,
            now_unix_ms,
        )
    }

    pub fn project_default(
        id: LocalId,
        organization_name: impl AsRef<str>,
        now_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        let organization_name = organization_name.as_ref().to_owned();
        Self::restore(BrandProfileWire {
            schema_version: CONTRACT_SCHEMA_VERSION,
            id,
            revision: Revision::new(1)?,
            name: format!("{organization_name} Default"),
            organization: OrganizationIdentity {
                name: organization_name,
                contact: None,
            },
            assets: BrandAssets::default(),
            colors: BrandColors {
                primary: "#133C55".to_owned(),
                secondary: "#386FA4".to_owned(),
                accent: "#59A5D8".to_owned(),
                text: "#111827".to_owned(),
                background: "#FFFFFF".to_owned(),
            },
            typography: BrandTypography {
                heading: BrandTypeface::Geist,
                body: BrandTypeface::Geist,
                mono: BrandTypeface::GeistMono,
            },
            default_paper_size: PaperSize::A4,
            default_orientation: PageOrientation::Portrait,
            cover_treatment: CoverTreatment::Minimal,
            density: ContentDensity::Comfortable,
            table_treatment: TableTreatment::Grid,
            section_treatment: SectionTreatment::Rule,
            page_furniture: PageFurniture::default(),
            created_at_unix_ms: now_unix_ms,
            updated_at_unix_ms: now_unix_ms,
        })
    }

    pub fn revise(
        &self,
        expected_revision: Revision,
        input: BrandProfileInput,
        now_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        if self.revision != expected_revision || now_unix_ms < self.updated_at_unix_ms {
            return Err(DomainError::new(DomainErrorCode::InvalidBrandProfile));
        }
        Self::from_input(
            self.id,
            expected_revision.next()?,
            input,
            self.assets.clone(),
            self.created_at_unix_ms,
            now_unix_ms,
        )
    }

    pub fn with_asset(
        &self,
        expected_revision: Revision,
        role: BrandAssetRole,
        asset_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        if self.revision != expected_revision || now_unix_ms < self.updated_at_unix_ms {
            return Err(DomainError::new(DomainErrorCode::InvalidBrandProfile));
        }
        let mut revised = self.clone();
        revised.revision = expected_revision.next()?;
        revised.updated_at_unix_ms = now_unix_ms;
        revised.assets = revised.assets.with_asset(role, asset_id);
        Ok(revised)
    }

    fn from_input(
        id: LocalId,
        revision: Revision,
        input: BrandProfileInput,
        assets: BrandAssets,
        created_at_unix_ms: i64,
        updated_at_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        Self::restore(BrandProfileWire {
            schema_version: CONTRACT_SCHEMA_VERSION,
            id,
            revision,
            name: input.name,
            organization: OrganizationIdentity {
                name: input.organization_name,
                contact: input.contact,
            },
            assets,
            colors: BrandColors {
                primary: input.primary_color,
                secondary: input.secondary_color,
                accent: input.accent_color,
                text: input.text_color,
                background: input.background_color,
            },
            typography: BrandTypography {
                heading: input.heading_typeface,
                body: input.body_typeface,
                mono: input.mono_typeface,
            },
            default_paper_size: input.default_paper_size,
            default_orientation: input.default_orientation,
            cover_treatment: input.cover_treatment,
            density: input.density,
            table_treatment: input.table_treatment,
            section_treatment: input.section_treatment,
            page_furniture: input.page_furniture,
            created_at_unix_ms,
            updated_at_unix_ms,
        })
    }

    fn restore(wire: BrandProfileWire) -> Result<Self, DomainError> {
        let code = DomainErrorCode::InvalidBrandProfile;
        if wire.schema_version != CONTRACT_SCHEMA_VERSION
            || wire.created_at_unix_ms < 0
            || wire.updated_at_unix_ms < wire.created_at_unix_ms
        {
            return Err(DomainError::new(code));
        }
        let name = bounded_text(&wire.name, 120, code)?;
        let organization_name = bounded_text(&wire.organization.name, 200, code)?;
        let contact = wire
            .organization
            .contact
            .as_deref()
            .map(|contact| bounded_text(contact, MAX_BRAND_TEXT_CHARS, code))
            .transpose()?;
        validate_colors(&wire.colors)?;
        Ok(Self {
            schema_version: wire.schema_version,
            id: wire.id,
            revision: wire.revision,
            name,
            organization: OrganizationIdentity {
                name: organization_name,
                contact,
            },
            assets: wire.assets,
            colors: wire.colors,
            typography: wire.typography,
            default_paper_size: wire.default_paper_size,
            default_orientation: wire.default_orientation,
            cover_treatment: wire.cover_treatment,
            density: wire.density,
            table_treatment: wire.table_treatment,
            section_treatment: wire.section_treatment,
            page_furniture: wire.page_furniture,
            created_at_unix_ms: wire.created_at_unix_ms,
            updated_at_unix_ms: wire.updated_at_unix_ms,
        })
    }

    #[must_use]
    pub const fn id(&self) -> LocalId {
        self.id
    }

    #[must_use]
    pub const fn revision(&self) -> Revision {
        self.revision
    }

    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    #[must_use]
    pub const fn asset_id(&self, role: BrandAssetRole) -> Option<LocalId> {
        self.assets.asset_id(role)
    }

    #[must_use]
    pub const fn default_paper_size(&self) -> PaperSize {
        self.default_paper_size
    }

    #[must_use]
    pub const fn default_orientation(&self) -> PageOrientation {
        self.default_orientation
    }

    #[must_use]
    pub const fn page_furniture(&self) -> PageFurniture {
        self.page_furniture
    }

    #[must_use]
    pub const fn cover_treatment(&self) -> CoverTreatment {
        self.cover_treatment
    }

    #[must_use]
    pub const fn heading_typeface(&self) -> BrandTypeface {
        self.typography.heading
    }

    #[must_use]
    pub const fn body_typeface(&self) -> BrandTypeface {
        self.typography.body
    }

    #[must_use]
    pub const fn mono_typeface(&self) -> BrandTypeface {
        self.typography.mono
    }

    #[must_use]
    pub fn organization_name(&self) -> &str {
        &self.organization.name
    }

    #[must_use]
    pub fn primary_color(&self) -> &str {
        &self.colors.primary
    }

    #[must_use]
    pub fn secondary_color(&self) -> &str {
        &self.colors.secondary
    }

    #[must_use]
    pub fn accent_color(&self) -> &str {
        &self.colors.accent
    }

    #[must_use]
    pub fn text_color(&self) -> &str {
        &self.colors.text
    }

    #[must_use]
    pub fn background_color(&self) -> &str {
        &self.colors.background
    }

    #[must_use]
    pub const fn updated_at_unix_ms(&self) -> i64 {
        self.updated_at_unix_ms
    }
}

fn validate_colors(colors: &BrandColors) -> Result<(), DomainError> {
    let code = DomainErrorCode::InvalidBrandProfile;
    for color in [
        &colors.primary,
        &colors.secondary,
        &colors.accent,
        &colors.text,
        &colors.background,
    ] {
        parse_hex_color(color).ok_or_else(|| DomainError::new(code))?;
    }
    if contrast_ratio(&colors.text, &colors.background).is_none_or(|ratio| ratio < 4.5) {
        return Err(DomainError::new(code));
    }
    Ok(())
}

fn parse_hex_color(value: &str) -> Option<[u8; 3]> {
    let value = value.strip_prefix('#')?;
    if value.len() != 6 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    Some([
        u8::from_str_radix(&value[0..2], 16).ok()?,
        u8::from_str_radix(&value[2..4], 16).ok()?,
        u8::from_str_radix(&value[4..6], 16).ok()?,
    ])
}

fn contrast_ratio(foreground: &str, background: &str) -> Option<f64> {
    let foreground = relative_luminance(parse_hex_color(foreground)?);
    let background = relative_luminance(parse_hex_color(background)?);
    let (lighter, darker) = if foreground > background {
        (foreground, background)
    } else {
        (background, foreground)
    };
    Some((lighter + 0.05) / (darker + 0.05))
}

fn relative_luminance(color: [u8; 3]) -> f64 {
    let channel = |value: u8| {
        let value = f64::from(value) / 255.0;
        if value <= 0.04045 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2])
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct BrandProfileRevisionReference {
    pub profile_id: LocalId,
    pub revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PublicationSource {
    FreeformDocument {
        document_id: LocalId,
        revision: Revision,
    },
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PublicationStatus {
    #[default]
    Draft,
    Final,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicationReleaseEntry {
    version: String,
    change_note: String,
    published_at_unix_ms: i64,
}

impl PublicationReleaseEntry {
    pub fn new(
        version: impl AsRef<str>,
        change_note: impl AsRef<str>,
        published_at_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        if published_at_unix_ms < 0 {
            return Err(DomainError::new(DomainErrorCode::InvalidPublication));
        }
        Ok(Self {
            version: normalize_release_version(version.as_ref())?,
            change_note: bounded_text(
                change_note.as_ref(),
                2_000,
                DomainErrorCode::InvalidPublication,
            )?,
            published_at_unix_ms,
        })
    }

    #[must_use]
    pub fn version(&self) -> &str {
        &self.version
    }

    #[must_use]
    pub fn change_note(&self) -> &str {
        &self.change_note
    }

    #[must_use]
    pub const fn published_at_unix_ms(&self) -> i64 {
        self.published_at_unix_ms
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicationSettings {
    format: PublicationFormat,
    paper_size: PaperSize,
    orientation: PageOrientation,
    brand_profile_revision: Option<BrandProfileRevisionReference>,
    page_furniture: PageFurniture,
    tlp_marking: Option<TlpMarking>,
    included_sections: Vec<String>,
    appendices: Vec<String>,
    output_file_name: String,
    output_location: Option<String>,
    release_version: String,
    publication_status: PublicationStatus,
    include_release_history: bool,
    release_history: Vec<PublicationReleaseEntry>,
}

impl PublicationSettings {
    #[must_use]
    pub fn from_brand(profile: &BrandProfile, format: PublicationFormat) -> Self {
        Self {
            format,
            paper_size: profile.default_paper_size,
            orientation: profile.default_orientation,
            brand_profile_revision: Some(BrandProfileRevisionReference {
                profile_id: profile.id,
                revision: profile.revision.get(),
            }),
            page_furniture: profile.page_furniture,
            tlp_marking: None,
            included_sections: Vec::new(),
            appendices: Vec::new(),
            output_file_name: format!("Sheut-document.{}", format.extension()),
            output_location: None,
            release_version: default_release_version(),
            publication_status: PublicationStatus::Draft,
            include_release_history: false,
            release_history: Vec::new(),
        }
    }

    #[must_use]
    pub fn from_brand_and_project(
        profile: &BrandProfile,
        project: &crate::ProjectMetadata,
        format: PublicationFormat,
    ) -> Self {
        Self::from_brand(profile, format).with_tlp_marking(Some(project.default_tlp_marking()))
    }

    #[must_use]
    pub const fn with_paper_size(mut self, paper_size: PaperSize) -> Self {
        self.paper_size = paper_size;
        self
    }

    #[must_use]
    pub const fn with_orientation(mut self, orientation: PageOrientation) -> Self {
        self.orientation = orientation;
        self
    }

    #[must_use]
    pub const fn with_tlp_marking(mut self, tlp_marking: Option<TlpMarking>) -> Self {
        self.tlp_marking = tlp_marking;
        self
    }

    #[must_use]
    pub const fn with_page_furniture(mut self, page_furniture: PageFurniture) -> Self {
        self.page_furniture = page_furniture;
        self
    }

    #[must_use]
    pub const fn tlp_marking(&self) -> Option<TlpMarking> {
        self.tlp_marking
    }

    pub fn with_output_file_name(
        mut self,
        file_name: impl AsRef<str>,
    ) -> Result<Self, DomainError> {
        self.output_file_name = validate_output_file_name(file_name.as_ref(), self.format)?;
        Ok(self)
    }

    pub fn with_output_location(mut self, location: impl AsRef<str>) -> Result<Self, DomainError> {
        self.output_location = Some(bounded_text(
            location.as_ref(),
            MAX_OUTPUT_LOCATION_CHARS,
            DomainErrorCode::InvalidPublication,
        )?);
        Ok(self)
    }

    #[must_use]
    pub fn with_included_sections(mut self, sections: Vec<String>) -> Self {
        self.included_sections = sections;
        self
    }

    #[must_use]
    pub fn with_appendices(mut self, appendices: Vec<String>) -> Self {
        self.appendices = appendices;
        self
    }

    pub fn with_release(
        mut self,
        version: impl AsRef<str>,
        status: PublicationStatus,
        include_release_history: bool,
        release_history: Vec<PublicationReleaseEntry>,
    ) -> Result<Self, DomainError> {
        self.release_version = normalize_release_version(version.as_ref())?;
        self.publication_status = status;
        self.include_release_history = include_release_history;
        self.release_history = release_history;
        Ok(self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicationSnapshot {
    schema_version: u16,
    id: LocalId,
    source: PublicationSource,
    format: PublicationFormat,
    paper_size: PaperSize,
    orientation: PageOrientation,
    brand_profile_revision: Option<BrandProfileRevisionReference>,
    page_furniture: PageFurniture,
    tlp_marking: Option<TlpMarking>,
    included_sections: Vec<String>,
    appendices: Vec<String>,
    output_file_name: String,
    output_location: Option<String>,
    #[serde(default = "default_release_version")]
    release_version: String,
    #[serde(default)]
    publication_status: PublicationStatus,
    #[serde(default)]
    include_release_history: bool,
    #[serde(default)]
    release_history: Vec<PublicationReleaseEntry>,
    created_at_unix_ms: i64,
}

impl PublicationSnapshot {
    pub fn new(
        id: LocalId,
        source: PublicationSource,
        settings: PublicationSettings,
        created_at_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        if created_at_unix_ms < 0
            || settings.included_sections.len() > MAX_INCLUDED_ITEMS
            || settings.appendices.len() > MAX_INCLUDED_ITEMS
            || settings.release_history.len() > 128
        {
            return Err(DomainError::new(DomainErrorCode::InvalidPublication));
        }
        let output_file_name =
            validate_output_file_name(&settings.output_file_name, settings.format)?;
        for key in &settings.included_sections {
            validate_key(key, DomainErrorCode::InvalidPublication)?;
        }
        for appendix in &settings.appendices {
            bounded_text(appendix, 200, DomainErrorCode::InvalidPublication)?;
        }
        let release_version = normalize_release_version(&settings.release_version)?;
        validate_release_history(
            &release_version,
            settings.include_release_history,
            &settings.release_history,
        )?;
        Ok(Self {
            schema_version: CONTRACT_SCHEMA_VERSION,
            id,
            source,
            format: settings.format,
            paper_size: settings.paper_size,
            orientation: settings.orientation,
            brand_profile_revision: settings.brand_profile_revision,
            page_furniture: settings.page_furniture,
            tlp_marking: settings.tlp_marking,
            included_sections: settings.included_sections,
            appendices: settings.appendices,
            output_file_name,
            output_location: settings.output_location,
            release_version,
            publication_status: settings.publication_status,
            include_release_history: settings.include_release_history,
            release_history: settings.release_history,
            created_at_unix_ms,
        })
    }

    #[must_use]
    pub const fn id(&self) -> LocalId {
        self.id
    }

    #[must_use]
    pub const fn source(&self) -> &PublicationSource {
        &self.source
    }

    #[must_use]
    pub const fn format(&self) -> PublicationFormat {
        self.format
    }

    #[must_use]
    pub const fn paper_size(&self) -> PaperSize {
        self.paper_size
    }

    #[must_use]
    pub const fn orientation(&self) -> PageOrientation {
        self.orientation
    }

    #[must_use]
    pub const fn brand_profile_revision(&self) -> Option<BrandProfileRevisionReference> {
        self.brand_profile_revision
    }

    #[must_use]
    pub const fn page_furniture(&self) -> PageFurniture {
        self.page_furniture
    }

    #[must_use]
    pub const fn tlp_marking(&self) -> Option<TlpMarking> {
        self.tlp_marking
    }

    #[must_use]
    pub fn included_sections(&self) -> &[String] {
        &self.included_sections
    }

    #[must_use]
    pub fn appendices(&self) -> &[String] {
        &self.appendices
    }

    #[must_use]
    pub fn output_file_name(&self) -> &str {
        &self.output_file_name
    }

    #[must_use]
    pub fn release_version(&self) -> &str {
        &self.release_version
    }

    #[must_use]
    pub const fn publication_status(&self) -> PublicationStatus {
        self.publication_status
    }

    #[must_use]
    pub const fn include_release_history(&self) -> bool {
        self.include_release_history
    }

    #[must_use]
    pub fn release_history(&self) -> &[PublicationReleaseEntry] {
        &self.release_history
    }

    #[must_use]
    pub const fn created_at_unix_ms(&self) -> i64 {
        self.created_at_unix_ms
    }
}

fn default_release_version() -> String {
    "1.0".to_owned()
}

fn normalize_release_version(value: &str) -> Result<String, DomainError> {
    let value = value
        .trim()
        .strip_prefix(['v', 'V'])
        .unwrap_or(value.trim());
    let parts = value.split('.').collect::<Vec<_>>();
    if !(2..=3).contains(&parts.len())
        || parts.iter().any(|part| {
            part.is_empty() || part.len() > 5 || !part.bytes().all(|byte| byte.is_ascii_digit())
        })
    {
        return Err(DomainError::new(DomainErrorCode::InvalidPublication));
    }
    let parsed = parts
        .iter()
        .map(|part| part.parse::<u16>())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| DomainError::new(DomainErrorCode::InvalidPublication))?;
    Ok(parsed
        .iter()
        .map(u16::to_string)
        .collect::<Vec<_>>()
        .join("."))
}

fn validate_release_history(
    release_version: &str,
    included: bool,
    history: &[PublicationReleaseEntry],
) -> Result<(), DomainError> {
    let mut previous: Option<Vec<u16>> = None;
    for entry in history {
        let normalized = normalize_release_version(&entry.version)?;
        let current = normalized
            .split('.')
            .map(|part| part.parse::<u16>().unwrap_or_default())
            .collect::<Vec<_>>();
        if previous
            .as_ref()
            .is_some_and(|previous| previous >= &current)
        {
            return Err(DomainError::new(DomainErrorCode::InvalidPublication));
        }
        previous = Some(current);
    }
    if history
        .last()
        .is_some_and(|entry| entry.version != release_version)
        || (included && release_version != "1.0" && history.len() < 2)
    {
        return Err(DomainError::new(DomainErrorCode::InvalidPublication));
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicationRecord {
    schema_version: u16,
    id: LocalId,
    snapshot: PublicationSnapshot,
    byte_len: u64,
    sha256: String,
}

impl PublicationRecord {
    pub fn new(
        id: LocalId,
        snapshot: PublicationSnapshot,
        byte_len: u64,
        sha256: impl AsRef<str>,
    ) -> Result<Self, DomainError> {
        let sha256 = sha256.as_ref();
        if byte_len == 0
            || sha256.len() != 64
            || !sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(DomainError::new(DomainErrorCode::InvalidPublication));
        }
        Ok(Self {
            schema_version: CONTRACT_SCHEMA_VERSION,
            id,
            snapshot,
            byte_len,
            sha256: sha256.to_ascii_lowercase(),
        })
    }

    #[must_use]
    pub const fn id(&self) -> LocalId {
        self.id
    }

    #[must_use]
    pub const fn snapshot(&self) -> &PublicationSnapshot {
        &self.snapshot
    }

    #[must_use]
    pub const fn byte_len(&self) -> u64 {
        self.byte_len
    }

    #[must_use]
    pub fn sha256(&self) -> &str {
        &self.sha256
    }
}

fn validate_key(value: &str, code: DomainErrorCode) -> Result<(), DomainError> {
    if value.is_empty()
        || value.len() > 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err(DomainError::new(code));
    }
    Ok(())
}

fn validate_output_file_name(
    value: &str,
    format: PublicationFormat,
) -> Result<String, DomainError> {
    let code = DomainErrorCode::InvalidPublication;
    let value = bounded_text(value, MAX_OUTPUT_FILE_NAME_CHARS, code)?;
    let expected_extension = format!(".{}", format.extension());
    if value == "."
        || value == ".."
        || value
            .chars()
            .any(|character| matches!(character, '/' | '\\'))
        || !value.to_ascii_lowercase().ends_with(&expected_extension)
    {
        return Err(DomainError::new(code));
    }
    Ok(value)
}
