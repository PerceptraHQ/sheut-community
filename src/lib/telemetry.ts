/** Typed webview facade for privacy-preserving, explicitly opted-in telemetry. */
import { invoke } from "@tauri-apps/api/core";

export type TelemetryConsent = "unknown" | "disabled" | "enabled";

export interface TelemetryPreference {
  consent: TelemetryConsent;
}

export type TelemetryEventName =
  | "application_started"
  | "project_created"
  | "project_unlocked"
  | "backup_created"
  | "recovery_point_restored"
  | "investigations_opened"
  | "intelligence_opened"
  | "evidence_opened"
  | "graph_opened"
  | "mitre_opened"
  | "settings_opened"
  | "stix_import_completed"
  | "stix_export_completed"
  | "evidence_import_completed"
  | "publication_completed"
  | "project_list_failed"
  | "webview_unhandled_error"
  | "webview_unhandled_rejection"
  | "workspace_render_failed";

export function getTelemetryPreference(): Promise<TelemetryPreference> {
  return invoke<TelemetryPreference>("get_telemetry_preference");
}

export function setTelemetryPreference(enabled: boolean): Promise<TelemetryPreference> {
  return invoke<TelemetryPreference>("set_telemetry_preference", { enabled });
}

export function recordTelemetryEvent(eventName: TelemetryEventName): Promise<boolean> {
  return invoke<boolean>("record_telemetry_event", { eventName });
}
