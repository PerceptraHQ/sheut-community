#![forbid(unsafe_code)]

//! Shared domain contracts and bounded validators for Sheut's trusted Rust boundary.
//! Structured documents remain versioned data; derived HTML is never their source of truth.

use std::{error::Error, fmt, io::Cursor, num::NonZeroU64};

use image::{ImageFormat, ImageReader, Limits};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

mod reporting;

pub use reporting::*;

const MAX_NAME_CHARS: usize = 120;
const MAX_LABEL_CHARS: usize = 120;
const MAX_RELATIONSHIP_TYPE_CHARS: usize = 64;
const MAX_DOCUMENT_BYTES: usize = 1024 * 1024;
const MAX_DOCUMENT_DEPTH: usize = 64;
const MAX_DOCUMENT_NODES: usize = 20_000;
const MAX_LINK_CHARS: usize = 2_048;
const MAX_ATTACHMENT_FILE_NAME_CHARS: usize = 255;
const MAX_ATTACHMENT_TEXT_CHARS: usize = 500;
const MAX_TECHNIQUE_NARRATIVE_CHARS: usize = 4_000;
const GRAPH_WORKSPACE_SCHEMA_VERSION: u8 = 1;
const MAX_GRAPH_COORDINATE: f64 = 1_000_000.0;
const MIN_GRAPH_ZOOM: f64 = 0.1;
const MAX_GRAPH_ZOOM: f64 = 8.0;
pub const MAX_GRAPH_WORKSPACE_ITEMS: usize = 5_000;
pub const MAX_GRAPH_VISUAL_LINKS: usize = 20_000;
pub const MAX_GRAPH_MUTATION_BATCH: usize = 1_000;
pub const MAX_IMAGE_ATTACHMENT_BYTES: u64 = 10 * 1024 * 1024;
pub const MAX_EVIDENCE_FILE_BYTES: u64 = 100 * 1024 * 1024;
const MAX_IMAGE_DIMENSION: u32 = 8_192;
const MAX_IMAGE_PIXELS: u64 = 16_777_216;
const MAX_IMAGE_DECODE_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DomainErrorCode {
    InvalidLocalId,
    InvalidRevision,
    RevisionOverflow,
    InvalidName,
    InvalidDocument,
    InvalidAttachment,
    InvalidPosition,
    InvalidViewport,
    InvalidWorkspace,
    WorkspaceLimitExceeded,
    SelfLink,
    InvalidLinkLabel,
    InvalidRelationshipType,
    InvalidCatalogReference,
    InvalidTechniqueObservation,
    InvalidGuidedReport,
    InvalidReportTemplate,
    InvalidBrandProfile,
    InvalidPublication,
}

impl fmt::Display for DomainErrorCode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let code = serde_json::to_value(self)
            .ok()
            .and_then(|value| value.as_str().map(str::to_owned))
            .unwrap_or_else(|| "domain_error".to_owned());
        formatter.write_str(&code)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DomainError {
    code: DomainErrorCode,
}

impl DomainError {
    #[must_use]
    pub const fn code(self) -> DomainErrorCode {
        self.code
    }

    const fn new(code: DomainErrorCode) -> Self {
        Self { code }
    }
}

impl fmt::Display for DomainError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.code.fmt(formatter)
    }
}

impl Error for DomainError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub struct LocalId(Uuid);

impl LocalId {
    pub fn parse(value: &str) -> Result<Self, DomainError> {
        let uuid = Uuid::parse_str(value)
            .map_err(|_| DomainError::new(DomainErrorCode::InvalidLocalId))?;
        if uuid.hyphenated().to_string() != value {
            return Err(DomainError::new(DomainErrorCode::InvalidLocalId));
        }
        Ok(Self(uuid))
    }

    #[must_use]
    pub const fn from_uuid(uuid: Uuid) -> Self {
        Self(uuid)
    }

    #[must_use]
    pub const fn as_uuid(self) -> Uuid {
        self.0
    }
}

impl fmt::Display for LocalId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.hyphenated().fmt(formatter)
    }
}

impl<'de> Deserialize<'de> for LocalId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::parse(&value).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
pub struct Revision(NonZeroU64);

impl Revision {
    pub fn new(value: u64) -> Result<Self, DomainError> {
        NonZeroU64::new(value)
            .map(Self)
            .ok_or_else(|| DomainError::new(DomainErrorCode::InvalidRevision))
    }

    #[must_use]
    pub const fn get(self) -> u64 {
        self.0.get()
    }

    pub fn next(self) -> Result<Self, DomainError> {
        self.get()
            .checked_add(1)
            .ok_or_else(|| DomainError::new(DomainErrorCode::RevisionOverflow))
            .and_then(Self::new)
    }
}

impl<'de> Deserialize<'de> for Revision {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        Self::new(u64::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProjectMetadata {
    id: LocalId,
    name: String,
    default_tlp_marking: TlpMarking,
    created_at_unix_ms: i64,
}

#[derive(Deserialize)]
struct ProjectMetadataWire {
    id: LocalId,
    name: String,
    default_tlp_marking: Option<TlpMarking>,
    created_at_unix_ms: i64,
}

impl<'de> Deserialize<'de> for ProjectMetadata {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = ProjectMetadataWire::deserialize(deserializer)?;
        Self::new_with_default_tlp(
            wire.id,
            wire.name,
            wire.default_tlp_marking.unwrap_or(TlpMarking::Clear),
            wire.created_at_unix_ms,
        )
        .map_err(serde::de::Error::custom)
    }
}

impl ProjectMetadata {
    pub fn new(
        id: LocalId,
        name: impl AsRef<str>,
        created_at_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        Self::new_with_default_tlp(id, name, TlpMarking::Amber, created_at_unix_ms)
    }

    pub fn new_with_default_tlp(
        id: LocalId,
        name: impl AsRef<str>,
        default_tlp_marking: TlpMarking,
        created_at_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        let name = bounded_text(name.as_ref(), MAX_NAME_CHARS, DomainErrorCode::InvalidName)?;
        if created_at_unix_ms < 0 {
            return Err(DomainError::new(DomainErrorCode::InvalidName));
        }
        Ok(Self {
            id,
            name,
            default_tlp_marking,
            created_at_unix_ms,
        })
    }

    #[must_use]
    pub const fn id(&self) -> LocalId {
        self.id
    }

    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    #[must_use]
    pub const fn default_tlp_marking(&self) -> TlpMarking {
        self.default_tlp_marking
    }

    #[must_use]
    pub const fn with_default_tlp_marking(mut self, marking: TlpMarking) -> Self {
        self.default_tlp_marking = marking;
        self
    }

