//! Privacy-preserving telemetry boundary.
//!
//! The webview may select only an allowlisted coarse event name. Rust owns consent,
//! the anonymous installation identifier, event enrichment, persistence, and
//! network delivery. Project values never enter this module's public commands.

use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::Manager;
use uuid::Uuid;

use crate::commands::CommandError;

const SETTINGS_SCHEMA_VERSION: u8 = 1;
const EVENT_SCHEMA_VERSION: u8 = 1;
const TELEMETRY_SETTINGS_FILE: &str = "telemetry.json";
const TELEMETRY_ENDPOINT_HOST: &str = "telemetry-api-production-f7f4.up.railway.app";
const TELEMETRY_ENDPOINT_PATH: &str = "/v1/events";

type SharedTelemetrySettings = Arc<Mutex<TelemetrySettings>>;

pub(crate) struct TelemetryState {
    settings: SharedTelemetrySettings,
    settings_path: PathBuf,
    client: reqwest::Client,
    endpoint: Option<reqwest::Url>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum TelemetryConsent {
    #[default]
    Unknown,
    Disabled,
    Enabled,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TelemetrySettings {
    schema_version: u8,
    consent: TelemetryConsent,
    installation_id: Option<Uuid>,
}

impl Default for TelemetrySettings {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            consent: TelemetryConsent::Unknown,
            installation_id: None,
        }
    }
}

impl TelemetrySettings {
    fn from_decision(enabled: bool) -> Self {
        if enabled {
            Self {
                schema_version: SETTINGS_SCHEMA_VERSION,
                consent: TelemetryConsent::Enabled,
                installation_id: Some(Uuid::new_v4()),
            }
        } else {
            Self {
                schema_version: SETTINGS_SCHEMA_VERSION,
                consent: TelemetryConsent::Disabled,
                installation_id: None,
            }
        }
    }

    fn is_valid(&self) -> bool {
        self.schema_version == SETTINGS_SCHEMA_VERSION
            && match self.consent {
                TelemetryConsent::Enabled => self.installation_id.is_some(),
                TelemetryConsent::Unknown | TelemetryConsent::Disabled => {
                    self.installation_id.is_none()
                }
            }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum TelemetryEventName {
    ApplicationStarted,
    ProjectCreated,
    ProjectUnlocked,
    BackupCreated,
    RecoveryPointRestored,
    InvestigationsOpened,
    IntelligenceOpened,
    EvidenceOpened,
    GraphOpened,
    MitreOpened,
    SettingsOpened,
    StixImportCompleted,
    StixExportCompleted,
    EvidenceImportCompleted,
    PublicationCompleted,
    ProjectListFailed,
    WebviewUnhandledError,
    WebviewUnhandledRejection,
    WorkspaceRenderFailed,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TelemetryPreference {
    consent: TelemetryConsent,
}

impl From<&TelemetrySettings> for TelemetryPreference {
    fn from(settings: &TelemetrySettings) -> Self {
        Self {
            consent: settings.consent,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TelemetryEvent {
    schema_version: u8,
    event_id: Uuid,
    installation_id: Uuid,
    occurred_at_unix_ms: u64,
    app_version: &'static str,
    operating_system: &'static str,
    architecture: &'static str,
    event_name: TelemetryEventName,
}

pub(crate) fn initialize<R: tauri::Runtime>(
    app: &mut tauri::App<R>,
) -> Result<(), Box<dyn std::error::Error>> {
    let settings_path = app
        .path()
        .app_local_data_dir()?
        .join(TELEMETRY_SETTINGS_FILE);
    let settings = load_settings(&settings_path);
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(4))
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    app.manage(TelemetryState {
        settings: Arc::new(Mutex::new(settings)),
        settings_path,
        client,
        endpoint: configured_endpoint(),
    });
    Ok(())
}

#[tauri::command]
pub(super) fn get_telemetry_preference(
    state: tauri::State<'_, TelemetryState>,
) -> Result<TelemetryPreference, CommandError> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| CommandError::storage_unavailable())?;
    Ok(TelemetryPreference::from(&*settings))
}

#[tauri::command]
pub(super) async fn set_telemetry_preference(
    enabled: bool,
    state: tauri::State<'_, TelemetryState>,
) -> Result<TelemetryPreference, CommandError> {
    let settings = Arc::clone(&state.settings);
    let settings_path = state.settings_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let next = TelemetrySettings::from_decision(enabled);
        persist_settings(&settings_path, &next).map_err(|_| CommandError::storage_unavailable())?;
        let preference = TelemetryPreference::from(&next);
        *settings
            .lock()
            .map_err(|_| CommandError::storage_unavailable())? = next;
        Ok(preference)
    })
    .await
    .map_err(|_| CommandError::storage_unavailable())?
}

#[tauri::command]
pub(super) async fn record_telemetry_event(
    event_name: TelemetryEventName,
    state: tauri::State<'_, TelemetryState>,
) -> Result<bool, CommandError> {
    let installation_id = {
        let settings = state
            .settings
            .lock()
            .map_err(|_| CommandError::storage_unavailable())?;
        if settings.consent != TelemetryConsent::Enabled {
            return Ok(false);
        }
        settings
            .installation_id
            .ok_or_else(CommandError::storage_unavailable)?
    };
    let Some(endpoint) = state.endpoint.clone() else {
        return Ok(false);
    };
    let event = TelemetryEvent {
        schema_version: EVENT_SCHEMA_VERSION,
        event_id: Uuid::new_v4(),
        installation_id,
        occurred_at_unix_ms: now_unix_ms()?,
        app_version: env!("CARGO_PKG_VERSION"),
        operating_system: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
        event_name,
    };
    let delivered = state
        .client
        .post(endpoint)
        .json(&event)
        .send()
        .await
        .is_ok_and(|response| response.status().is_success());
    Ok(delivered)
}

fn configured_endpoint() -> Option<reqwest::Url> {
    let raw = option_env!("SHEUT_TELEMETRY_ENDPOINT")?;
    validated_endpoint(raw)
}

fn validated_endpoint(raw: &str) -> Option<reqwest::Url> {
    let url = reqwest::Url::parse(raw).ok()?;
    if url.scheme() != "https"
        || url.host_str() != Some(TELEMETRY_ENDPOINT_HOST)
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != TELEMETRY_ENDPOINT_PATH
    {
        return None;
    }
    Some(url)
}

fn load_settings(path: &Path) -> TelemetrySettings {
    let Ok(bytes) = fs::read(path) else {
        return TelemetrySettings::default();
    };
    let Ok(settings) = serde_json::from_slice::<TelemetrySettings>(&bytes) else {
        return TelemetrySettings::default();
    };
    if settings.is_valid() {
        settings
    } else {
        TelemetrySettings::default()
    }
}

fn persist_settings(path: &Path, settings: &TelemetrySettings) -> io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "telemetry settings path has no parent",
        )
    })?;
    fs::create_dir_all(parent)?;
    let bytes = serde_json::to_vec(settings)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let temporary_path = path.with_extension("json.tmp");
    fs::write(&temporary_path, bytes)?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    fs::rename(temporary_path, path)
}

