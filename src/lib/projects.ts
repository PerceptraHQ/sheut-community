/** Typed webview facade for project lifecycle commands and validated lock events. */
import { invoke } from "@tauri-apps/api/core";

export type TlpMarking = "clear" | "green" | "amber" | "amber_strict" | "red";

export const PROJECTS_AUTO_LOCKED_EVENT = "projects-auto-locked";

export interface ProjectsAutoLockedEvent {
  projectIds: string[];
  idleTimeoutMinutes: number;
}

export interface ProjectSummary {
  id: string;
  name: string | null;
  locked: boolean;
  unlockMethod: "device" | "passphrase";
  defaultTlpMarking: TlpMarking | null;
}

export interface ProjectBackupSummary {
  id: string;
  createdAtUnixMs: number;
}

const localIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function isBoundedLocalIdList(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) return false;
  const values: unknown[] = value;
  return values.every(
    (projectId): projectId is string =>
      typeof projectId === "string" && localIdPattern.test(projectId),
  );
}

export function projectsAutoLockedFromEvent(value: unknown): ProjectsAutoLockedEvent | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { projectIds?: unknown; idleTimeoutMinutes?: unknown };
  const { projectIds, idleTimeoutMinutes } = candidate;
  if (
    !isBoundedLocalIdList(projectIds) ||
    typeof idleTimeoutMinutes !== "number" ||
    !Number.isInteger(idleTimeoutMinutes) ||
    idleTimeoutMinutes < 1 ||
    idleTimeoutMinutes > 24 * 60
  ) {
    return null;
  }
  return { projectIds: [...projectIds], idleTimeoutMinutes };
}

const errorMessages: Readonly<Record<string, string>> = {
  already_locked: "That project is already locked.",
  backup_failed: "Sheut could not create the recovery point. Try again.",
  backup_not_found: "That recovery point is no longer available.",
  credential_unavailable:
    "The system credential store is unavailable. Check that it is unlocked, then try again.",
  invalid_key_or_corrupt:
    "Sheut could not unlock this project. Its credential is invalid or the project is damaged.",
  invalid_name: "Use a project name between 1 and 120 characters without line breaks.",
  invalid_passphrase: "Use a passphrase between 12 and 1,024 bytes.",
  invalid_passphrase_or_corrupt: "The passphrase is incorrect or the project key data is damaged.",
  invalid_project: "This project is not a valid Sheut Community project.",
  passphrase_required: "This project requires its passphrase.",
  project_not_found: "That local project could not be found.",
  project_locked: "Unlock the project before creating a recovery point.",
  project_must_be_locked: "Lock the project before continuing.",
  recovery_failed:
    "Sheut could not confirm that recovery point was restored. Verify the project before continuing.",
  storage_unavailable: "Local encrypted storage is unavailable. Check disk access, then try again.",
};

export function listProjects(): Promise<ProjectSummary[]> {
  return invoke<ProjectSummary[]>("list_projects");
}

export function listProjectBackups(projectId: string): Promise<ProjectBackupSummary[]> {
  return invoke<ProjectBackupSummary[]>("list_project_backups", { projectId });
}

export function createProject(
  name: string,
  defaultTlpMarking: TlpMarking,
): Promise<ProjectSummary> {
  return invoke<ProjectSummary>("create_project", { name, defaultTlpMarking });
}

export function createPassphraseProject(
  name: string,
  defaultTlpMarking: TlpMarking,
  passphrase: string,
): Promise<ProjectSummary> {
  return invoke<ProjectSummary>("create_passphrase_project", {
    name,
    defaultTlpMarking,
    passphrase,
  });
}

export function updateProjectDefaultTlp(
  projectId: string,
  marking: TlpMarking,
): Promise<ProjectSummary> {
  return invoke<ProjectSummary>("update_project_default_tlp", { projectId, marking });
}

export function unlockProject(projectId: string): Promise<ProjectSummary> {
  return invoke<ProjectSummary>("unlock_project", { projectId });
}

export function unlockPassphraseProject(
  projectId: string,
  passphrase: string,
): Promise<ProjectSummary> {
  return invoke<ProjectSummary>("unlock_passphrase_project", { projectId, passphrase });
}

export function lockProject(projectId: string): Promise<void> {
  return invoke<void>("lock_project", { projectId });
}

export function deleteProject(projectId: string): Promise<void> {
  return invoke<void>("delete_project", { projectId });
}

export function createProjectBackup(projectId: string): Promise<ProjectBackupSummary> {
  return invoke<ProjectBackupSummary>("create_project_backup", { projectId });
}

export function restoreDeviceProjectBackup(projectId: string, backupId: string): Promise<void> {
  return invoke<void>("restore_device_project_backup", { projectId, backupId });
}

export function restorePassphraseProjectBackup(
  projectId: string,
  backupId: string,
  passphrase: string,
): Promise<void> {
  return invoke<void>("restore_passphrase_project_backup", {
    projectId,
    backupId,
    passphrase,
  });
}

export function projectErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = Reflect.get(error, "code");
    if (typeof code === "string" && code in errorMessages) {
      return errorMessages[code];
    }
  }
  return "Sheut could not complete that project operation. Try again.";
}
