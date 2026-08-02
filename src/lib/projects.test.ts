import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPassphraseProject,
  createProject,
  createProjectBackup,
  deleteProject,
  listProjectBackups,
  listProjects,
  lockProject,
  projectErrorMessage,
  projectsAutoLockedFromEvent,
  restoreDeviceProjectBackup,
  restorePassphraseProjectBackup,
  unlockPassphraseProject,
  unlockProject,
  updateProjectDefaultTlp,
} from "./projects";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("project command client", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("uses narrow typed Tauri commands without accepting paths or keys", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([]);
    await listProjects();
    expect(invoke).toHaveBeenLastCalledWith("list_projects");

    vi.mocked(invoke).mockResolvedValueOnce([]);
    await listProjectBackups("project-id");
    expect(invoke).toHaveBeenLastCalledWith("list_project_backups", {
      projectId: "project-id",
    });

    vi.mocked(invoke).mockResolvedValueOnce({ id: "project-id", name: "Name", locked: false });
    await createProject("Name", "amber");
    expect(invoke).toHaveBeenLastCalledWith("create_project", {
      name: "Name",
      defaultTlpMarking: "amber",
    });

    vi.mocked(invoke).mockResolvedValueOnce({ id: "project-id", name: "Name", locked: false });
    await createPassphraseProject("Name", "amber", "correct horse battery staple");
    expect(invoke).toHaveBeenLastCalledWith("create_passphrase_project", {
      name: "Name",
      defaultTlpMarking: "amber",
      passphrase: "correct horse battery staple",
    });

    vi.mocked(invoke).mockResolvedValueOnce({ id: "project-id", name: "Name", locked: false });
    await updateProjectDefaultTlp("project-id", "red");
    expect(invoke).toHaveBeenLastCalledWith("update_project_default_tlp", {
      projectId: "project-id",
      marking: "red",
    });

    vi.mocked(invoke).mockResolvedValueOnce({ id: "project-id", name: "Name", locked: false });
    await unlockProject("project-id");
    expect(invoke).toHaveBeenLastCalledWith("unlock_project", { projectId: "project-id" });

    vi.mocked(invoke).mockResolvedValueOnce({ id: "project-id", name: "Name", locked: false });
    await unlockPassphraseProject("project-id", "correct horse battery staple");
    expect(invoke).toHaveBeenLastCalledWith("unlock_passphrase_project", {
      projectId: "project-id",
      passphrase: "correct horse battery staple",
    });

    vi.mocked(invoke).mockResolvedValueOnce({ id: "backup-id", createdAtUnixMs: 1_000 });
    await createProjectBackup("project-id");
    expect(invoke).toHaveBeenLastCalledWith("create_project_backup", {
      projectId: "project-id",
    });

    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await restoreDeviceProjectBackup("project-id", "backup-id");
    expect(invoke).toHaveBeenLastCalledWith("restore_device_project_backup", {
      projectId: "project-id",
      backupId: "backup-id",
    });

    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await restorePassphraseProjectBackup("project-id", "backup-id", "correct horse battery staple");
    expect(invoke).toHaveBeenLastCalledWith("restore_passphrase_project_backup", {
      projectId: "project-id",
      backupId: "backup-id",
      passphrase: "correct horse battery staple",
    });

    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await lockProject("project-id");
    expect(invoke).toHaveBeenLastCalledWith("lock_project", { projectId: "project-id" });

    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await deleteProject("project-id");
    expect(invoke).toHaveBeenLastCalledWith("delete_project", { projectId: "project-id" });
  });

  it("maps command failures to bounded user-facing messages", () => {
    expect(projectErrorMessage({ code: "credential_unavailable", path: "/secret" })).toBe(
      "The system credential store is unavailable. Check that it is unlocked, then try again.",
    );
    expect(projectErrorMessage(new Error("raw database failure"))).toBe(
      "Sheut could not complete that project operation. Try again.",
    );
    expect(projectErrorMessage({ code: "invalid_passphrase_or_corrupt", detail: "secret" })).toBe(
      "The passphrase is incorrect or the project key data is damaged.",
    );
    expect(projectErrorMessage({ code: "backup_not_found", path: "/secret" })).toBe(
      "That recovery point is no longer available.",
    );
  });

  it("accepts only bounded auto-lock event payloads", () => {
    expect(
      projectsAutoLockedFromEvent({
        projectIds: ["019b0dc2-34c8-7c31-a2e5-c447222ce0b9"],
        idleTimeoutMinutes: 30,
      }),
    ).toEqual({
      projectIds: ["019b0dc2-34c8-7c31-a2e5-c447222ce0b9"],
      idleTimeoutMinutes: 30,
    });
    expect(
      projectsAutoLockedFromEvent({ projectIds: ["../../project"], idleTimeoutMinutes: 30 }),
    ).toBeNull();
    expect(
      projectsAutoLockedFromEvent({
        projectIds: Array.from({ length: 257 }, () => "019b0dc2-34c8-7c31-a2e5-c447222ce0b9"),
        idleTimeoutMinutes: 30,
      }),
    ).toBeNull();
    expect(projectsAutoLockedFromEvent({ projectIds: [], idleTimeoutMinutes: 0 })).toBeNull();
  });
});