fn now_unix_ms() -> Result<u64, CommandError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| CommandError::storage_unavailable())?;
    u64::try_from(duration.as_millis()).map_err(|_| CommandError::storage_unavailable())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use serde_json::Value;

    use super::*;

    #[test]
    fn opt_out_removes_the_installation_identifier() {
        let disabled = TelemetrySettings::from_decision(false);

        assert_eq!(disabled.consent, TelemetryConsent::Disabled);
        assert_eq!(disabled.installation_id, None);
        assert!(disabled.is_valid());
    }

    #[test]
    fn invalid_or_content_bearing_settings_fail_closed() {
        let path = std::env::temp_dir().join(format!("sheut-telemetry-{}.json", Uuid::new_v4()));
        fs::write(
            &path,
            br#"{"schemaVersion":1,"consent":"enabled","installationId":null,"projectTitle":"secret"}"#,
        )
        .unwrap();

        let settings = load_settings(&path);
        let _ = fs::remove_file(path);

        assert_eq!(settings, TelemetrySettings::default());
    }

    #[test]
    fn outbound_event_has_an_exact_non_content_field_allowlist() {
        let event = TelemetryEvent {
            schema_version: EVENT_SCHEMA_VERSION,
            event_id: Uuid::nil(),
            installation_id: Uuid::nil(),
            occurred_at_unix_ms: 1,
            app_version: "0.1.0-alpha",
            operating_system: "linux",
            architecture: "x86_64",
            event_name: TelemetryEventName::GraphOpened,
        };

        let Value::Object(fields) = serde_json::to_value(event).unwrap() else {
            panic!("telemetry event must serialize as an object");
        };
        let actual = fields.keys().map(String::as_str).collect::<BTreeSet<_>>();
        let expected = BTreeSet::from([
            "appVersion",
            "architecture",
            "eventName",
            "eventId",
            "installationId",
            "occurredAtUnixMs",
            "operatingSystem",
            "schemaVersion",
        ]);
        assert_eq!(actual, expected);
    }

    #[test]
    fn telemetry_endpoint_must_be_the_exact_https_ingestion_path() {
        assert!(
            validated_endpoint("https://telemetry-api-production-f7f4.up.railway.app/v1/events")
                .is_some()
        );
        assert!(
            validated_endpoint("http://telemetry-api-production-f7f4.up.railway.app/v1/events")
                .is_none()
        );
        assert!(validated_endpoint("https://telemetry.perceptrahq.com/v1/events").is_none());
        assert!(
            validated_endpoint("https://telemetry-api-production-f7f4.up.railway.app/anything")
                .is_none()
        );
        assert!(validated_endpoint("https://attacker.invalid/v1/events").is_none());
        assert!(
            validated_endpoint(
                "https://telemetry-api-production-f7f4.up.railway.app/v1/events?project=secret"
            )
            .is_none()
        );
    }
}
