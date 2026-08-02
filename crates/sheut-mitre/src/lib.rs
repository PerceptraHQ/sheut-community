#![forbid(unsafe_code)]

//! Offline MITRE catalog snapshots plus bounded mapping and update interchange.
//! Project observations remain encrypted separately from these read-only public catalogs.

mod interchange;
mod updates;

use std::{error::Error, fmt, sync::LazyLock};

use serde::{Deserialize, Serialize};
use sheut_core::{MitreCatalog, MitreTechniqueReference};

pub use interchange::{
    MAX_MAPPING_FILE_BYTES, MAX_MAPPING_OBSERVATIONS, MappingError, MappingErrorCode, MappingFile,
    NavigatorImportEntry, NavigatorImportPreview, export_mapping_file, export_navigator_projection,
    import_mapping_file, navigator_catalog_from_source, preview_navigator_import,
};
pub use updates::{
    CatalogOrigin, CatalogStatus, CatalogStore, MAX_MITRE_SOURCE_BYTES, compile_official_catalog,
};

const ENTERPRISE_JSON: &str = include_str!("../catalogs/attack-enterprise-19.1.json");
const MOBILE_JSON: &str = include_str!("../catalogs/attack-mobile-19.1.json");
const ICS_JSON: &str = include_str!("../catalogs/attack-ics-19.1.json");
const ATLAS_JSON: &str = include_str!("../catalogs/atlas-2026.06.json");

static ENTERPRISE: LazyLock<Result<CatalogSnapshot, MitreCatalogError>> =
    LazyLock::new(|| parse_catalog(ENTERPRISE_JSON, MitreCatalog::AttackEnterprise, "19.1"));
static MOBILE: LazyLock<Result<CatalogSnapshot, MitreCatalogError>> =
    LazyLock::new(|| parse_catalog(MOBILE_JSON, MitreCatalog::AttackMobile, "19.1"));
static ICS: LazyLock<Result<CatalogSnapshot, MitreCatalogError>> =
    LazyLock::new(|| parse_catalog(ICS_JSON, MitreCatalog::AttackIcs, "19.1"));
static ATLAS: LazyLock<Result<CatalogSnapshot, MitreCatalogError>> =
    LazyLock::new(|| parse_catalog(ATLAS_JSON, MitreCatalog::Atlas, "2026.06"));

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MitreCatalogErrorCode {
    InvalidCatalog,
    ReferenceUnavailable,
    LimitExceeded,
    StorageUnavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MitreCatalogError {
    code: MitreCatalogErrorCode,
}

impl MitreCatalogError {
    const fn new(code: MitreCatalogErrorCode) -> Self {
        Self { code }
    }

    #[must_use]
    pub const fn code(self) -> MitreCatalogErrorCode {
        self.code
    }
}

impl fmt::Display for MitreCatalogError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.code {
            MitreCatalogErrorCode::InvalidCatalog => formatter.write_str("invalid_catalog"),
            MitreCatalogErrorCode::ReferenceUnavailable => {
                formatter.write_str("reference_unavailable")
            }
            MitreCatalogErrorCode::LimitExceeded => formatter.write_str("limit_exceeded"),
            MitreCatalogErrorCode::StorageUnavailable => formatter.write_str("storage_unavailable"),
        }
    }
}

impl Error for MitreCatalogError {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSource {
    url: String,
    sha256: String,
}

impl CatalogSource {
    #[must_use]
    pub fn url(&self) -> &str {
        &self.url
    }