    #[must_use]
    pub const fn created_at_unix_ms(&self) -> i64 {
        self.created_at_unix_ms
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DocumentKind {
    Investigation,
    AnalystNote,
    Report,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DocumentActivityKind {
    Created,
    Edited,
    Deleted,
    Restored,
    RestoredRevision,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DocumentTextDiffKind {
    Added,
    Removed,
    Unchanged,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentTextDiffSegment {
    kind: DocumentTextDiffKind,
    text: String,
}

impl DocumentTextDiffSegment {
    #[must_use]
    pub fn new(kind: DocumentTextDiffKind, text: String) -> Self {
        Self { kind, text }
    }

    #[must_use]
    pub const fn kind(&self) -> DocumentTextDiffKind {
        self.kind
    }

    #[must_use]
    pub fn text(&self) -> &str {
        &self.text
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRevisionDiff {
    from_revision: Revision,
    to_revision: Revision,
    segments: Vec<DocumentTextDiffSegment>,
    simplified: bool,
}

impl DocumentRevisionDiff {
    #[must_use]
    pub const fn new(
        from_revision: Revision,
        to_revision: Revision,
        segments: Vec<DocumentTextDiffSegment>,
        simplified: bool,
    ) -> Self {
        Self {
            from_revision,
            to_revision,
            segments,
            simplified,
        }
    }

    #[must_use]
    pub const fn from_revision(&self) -> Revision {
        self.from_revision
    }

    #[must_use]
    pub const fn to_revision(&self) -> Revision {
        self.to_revision
    }

    #[must_use]
    pub fn segments(&self) -> &[DocumentTextDiffSegment] {
        &self.segments
    }

    #[must_use]
    pub const fn simplified(&self) -> bool {
        self.simplified
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRevisionSummary {
    revision: Revision,
    saved_at_unix_ms: i64,
}

impl DocumentRevisionSummary {
    #[must_use]
    pub const fn new(revision: Revision, saved_at_unix_ms: i64) -> Self {
        Self {
            revision,
            saved_at_unix_ms,
        }
    }

    #[must_use]
    pub const fn revision(&self) -> Revision {
        self.revision
    }

    #[must_use]
    pub const fn saved_at_unix_ms(&self) -> i64 {
        self.saved_at_unix_ms
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentActivityEntry {
    sequence: u64,
    kind: DocumentActivityKind,
    revision: Revision,
    source_revision: Option<Revision>,
    occurred_at_unix_ms: i64,
}

impl DocumentActivityEntry {
    #[must_use]
    pub const fn new(
        sequence: u64,
        kind: DocumentActivityKind,
        revision: Revision,
        source_revision: Option<Revision>,
        occurred_at_unix_ms: i64,
    ) -> Self {
        Self {
            sequence,
            kind,
            revision,
            source_revision,
            occurred_at_unix_ms,
        }
    }

    #[must_use]
    pub const fn sequence(&self) -> u64 {
        self.sequence
    }

    #[must_use]
    pub const fn kind(&self) -> DocumentActivityKind {
        self.kind
    }

    #[must_use]
    pub const fn revision(&self) -> Revision {
        self.revision
    }

    #[must_use]
    pub const fn source_revision(&self) -> Option<Revision> {
        self.source_revision
    }

    #[must_use]
    pub const fn occurred_at_unix_ms(&self) -> i64 {
        self.occurred_at_unix_ms
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DocumentEnvelope {
    schema_version: u16,
    id: LocalId,
    kind: DocumentKind,
    revision: Revision,
    root: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ImageMediaType {
    #[serde(rename = "image/png")]
    Png,
    #[serde(rename = "image/jpeg")]
    Jpeg,
    #[serde(rename = "image/webp")]
    Webp,
}

impl ImageMediaType {
    pub fn detect(bytes: &[u8]) -> Result<Self, DomainError> {
        if u64::try_from(bytes.len())
            .ok()
            .is_none_or(|length| !(1..=MAX_IMAGE_ATTACHMENT_BYTES).contains(&length))
        {
            return Err(DomainError::new(DomainErrorCode::InvalidAttachment));
        }
        let (media_type, format) = if bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10])
            && bytes.ends_with(&[0, 0, 0, 0, b'I', b'E', b'N', b'D', 0xae, 0x42, 0x60, 0x82])
        {
            (Self::Png, ImageFormat::Png)
        } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) && bytes.ends_with(&[0xff, 0xd9]) {
            (Self::Jpeg, ImageFormat::Jpeg)
        } else if valid_webp_container(bytes) {
            (Self::Webp, ImageFormat::WebP)
        } else {
            return Err(DomainError::new(DomainErrorCode::InvalidAttachment));
        };
        let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
        let mut limits = Limits::default();
        limits.max_image_width = Some(MAX_IMAGE_DIMENSION);
        limits.max_image_height = Some(MAX_IMAGE_DIMENSION);
        limits.max_alloc = Some(MAX_IMAGE_DECODE_BYTES);
        reader.limits(limits);
        let decoded = reader
            .decode()
            .map_err(|_| DomainError::new(DomainErrorCode::InvalidAttachment))?;
        let width = decoded.width();
        let height = decoded.height();
        if width == 0
            || height == 0
            || u64::from(width).saturating_mul(u64::from(height)) > MAX_IMAGE_PIXELS
        {
            return Err(DomainError::new(DomainErrorCode::InvalidAttachment));
        }
        Ok(media_type)
    }

    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::Webp => "image/webp",
        }
    }
}

/// Detects the inert storage media type for a project Evidence file.
///
/// Detection is based on bounded content and, for ZIP-based Office formats,
/// the file extension. Evidence is never executed or automatically unpacked.
pub fn detect_evidence_media_type(
    file_name: &str,
    bytes: &[u8],
) -> Result<&'static str, DomainError> {
    if u64::try_from(bytes.len())
        .ok()
        .is_none_or(|length| !(1..=MAX_EVIDENCE_FILE_BYTES).contains(&length))
    {
        return Err(DomainError::new(DomainErrorCode::InvalidAttachment));
    }
    if let Ok(media_type) = ImageMediaType::detect(bytes) {
        return Ok(media_type.as_str());
    }

    let extension = file_name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .unwrap_or_default();
    if is_zip_container(bytes) {
        return Ok(match extension.as_str() {
            "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            _ => "application/zip",
        });
    }
    if bytes.starts_with(b"%PDF-") {
        return Ok("application/pdf");
    }
    if bytes.starts_with(&[0x1f, 0x8b]) {
        return Ok("application/gzip");
    }
    if bytes.starts_with(&[0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) {
        return Ok("application/x-7z-compressed");
    }
    if bytes.starts_with(b"Rar!\x1a\x07") {
        return Ok("application/vnd.rar");
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        return Ok(if &bytes[8..12] == b"qt  " {
            "video/quicktime"
        } else {
            "video/mp4"
        });
    }
    if bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
        return Ok("video/webm");
    }
    if bytes.starts_with(b"ID3")
        || (bytes.len() >= 2 && bytes[0] == 0xff && bytes[1] & 0xe0 == 0xe0)
    {
        return Ok("audio/mpeg");
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WAVE" {
        return Ok("audio/wav");
    }
    if extension == "json" && serde_json::from_slice::<Value>(bytes).is_ok() {
        return Ok("application/json");
    }
    if !matches!(extension.as_str(), "html" | "htm" | "svg" | "xml")
        && !bytes.contains(&0)
        && std::str::from_utf8(bytes).is_ok()
    {
        return Ok("text/plain");
    }
    Ok("application/octet-stream")
}

#[must_use]
pub fn is_supported_evidence_media_type(media_type: &str) -> bool {
    matches!(
        media_type,
        "image/png"
            | "image/jpeg"
            | "image/webp"
            | "application/pdf"
            | "application/zip"
            | "application/gzip"
            | "application/x-7z-compressed"
            | "application/vnd.rar"
            | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            | "application/vnd.openxmlformats-officedocument.presentationml.presentation"
            | "video/mp4"
            | "video/webm"
            | "video/quicktime"
            | "audio/mpeg"
            | "audio/wav"
            | "application/json"
            | "text/plain"
            | "application/octet-stream"
    )
}

fn is_zip_container(bytes: &[u8]) -> bool {
    bytes.starts_with(b"PK\x03\x04")
        || bytes.starts_with(b"PK\x05\x06")
        || bytes.starts_with(b"PK\x07\x08")
}

fn valid_webp_container(bytes: &[u8]) -> bool {
    if bytes.len() < 12 || !bytes.starts_with(b"RIFF") || &bytes[8..12] != b"WEBP" {
        return false;
    }
    let Some(size_bytes) = bytes.get(4..8).and_then(|value| value.try_into().ok()) else {
        return false;
    };
    let declared_size = u32::from_le_bytes(size_bytes);
    usize::try_from(declared_size)
        .ok()
        .and_then(|size| size.checked_add(8))
        == Some(bytes.len())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageAttachmentMetadata {
    id: LocalId,
    document_id: LocalId,
    media_type: ImageMediaType,
    file_name: String,
    byte_len: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImageAttachmentMetadataWire {
    id: LocalId,
    document_id: LocalId,
    media_type: ImageMediaType,
    file_name: String,
    byte_len: u64,
}

impl<'de> Deserialize<'de> for ImageAttachmentMetadata {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = ImageAttachmentMetadataWire::deserialize(deserializer)?;
        Self::new(
            wire.id,
            wire.document_id,
            wire.media_type,
            wire.file_name,
            wire.byte_len,
        )
        .map_err(serde::de::Error::custom)
    }
}

impl ImageAttachmentMetadata {
    pub fn new(
        id: LocalId,
        document_id: LocalId,
        media_type: ImageMediaType,
        file_name: impl AsRef<str>,
        byte_len: u64,
    ) -> Result<Self, DomainError> {
        let file_name = bounded_text(
            file_name.as_ref(),
            MAX_ATTACHMENT_FILE_NAME_CHARS,
            DomainErrorCode::InvalidAttachment,
        )?;
        if file_name == "."
            || file_name == ".."
            || file_name
                .chars()
                .any(|character| matches!(character, '/' | '\\'))
            || !(1..=MAX_IMAGE_ATTACHMENT_BYTES).contains(&byte_len)
        {
            return Err(DomainError::new(DomainErrorCode::InvalidAttachment));
        }
        Ok(Self {
            id,
            document_id,
            media_type,
            file_name,
            byte_len,
        })
    }

    #[must_use]
    pub const fn id(&self) -> LocalId {
        self.id
    }

    #[must_use]
    pub const fn document_id(&self) -> LocalId {
        self.document_id
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

#[derive(Deserialize)]
struct DocumentEnvelopeWire {
    schema_version: u16,
    id: LocalId,
    kind: DocumentKind,
    revision: Revision,
    root: Value,
}

impl<'de> Deserialize<'de> for DocumentEnvelope {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = DocumentEnvelopeWire::deserialize(deserializer)?;
        if wire.schema_version != 1 {
            return Err(serde::de::Error::custom(DomainError::new(
                DomainErrorCode::InvalidDocument,
            )));
        }
        Self::new(wire.id, wire.kind, wire.revision, wire.root).map_err(serde::de::Error::custom)
    }
}

impl DocumentEnvelope {
    pub fn new(
        id: LocalId,
        kind: DocumentKind,
        revision: Revision,
        root: Value,
    ) -> Result<Self, DomainError> {
        validate_document_root(&root)?;
        Ok(Self {
            schema_version: 1,
            id,
            kind,
            revision,
            root,
        })
    }

    #[must_use]
    pub const fn schema_version(&self) -> u16 {
        self.schema_version
    }

    #[must_use]
    pub const fn id(&self) -> LocalId {
        self.id
    }

    #[must_use]
    pub const fn kind(&self) -> DocumentKind {
        self.kind
    }

    #[must_use]
    pub const fn revision(&self) -> Revision {
        self.revision
    }

    #[must_use]
    pub fn root(&self) -> &Value {
        &self.root
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderedDocument {
    html: String,
    plain_text: String,
}

impl RenderedDocument {
    #[must_use]
    pub fn html(&self) -> &str {
        &self.html
    }

    #[must_use]
    pub fn plain_text(&self) -> &str {
        &self.plain_text
    }
}

#[must_use]
pub fn render_document(document: &DocumentEnvelope) -> RenderedDocument {
    let mut html = String::new();
    render_html_node(document.root(), &mut html);

    let mut plain_text = String::new();
    render_plain_text_node(document.root(), &mut plain_text);
    while plain_text.ends_with('\n') {
        plain_text.pop();
    }

    RenderedDocument { html, plain_text }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum DocumentContent {
    Block,
    Inline,
    ListItem,
    TableCell,
    TableRow,
    Text,
}

fn validate_document_root(root: &Value) -> Result<(), DomainError> {
    let bytes =
        serde_json::to_vec(root).map_err(|_| DomainError::new(DomainErrorCode::InvalidDocument))?;
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(DomainError::new(DomainErrorCode::InvalidDocument));
    }

    let mut nodes_remaining = MAX_DOCUMENT_NODES;
    validate_document_node(root, 0, DocumentContent::Block, true, &mut nodes_remaining)
}

fn validate_document_node(
    value: &Value,
    depth: usize,
    expected: DocumentContent,
    is_root: bool,
    nodes_remaining: &mut usize,
) -> Result<(), DomainError> {
    if depth > MAX_DOCUMENT_DEPTH || *nodes_remaining == 0 {
        return Err(DomainError::new(DomainErrorCode::InvalidDocument));
    }
    *nodes_remaining -= 1;

    let object = value
        .as_object()
        .ok_or_else(|| DomainError::new(DomainErrorCode::InvalidDocument))?;
    let node_type = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| DomainError::new(DomainErrorCode::InvalidDocument))?;

    if is_root {
        if node_type != "doc" {
            return Err(DomainError::new(DomainErrorCode::InvalidDocument));
        }
    } else if node_type == "doc" {
        return Err(DomainError::new(DomainErrorCode::InvalidDocument));
    }

    let child_content = match node_type {
        "doc" if is_root => DocumentContent::Block,
        "paragraph" if expected == DocumentContent::Block => {
            validate_paragraph(object.get("attrs"))?;
            DocumentContent::Inline
        }
        "heading" if expected == DocumentContent::Block => {
            validate_heading(object.get("attrs"))?;
            DocumentContent::Inline
        }
        "blockquote" if expected == DocumentContent::Block => DocumentContent::Block,
        "callout" if expected == DocumentContent::Block => {
            validate_callout(object.get("attrs"))?;
            DocumentContent::Block
        }
        "bulletList" | "taskList" if expected == DocumentContent::Block => {
            DocumentContent::ListItem
        }
        "orderedList" if expected == DocumentContent::Block => {
            validate_ordered_list(object.get("attrs"))?;
            DocumentContent::ListItem
        }
        "listItem" if expected == DocumentContent::ListItem => DocumentContent::Block,
        "taskItem" if expected == DocumentContent::ListItem => {
            validate_task_item(object.get("attrs"))?;
            DocumentContent::Block
        }
        "table" if expected == DocumentContent::Block => DocumentContent::TableRow,
        "tableRow" if expected == DocumentContent::TableRow => DocumentContent::TableCell,
        "tableCell" | "tableHeader" if expected == DocumentContent::TableCell => {
            validate_table_cell(object.get("attrs"))?;
            DocumentContent::Block
        }
        "codeBlock" if expected == DocumentContent::Block => DocumentContent::Text,
        "horizontalRule" if expected == DocumentContent::Block => {
            reject_content(object)?;
            return Ok(());
        }
        "imageAttachment" if expected == DocumentContent::Block => {
            validate_image_reference(object, "attachmentId")?;
            return Ok(());
        }
        "evidenceImage" if expected == DocumentContent::Block => {
            validate_image_reference(object, "evidenceId")?;
            return Ok(());
        }
        "hardBreak" if expected == DocumentContent::Inline => {
            reject_content(object)?;
            return Ok(());
        }
        "text" if matches!(expected, DocumentContent::Inline | DocumentContent::Text) => {
            validate_text_node(object, expected == DocumentContent::Inline)?;
            return Ok(());
        }
        _ => return Err(DomainError::new(DomainErrorCode::InvalidDocument)),
    };

    let Some(content) = object.get("content") else {
        if requires_non_empty_content(node_type) {
            return Err(DomainError::new(DomainErrorCode::InvalidDocument));
        }
        return Ok(());
    };
    let content = content
        .as_array()
        .ok_or_else(|| DomainError::new(DomainErrorCode::InvalidDocument))?;
    if content.is_empty() && requires_non_empty_content(node_type) {
        return Err(DomainError::new(DomainErrorCode::InvalidDocument));
    }
    for child in content {
        validate_document_node(child, depth + 1, child_content, false, nodes_remaining)?;
    }
    Ok(())
}

fn requires_non_empty_content(node_type: &str) -> bool {
    matches!(
        node_type,
        "callout" | "taskList" | "taskItem" | "table" | "tableRow" | "tableCell" | "tableHeader"
    )
}

fn validate_callout(attrs: Option<&Value>) -> Result<(), DomainError> {
    let tone = attrs
        .and_then(Value::as_object)
        .and_then(|attrs| attrs.get("tone"))
        .and_then(Value::as_str);
    if matches!(tone, Some("info" | "warning" | "critical")) {
        Ok(())
    } else {
        Err(DomainError::new(DomainErrorCode::InvalidDocument))
    }
}

fn validate_image_reference(
    object: &serde_json::Map<String, Value>,
    id_attribute: &str,
) -> Result<(), DomainError> {
    reject_content(object)?;
    let attrs = object
        .get("attrs")
        .and_then(Value::as_object)
        .ok_or_else(|| DomainError::new(DomainErrorCode::InvalidDocument))?;
    let is_evidence = id_attribute == "evidenceId";
    if attrs.keys().any(|name| {
        name != id_attribute
            && !matches!(name.as_str(), "alt" | "title")
            && !(is_evidence
                && matches!(name.as_str(), "placement" | "appendixKey" | "appendixTitle"))
    }) {
        return Err(DomainError::new(DomainErrorCode::InvalidDocument));
    }
    let attachment_id = attrs
        .get(id_attribute)
        .and_then(Value::as_str)
        .ok_or_else(|| DomainError::new(DomainErrorCode::InvalidDocument))?;
    LocalId::parse(attachment_id)
        .map_err(|_| DomainError::new(DomainErrorCode::InvalidDocument))?;
    validate_attachment_text(attrs.get("alt"), false)?;
    validate_attachment_text(attrs.get("title"), true)?;
    if is_evidence {
        let placement = attrs
            .get("placement")
            .and_then(Value::as_str)
            .unwrap_or("inline");
        if !matches!(placement, "inline" | "appendix") {
            return Err(DomainError::new(DomainErrorCode::InvalidDocument));
        }
        let appendix_key = attrs.get("appendixKey");
        let appendix_title = attrs.get("appendixTitle");
        if placement == "appendix" {
            let appendix_key = appendix_key
                .and_then(Value::as_str)
                .ok_or_else(|| DomainError::new(DomainErrorCode::InvalidDocument))?;
            if appendix_key.is_empty()
                || appendix_key.len() > 64
                || !appendix_key
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
            {
                return Err(DomainError::new(DomainErrorCode::InvalidDocument));
            }
            validate_attachment_text(appendix_title, false)?;
        } else if appendix_key.is_some_and(|value| !value.is_null())
            || appendix_title.is_some_and(|value| !value.is_null())
        {
            return Err(DomainError::new(DomainErrorCode::InvalidDocument));
        }
    }
    Ok(())
}

fn validate_attachment_text(value: Option<&Value>, nullable: bool) -> Result<(), DomainError> {
    if nullable && value.is_none_or(Value::is_null) {
        return Ok(());
    }
    let value = value
        .and_then(Value::as_str)
        .ok_or_else(|| DomainError::new(DomainErrorCode::InvalidDocument))?;
    bounded_text(
        value,
        MAX_ATTACHMENT_TEXT_CHARS,
        DomainErrorCode::InvalidDocument,
    )?;
    Ok(())
}

fn validate_table_cell(attrs: Option<&Value>) -> Result<(), DomainError> {
    let Some(attrs) = attrs else {
        return Ok(());
    };
    let attrs = attrs
        .as_object()
        .ok_or_else(|| DomainError::new(DomainErrorCode::InvalidDocument))?;
    for name in ["colspan", "rowspan"] {
        let Some(span) = attrs.get(name) else {
            continue;
        };
        if !span.as_u64().is_some_and(|span| (1..=100).contains(&span)) {
            return Err(DomainError::new(DomainErrorCode::InvalidDocument));
        }
    }
    let Some(widths) = attrs.get("colwidth") else {
        return Ok(());
    };
    if widths.is_null() {
        return Ok(());
    }
    let widths = widths
        .as_array()
        .ok_or_else(|| DomainError::new(DomainErrorCode::InvalidDocument))?;
    if widths.len() > 100
        || widths.iter().any(|width| {
            !width
                .as_u64()
                .is_some_and(|width| (1..=4_096).contains(&width))
        })
    {
        return Err(DomainError::new(DomainErrorCode::InvalidDocument));
    }
    Ok(())
}

fn validate_heading(attrs: Option<&Value>) -> Result<(), DomainError> {
    let attrs = attrs
        .and_then(Value::as_object)
        .ok_or_else(|| DomainError::new(DomainErrorCode::InvalidDocument))?;
    if attrs
        .keys()
        .any(|name| !matches!(name.as_str(), "level" | "textAlign"))
    {
        return Err(DomainError::new(DomainErrorCode::InvalidDocument));
    }
    let level = attrs.get("level").and_then(Value::as_u64);
    if !matches!(level, Some(1..=3)) {
        return Err(DomainError::new(DomainErrorCode::InvalidDocument));
    }
    validate_text_alignment(attrs.get("textAlign"))
}

fn validate_paragraph(attrs: Option<&Value>) -> Result<(), DomainError> {
    let Some(attrs) = attrs else {
        return Ok(());
    };
    let attrs = attrs
        .as_object()
        .ok_or_else(|| DomainError::new(DomainErrorCode::InvalidDocument))?;
    if attrs.keys().any(|name| name != "textAlign") {
        return Err(DomainError::new(DomainErrorCode::InvalidDocument));
    }
    validate_text_alignment(attrs.get("textAlign"))
}

fn validate_text_alignment(value: Option<&Value>) -> Result<(), DomainError> {
    if value.is_none_or(Value::is_null)
        || value
            .and_then(Value::as_str)
            .is_some_and(|alignment| matches!(alignment, "left" | "center" | "right" | "justify"))
    {
        Ok(())
    } else {
        Err(DomainError::new(DomainErrorCode::InvalidDocument))
    }
}

fn validate_task_item(attrs: Option<&Value>) -> Result<(), DomainError> {
    let attrs = attrs
        .and_then(Value::as_object)
        .ok_or_else(|| DomainError::new(DomainErrorCode::InvalidDocument))?;
    if attrs.len() == 1 && attrs.get("checked").is_some_and(Value::is_boolean) {
        Ok(())
    } else {
        Err(DomainError::new(DomainErrorCode::InvalidDocument))
    }
}

fn validate_ordered_list(attrs: Option<&Value>) -> Result<(), DomainError> {
    let Some(attrs) = attrs else {
        return Ok(());
    };
    let start = attrs
        .as_object()
        .and_then(|attrs| attrs.get("start"))
        .and_then(Value::as_u64);
    if start.is_none_or(|start| (1..=1_000_000).contains(&start)) {
        Ok(())
    } else {
        Err(DomainError::new(DomainErrorCode::InvalidDocument))
    }
}

fn validate_text_node(
    object: &serde_json::Map<String, Value>,
    allow_marks: bool,
) -> Result<(), DomainError> {
    reject_content(object)?;
    if !object.get("text").is_some_and(Value::is_string) {
        return Err(DomainError::new(DomainErrorCode::InvalidDocument));
    }
    let Some(marks) = object.get("marks") else {
        return Ok(());
    };
    if !allow_marks {
        return Err(DomainError::new(DomainErrorCode::InvalidDocument));
    }
    for mark in marks
        .as_array()
        .ok_or_else(|| DomainError::new(DomainErrorCode::InvalidDocument))?
    {
        validate_mark(mark)?;
    }
    Ok(())
}

fn validate_mark(mark: &Value) -> Result<(), DomainError> {
    let mark = mark
        .as_object()
        .ok_or_else(|| DomainError::new(DomainErrorCode::InvalidDocument))?;
    let mark_type = mark
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| DomainError::new(DomainErrorCode::InvalidDocument))?;
    match mark_type {
        "bold" | "italic" | "strike" | "code" | "underline" | "highlight" | "subscript"
        | "superscript" => Ok(()),
        "link" => {
            let href = mark
                .get("attrs")
                .and_then(Value::as_object)
                .and_then(|attrs| attrs.get("href"))
                .and_then(Value::as_str)
                .ok_or_else(|| DomainError::new(DomainErrorCode::InvalidDocument))?;
            if href.chars().count() <= MAX_LINK_CHARS {
                Ok(())
            } else {
                Err(DomainError::new(DomainErrorCode::InvalidDocument))
            }
        }
        _ => Err(DomainError::new(DomainErrorCode::InvalidDocument)),
    }
}

fn reject_content(object: &serde_json::Map<String, Value>) -> Result<(), DomainError> {
    if object.contains_key("content") {
        Err(DomainError::new(DomainErrorCode::InvalidDocument))
    } else {
        Ok(())
    }
}

fn render_html_node(node: &Value, output: &mut String) {
    let Some(object) = node.as_object() else {
        return;
    };
    let Some(node_type) = object.get("type").and_then(Value::as_str) else {
        return;
    };

    match node_type {
        "doc" => render_html_children(object, output),
        "paragraph" => render_html_text_block("p", object, output),
        "heading" => {
            let level = object
                .get("attrs")
                .and_then(Value::as_object)
                .and_then(|attrs| attrs.get("level"))
                .and_then(Value::as_u64)
                .unwrap_or(1);
            let tag = format!("h{level}");
            render_html_text_block(&tag, object, output);
        }
        "blockquote" => render_html_element("blockquote", object, output),
        "callout" => {
            let tone = object
                .get("attrs")
                .and_then(Value::as_object)
                .and_then(|attrs| attrs.get("tone"))
                .and_then(Value::as_str)
                .unwrap_or("info");
            output.push_str("<aside data-sheut-callout=\"");
            output.push_str(tone);
            output.push_str("\">");
            render_html_children(object, output);
            output.push_str("</aside>");
        }
        "bulletList" => render_html_element("ul", object, output),
        "taskList" => {
            output.push_str("<ul data-type=\"taskList\">");
            render_html_children(object, output);
            output.push_str("</ul>");
        }
        "orderedList" => {
            let start = object
                .get("attrs")
                .and_then(Value::as_object)
                .and_then(|attrs| attrs.get("start"))
                .and_then(Value::as_u64)
                .unwrap_or(1);
            output.push_str("<ol");
            if start != 1 {
                output.push_str(" start=\"");
                output.push_str(&start.to_string());
                output.push('"');
            }
            output.push('>');
            render_html_children(object, output);
            output.push_str("</ol>");
        }
        "listItem" => render_html_element("li", object, output),
        "taskItem" => {
            let checked = object
                .get("attrs")
                .and_then(Value::as_object)
                .and_then(|attrs| attrs.get("checked"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            output.push_str(if checked {
                "<li data-checked=\"true\">"
            } else {
                "<li data-checked=\"false\">"
            });
            render_html_children(object, output);
            output.push_str("</li>");
        }
        "table" => {
            output.push_str("<table><tbody>");
            render_html_children(object, output);
            output.push_str("</tbody></table>");
        }
        "tableRow" => render_html_element("tr", object, output),
        "tableCell" => render_html_element("td", object, output),
        "tableHeader" => render_html_element("th", object, output),
        "codeBlock" => {
            output.push_str("<pre><code>");
            render_html_children(object, output);
            output.push_str("</code></pre>");
        }
        "horizontalRule" => output.push_str("<hr>"),
        "imageAttachment" => render_html_image_attachment(object, output),
        "evidenceImage" => render_html_evidence_image(object, output),
        "hardBreak" => output.push_str("<br>"),
        "text" => render_html_text(object, output),
        _ => {}
    }
}

fn render_html_image_attachment(object: &serde_json::Map<String, Value>, output: &mut String) {
    let Some(attrs) = object.get("attrs").and_then(Value::as_object) else {
        return;
    };
    let Some(attachment_id) = attrs.get("attachmentId").and_then(Value::as_str) else {
        return;
    };
    let Some(alt) = attrs.get("alt").and_then(Value::as_str) else {
        return;
    };
    output.push_str("<figure data-sheut-attachment=\"");
    output.push_str(&escape_html(attachment_id));
    output.push_str("\"><figcaption>");
    output.push_str(&escape_html(alt));
    output.push_str("</figcaption></figure>");
}

fn render_html_evidence_image(object: &serde_json::Map<String, Value>, output: &mut String) {
    let Some(alt) = object
        .get("attrs")
        .and_then(Value::as_object)
        .and_then(|attrs| attrs.get("alt"))
        .and_then(Value::as_str)
    else {
        return;
    };
    output.push_str("<figure data-sheut-evidence-image><figcaption>");
    output.push_str(&escape_html(alt));
    output.push_str("</figcaption></figure>");
}

fn render_html_element(tag: &str, object: &serde_json::Map<String, Value>, output: &mut String) {
    output.push('<');
    output.push_str(tag);
    output.push('>');
    render_html_children(object, output);
    output.push_str("</");
    output.push_str(tag);
    output.push('>');
}

fn render_html_text_block(tag: &str, object: &serde_json::Map<String, Value>, output: &mut String) {
    output.push('<');
    output.push_str(tag);
    if let Some(alignment) = object
        .get("attrs")
        .and_then(Value::as_object)
        .and_then(|attrs| attrs.get("textAlign"))
        .and_then(Value::as_str)
    {
        output.push_str(" style=\"text-align:");
        output.push_str(alignment);
        output.push('"');
    }
    output.push('>');
    render_html_children(object, output);
    output.push_str("</");
    output.push_str(tag);
    output.push('>');
}

fn render_html_children(object: &serde_json::Map<String, Value>, output: &mut String) {
    if let Some(children) = object.get("content").and_then(Value::as_array) {
        for child in children {
            render_html_node(child, output);
        }
    }
}

fn render_html_text(object: &serde_json::Map<String, Value>, output: &mut String) {
    let Some(text) = object.get("text").and_then(Value::as_str) else {
        return;
    };
    let mut rendered = escape_html(text);
    if let Some(marks) = object.get("marks").and_then(Value::as_array) {
        for mark in marks {
            let Some(mark) = mark.as_object() else {
                continue;
            };
            rendered = match mark.get("type").and_then(Value::as_str) {
                Some("bold") => wrap_html("strong", &rendered),
                Some("italic") => wrap_html("em", &rendered),
                Some("strike") => wrap_html("s", &rendered),
                Some("code") => wrap_html("code", &rendered),
                Some("underline") => wrap_html("u", &rendered),
                Some("highlight") => wrap_html("mark", &rendered),
                Some("subscript") => wrap_html("sub", &rendered),
                Some("superscript") => wrap_html("sup", &rendered),
                Some("link") => render_safe_link(mark, &rendered),
                _ => rendered,
            };
        }
    }
    output.push_str(&rendered);
}

fn render_safe_link(mark: &serde_json::Map<String, Value>, content: &str) -> String {
    let href = mark
        .get("attrs")
        .and_then(Value::as_object)
        .and_then(|attrs| attrs.get("href"))
        .and_then(Value::as_str);
    let Some(href) = href.filter(|href| is_safe_link(href)) else {
        return content.to_owned();
    };
    format!("<a href=\"{}\">{content}</a>", escape_html(href.trim()))
}

fn is_safe_link(href: &str) -> bool {
    let trimmed = href.trim();
    if trimmed.chars().any(char::is_control) {
        return false;
    }
    // Relative network paths (//host) are excluded even though ordinary local
    // anchors and paths are allowed; they would otherwise escape offline output.
    let lowercase = trimmed.to_ascii_lowercase();
    lowercase.starts_with("https://")
        || lowercase.starts_with("http://")
        || lowercase.starts_with("mailto:")
        || (trimmed.starts_with('/') && !trimmed.starts_with("//"))
        || trimmed.starts_with('#')
}

fn wrap_html(tag: &str, content: &str) -> String {
    format!("<{tag}>{content}</{tag}>")
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

fn render_plain_text_node(node: &Value, output: &mut String) {
    let Some(object) = node.as_object() else {
        return;
    };
    let Some(node_type) = object.get("type").and_then(Value::as_str) else {
        return;
    };
    if node_type == "text" {
        if let Some(text) = object.get("text").and_then(Value::as_str) {
            output.push_str(text);
        }
        return;
    }
    if node_type == "hardBreak" {
        output.push('\n');
        return;
    }
    if matches!(node_type, "imageAttachment" | "evidenceImage") {
        if let Some(alt) = object
            .get("attrs")
            .and_then(Value::as_object)
            .and_then(|attrs| attrs.get("alt"))
            .and_then(Value::as_str)
        {
            output.push_str("[Image: ");
            output.push_str(alt);
            output.push_str("]\n");
        }
        return;
    }
    if node_type == "taskItem" {
        let checked = object
            .get("attrs")
            .and_then(Value::as_object)
            .and_then(|attrs| attrs.get("checked"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        output.push_str(if checked { "[x] " } else { "[ ] " });
        if let Some(children) = object.get("content").and_then(Value::as_array) {
            for child in children {
                render_plain_text_node(child, output);
            }
        }
        if !output.ends_with('\n') {
            output.push('\n');
        }
        return;
    }
    if node_type == "tableRow" {
        if let Some(cells) = object.get("content").and_then(Value::as_array) {
            for (index, cell) in cells.iter().enumerate() {
                if index > 0 {
                    output.push('\t');
                }
                render_plain_text_node(cell, output);
                while output.ends_with('\n') {
                    output.pop();
                }
            }
        }
        output.push('\n');
        return;
    }

    if let Some(children) = object.get("content").and_then(Value::as_array) {
        for child in children {
            render_plain_text_node(child, output);
        }
    }
    if matches!(
        node_type,
        "paragraph"
            | "heading"
            | "blockquote"
            | "callout"
            | "listItem"
            | "codeBlock"
            | "horizontalRule"
    ) && !output.ends_with('\n')
    {
        output.push('\n');
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

impl Position {
    pub fn new(x: f64, y: f64) -> Result<Self, DomainError> {
        if !valid_graph_coordinate(x) || !valid_graph_coordinate(y) {
            return Err(DomainError::new(DomainErrorCode::InvalidPosition));
        }
        Ok(Self { x, y })
    }
}

impl<'de> Deserialize<'de> for Position {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct Wire {
            x: f64,
            y: f64,
        }

        let wire = Wire::deserialize(deserializer)?;
        Self::new(wire.x, wire.y).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct GraphViewport {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

impl GraphViewport {
    pub fn new(x: f64, y: f64, zoom: f64) -> Result<Self, DomainError> {
        if !valid_graph_coordinate(x)
            || !valid_graph_coordinate(y)
            || !zoom.is_finite()
            || !(MIN_GRAPH_ZOOM..=MAX_GRAPH_ZOOM).contains(&zoom)
        {
            return Err(DomainError::new(DomainErrorCode::InvalidViewport));
        }
        Ok(Self { x, y, zoom })
    }
}

impl Default for GraphViewport {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            zoom: 1.0,
        }
    }
}

impl<'de> Deserialize<'de> for GraphViewport {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct Wire {
            x: f64,
            y: f64,
            zoom: f64,
        }

        let wire = Wire::deserialize(deserializer)?;
        Self::new(wire.x, wire.y, wire.zoom).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceMode {
    View,
    Build,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GraphWorkspace {
    schema_version: u8,
    id: LocalId,
    name: String,
    revision: Revision,
    mode: WorkspaceMode,
    viewport: GraphViewport,
    created_at_unix_ms: i64,
    updated_at_unix_ms: i64,
    deleted_at_unix_ms: Option<i64>,
}

#[derive(Deserialize)]
struct GraphWorkspaceWire {
    schema_version: u8,
    id: LocalId,
    name: String,
    revision: Revision,
    mode: WorkspaceMode,
    viewport: GraphViewport,
    created_at_unix_ms: i64,
    updated_at_unix_ms: i64,
    deleted_at_unix_ms: Option<i64>,
}

impl<'de> Deserialize<'de> for GraphWorkspace {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = GraphWorkspaceWire::deserialize(deserializer)?;
        Self::restore(
            wire.schema_version,
            wire.id,
            wire.name,
            wire.revision,
            wire.mode,
            wire.viewport,
            wire.created_at_unix_ms,
            wire.updated_at_unix_ms,
            wire.deleted_at_unix_ms,
        )
        .map_err(serde::de::Error::custom)
    }
}

impl GraphWorkspace {
    pub fn new(
        id: LocalId,
        name: impl AsRef<str>,
        mode: WorkspaceMode,
        viewport: GraphViewport,
        now_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        Self::restore(
            GRAPH_WORKSPACE_SCHEMA_VERSION,
            id,
            name,
            Revision::new(1)?,
            mode,
            viewport,
            now_unix_ms,
            now_unix_ms,
            None,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn restore(
        schema_version: u8,
        id: LocalId,
        name: impl AsRef<str>,
        revision: Revision,
        mode: WorkspaceMode,
        viewport: GraphViewport,
        created_at_unix_ms: i64,
        updated_at_unix_ms: i64,
        deleted_at_unix_ms: Option<i64>,
    ) -> Result<Self, DomainError> {
        if schema_version != GRAPH_WORKSPACE_SCHEMA_VERSION
            || created_at_unix_ms < 0
            || updated_at_unix_ms < created_at_unix_ms
            || deleted_at_unix_ms.is_some_and(|deleted| deleted < updated_at_unix_ms)
        {
            return Err(DomainError::new(DomainErrorCode::InvalidWorkspace));
        }
        Ok(Self {
            schema_version,
            id,
            name: bounded_text(name.as_ref(), MAX_NAME_CHARS, DomainErrorCode::InvalidName)?,
            revision,
            mode,
            viewport,
            created_at_unix_ms,
            updated_at_unix_ms,
            deleted_at_unix_ms,
        })
    }

    #[must_use]
    pub const fn id(&self) -> LocalId {
        self.id
    }

    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    #[must_use]
    pub const fn revision(&self) -> Revision {
        self.revision
    }

    #[must_use]
    pub const fn mode(&self) -> WorkspaceMode {
        self.mode
    }

    #[must_use]
    pub const fn viewport(&self) -> GraphViewport {
        self.viewport
    }

    #[must_use]
    pub const fn created_at_unix_ms(&self) -> i64 {
        self.created_at_unix_ms
    }

    #[must_use]
    pub const fn updated_at_unix_ms(&self) -> i64 {
        self.updated_at_unix_ms
    }

    #[must_use]
    pub const fn deleted_at_unix_ms(&self) -> Option<i64> {
        self.deleted_at_unix_ms
    }

    pub fn revised(
        &self,
        name: impl AsRef<str>,
        mode: WorkspaceMode,
        viewport: GraphViewport,
        updated_at_unix_ms: i64,
        deleted_at_unix_ms: Option<i64>,
    ) -> Result<Self, DomainError> {
        Self::restore(
            self.schema_version,
            self.id,
            name,
            self.revision.next()?,
            mode,
            viewport,
            self.created_at_unix_ms,
            updated_at_unix_ms,
            deleted_at_unix_ms,
        )
    }
}

const fn valid_graph_coordinate(value: f64) -> bool {
    value.is_finite() && value >= -MAX_GRAPH_COORDINATE && value <= MAX_GRAPH_COORDINATE
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceItemKind {
    Intelligence,
    Evidence,
    Document,
    CatalogReference,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkspaceItem {
    workspace_id: LocalId,
    item_id: LocalId,
    item_kind: WorkspaceItemKind,
    position: Position,
    pinned: bool,
}

impl WorkspaceItem {
    #[must_use]
    pub const fn new(
        workspace_id: LocalId,
        item_id: LocalId,
        item_kind: WorkspaceItemKind,
        position: Position,
        pinned: bool,
    ) -> Self {
        Self {
            workspace_id,
            item_id,
            item_kind,
            position,
            pinned,
        }
    }

    #[must_use]
    pub const fn workspace_id(&self) -> LocalId {
        self.workspace_id
    }

    #[must_use]
    pub const fn item_id(&self) -> LocalId {
        self.item_id
    }

    #[must_use]
    pub const fn item_kind(&self) -> WorkspaceItemKind {
        self.item_kind
    }

    #[must_use]
    pub const fn position(&self) -> Position {
        self.position
    }

    #[must_use]
    pub const fn pinned(&self) -> bool {
        self.pinned
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum LinkKind {
    Visual,
    SemanticRelationshipDraft,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct VisualLink {
    kind: LinkKind,
    id: LocalId,
    workspace_id: LocalId,
    source_id: LocalId,
    target_id: LocalId,
    label: Option<String>,
}

#[derive(Deserialize)]
struct VisualLinkWire {
    kind: LinkKind,
    id: LocalId,
    workspace_id: LocalId,
    source_id: LocalId,
    target_id: LocalId,
    label: Option<String>,
}

impl<'de> Deserialize<'de> for VisualLink {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = VisualLinkWire::deserialize(deserializer)?;
        if wire.kind != LinkKind::Visual {
            return Err(serde::de::Error::custom(DomainError::new(
                DomainErrorCode::InvalidLinkLabel,
            )));
        }
        Self::new(
            wire.id,
            wire.workspace_id,
            wire.source_id,
            wire.target_id,
            wire.label.as_deref(),
        )
        .map_err(serde::de::Error::custom)
    }
}

impl VisualLink {
    pub fn new(
        id: LocalId,
        workspace_id: LocalId,
        source_id: LocalId,
        target_id: LocalId,
        label: Option<&str>,
    ) -> Result<Self, DomainError> {
        reject_self_link(source_id, target_id)?;
        let label = label
            .map(|value| bounded_text(value, MAX_LABEL_CHARS, DomainErrorCode::InvalidLinkLabel))
            .transpose()?;
        Ok(Self {
            kind: LinkKind::Visual,
            id,
            workspace_id,
            source_id,
            target_id,
            label,
        })
    }

    #[must_use]
    pub fn label(&self) -> Option<&str> {
        self.label.as_deref()
    }

    #[must_use]
    pub const fn id(&self) -> LocalId {
        self.id
    }

    #[must_use]
    pub const fn workspace_id(&self) -> LocalId {
        self.workspace_id
    }

    #[must_use]
    pub const fn source_id(&self) -> LocalId {
        self.source_id
    }

    #[must_use]
    pub const fn target_id(&self) -> LocalId {
        self.target_id
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GraphWorkspaceSnapshot {
    workspace: GraphWorkspace,
    items: Vec<WorkspaceItem>,
    visual_links: Vec<VisualLink>,
}

#[derive(Deserialize)]
struct GraphWorkspaceSnapshotWire {
    workspace: GraphWorkspace,
    items: Vec<WorkspaceItem>,
    visual_links: Vec<VisualLink>,
}

impl<'de> Deserialize<'de> for GraphWorkspaceSnapshot {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = GraphWorkspaceSnapshotWire::deserialize(deserializer)?;
        Self::new(wire.workspace, wire.items, wire.visual_links).map_err(serde::de::Error::custom)
    }
}

impl GraphWorkspaceSnapshot {
    pub fn new(
        workspace: GraphWorkspace,
        items: Vec<WorkspaceItem>,
        visual_links: Vec<VisualLink>,
    ) -> Result<Self, DomainError> {
        if items.len() > MAX_GRAPH_WORKSPACE_ITEMS
            || visual_links.len() > MAX_GRAPH_VISUAL_LINKS
            || items
                .iter()
                .any(|item| item.workspace_id() != workspace.id())
            || visual_links
                .iter()
                .any(|link| link.workspace_id() != workspace.id())
        {
            return Err(DomainError::new(DomainErrorCode::WorkspaceLimitExceeded));
        }
        let item_ids = items
            .iter()
            .map(WorkspaceItem::item_id)
            .collect::<std::collections::HashSet<_>>();
        if visual_links.iter().any(|link| {
            !item_ids.contains(&link.source_id()) || !item_ids.contains(&link.target_id())
        }) {
            return Err(DomainError::new(DomainErrorCode::InvalidWorkspace));
        }
        Ok(Self {
            workspace,
            items,
            visual_links,
        })
    }

    #[must_use]
    pub const fn workspace(&self) -> &GraphWorkspace {
        &self.workspace
    }

    #[must_use]
    pub fn items(&self) -> &[WorkspaceItem] {
        &self.items
    }

    #[must_use]
    pub fn visual_links(&self) -> &[VisualLink] {
        &self.visual_links
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SemanticRelationshipDraft {
    kind: LinkKind,
    source_id: LocalId,
    target_id: LocalId,
    relationship_type: String,
}

#[derive(Deserialize)]
struct SemanticRelationshipDraftWire {
    kind: LinkKind,
    source_id: LocalId,
    target_id: LocalId,
    relationship_type: String,
}

impl<'de> Deserialize<'de> for SemanticRelationshipDraft {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = SemanticRelationshipDraftWire::deserialize(deserializer)?;
        if wire.kind != LinkKind::SemanticRelationshipDraft {
            return Err(serde::de::Error::custom(DomainError::new(
                DomainErrorCode::InvalidRelationshipType,
            )));
        }
        Self::new(wire.source_id, wire.target_id, wire.relationship_type)
            .map_err(serde::de::Error::custom)
    }
}

impl SemanticRelationshipDraft {
    pub fn new(
        source_id: LocalId,
        target_id: LocalId,
        relationship_type: impl AsRef<str>,
    ) -> Result<Self, DomainError> {
        reject_self_link(source_id, target_id)?;
        let relationship_type = bounded_text(
            relationship_type.as_ref(),
            MAX_RELATIONSHIP_TYPE_CHARS,
            DomainErrorCode::InvalidRelationshipType,
        )?;
        if !relationship_type.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        }) {
            return Err(DomainError::new(DomainErrorCode::InvalidRelationshipType));
        }
        Ok(Self {
            kind: LinkKind::SemanticRelationshipDraft,
            source_id,
            target_id,
            relationship_type,
        })
    }

    #[must_use]
    pub fn relationship_type(&self) -> &str {
        &self.relationship_type
    }

    #[must_use]
    pub const fn source_id(&self) -> LocalId {
        self.source_id
    }

    #[must_use]
    pub const fn target_id(&self) -> LocalId {
        self.target_id
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CatalogReference {
    catalog: String,
    version: String,
    object_type: String,
    external_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MitreCatalog {
    AttackEnterprise,
    AttackMobile,
    AttackIcs,
    Atlas,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MitreTechniqueReference {
    catalog: MitreCatalog,
    version: String,
    technique_id: String,
    tactic_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MitreTechniqueReferenceWire {
    catalog: MitreCatalog,
    version: String,
    technique_id: String,
    tactic_id: Option<String>,
}

impl<'de> Deserialize<'de> for MitreTechniqueReference {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = MitreTechniqueReferenceWire::deserialize(deserializer)?;
        Self::new(
            wire.catalog,
            wire.version,
            wire.technique_id,
            wire.tactic_id.as_deref(),
        )
        .map_err(serde::de::Error::custom)
    }
}

impl MitreTechniqueReference {
    pub fn new(
        catalog: MitreCatalog,
        version: impl AsRef<str>,
        technique_id: impl AsRef<str>,
        tactic_id: Option<&str>,
    ) -> Result<Self, DomainError> {
        let version = catalog_text(version.as_ref())?;
        let technique_id = catalog_text(technique_id.as_ref())?;
        let tactic_id = tactic_id.map(catalog_text).transpose()?;
        let valid = match catalog {
            MitreCatalog::AttackEnterprise
            | MitreCatalog::AttackMobile
            | MitreCatalog::AttackIcs => {
                valid_numeric_identifier(&technique_id, "T", true)
                    && tactic_id
                        .as_deref()
                        .is_none_or(|value| valid_numeric_identifier(value, "TA", false))
            }
            MitreCatalog::Atlas => {
                valid_numeric_identifier(&technique_id, "AML.T", true)
                    && tactic_id
                        .as_deref()
                        .is_none_or(|value| valid_numeric_identifier(value, "AML.TA", false))
            }
        };
        if !valid {
            return Err(DomainError::new(DomainErrorCode::InvalidCatalogReference));
        }
        Ok(Self {
            catalog,
            version,
            technique_id,
            tactic_id,
        })
    }

    #[must_use]
    pub const fn catalog(&self) -> MitreCatalog {
        self.catalog
    }

    #[must_use]
    pub fn version(&self) -> &str {
        &self.version
    }

    #[must_use]
    pub fn technique_id(&self) -> &str {
        &self.technique_id
    }

    #[must_use]
    pub fn tactic_id(&self) -> Option<&str> {
        self.tactic_id.as_deref()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TechniqueAssessment {
    Observed,
    Suspected,
    RuledOut,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TechniqueOutcome {
    Unknown,
    Attempted,
    Successful,
    Prevented,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnalyticConfidence {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TechniqueObservation {
    id: LocalId,
    reference: MitreTechniqueReference,
    assessment: TechniqueAssessment,
    outcome: TechniqueOutcome,
    confidence: AnalyticConfidence,
    narrative: String,
    first_seen_unix_ms: Option<i64>,
    last_seen_unix_ms: Option<i64>,
    revision: Revision,
    created_at_unix_ms: i64,
    updated_at_unix_ms: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TechniqueObservationWire {
    id: LocalId,
    reference: MitreTechniqueReference,
    assessment: TechniqueAssessment,
    outcome: TechniqueOutcome,
    confidence: AnalyticConfidence,
    narrative: String,
    first_seen_unix_ms: Option<i64>,
    last_seen_unix_ms: Option<i64>,
    revision: Revision,
    created_at_unix_ms: i64,
    updated_at_unix_ms: i64,
}

impl<'de> Deserialize<'de> for TechniqueObservation {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = TechniqueObservationWire::deserialize(deserializer)?;
        Self::validated(
            wire.id,
            wire.reference,
            wire.assessment,
            wire.outcome,
            wire.confidence,
            &wire.narrative,
            wire.first_seen_unix_ms,
            wire.last_seen_unix_ms,
            wire.revision,
            wire.created_at_unix_ms,
            wire.updated_at_unix_ms,
        )
        .map_err(serde::de::Error::custom)
    }
}

impl TechniqueObservation {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: LocalId,
        reference: MitreTechniqueReference,
        assessment: TechniqueAssessment,
        outcome: TechniqueOutcome,
        confidence: AnalyticConfidence,
        narrative: impl AsRef<str>,
        first_seen_unix_ms: Option<i64>,
        last_seen_unix_ms: Option<i64>,
        now_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        Self::validated(
            id,
            reference,
            assessment,
            outcome,
            confidence,
            narrative.as_ref(),
            first_seen_unix_ms,
            last_seen_unix_ms,
            Revision::new(1)?,
            now_unix_ms,
            now_unix_ms,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn revise(
        &self,
        assessment: TechniqueAssessment,
        outcome: TechniqueOutcome,
        confidence: AnalyticConfidence,
        narrative: impl AsRef<str>,
        first_seen_unix_ms: Option<i64>,
        last_seen_unix_ms: Option<i64>,
        now_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        Self::validated(
            self.id,
            self.reference.clone(),
            assessment,
            outcome,
            confidence,
            narrative.as_ref(),
            first_seen_unix_ms,
            last_seen_unix_ms,
            self.revision.next()?,
            self.created_at_unix_ms,
            now_unix_ms,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn validated(
        id: LocalId,
        reference: MitreTechniqueReference,
        assessment: TechniqueAssessment,
        outcome: TechniqueOutcome,
        confidence: AnalyticConfidence,
        narrative: &str,
        first_seen_unix_ms: Option<i64>,
        last_seen_unix_ms: Option<i64>,
        revision: Revision,
        created_at_unix_ms: i64,
        updated_at_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        let narrative = bounded_multiline_text(narrative, MAX_TECHNIQUE_NARRATIVE_CHARS)?;
        let timestamps_are_valid = created_at_unix_ms >= 0
            && updated_at_unix_ms >= created_at_unix_ms
            && first_seen_unix_ms.is_none_or(|value| value >= 0 && value <= updated_at_unix_ms)
            && last_seen_unix_ms.is_none_or(|value| value >= 0 && value <= updated_at_unix_ms)
            && match (first_seen_unix_ms, last_seen_unix_ms) {
                (Some(first), Some(last)) => first <= last,
                _ => true,
            };
        let state_is_valid =
            assessment != TechniqueAssessment::RuledOut || outcome == TechniqueOutcome::Unknown;
        if !timestamps_are_valid || !state_is_valid {
            return Err(DomainError::new(
                DomainErrorCode::InvalidTechniqueObservation,
            ));
        }
        Ok(Self {
            id,
            reference,
            assessment,
            outcome,
            confidence,
            narrative,
            first_seen_unix_ms,
            last_seen_unix_ms,
            revision,
            created_at_unix_ms,
            updated_at_unix_ms,
        })
    }

    #[must_use]
    pub const fn id(&self) -> LocalId {
        self.id
    }

    #[must_use]
    pub const fn reference(&self) -> &MitreTechniqueReference {
        &self.reference
    }

    #[must_use]
    pub const fn assessment(&self) -> TechniqueAssessment {
        self.assessment
    }

    #[must_use]
    pub const fn outcome(&self) -> TechniqueOutcome {
        self.outcome
    }

    #[must_use]
    pub const fn confidence(&self) -> AnalyticConfidence {
        self.confidence
    }

    #[must_use]
    pub fn narrative(&self) -> &str {
        &self.narrative
    }

    #[must_use]
    pub const fn first_seen_unix_ms(&self) -> Option<i64> {
        self.first_seen_unix_ms
    }

    #[must_use]
    pub const fn last_seen_unix_ms(&self) -> Option<i64> {
        self.last_seen_unix_ms
    }

    #[must_use]
    pub const fn revision(&self) -> Revision {
        self.revision
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

fn valid_numeric_identifier(value: &str, prefix: &str, allow_sub_identifier: bool) -> bool {
    let Some(value) = value.strip_prefix(prefix) else {
        return false;
    };
    let (primary, secondary) = value
        .split_once('.')
        .map_or((value, None), |(primary, secondary)| {
            (primary, Some(secondary))
        });
    primary.len() == 4
        && primary.bytes().all(|value| value.is_ascii_digit())
        && secondary.is_none_or(|secondary| {
            allow_sub_identifier
                && secondary.len() == 3
                && secondary.bytes().all(|value| value.is_ascii_digit())
        })
}

fn bounded_multiline_text(value: &str, max_chars: usize) -> Result<String, DomainError> {
    let value = value.trim();
    if value.is_empty()
        || value.chars().count() > max_chars
        || value
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        return Err(DomainError::new(
            DomainErrorCode::InvalidTechniqueObservation,
        ));
    }
    Ok(value.replace("\r\n", "\n").replace('\r', "\n"))
}

#[derive(Deserialize)]
struct CatalogReferenceWire {
    catalog: String,
    version: String,
    object_type: String,
    external_id: String,
}

impl<'de> Deserialize<'de> for CatalogReference {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = CatalogReferenceWire::deserialize(deserializer)?;
        Self::new(
            wire.catalog,
            wire.version,
            wire.object_type,
            wire.external_id,
        )
        .map_err(serde::de::Error::custom)
    }
}

impl CatalogReference {
    pub fn new(
        catalog: impl AsRef<str>,
        version: impl AsRef<str>,
        object_type: impl AsRef<str>,
        external_id: impl AsRef<str>,
    ) -> Result<Self, DomainError> {
        Ok(Self {
            catalog: catalog_text(catalog.as_ref())?,
            version: catalog_text(version.as_ref())?,
            object_type: catalog_text(object_type.as_ref())?,
            external_id: catalog_text(external_id.as_ref())?,
        })
    }

    #[must_use]
    pub fn catalog(&self) -> &str {
        &self.catalog
    }

    #[must_use]
    pub fn version(&self) -> &str {
        &self.version
    }

    #[must_use]
    pub fn external_id(&self) -> &str {
        &self.external_id
    }
}

fn reject_self_link(source_id: LocalId, target_id: LocalId) -> Result<(), DomainError> {
    if source_id == target_id {
        return Err(DomainError::new(DomainErrorCode::SelfLink));
    }
    Ok(())
}

fn catalog_text(value: &str) -> Result<String, DomainError> {
    bounded_text(
        value,
        MAX_NAME_CHARS,
        DomainErrorCode::InvalidCatalogReference,
    )
}

fn bounded_text(
    value: &str,
    max_chars: usize,
    code: DomainErrorCode,
) -> Result<String, DomainError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max_chars || value.chars().any(char::is_control)
    {
        return Err(DomainError::new(code));
    }
    Ok(value.to_owned())
}
