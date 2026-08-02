use std::{
    collections::{BTreeMap, HashSet},
    error::Error,
    fmt,
};

use serde::{Deserialize, Serialize};
use sheut_core::{
    AnalyticConfidence, MitreCatalog, MitreTechniqueReference, TechniqueAssessment,
    TechniqueObservation, TechniqueOutcome,
};

use crate::{CatalogSnapshot, validate_reference_in};

pub const MAX_MAPPING_FILE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_MAPPING_OBSERVATIONS: usize = 10_000;
const MAX_LAYER_NAME_CHARS: usize = 160;
const MAX_NAVIGATOR_COMMENT_CHARS: usize = 4_000;
const MAX_NAVIGATOR_ENTRIES: usize = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MappingErrorCode {
    InvalidMapping,
    InvalidNavigatorLayer,
    LimitExceeded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MappingError {
    code: MappingErrorCode,
}

impl MappingError {
    const fn new(code: MappingErrorCode) -> Self {
        Self { code }
    }

    #[must_use]
    pub const fn code(self) -> MappingErrorCode {
        self.code
    }
}

impl fmt::Display for MappingError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.code {
            MappingErrorCode::InvalidMapping => formatter.write_str("invalid_mapping"),
            MappingErrorCode::InvalidNavigatorLayer => {
                formatter.write_str("invalid_navigator_layer")
            }
            MappingErrorCode::LimitExceeded => formatter.write_str("limit_exceeded"),
        }
    }
}

impl Error for MappingError {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MappingFile {
    format: String,
    format_version: u16,
    exported_at_unix_ms: i64,
    observations: Vec<TechniqueObservation>,
}

impl MappingFile {
    #[must_use]
    pub const fn exported_at_unix_ms(&self) -> i64 {
        self.exported_at_unix_ms
    }

