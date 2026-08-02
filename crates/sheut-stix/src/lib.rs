#![forbid(unsafe_code)]

//! Bounded STIX 2.1 import and export at the interchange boundary.
//! Drafts keep stable local identifiers until explicit validation and export create STIX IDs.

use std::{collections::HashMap, error::Error, fmt};

use rstix::{
    core::{ScoKind, StixId},
    id::generate_sco_id,
    model::ParseOptions,
    validate::Validator,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sheut_core::{LocalId, SemanticRelationshipDraft};
use uuid::Uuid;

pub const MAX_STIX_BUNDLE_BYTES: usize = 16 * 1024 * 1024;
const MAX_NESTING_DEPTH: usize = 64;
const MAX_OBJECT_COUNT: usize = 5_000;
const MAX_STRING_LENGTH: usize = 1024 * 1024;

const BUILT_IN_OBJECT_TYPES: [&str; 42] = [
    "attack-pattern",
    "campaign",
    "course-of-action",
    "grouping",
    "identity",
    "incident",
    "indicator",
    "infrastructure",
    "intrusion-set",
    "location",
    "malware",
    "malware-analysis",
    "note",
    "observed-data",
    "opinion",
    "report",
    "threat-actor",
    "tool",
    "vulnerability",
    "artifact",
    "autonomous-system",
    "directory",
    "domain-name",
    "email-addr",
    "email-message",
    "file",
    "ipv4-addr",
    "ipv6-addr",
    "mac-addr",
    "mutex",
    "network-traffic",
    "process",
    "software",
    "url",
    "user-account",
    "windows-registry-key",
    "x509-certificate",
    "relationship",
    "sighting",
    "marking-definition",
    "language-content",
    "extension-definition",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StixErrorCode {
    InvalidJson,
    InvalidBundle,
    UnsupportedSpecVersion,
    ValidationFailed,
    LimitExceeded,
    InvalidDraft,
    DuplicateDecisionRequired,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StixError {
    code: StixErrorCode,
}

impl StixError {
    #[must_use]
    pub const fn code(self) -> StixErrorCode {
        self.code
    }

    const fn new(code: StixErrorCode) -> Self {
        Self { code }
    }
}

impl fmt::Display for StixError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let code = serde_json::to_value(self.code)
            .ok()
            .and_then(|value| value.as_str().map(str::to_owned))
            .unwrap_or_else(|| "stix_error".to_owned());
        formatter.write_str(&code)
    }
}

impl Error for StixError {}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ParsedStixObject {
    stix_id: String,
    object_type: String,
    modified: Option<String>,
    raw: Value,
}

impl ParsedStixObject {
    #[must_use]
    pub fn stix_id(&self) -> &str {
        &self.stix_id
    }

    #[must_use]
    pub fn object_type(&self) -> &str {
        &self.object_type
    }

    #[must_use]
    pub fn modified(&self) -> Option<&str> {
        self.modified.as_deref()
    }

    #[must_use]
    pub const fn raw(&self) -> &Value {
        &self.raw
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ParsedBundle {
    bundle_id: String,
    objects: Vec<ParsedStixObject>,
}

impl ParsedBundle {
    #[must_use]
    pub fn bundle_id(&self) -> &str {
        &self.bundle_id
    }

    #[must_use]
    pub fn objects(&self) -> &[ParsedStixObject] {
        &self.objects
    }
}

#[must_use]
pub const fn supported_object_types() -> &'static [&'static str] {
    &BUILT_IN_OBJECT_TYPES
}

pub fn parse_bundle(bytes: &[u8]) -> Result<ParsedBundle, StixError> {
    if bytes.is_empty() {
        return Err(StixError::new(StixErrorCode::InvalidJson));
    }
    if bytes.len() > MAX_STIX_BUNDLE_BYTES {
        return Err(StixError::new(StixErrorCode::LimitExceeded));
    }

    // Cap raw bytes before allocation, then walk the decoded tree before the
    // richer STIX validator sees it. Both limits matter for hostile local files.
    let value: Value =
        serde_json::from_slice(bytes).map_err(|_| StixError::new(StixErrorCode::InvalidJson))?;
    validate_value_limits(&value, 0)?;

    let root = value
        .as_object()
        .ok_or_else(|| StixError::new(StixErrorCode::InvalidBundle))?;
    if root.get("type").and_then(Value::as_str) != Some("bundle") {
        return Err(StixError::new(StixErrorCode::InvalidBundle));
    }
    let bundle_id = required_stix_id(root, "id", Some("bundle"))?;
    let objects = root
        .get("objects")
        .and_then(Value::as_array)
        .ok_or_else(|| StixError::new(StixErrorCode::InvalidBundle))?;
    if objects.is_empty() {
        return Err(StixError::new(StixErrorCode::InvalidBundle));
    }
    if objects.len() > MAX_OBJECT_COUNT {
        return Err(StixError::new(StixErrorCode::LimitExceeded));
    }

    let mut parsed_objects = Vec::with_capacity(objects.len());
    for object in objects {
        let map = object
            .as_object()
            .ok_or_else(|| StixError::new(StixErrorCode::InvalidBundle))?;
        if map.get("spec_version").and_then(Value::as_str) != Some("2.1") {
            return Err(StixError::new(StixErrorCode::UnsupportedSpecVersion));
        }
        let object_type = map
            .get("type")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| StixError::new(StixErrorCode::InvalidBundle))?;
        let stix_id = required_stix_id(map, "id", Some(object_type))?;
        let modified = map
            .get("modified")
            .and_then(Value::as_str)
            .map(str::to_owned);
        parsed_objects.push(ParsedStixObject {
            stix_id,
            object_type: object_type.to_owned(),
            modified,
            raw: object.clone(),
        });
    }

    validate_reference_kinds(objects)?;
    validate_with_rstix(&value)?;

    Ok(ParsedBundle {
        bundle_id,
        objects: parsed_objects,
    })
}

fn validate_reference_kinds(objects: &[Value]) -> Result<(), StixError> {
    for object in objects {
        let map = object
            .as_object()
            .ok_or_else(|| StixError::new(StixErrorCode::InvalidBundle))?;
        validate_reference_ids(&Value::Object(map.clone()))?;
        if map.get("type").and_then(Value::as_str) == Some("relationship") {
            for property in ["source_ref", "target_ref"] {
                let reference = map
                    .get(property)
                    .and_then(Value::as_str)
                    .ok_or_else(|| StixError::new(StixErrorCode::ValidationFailed))?;
                let reference_type = StixId::parse(reference)
                    .map_err(|_| StixError::new(StixErrorCode::ValidationFailed))?
                    .type_name()
                    .to_owned();
                if !is_relationship_endpoint_type(&reference_type) {
                    return Err(StixError::new(StixErrorCode::ValidationFailed));
                }
            }
        }
    }
    Ok(())
}

fn validate_reference_ids(value: &Value) -> Result<(), StixError> {
    match value {
        Value::Array(values) => {
            for value in values {
                validate_reference_ids(value)?;
            }
        }
        Value::Object(map) => {
            for (name, value) in map {
                if name.ends_with("_ref") {
                    let reference = value
                        .as_str()
                        .ok_or_else(|| StixError::new(StixErrorCode::ValidationFailed))?;
                    StixId::parse(reference)
                        .map_err(|_| StixError::new(StixErrorCode::ValidationFailed))?;
                } else if name.ends_with("_refs") {
                    let references = value
                        .as_array()
                        .ok_or_else(|| StixError::new(StixErrorCode::ValidationFailed))?;
                    for reference in references {
                        StixId::parse(
                            reference
                                .as_str()
                                .ok_or_else(|| StixError::new(StixErrorCode::ValidationFailed))?,
                        )
                        .map_err(|_| StixError::new(StixErrorCode::ValidationFailed))?;
                    }
                } else {
                    validate_reference_ids(value)?;
                }
            }
        }
        _ => {}
    }
    Ok(())
}

#[must_use]
pub fn is_relationship_endpoint_type(object_type: &str) -> bool {
    BUILT_IN_OBJECT_TYPES[..37].contains(&object_type) || object_type.starts_with("x-")
}

fn parse_options() -> ParseOptions {
    let mut options = ParseOptions::new().allow_custom(true);
    options.max_nesting_depth = MAX_NESTING_DEPTH;
    options.max_object_count = MAX_OBJECT_COUNT;
    options.max_string_length = MAX_STRING_LENGTH;
    options.max_bundle_bytes = MAX_STIX_BUNDLE_BYTES;
    options
}

fn validate_with_rstix(value: &Value) -> Result<(), StixError> {
    let validation_value = rstix_validation_value(value);
    let strict = Validator::consumer_strict();
    let mut builder = Validator::builder().with_parse_options(parse_options());
    for phase in strict.phases() {
        builder = builder.with_phase(*phase);
    }
    let report = builder.build().validate_json_value(&validation_value);
    if report.is_valid() {
        Ok(())
    } else {
        Err(StixError::new(StixErrorCode::ValidationFailed))
    }
}

fn rstix_validation_value(value: &Value) -> Value {
    let mut validation_value = value.clone();
    let Some(objects) = validation_value
        .get_mut("objects")
        .and_then(Value::as_array_mut)
    else {
        return validation_value;
    };
    for object in objects {
        let Some(map) = object.as_object_mut() else {
            continue;
        };
        if !matches!(
            map.get("type").and_then(Value::as_str),
            Some("grouping" | "note" | "opinion" | "report")
        ) {
            continue;
        }
        let Some(references) = map.get_mut("object_refs").and_then(Value::as_array_mut) else {
            continue;
        };
        for reference in references {
            if reference.as_str().is_some_and(|value| {
                value.starts_with("relationship--") || value.starts_with("sighting--")
            }) {
                // rstix 0.20 incorrectly excludes SROs from these object_refs even though the
                // official OASIS APT1 Report references Relationship objects. Only the validation
                // copy is normalized; the imported JSON remains byte-semantic and unchanged.
                *reference =
                    Value::String("identity--00000000-0000-4000-8000-000000000000".to_owned());
            }
        }
    }
    validation_value
}

fn required_stix_id(
    map: &Map<String, Value>,
    property: &str,
    expected_type: Option<&str>,
) -> Result<String, StixError> {
    let value = map
        .get(property)
        .and_then(Value::as_str)
        .ok_or_else(|| StixError::new(StixErrorCode::InvalidBundle))?;
    let id = StixId::parse(value).map_err(|_| StixError::new(StixErrorCode::ValidationFailed))?;
    if expected_type.is_some_and(|object_type| id.type_name() != object_type) {
        return Err(StixError::new(StixErrorCode::ValidationFailed));
    }
    Ok(value.to_owned())
}

fn validate_value_limits(value: &Value, depth: usize) -> Result<(), StixError> {
    if depth > MAX_NESTING_DEPTH {
        return Err(StixError::new(StixErrorCode::LimitExceeded));
    }
    match value {
        Value::String(value) if value.len() > MAX_STRING_LENGTH => {
            Err(StixError::new(StixErrorCode::LimitExceeded))
        }
        Value::Array(values) => {
            for value in values {
                validate_value_limits(value, depth + 1)?;
            }
            Ok(())
        }
        Value::Object(values) => {
            for value in values.values() {
                validate_value_limits(value, depth + 1)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn parse_single_object(raw: Value) -> Result<ParsedStixObject, StixError> {
    let bytes = serde_json::to_vec(&json!({
        "type": "bundle",
        "id": "bundle--00000000-0000-4000-8000-000000000000",
        "objects": [raw]
    }))
    .map_err(|_| StixError::new(StixErrorCode::InvalidJson))?;
    parse_bundle(&bytes)?
        .objects
        .into_iter()
        .next()
        .ok_or_else(|| StixError::new(StixErrorCode::InvalidBundle))
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ExistingStixObject {
    local_id: LocalId,
    object: ParsedStixObject,
}

impl ExistingStixObject {
    pub fn new(local_id: LocalId, raw: Value) -> Result<Self, StixError> {
        Ok(Self {
            local_id,
            object: parse_single_object(raw)?,
        })
    }

    #[must_use]
    pub const fn local_id(&self) -> LocalId {
        self.local_id
    }

    #[must_use]
    pub const fn raw(&self) -> &Value {
        self.object.raw()
    }

    #[must_use]
    pub fn stix_id(&self) -> &str {
        self.object.stix_id()
    }

    #[must_use]
    pub fn object_type(&self) -> &str {
        self.object.object_type()
    }

    #[must_use]
    pub fn modified(&self) -> Option<&str> {
        self.object.modified()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DuplicateDecision {
    KeepExisting,
    ReplaceVersion,
    MergeSupportedFields,
    Cancel,
}

#[derive(Debug, Clone)]
pub struct ImportPreview {
    bundle: ParsedBundle,
    duplicate_existing_indexes: Vec<Option<usize>>,
    existing: Vec<ExistingStixObject>,
    duplicate_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateStixObject {
    stix_id: String,
    object_type: String,
    modified: Option<String>,
}

impl DuplicateStixObject {
    #[must_use]
    pub fn stix_id(&self) -> &str {
        &self.stix_id
    }

    #[must_use]
    pub fn object_type(&self) -> &str {
        &self.object_type
    }

    #[must_use]
    pub fn modified(&self) -> Option<&str> {
        self.modified.as_deref()
    }
}

impl ImportPreview {
    #[must_use]
    pub const fn duplicates(&self) -> usize {
        self.duplicate_count
    }

    #[must_use]
    pub fn object_count(&self) -> usize {
        self.bundle.objects.len()
    }

    #[must_use]
    pub fn duplicate_objects(&self) -> Vec<DuplicateStixObject> {
        self.bundle
            .objects
            .iter()
            .zip(&self.duplicate_existing_indexes)
            .filter_map(|(object, duplicate)| {
                duplicate.map(|_| DuplicateStixObject {
                    stix_id: object.stix_id.clone(),
                    object_type: object.object_type.clone(),
                    modified: object.modified.clone(),
                })
            })
            .collect()
    }
}

pub fn preview_import(
    bundle: ParsedBundle,
    existing: &[ExistingStixObject],
) -> Result<ImportPreview, StixError> {
    let mut duplicate_count = 0;
    let duplicate_existing_indexes = bundle
        .objects
        .iter()
        .map(|incoming| {
            let duplicate = existing.iter().position(|candidate| {
                candidate.object.stix_id == incoming.stix_id
                    && candidate.object.modified == incoming.modified
            });
            if duplicate.is_some() {
                duplicate_count += 1;
            }
            duplicate
        })
        .collect();

    Ok(ImportPreview {
        bundle,
        duplicate_existing_indexes,
        existing: existing.to_vec(),
        duplicate_count,
    })
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ImportedStixObject {
    local_id: LocalId,
    raw: Value,
}

impl ImportedStixObject {
    #[must_use]
    pub const fn local_id(&self) -> LocalId {
        self.local_id
    }

    #[must_use]
    pub const fn raw(&self) -> &Value {
        &self.raw
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ImportCommit {
    upserts: Vec<ImportedStixObject>,
    skipped: usize,
}

impl ImportCommit {
    #[must_use]
    pub fn upserts(&self) -> &[ImportedStixObject] {
        &self.upserts
    }

    #[must_use]
    pub const fn skipped(&self) -> usize {
        self.skipped
    }
}

pub fn commit_import(
    preview: &ImportPreview,
    decisions: &[DuplicateDecision],
) -> Result<ImportCommit, StixError> {
    if decisions.len() != preview.duplicate_count {
        return Err(StixError::new(StixErrorCode::DuplicateDecisionRequired));
    }
    if decisions.contains(&DuplicateDecision::Cancel) {
        return Err(StixError::new(StixErrorCode::Cancelled));
    }

    let mut decision_index = 0;
    let mut skipped = 0;
    let mut upserts = Vec::with_capacity(preview.bundle.objects.len());
    for (incoming, existing_index) in preview
        .bundle
        .objects
        .iter()
        .zip(&preview.duplicate_existing_indexes)
    {
        let Some(existing_index) = existing_index else {
            upserts.push(ImportedStixObject {
                local_id: LocalId::from_uuid(Uuid::new_v4()),
                raw: incoming.raw.clone(),
            });
            continue;
        };

        let existing = &preview.existing[*existing_index];
        let decision = decisions[decision_index];
        decision_index += 1;
        match decision {
            DuplicateDecision::KeepExisting => skipped += 1,
            DuplicateDecision::ReplaceVersion => upserts.push(ImportedStixObject {
                local_id: existing.local_id,
                raw: incoming.raw.clone(),
            }),
            DuplicateDecision::MergeSupportedFields => {
                let raw = merge_custom_properties(existing.raw(), &incoming.raw)?;
                parse_single_object(raw.clone())?;
                upserts.push(ImportedStixObject {
                    local_id: existing.local_id,
                    raw,
                });
            }
            DuplicateDecision::Cancel => unreachable!("cancel is handled before commit"),
        }
    }

    Ok(ImportCommit { upserts, skipped })
}

fn merge_custom_properties(existing: &Value, incoming: &Value) -> Result<Value, StixError> {
    let mut merged = incoming
        .as_object()
        .cloned()
        .ok_or_else(|| StixError::new(StixErrorCode::InvalidBundle))?;
    let existing = existing
        .as_object()
        .ok_or_else(|| StixError::new(StixErrorCode::InvalidBundle))?;
    for (name, value) in existing {
        if name.starts_with("x_") {
            merged.entry(name.clone()).or_insert_with(|| value.clone());
        }
    }
    Ok(Value::Object(merged))
}

#[derive(Debug, Clone, PartialEq)]
pub struct StixDraft {
    local_id: LocalId,
    object_type: String,
    properties: Map<String, Value>,
    semantic_relationship: Option<SemanticRelationshipDraft>,
    replaces_stix_id: Option<String>,
}

impl StixDraft {
    pub fn new(
        local_id: LocalId,
        object_type: impl Into<String>,
        properties: Value,
    ) -> Result<Self, StixError> {
        let object_type = object_type.into();
        if !is_valid_draft_type(&object_type) || object_type == "relationship" {
            return Err(StixError::new(StixErrorCode::InvalidDraft));
        }
        let properties = validated_draft_properties(properties, &[])?;
        Ok(Self {
            local_id,
            object_type,
            properties,
            semantic_relationship: None,
            replaces_stix_id: None,
        })
    }

    pub fn new_relationship(
        local_id: LocalId,
        relationship: SemanticRelationshipDraft,
        properties: Value,
    ) -> Result<Self, StixError> {
        let properties = validated_draft_properties(
            properties,
            &["relationship_type", "source_ref", "target_ref"],
        )?;
        Ok(Self {
            local_id,
            object_type: "relationship".to_owned(),
            properties,
            semantic_relationship: Some(relationship),
            replaces_stix_id: None,
        })
    }

    pub fn new_revision(
        existing: &ExistingStixObject,
        properties: Value,
        semantic_relationship: Option<SemanticRelationshipDraft>,
    ) -> Result<Self, StixError> {
        if existing.modified().is_none() {
            return Err(StixError::new(StixErrorCode::InvalidDraft));
        }
        let mut draft = match (existing.object_type(), semantic_relationship) {
            ("relationship", Some(relationship)) => {
                Self::new_relationship(existing.local_id(), relationship, properties)?
            }
            ("relationship", None) | (_, Some(_)) => {
                return Err(StixError::new(StixErrorCode::InvalidDraft));
            }
            (object_type, None) => Self::new(existing.local_id(), object_type, properties)?,
        };
        draft.set_replacement(existing.stix_id())?;
        Ok(draft)
    }

    pub fn restore(
        local_id: LocalId,
        object_type: impl Into<String>,
        properties: Value,
        semantic_relationship: Option<SemanticRelationshipDraft>,
        replaces_stix_id: Option<String>,
    ) -> Result<Self, StixError> {
        let object_type = object_type.into();
        let mut draft = match (object_type.as_str(), semantic_relationship) {
            ("relationship", Some(relationship)) => {
                Self::new_relationship(local_id, relationship, properties)?
            }
            ("relationship", None) | (_, Some(_)) => {
                return Err(StixError::new(StixErrorCode::InvalidDraft));
            }
            (_, None) => Self::new(local_id, object_type, properties)?,
        };
        if let Some(stix_id) = replaces_stix_id {
            draft.set_replacement(&stix_id)?;
        }
        Ok(draft)
    }

    pub fn updated(
        &self,
        object_type: impl Into<String>,
        properties: Value,
        semantic_relationship: Option<SemanticRelationshipDraft>,
    ) -> Result<Self, StixError> {
        let object_type = object_type.into();
        if self.replaces_stix_id.is_some() && object_type != self.object_type {
            return Err(StixError::new(StixErrorCode::InvalidDraft));
        }
        Self::restore(
            self.local_id,
            object_type,
            properties,
            semantic_relationship,
            self.replaces_stix_id.clone(),
        )
    }

    fn set_replacement(&mut self, stix_id: &str) -> Result<(), StixError> {
        let parsed =
            StixId::parse(stix_id).map_err(|_| StixError::new(StixErrorCode::InvalidDraft))?;
        if parsed.type_name() != self.object_type || !self.properties.contains_key("modified") {
            return Err(StixError::new(StixErrorCode::InvalidDraft));
        }
        self.replaces_stix_id = Some(stix_id.to_owned());
        Ok(())
    }

    #[must_use]
    pub const fn local_id(&self) -> LocalId {
        self.local_id
    }

    #[must_use]
    pub fn object_type(&self) -> &str {
        &self.object_type
    }

    #[must_use]
    pub const fn properties(&self) -> &Map<String, Value> {
        &self.properties
    }

    #[must_use]
    pub const fn semantic_relationship(&self) -> Option<&SemanticRelationshipDraft> {
        self.semantic_relationship.as_ref()
    }

    #[must_use]
    pub fn replaces_stix_id(&self) -> Option<&str> {
        self.replaces_stix_id.as_deref()
    }
}

fn validated_draft_properties(
    properties: Value,
    additional_reserved: &[&str],
) -> Result<Map<String, Value>, StixError> {
    let properties = properties
        .as_object()
        .cloned()
        .ok_or_else(|| StixError::new(StixErrorCode::InvalidDraft))?;
    if ["type", "id", "spec_version"]
        .iter()
        .chain(additional_reserved)
        .any(|reserved| properties.contains_key(*reserved))
    {
        return Err(StixError::new(StixErrorCode::InvalidDraft));
    }
    validate_value_limits(&Value::Object(properties.clone()), 0)?;
    Ok(properties)
}

fn is_valid_draft_type(object_type: &str) -> bool {
    BUILT_IN_OBJECT_TYPES.contains(&object_type)
        || object_type
            .strip_prefix("x-")
            .is_some_and(|suffix| !suffix.is_empty())
}

#[derive(Debug, Clone)]
pub struct ExportPreview {
    drafts: Vec<StixDraft>,
}

impl ExportPreview {
    #[must_use]
    pub fn object_count(&self) -> usize {
        self.drafts.len()
    }
}

pub fn preview_draft_export(drafts: &[StixDraft]) -> Result<ExportPreview, StixError> {
    if drafts.is_empty() || drafts.len() > MAX_OBJECT_COUNT {
        return Err(StixError::new(StixErrorCode::InvalidDraft));
    }

    let ids = preview_draft_ids(drafts)?;
    let objects = drafts
        .iter()
        .map(|draft| {
            draft_object(
                draft,
                ids.get(&draft.local_id)
                    .cloned()
                    .ok_or_else(|| StixError::new(StixErrorCode::InvalidDraft))?,
                &ids,
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    validate_export_objects(objects)?;

    Ok(ExportPreview {
        drafts: drafts.to_vec(),
    })
}

fn preview_draft_ids(drafts: &[StixDraft]) -> Result<HashMap<LocalId, String>, StixError> {
    drafts
        .iter()
        .map(|draft| Ok((draft.local_id, generated_draft_stix_id(draft)?)))
        .collect()
}

fn generated_draft_stix_id(draft: &StixDraft) -> Result<String, StixError> {
    if let Some(stix_id) = draft.replaces_stix_id() {
        return Ok(stix_id.to_owned());
    }
    let Some(sco_kind) = ScoKind::from_type_str(&draft.object_type) else {
        return Ok(StixId::generate(&draft.object_type).to_string());
    };
    generate_sco_id(sco_kind, &Value::Object(draft.properties.clone()))
        .map(|id| id.to_string())
        .map_err(|_| StixError::new(StixErrorCode::InvalidDraft))
}

fn draft_object(
    draft: &StixDraft,
    stix_id: String,
    ids: &HashMap<LocalId, String>,
) -> Result<Value, StixError> {
    let mut object = draft.properties.clone();
    object.insert("type".to_owned(), Value::String(draft.object_type.clone()));
    object.insert("spec_version".to_owned(), Value::String("2.1".to_owned()));
    object.insert("id".to_owned(), Value::String(stix_id));
    if let Some(relationship) = draft.semantic_relationship() {
        let source_ref = ids
            .get(&relationship.source_id())
            .ok_or_else(|| StixError::new(StixErrorCode::InvalidDraft))?;
        let target_ref = ids
            .get(&relationship.target_id())
            .ok_or_else(|| StixError::new(StixErrorCode::InvalidDraft))?;
        object.insert(
            "relationship_type".to_owned(),
            Value::String(relationship.relationship_type().to_owned()),
        );
        object.insert("source_ref".to_owned(), Value::String(source_ref.clone()));
        object.insert("target_ref".to_owned(), Value::String(target_ref.clone()));
    }
    Ok(Value::Object(object))
}

fn validate_export_objects(objects: Vec<Value>) -> Result<(), StixError> {
    let bytes = serde_json::to_vec(&json!({
        "type": "bundle",
        "id": "bundle--00000000-0000-4000-8000-000000000000",
        "objects": objects,
    }))
    .map_err(|_| StixError::new(StixErrorCode::InvalidDraft))?;
    parse_bundle(&bytes)
        .map(|_| ())
        .map_err(|error| match error.code() {
            StixErrorCode::LimitExceeded => error,
            _ => StixError::new(StixErrorCode::InvalidDraft),
        })
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GeneratedStixId {
    local_id: LocalId,
    stix_id: String,
}

impl GeneratedStixId {
    #[must_use]
    pub const fn local_id(&self) -> LocalId {
        self.local_id
    }

    #[must_use]
    pub fn stix_id(&self) -> &str {
        &self.stix_id
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CommittedExport {
    bytes: Vec<u8>,
    generated_ids: Vec<GeneratedStixId>,
}

impl CommittedExport {
    #[must_use]
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    #[must_use]
    pub fn generated_ids(&self) -> &[GeneratedStixId] {
        &self.generated_ids
    }

    pub fn generated_objects(&self) -> Result<Vec<ExistingStixObject>, StixError> {
        let bundle = parse_bundle(&self.bytes)?;
        self.generated_ids
            .iter()
            .map(|generated| {
                let object = bundle
                    .objects()
                    .iter()
                    .find(|object| object.stix_id() == generated.stix_id())
                    .ok_or_else(|| StixError::new(StixErrorCode::InvalidBundle))?;
                ExistingStixObject::new(generated.local_id(), object.raw().clone())
            })
            .collect()
    }
}

pub fn commit_draft_export(preview: &ExportPreview) -> Result<CommittedExport, StixError> {
    let generated_ids = preview
        .drafts
        .iter()
        .map(|draft| {
            Ok(GeneratedStixId {
                local_id: draft.local_id,
                stix_id: generated_draft_stix_id(draft)?,
            })
        })
        .collect::<Result<Vec<_>, StixError>>()?;
    let ids = generated_ids
        .iter()
        .map(|generated| (generated.local_id, generated.stix_id.clone()))
        .collect::<HashMap<_, _>>();
    let objects = preview
        .drafts
        .iter()
        .zip(&generated_ids)
        .map(|(draft, generated)| draft_object(draft, generated.stix_id.clone(), &ids))
        .collect::<Result<Vec<_>, _>>()?;
    let value = json!({
        "type": "bundle",
        "id": StixId::generate("bundle").to_string(),
        "objects": objects,
    });
    let bytes = serde_json::to_vec_pretty(&value)
        .map_err(|_| StixError::new(StixErrorCode::InvalidDraft))?;
    parse_bundle(&bytes)?;
    Ok(CommittedExport {
        bytes,
        generated_ids,
    })
}

#[derive(Debug, Clone)]
pub struct ExistingExportPreview {
    objects: Vec<ExistingStixObject>,
}

impl ExistingExportPreview {
    #[must_use]
    pub fn object_count(&self) -> usize {
        self.objects.len()
    }
}

pub fn preview_existing_export(
    objects: &[ExistingStixObject],
) -> Result<ExistingExportPreview, StixError> {
    if objects.is_empty() || objects.len() > MAX_OBJECT_COUNT {
        return Err(StixError::new(StixErrorCode::InvalidBundle));
    }
    validate_export_objects(objects.iter().map(|object| object.raw().clone()).collect())?;
    Ok(ExistingExportPreview {
        objects: objects.to_vec(),
    })
}

pub fn commit_existing_export(
    preview: &ExistingExportPreview,
) -> Result<CommittedExport, StixError> {
    let value = json!({
        "type": "bundle",
        "id": StixId::generate("bundle").to_string(),
        "objects": preview
            .objects
            .iter()
            .map(|object| object.raw().clone())
            .collect::<Vec<_>>(),
    });
    let bytes = serde_json::to_vec_pretty(&value)
        .map_err(|_| StixError::new(StixErrorCode::InvalidBundle))?;
    parse_bundle(&bytes)?;
    Ok(CommittedExport {
        bytes,
        generated_ids: Vec::new(),
    })
}

#[derive(Debug, Clone)]
pub struct ProjectExportPreview {
    existing: Vec<ExistingStixObject>,
    drafts: Vec<StixDraft>,
}

impl ProjectExportPreview {
    #[must_use]
    pub fn object_count(&self) -> usize {
        self.existing.len() + self.drafts.len()
    }
}

pub fn preview_project_export(
    existing: &[ExistingStixObject],
    drafts: &[StixDraft],
) -> Result<ProjectExportPreview, StixError> {
    for draft in drafts
        .iter()
        .filter(|draft| draft.replaces_stix_id().is_some())
    {
        let replaced = existing
            .iter()
            .find(|object| object.local_id() == draft.local_id())
            .ok_or_else(|| StixError::new(StixErrorCode::InvalidDraft))?;
        if Some(replaced.stix_id()) != draft.replaces_stix_id()
            || draft
                .properties()
                .get("modified")
                .and_then(Value::as_str)
                .zip(replaced.modified())
                .is_none_or(|(revised, committed)| revised <= committed)
        {
            return Err(StixError::new(StixErrorCode::InvalidDraft));
        }
    }
    let existing = existing
        .iter()
        .filter(|object| {
            !drafts.iter().any(|draft| {
                draft.replaces_stix_id().is_some() && draft.local_id() == object.local_id()
            })
        })
        .cloned()
        .collect::<Vec<_>>();
    let object_count = existing.len().saturating_add(drafts.len());
    if object_count == 0 || object_count > MAX_OBJECT_COUNT {
        return Err(StixError::new(StixErrorCode::InvalidBundle));
    }
    let mut ids = existing
        .iter()
        .map(|object| (object.local_id(), object.stix_id().to_owned()))
        .collect::<HashMap<_, _>>();
    ids.extend(preview_draft_ids(drafts)?);
    let mut objects = existing
        .iter()
        .map(|object| object.raw().clone())
        .collect::<Vec<_>>();
    objects.extend(
        drafts
            .iter()
            .map(|draft| {
                draft_object(
                    draft,
                    ids.get(&draft.local_id)
                        .cloned()
                        .ok_or_else(|| StixError::new(StixErrorCode::InvalidDraft))?,
                    &ids,
                )
            })
            .collect::<Result<Vec<_>, _>>()?,
    );
    validate_export_objects(objects)?;
    Ok(ProjectExportPreview {
        existing,
        drafts: drafts.to_vec(),
    })
}

pub fn commit_project_export(preview: &ProjectExportPreview) -> Result<CommittedExport, StixError> {
    let generated_ids = preview
        .drafts
        .iter()
        .map(|draft| {
            Ok(GeneratedStixId {
                local_id: draft.local_id,
                stix_id: generated_draft_stix_id(draft)?,
            })
        })
        .collect::<Result<Vec<_>, StixError>>()?;
    let mut ids = preview
        .existing
        .iter()
        .map(|object| (object.local_id(), object.stix_id().to_owned()))
        .collect::<HashMap<_, _>>();
    ids.extend(
        generated_ids
            .iter()
            .map(|generated| (generated.local_id, generated.stix_id.clone())),
    );
    let mut objects = preview
        .existing
        .iter()
        .map(|object| object.raw().clone())
        .collect::<Vec<_>>();
    objects.extend(
        preview
            .drafts
            .iter()
            .zip(&generated_ids)
            .map(|(draft, generated)| draft_object(draft, generated.stix_id.clone(), &ids))
            .collect::<Result<Vec<_>, _>>()?,
    );
    let value = json!({
        "type": "bundle",
        "id": StixId::generate("bundle").to_string(),
        "objects": objects,
    });
    let bytes = serde_json::to_vec_pretty(&value)
        .map_err(|_| StixError::new(StixErrorCode::InvalidBundle))?;
    parse_bundle(&bytes)?;
    Ok(CommittedExport {
        bytes,
        generated_ids,
    })
}
