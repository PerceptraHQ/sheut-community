use std::{
    collections::{HashMap, HashSet},
    fmt::Write as _,
    fs::{self, OpenOptions},
    io::Write as _,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sheut_core::MitreCatalog;

use super::{
    CatalogSnapshot, CatalogSource, CatalogTactic, CatalogTechnique, MitreCatalogError,
    MitreCatalogErrorCode, catalog as bundled_catalog, validate_snapshot,
};

pub const MAX_MITRE_SOURCE_BYTES: usize = 96 * 1024 * 1024;
const MAX_COMPILED_CATALOG_BYTES: u64 = 8 * 1024 * 1024;
const MAX_SOURCE_OBJECTS: usize = 100_000;
const MAX_DIRECTORY_ENTRIES: usize = 256;
pub(super) const MAX_CATALOG_TACTICS: usize = 256;
pub(super) const MAX_CATALOG_TECHNIQUES: usize = 10_000;
static INSTALL_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CatalogOrigin {
    Bundled,
    LocalFile,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogStatus {
    catalog: MitreCatalog,
    version: String,
    origin: CatalogOrigin,
}

impl CatalogStatus {
    #[must_use]
    pub const fn catalog(&self) -> MitreCatalog {
        self.catalog
    }

    #[must_use]
    pub fn version(&self) -> &str {
        &self.version
    }

    #[must_use]
    pub const fn origin(&self) -> CatalogOrigin {
        self.origin
    }
}

#[derive(Debug, Deserialize)]
struct SourceBundle {
    #[serde(rename = "type")]
    object_type: String,
    objects: Vec<SourceObject>,
}

#[derive(Debug, Deserialize)]
struct SourceObject {
    #[serde(rename = "type")]
    object_type: String,
    id: Option<String>,
    spec_version: Option<String>,
    name: Option<String>,
    description: Option<String>,
    x_mitre_shortname: Option<String>,
    x_mitre_version: Option<String>,
    #[serde(default)]
    x_mitre_platforms: Vec<String>,
    #[serde(default)]
    revoked: bool,
    #[serde(default)]
    x_mitre_deprecated: bool,
    #[serde(default)]
    external_references: Vec<ExternalReference>,
    #[serde(default)]
    kill_chain_phases: Vec<KillChainPhase>,
    #[serde(default)]
    tactic_refs: Vec<String>,
}

impl SourceObject {
    const fn inactive(&self) -> bool {
        self.revoked || self.x_mitre_deprecated
    }

    fn is_stix_21(&self) -> bool {
        self.spec_version.as_deref() == Some("2.1")
    }
}

#[derive(Debug, Deserialize)]
struct ExternalReference {
    external_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct KillChainPhase {
    phase_name: Option<String>,
}

pub fn compile_official_catalog(payload: &[u8]) -> Result<CatalogSnapshot, MitreCatalogError> {
    if payload.is_empty() || payload.len() > MAX_MITRE_SOURCE_BYTES {
        return Err(error(MitreCatalogErrorCode::LimitExceeded));
    }
    let bundle: SourceBundle = serde_json::from_slice(payload)
        .map_err(|_| error(MitreCatalogErrorCode::InvalidCatalog))?;
    if bundle.object_type != "bundle" || bundle.objects.len() > MAX_SOURCE_OBJECTS {
        return Err(error(if bundle.objects.len() > MAX_SOURCE_OBJECTS {
            MitreCatalogErrorCode::LimitExceeded
        } else {
            MitreCatalogErrorCode::InvalidCatalog
        }));
    }

    let collections = bundle
        .objects
        .iter()
        .filter(|object| object.object_type == "x-mitre-collection" && !object.inactive())
        .collect::<Vec<_>>();
    if collections.len() != 1 || !collections[0].is_stix_21() {
        return Err(error(MitreCatalogErrorCode::InvalidCatalog));
    }
    let collection = collections[0];
    let catalog = catalog_from_collection(
        collection
            .name
            .as_deref()
            .ok_or_else(|| error(MitreCatalogErrorCode::InvalidCatalog))?,
    )?;
    let version = bounded_identifier(
        collection
            .x_mitre_version
            .as_deref()
            .ok_or_else(|| error(MitreCatalogErrorCode::InvalidCatalog))?,
        32,
    )?;
    if !valid_version(&version) {
        return Err(error(MitreCatalogErrorCode::InvalidCatalog));
    }

    let matrices = bundle
        .objects
        .iter()
        .filter(|object| object.object_type == "x-mitre-matrix" && !object.inactive())
        .collect::<Vec<_>>();
    if matrices.len() != 1
        || !matrices[0].is_stix_21()
        || matrices[0].tactic_refs.is_empty()
        || matrices[0].tactic_refs.len() > MAX_CATALOG_TACTICS
    {
        return Err(error(MitreCatalogErrorCode::InvalidCatalog));
    }
    let mut tactic_order = HashMap::new();
    for (index, reference) in matrices[0].tactic_refs.iter().enumerate() {
        let source_id = bounded_identifier(reference, 200)?;
        if tactic_order.insert(source_id, index).is_some() {
            return Err(error(MitreCatalogErrorCode::InvalidCatalog));
        }
    }

    let mut tactics = Vec::new();
    let mut tactic_ids = HashSet::new();
    let mut tactic_by_short_name = HashMap::new();
    for object in bundle
        .objects
        .iter()
        .filter(|object| object.object_type == "x-mitre-tactic" && !object.inactive())
    {
        if !object.is_stix_21() {
            return Err(error(MitreCatalogErrorCode::InvalidCatalog));
        }
        let source_id = bounded_identifier(
            object
                .id
                .as_deref()
                .ok_or_else(|| error(MitreCatalogErrorCode::InvalidCatalog))?,
            200,
        )?;
        let order = *tactic_order
            .get(&source_id)
            .ok_or_else(|| error(MitreCatalogErrorCode::InvalidCatalog))?;
        let Some(id) = external_id(object, catalog, false) else {
            continue;
        };
        if !tactic_ids.insert(id.clone()) || tactics.len() >= MAX_CATALOG_TACTICS {
            return Err(error(MitreCatalogErrorCode::InvalidCatalog));
        }
        let name = bounded_text(
            object
                .name
                .as_deref()
                .ok_or_else(|| error(MitreCatalogErrorCode::InvalidCatalog))?,
            200,
        )?;
        let short_name = bounded_identifier(
            object
                .x_mitre_shortname
                .as_deref()
                .ok_or_else(|| error(MitreCatalogErrorCode::InvalidCatalog))?,
            100,
        )?;
        let description = bounded_text(object.description.as_deref().unwrap_or(&name), 64_000)?;
        if tactic_by_short_name
            .insert(short_name.clone(), id.clone())
            .is_some()
        {
            return Err(error(MitreCatalogErrorCode::InvalidCatalog));
        }
        tactics.push((
            order,
            CatalogTactic {
                id,
                name,
                short_name,
                description,
            },
        ));
    }
    if tactics.len() != tactic_order.len() {
        return Err(error(MitreCatalogErrorCode::InvalidCatalog));
    }

    let mut techniques = Vec::new();
    let mut technique_ids = HashSet::new();
    for object in bundle
        .objects
        .iter()
        .filter(|object| object.object_type == "attack-pattern" && !object.inactive())
    {
        if !object.is_stix_21() {
            return Err(error(MitreCatalogErrorCode::InvalidCatalog));
        }
        let Some(id) = external_id(object, catalog, true) else {
            continue;
        };
        if !technique_ids.insert(id.clone()) || techniques.len() >= MAX_CATALOG_TECHNIQUES {
            return Err(error(MitreCatalogErrorCode::InvalidCatalog));
        }
        let name = bounded_text(
            object
                .name
                .as_deref()
                .ok_or_else(|| error(MitreCatalogErrorCode::InvalidCatalog))?,
            300,
        )?;
        let description = bounded_text(object.description.as_deref().unwrap_or(&name), 64_000)?;
        if object.kill_chain_phases.len() > MAX_CATALOG_TACTICS
            || object.x_mitre_platforms.len() > 128
        {
            return Err(error(MitreCatalogErrorCode::LimitExceeded));
        }
        let mut tactic_ids_for_technique = object
            .kill_chain_phases
            .iter()
            .map(|phase| {
                phase
                    .phase_name
                    .as_deref()
                    .and_then(|name| tactic_by_short_name.get(name))
                    .cloned()
                    .ok_or_else(|| error(MitreCatalogErrorCode::InvalidCatalog))
            })
            .collect::<Result<Vec<_>, _>>()?;
        tactic_ids_for_technique.sort();
        tactic_ids_for_technique.dedup();
        let mut platforms = object
            .x_mitre_platforms
            .iter()
            .map(|platform| bounded_text(platform, 100))
            .collect::<Result<Vec<_>, _>>()?;
        platforms.sort();
        platforms.dedup();
        let parent_id = id
            .rsplit_once('.')
            .filter(|(_, suffix)| {
                suffix.len() == 3 && suffix.bytes().all(|byte| byte.is_ascii_digit())
            })
            .map(|(parent, _)| parent.to_owned());
        techniques.push(CatalogTechnique {
            id,
            name,
            description,
            tactic_ids: tactic_ids_for_technique,
            platforms,
            parent_id,
        });
    }

    tactics.sort_by_key(|(order, _)| *order);
    let tactics = tactics
        .into_iter()
        .map(|(_, tactic)| tactic)
        .collect::<Vec<_>>();
    techniques.sort_by(|left, right| left.id.cmp(&right.id));
    if tactics.is_empty()
        || techniques.is_empty()
        || techniques.iter().any(|technique| {
            technique
                .parent_id
                .as_ref()
                .is_some_and(|parent| !technique_ids.contains(parent))
        })
    {
        return Err(error(MitreCatalogErrorCode::InvalidCatalog));
    }

    let snapshot = CatalogSnapshot {
        schema_version: 2,
        catalog,
        version: version.clone(),
        source: CatalogSource {
            url: official_source_url(catalog, &version),
            sha256: sha256(payload),
        },
        tactics,
        techniques,
    };
    validate_snapshot(&snapshot, catalog, Some(&version))?;
    Ok(snapshot)
}

#[derive(Debug, Clone)]
pub struct CatalogStore {
    root: PathBuf,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogInstallation {
    schema_version: u16,
    snapshot_sha256: String,
    snapshot: CatalogSnapshot,
}

impl CatalogStore {
    pub fn new(root: impl AsRef<Path>) -> Result<Self, MitreCatalogError> {
        fs::create_dir_all(root.as_ref())
            .map_err(|_| error(MitreCatalogErrorCode::StorageUnavailable))?;
        Ok(Self {
            root: root.as_ref().to_owned(),
        })
    }

    pub fn active(&self, catalog: MitreCatalog) -> Result<CatalogSnapshot, MitreCatalogError> {
        self.active_with_origin(catalog)
            .map(|(snapshot, _)| snapshot)
    }

    pub fn status(&self, catalog: MitreCatalog) -> Result<CatalogStatus, MitreCatalogError> {
        let (snapshot, origin) = self.active_with_origin(catalog)?;
        Ok(CatalogStatus {
            catalog,
            version: snapshot.version,
            origin,
        })
    }

    pub fn install(&self, snapshot: &CatalogSnapshot) -> Result<(), MitreCatalogError> {
        validate_snapshot(snapshot, snapshot.catalog, Some(&snapshot.version))?;
        let snapshot_payload = serde_json::to_vec(snapshot)
            .map_err(|_| error(MitreCatalogErrorCode::InvalidCatalog))?;
        let snapshot_sha256 = sha256(&snapshot_payload);
        let payload = serde_json::to_vec(&CatalogInstallation {
            schema_version: 2,
            snapshot_sha256: snapshot_sha256.clone(),
            snapshot: snapshot.clone(),
        })
        .map_err(|_| error(MitreCatalogErrorCode::InvalidCatalog))?;
        if u64::try_from(payload.len())
            .ok()
            .is_none_or(|length| length > MAX_COMPILED_CATALOG_BYTES)
        {
            return Err(error(MitreCatalogErrorCode::LimitExceeded));
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| error(MitreCatalogErrorCode::StorageUnavailable))?
            .as_millis();
        let sequence = INSTALL_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let file_name = format!(
            "{}-{now:020}-{sequence:020}-{}.json",
            catalog_prefix(snapshot.catalog),
            snapshot_sha256
        );
        let path = self.root.join(file_name);
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(path)
            .map_err(|_| error(MitreCatalogErrorCode::StorageUnavailable))?;
        file.write_all(&payload)
            .and_then(|()| file.sync_all())
            .map_err(|_| error(MitreCatalogErrorCode::StorageUnavailable))?;
        sync_directory(&self.root)?;
        Ok(())
    }

    pub fn reset(&self, catalog: MitreCatalog) -> Result<(), MitreCatalogError> {
        let prefix = format!("{}-", catalog_prefix(catalog));
        for path in self.catalog_paths()? {
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if name.starts_with(&prefix) && name.ends_with(".json") {
                fs::remove_file(path)
                    .map_err(|_| error(MitreCatalogErrorCode::StorageUnavailable))?;
            }
        }
        sync_directory(&self.root)
    }

    fn active_with_origin(
        &self,
        catalog: MitreCatalog,
    ) -> Result<(CatalogSnapshot, CatalogOrigin), MitreCatalogError> {
        let prefix = format!("{}-", catalog_prefix(catalog));
        let mut paths = self
            .catalog_paths()?
            .into_iter()
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with(&prefix) && name.ends_with(".json"))
            })
            .collect::<Vec<_>>();
        paths.sort_by(|left, right| right.file_name().cmp(&left.file_name()));
        for path in paths {
            let Ok(metadata) = path.metadata() else {
                continue;
            };
            if !metadata.is_file() || metadata.len() > MAX_COMPILED_CATALOG_BYTES {
                continue;
            }
            let Ok(payload) = fs::read(path) else {
                continue;
            };
            let Ok(installation) = serde_json::from_slice::<CatalogInstallation>(&payload) else {
                continue;
            };
            let Ok(snapshot_payload) = serde_json::to_vec(&installation.snapshot) else {
                continue;
            };
            if installation.schema_version == 2
                && installation.snapshot_sha256 == sha256(&snapshot_payload)
                && validate_snapshot(&installation.snapshot, catalog, None).is_ok()
            {
                return Ok((installation.snapshot, CatalogOrigin::LocalFile));
            }
        }
        bundled_catalog(catalog)
            .cloned()
            .map(|snapshot| (snapshot, CatalogOrigin::Bundled))
    }

    fn catalog_paths(&self) -> Result<Vec<PathBuf>, MitreCatalogError> {
        let mut paths = Vec::new();
        for entry in fs::read_dir(&self.root)
            .map_err(|_| error(MitreCatalogErrorCode::StorageUnavailable))?
        {
            if paths.len() >= MAX_DIRECTORY_ENTRIES {
                return Err(error(MitreCatalogErrorCode::LimitExceeded));
            }
            paths.push(
                entry
                    .map_err(|_| error(MitreCatalogErrorCode::StorageUnavailable))?
                    .path(),
            );
        }
        Ok(paths)
    }
}

pub(super) fn valid_version(version: &str) -> bool {
    let parts = version.split('.').collect::<Vec<_>>();
    (2..=3).contains(&parts.len())
        && parts.iter().all(|part| {
            !part.is_empty() && part.len() <= 4 && part.bytes().all(|byte| byte.is_ascii_digit())
        })
}

fn catalog_from_collection(name: &str) -> Result<MitreCatalog, MitreCatalogError> {
    match name {
        "Enterprise ATT&CK" => Ok(MitreCatalog::AttackEnterprise),
        "Mobile ATT&CK" => Ok(MitreCatalog::AttackMobile),
        "ICS ATT&CK" => Ok(MitreCatalog::AttackIcs),
        "ATLAS" => Ok(MitreCatalog::Atlas),
        _ => Err(error(MitreCatalogErrorCode::InvalidCatalog)),
    }
}

fn external_id(object: &SourceObject, catalog: MitreCatalog, technique: bool) -> Option<String> {
    object
        .external_references
        .iter()
        .filter_map(|reference| reference.external_id.as_deref())
        .find(|identifier| valid_external_id(catalog, identifier, technique))
        .map(ToOwned::to_owned)
}

fn valid_external_id(catalog: MitreCatalog, value: &str, technique: bool) -> bool {
    let (prefix, allow_subtechnique) = match (catalog, technique) {
        (MitreCatalog::Atlas, true) => ("AML.T", true),
        (MitreCatalog::Atlas, false) => ("AML.TA", false),
        (_, true) => ("T", true),
        (_, false) => ("TA", false),
    };
    let Some(remainder) = value.strip_prefix(prefix) else {
        return false;
    };
    if allow_subtechnique {
        let mut parts = remainder.split('.');
        let Some(primary) = parts.next() else {
            return false;
        };
        let secondary = parts.next();
        parts.next().is_none()
            && primary.len() == 4
            && primary.bytes().all(|byte| byte.is_ascii_digit())
            && secondary.is_none_or(|part| {
                part.len() == 3 && part.bytes().all(|byte| byte.is_ascii_digit())
            })
    } else {
        remainder.len() == 4 && remainder.bytes().all(|byte| byte.is_ascii_digit())
    }
}

fn bounded_text(value: &str, maximum_chars: usize) -> Result<String, MitreCatalogError> {
    let normalized = value.replace("\r\n", "\n").replace('\r', "\n");
    let normalized = normalized.trim();
    if normalized.is_empty()
        || normalized.chars().count() > maximum_chars
        || normalized
            .chars()
            .any(|character| character.is_control() && character != '\n' && character != '\t')
    {
        return Err(error(MitreCatalogErrorCode::InvalidCatalog));
    }
    Ok(normalized.to_owned())
}

fn bounded_identifier(value: &str, maximum_chars: usize) -> Result<String, MitreCatalogError> {
    let normalized = bounded_text(value, maximum_chars)?;
    if normalized.chars().any(char::is_whitespace) {
        return Err(error(MitreCatalogErrorCode::InvalidCatalog));
    }
    Ok(normalized)
}

pub(super) fn official_source_url(catalog: MitreCatalog, version: &str) -> String {
    match catalog {
        MitreCatalog::AttackEnterprise => format!(
            "https://github.com/mitre-attack/attack-stix-data/releases/download/v{version}/enterprise-attack.json"
        ),
        MitreCatalog::AttackMobile => format!(
            "https://github.com/mitre-attack/attack-stix-data/releases/download/v{version}/mobile-attack.json"
        ),
        MitreCatalog::AttackIcs => format!(
            "https://github.com/mitre-attack/attack-stix-data/releases/download/v{version}/ics-attack.json"
        ),
        MitreCatalog::Atlas => format!(
            "https://github.com/mitre-atlas/atlas-data/releases/download/v{version}/stix-atlas.json"
        ),
    }
}

fn sha256(payload: &[u8]) -> String {
    let digest = Sha256::digest(payload);
    let mut encoded = String::with_capacity(64);
    for byte in digest {
        write!(&mut encoded, "{byte:02x}").expect("writing to String cannot fail");
    }
    encoded
}

const fn catalog_prefix(catalog: MitreCatalog) -> &'static str {
    match catalog {
        MitreCatalog::AttackEnterprise => "attack-enterprise",
        MitreCatalog::AttackMobile => "attack-mobile",
        MitreCatalog::AttackIcs => "attack-ics",
        MitreCatalog::Atlas => "atlas",
    }
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), MitreCatalogError> {
    fs::File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| error(MitreCatalogErrorCode::StorageUnavailable))
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<(), MitreCatalogError> {
    Ok(())
}

const fn error(code: MitreCatalogErrorCode) -> MitreCatalogError {
    MitreCatalogError::new(code)
}