    #[must_use]
    pub fn observations(&self) -> &[TechniqueObservation] {
        &self.observations
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigatorImportEntry {
    reference: MitreTechniqueReference,
    comment: String,
    score: Option<f64>,
    color: Option<String>,
    enabled: bool,
}

impl NavigatorImportEntry {
    #[must_use]
    pub const fn reference(&self) -> &MitreTechniqueReference {
        &self.reference
    }

    #[must_use]
    pub fn comment(&self) -> &str {
        &self.comment
    }

    #[must_use]
    pub const fn score(&self) -> Option<f64> {
        self.score
    }

    #[must_use]
    pub const fn enabled(&self) -> bool {
        self.enabled
    }
}

#[derive(Deserialize)]
struct NavigatorDomainWire {
    domain: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigatorImportPreview {
    name: String,
    catalog: MitreCatalog,
    catalog_version: String,
    layer_version: String,
    source_attack_version: Option<String>,
    entries: Vec<NavigatorImportEntry>,
}

impl NavigatorImportPreview {
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    #[must_use]
    pub const fn catalog(&self) -> MitreCatalog {
        self.catalog
    }

    #[must_use]
    pub fn catalog_version(&self) -> &str {
        &self.catalog_version
    }

    #[must_use]
    pub fn entries(&self) -> &[NavigatorImportEntry] {
        &self.entries
    }
}

#[derive(Deserialize)]
struct NavigatorLayerWire {
    name: String,
    versions: NavigatorVersionsWire,
    domain: String,
    techniques: Vec<NavigatorTechniqueWire>,
}

#[derive(Deserialize)]
struct NavigatorVersionsWire {
    #[serde(default)]
    attack: Option<String>,
    layer: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NavigatorTechniqueWire {
    #[serde(rename = "techniqueID")]
    technique_id: String,
    #[serde(default)]
    tactic: Option<String>,
    #[serde(default)]
    comment: String,
    #[serde(default)]
    score: Option<f64>,
    #[serde(default)]
    color: Option<String>,
    #[serde(default = "default_true")]
    enabled: bool,
}

const fn default_true() -> bool {
    true
}

#[derive(Serialize)]
struct NavigatorLayerExport {
    name: String,
    versions: NavigatorVersionsExport,
    domain: &'static str,
    description: String,
    filters: NavigatorFilters,
    sorting: u8,
    layout: NavigatorLayout,
    #[serde(rename = "hideDisabled")]
    hide_disabled: bool,
    techniques: Vec<NavigatorTechniqueExport>,
}

#[derive(Serialize)]
struct NavigatorVersionsExport {
    #[serde(skip_serializing_if = "Option::is_none")]
    attack: Option<String>,
    navigator: &'static str,
    layer: &'static str,
}

#[derive(Serialize)]
struct NavigatorFilters {
    platforms: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NavigatorLayout {
    layout: &'static str,
    aggregate_function: &'static str,
    show_id: bool,
    show_name: bool,
    show_aggregate_scores: bool,
    count_unscored: bool,
}

#[derive(Serialize)]
struct NavigatorTechniqueExport {
    #[serde(rename = "techniqueID")]
    technique_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    tactic: Option<String>,
    comment: String,
    enabled: bool,
    metadata: Vec<NavigatorMetadata>,
}

#[derive(Serialize)]
struct NavigatorMetadata {
    name: String,
    value: String,
}

pub fn export_mapping_file(
    observations: &[TechniqueObservation],
    exported_at_unix_ms: i64,
) -> Result<Vec<u8>, MappingError> {
    if exported_at_unix_ms < 0 || observations.len() > MAX_MAPPING_OBSERVATIONS {
        return Err(MappingError::new(MappingErrorCode::LimitExceeded));
    }
    ensure_unique_observation_ids(observations)?;
    let mapping = MappingFile {
        format: "sheut-mitre-mapping".to_owned(),
        format_version: 1,
        exported_at_unix_ms,
        observations: observations.to_vec(),
    };
    let bytes = serde_json::to_vec_pretty(&mapping)
        .map_err(|_| MappingError::new(MappingErrorCode::InvalidMapping))?;
    if bytes.len() > MAX_MAPPING_FILE_BYTES {
        return Err(MappingError::new(MappingErrorCode::LimitExceeded));
    }
    Ok(bytes)
}

pub fn import_mapping_file(source: &[u8]) -> Result<MappingFile, MappingError> {
    if source.is_empty() || source.len() > MAX_MAPPING_FILE_BYTES {
        return Err(MappingError::new(MappingErrorCode::LimitExceeded));
    }
    let mapping: MappingFile = serde_json::from_slice(source)
        .map_err(|_| MappingError::new(MappingErrorCode::InvalidMapping))?;
    if mapping.format != "sheut-mitre-mapping"
        || mapping.format_version != 1
        || mapping.exported_at_unix_ms < 0
        || mapping.observations.len() > MAX_MAPPING_OBSERVATIONS
    {
        return Err(MappingError::new(MappingErrorCode::InvalidMapping));
    }
    ensure_unique_observation_ids(&mapping.observations)?;
    Ok(mapping)
}

pub fn export_navigator_projection(
    name: &str,
    catalog: &CatalogSnapshot,
    observations: &[TechniqueObservation],
) -> Result<Vec<u8>, MappingError> {
    let name = bounded_text(
        name,
        MAX_LAYER_NAME_CHARS,
        MappingErrorCode::InvalidNavigatorLayer,
    )?;
    let mut grouped = BTreeMap::<(String, Option<String>), Vec<&TechniqueObservation>>::new();
    for observation in observations.iter().filter(|observation| {
        observation.reference().catalog() == catalog.catalog()
            && observation.reference().version() == catalog.version()
    }) {
        validate_reference_in(catalog, observation.reference())
            .map_err(|_| MappingError::new(MappingErrorCode::InvalidMapping))?;
        grouped
            .entry((
                observation.reference().technique_id().to_owned(),
                observation.reference().tactic_id().map(str::to_owned),
            ))
            .or_default()
            .push(observation);
    }

    let mut techniques = Vec::with_capacity(grouped.len());
    for ((technique_id, tactic_id), entries) in grouped {
        let tactic = tactic_id
            .as_deref()
            .map(|id| {
                catalog
                    .tactics()
                    .iter()
                    .find(|tactic| tactic.id() == id)
                    .map(|tactic| tactic.short_name().to_owned())
                    .ok_or_else(|| MappingError::new(MappingErrorCode::InvalidMapping))
            })
            .transpose()?;
        let enabled = entries
            .iter()
            .any(|entry| entry.assessment() != TechniqueAssessment::RuledOut);
        let comment = navigator_comment(&entries);
        techniques.push(NavigatorTechniqueExport {
            technique_id,
            tactic,
            comment,
            enabled,
            metadata: vec![
                NavigatorMetadata {
                    name: "Sheut observations".to_owned(),
                    value: entries.len().to_string(),
                },
                NavigatorMetadata {
                    name: "Sheut catalog version".to_owned(),
                    value: catalog.version().to_owned(),
                },
            ],
        });
    }

    let (domain, layer, attack) = navigator_identity(catalog.catalog(), catalog.version());
    let document = NavigatorLayerExport {
        name,
        versions: NavigatorVersionsExport {
            attack,
            navigator: "5.3.2",
            layer,
        },
        domain,
        description: "A compatible projection of Sheut observations. The lossless Sheut mapping file remains authoritative.".to_owned(),
        filters: NavigatorFilters { platforms: vec![] },
        sorting: 0,
        layout: NavigatorLayout {
            layout: "side",
            aggregate_function: "average",
            show_id: false,
            show_name: true,
            show_aggregate_scores: false,
            count_unscored: false,
        },
        hide_disabled: false,
        techniques,
    };
    let bytes = serde_json::to_vec_pretty(&document)
        .map_err(|_| MappingError::new(MappingErrorCode::InvalidNavigatorLayer))?;
    if bytes.len() > MAX_MAPPING_FILE_BYTES {
        return Err(MappingError::new(MappingErrorCode::LimitExceeded));
    }
    Ok(bytes)
}

pub fn preview_navigator_import(
    source: &[u8],
    catalog: &CatalogSnapshot,
) -> Result<NavigatorImportPreview, MappingError> {
    if source.is_empty() || source.len() > MAX_MAPPING_FILE_BYTES {
        return Err(MappingError::new(MappingErrorCode::LimitExceeded));
    }
    let layer: NavigatorLayerWire = serde_json::from_slice(source)
        .map_err(|_| MappingError::new(MappingErrorCode::InvalidNavigatorLayer))?;
    let name = bounded_text(
        &layer.name,
        MAX_LAYER_NAME_CHARS,
        MappingErrorCode::InvalidNavigatorLayer,
    )?;
    let (expected_domain, expected_layer, _) =
        navigator_identity(catalog.catalog(), catalog.version());
    if layer.domain != expected_domain
        || layer.versions.layer != expected_layer
        || layer.techniques.len() > MAX_NAVIGATOR_ENTRIES
    {
        return Err(MappingError::new(MappingErrorCode::InvalidNavigatorLayer));
    }

    let mut seen = HashSet::with_capacity(layer.techniques.len());
    let mut entries = Vec::with_capacity(layer.techniques.len());
    for entry in layer.techniques {
        let tactic_id = entry
            .tactic
            .as_deref()
            .map(|short_name| {
                catalog
                    .tactics()
                    .iter()
                    .find(|tactic| tactic.short_name() == short_name)
                    .map(|tactic| tactic.id().to_owned())
                    .ok_or_else(|| MappingError::new(MappingErrorCode::InvalidNavigatorLayer))
            })
            .transpose()?;
        let reference = MitreTechniqueReference::new(
            catalog.catalog(),
            catalog.version(),
            &entry.technique_id,
            tactic_id.as_deref(),
        )
        .map_err(|_| MappingError::new(MappingErrorCode::InvalidNavigatorLayer))?;
        validate_reference_in(catalog, &reference)
            .map_err(|_| MappingError::new(MappingErrorCode::InvalidNavigatorLayer))?;
        let key = (
            reference.technique_id().to_owned(),
            reference.tactic_id().map(str::to_owned),
        );
        if !seen.insert(key) {
            return Err(MappingError::new(MappingErrorCode::InvalidNavigatorLayer));
        }
        let comment = optional_bounded_text(&entry.comment, MAX_NAVIGATOR_COMMENT_CHARS)?;
        let color = entry.color.map(validate_color).transpose()?;
        entries.push(NavigatorImportEntry {
            reference,
            comment,
            score: entry.score,
            color,
            enabled: entry.enabled,
        });
    }
    Ok(NavigatorImportPreview {
        name,
        catalog: catalog.catalog(),
        catalog_version: catalog.version().to_owned(),
        layer_version: layer.versions.layer,
        source_attack_version: layer.versions.attack,
        entries,
    })
}

pub fn navigator_catalog_from_source(source: &[u8]) -> Result<MitreCatalog, MappingError> {
    if source.is_empty() || source.len() > MAX_MAPPING_FILE_BYTES {
        return Err(MappingError::new(MappingErrorCode::LimitExceeded));
    }
    let layer: NavigatorDomainWire = serde_json::from_slice(source)
        .map_err(|_| MappingError::new(MappingErrorCode::InvalidNavigatorLayer))?;
    match layer.domain.as_str() {
        "enterprise-attack" => Ok(MitreCatalog::AttackEnterprise),
        "mobile-attack" => Ok(MitreCatalog::AttackMobile),
        "ics-attack" => Ok(MitreCatalog::AttackIcs),
        "atlas-atlas" => Ok(MitreCatalog::Atlas),
        _ => Err(MappingError::new(MappingErrorCode::InvalidNavigatorLayer)),
    }
}

fn ensure_unique_observation_ids(
    observations: &[TechniqueObservation],
) -> Result<(), MappingError> {
    let mut ids = HashSet::with_capacity(observations.len());
    if observations.iter().all(|item| ids.insert(item.id())) {
        Ok(())
    } else {
        Err(MappingError::new(MappingErrorCode::InvalidMapping))
    }
}

fn navigator_identity(
    catalog: MitreCatalog,
    version: &str,
) -> (&'static str, &'static str, Option<String>) {
    match catalog {
        MitreCatalog::AttackEnterprise => (
            "enterprise-attack",
            "4.5",
            Some(version.split('.').next().unwrap_or(version).to_owned()),
        ),
        MitreCatalog::AttackMobile => (
            "mobile-attack",
            "4.5",
            Some(version.split('.').next().unwrap_or(version).to_owned()),
        ),
        MitreCatalog::AttackIcs => (
            "ics-attack",
            "4.5",
            Some(version.split('.').next().unwrap_or(version).to_owned()),
        ),
        MitreCatalog::Atlas => ("atlas-atlas", "4.3", None),
    }
}

fn navigator_comment(entries: &[&TechniqueObservation]) -> String {
    if let [entry] = entries {
        return entry.narrative().to_owned();
    }
    let combined = entries
        .iter()
        .map(|entry| {
            format!(
                "[{} / {} / {}]\n{}",
                assessment_name(entry.assessment()),
                outcome_name(entry.outcome()),
                confidence_name(entry.confidence()),
                entry.narrative()
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    if combined.chars().count() <= MAX_NAVIGATOR_COMMENT_CHARS {
        return combined;
    }
    const SUFFIX: &str =
        "\n\n[Additional observations omitted; use the lossless Sheut mapping file.]";
    let prefix_chars = MAX_NAVIGATOR_COMMENT_CHARS.saturating_sub(SUFFIX.chars().count());
    format!(
        "{}{}",
        combined.chars().take(prefix_chars).collect::<String>(),
        SUFFIX
    )
}

const fn assessment_name(value: TechniqueAssessment) -> &'static str {
    match value {
        TechniqueAssessment::Observed => "observed",
        TechniqueAssessment::Suspected => "suspected",
        TechniqueAssessment::RuledOut => "ruled out",
    }
}

const fn outcome_name(value: TechniqueOutcome) -> &'static str {
    match value {
        TechniqueOutcome::Unknown => "unknown",
        TechniqueOutcome::Attempted => "attempted",
        TechniqueOutcome::Successful => "successful",
        TechniqueOutcome::Prevented => "prevented",
    }
}

const fn confidence_name(value: AnalyticConfidence) -> &'static str {
    match value {
        AnalyticConfidence::Low => "low confidence",
        AnalyticConfidence::Medium => "medium confidence",
        AnalyticConfidence::High => "high confidence",
    }
}

fn bounded_text(
    value: &str,
    max_chars: usize,
    code: MappingErrorCode,
) -> Result<String, MappingError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max_chars || value.chars().any(char::is_control)
    {
        return Err(MappingError::new(code));
    }
    Ok(value.to_owned())
}

fn optional_bounded_text(value: &str, max_chars: usize) -> Result<String, MappingError> {
    let value = value.trim();
    if value.chars().count() > max_chars
        || value
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        return Err(MappingError::new(MappingErrorCode::InvalidNavigatorLayer));
    }
    Ok(value.replace("\r\n", "\n").replace('\r', "\n"))
}

fn validate_color(value: String) -> Result<String, MappingError> {
    let valid = value.len() == 7
        && value.starts_with('#')
        && value[1..].bytes().all(|byte| byte.is_ascii_hexdigit());
    if valid {
        Ok(value)
    } else {
        Err(MappingError::new(MappingErrorCode::InvalidNavigatorLayer))
    }
}