    #[must_use]
    pub fn sha256(&self) -> &str {
        &self.sha256
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogTactic {
    id: String,
    name: String,
    short_name: String,
    description: String,
}

impl CatalogTactic {
    #[must_use]
    pub fn id(&self) -> &str {
        &self.id
    }

    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    #[must_use]
    pub fn short_name(&self) -> &str {
        &self.short_name
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogTechnique {
    id: String,
    name: String,
    description: String,
    tactic_ids: Vec<String>,
    platforms: Vec<String>,
    parent_id: Option<String>,
}

impl CatalogTechnique {
    #[must_use]
    pub fn id(&self) -> &str {
        &self.id
    }

    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    #[must_use]
    pub fn tactic_ids(&self) -> &[String] {
        &self.tactic_ids
    }

    #[must_use]
    pub fn parent_id(&self) -> Option<&str> {
        self.parent_id.as_deref()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSnapshot {
    schema_version: u16,
    catalog: MitreCatalog,
    version: String,
    source: CatalogSource,
    tactics: Vec<CatalogTactic>,
    techniques: Vec<CatalogTechnique>,
}

impl CatalogSnapshot {
    #[must_use]
    pub const fn catalog(&self) -> MitreCatalog {
        self.catalog
    }

    #[must_use]
    pub fn version(&self) -> &str {
        &self.version
    }

    #[must_use]
    pub const fn source(&self) -> &CatalogSource {
        &self.source
    }

    #[must_use]
    pub fn tactics(&self) -> &[CatalogTactic] {
        &self.tactics
    }

    #[must_use]
    pub fn techniques(&self) -> &[CatalogTechnique] {
        &self.techniques
    }

    #[must_use]
    pub fn contains(&self, reference: &MitreTechniqueReference) -> bool {
        if reference.catalog() != self.catalog || reference.version() != self.version {
            return false;
        }
        self.techniques.iter().any(|technique| {
            technique.id == reference.technique_id()
                && reference
                    .tactic_id()
                    .is_none_or(|tactic_id| technique.tactic_ids.iter().any(|id| id == tactic_id))
        })
    }
}

pub fn catalog(catalog: MitreCatalog) -> Result<&'static CatalogSnapshot, MitreCatalogError> {
    let snapshot = match catalog {
        MitreCatalog::AttackEnterprise => &*ENTERPRISE,
        MitreCatalog::AttackMobile => &*MOBILE,
        MitreCatalog::AttackIcs => &*ICS,
        MitreCatalog::Atlas => &*ATLAS,
    };
    snapshot.as_ref().map_err(|error| *error)
}

pub fn validate_reference(reference: &MitreTechniqueReference) -> Result<(), MitreCatalogError> {
    validate_reference_in(catalog(reference.catalog())?, reference)
}

pub fn validate_reference_in(
    snapshot: &CatalogSnapshot,
    reference: &MitreTechniqueReference,
) -> Result<(), MitreCatalogError> {
    if snapshot.contains(reference) {
        Ok(())
    } else {
        Err(MitreCatalogError::new(
            MitreCatalogErrorCode::ReferenceUnavailable,
        ))
    }
}

fn parse_catalog(
    json: &str,
    expected_catalog: MitreCatalog,
    expected_version: &str,
) -> Result<CatalogSnapshot, MitreCatalogError> {
    let snapshot: CatalogSnapshot = serde_json::from_str(json)
        .map_err(|_| MitreCatalogError::new(MitreCatalogErrorCode::InvalidCatalog))?;
    validate_snapshot(&snapshot, expected_catalog, Some(expected_version))?;
    Ok(snapshot)
}

fn validate_snapshot(
    snapshot: &CatalogSnapshot,
    expected_catalog: MitreCatalog,
    expected_version: Option<&str>,
) -> Result<(), MitreCatalogError> {
    let valid = snapshot.schema_version == 2
        && snapshot.catalog == expected_catalog
        && expected_version.is_none_or(|version| snapshot.version == version)
        && updates::valid_version(&snapshot.version)
        && !snapshot.tactics.is_empty()
        && !snapshot.techniques.is_empty()
        && snapshot.source.sha256.len() == 64
        && snapshot
            .source
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
        && snapshot.source.url == updates::official_source_url(snapshot.catalog, &snapshot.version)
        && snapshot.tactics.len() <= updates::MAX_CATALOG_TACTICS
        && snapshot.techniques.len() <= updates::MAX_CATALOG_TECHNIQUES
        && snapshot.tactics.iter().all(|tactic| {
            !tactic.id.is_empty()
                && !tactic.name.is_empty()
                && !tactic.short_name.is_empty()
                && !tactic.description.is_empty()
        })
        && snapshot.techniques.iter().all(|technique| {
            !technique.id.is_empty()
                && !technique.name.is_empty()
                && technique
                    .tactic_ids
                    .iter()
                    .all(|id| snapshot.tactics.iter().any(|tactic| tactic.id == *id))
        });
    if !valid {
        return Err(MitreCatalogError::new(
            MitreCatalogErrorCode::InvalidCatalog,
        ));
    }
    Ok(())
}
