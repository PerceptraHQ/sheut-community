import { Button } from "@base-ui/react/button";
import { IconFolder, IconLock, IconTrash } from "@tabler/icons-react";
import { lazy, Suspense, useState } from "react";
import type { ProjectSummary } from "../lib/projects";
import { projectErrorMessage } from "../lib/projects";
import type { CreateProjectRequest } from "./CreateProjectDialog";
import { useVaultNotices } from "./VaultNotices";

const CreateProjectDialog = lazy(async () => {
  const module = await import("./CreateProjectDialog");
  return { default: module.CreateProjectDialog };
});

const UnlockProjectDialog = lazy(async () => {
  const module = await import("./UnlockProjectDialog");
  return { default: module.UnlockProjectDialog };
});

const RestoreProjectDialog = lazy(async () => {
  const module = await import("./RestoreProjectDialog");
  return { default: module.RestoreProjectDialog };
});

const DeleteProjectDialog = lazy(async () => {
  const module = await import("./DeleteProjectDialog");
  return { default: module.DeleteProjectDialog };
});

interface ProjectLauncherProps {
  projects: ProjectSummary[];
  loading: boolean;
  loadError: string | null;
  onCreate: (request: CreateProjectRequest) => Promise<void>;
  onUnlockDevice: (projectId: string) => Promise<void>;
  onUnlockPassphrase: (projectId: string, passphrase: string) => Promise<void>;
  onDelete: (projectId: string) => Promise<void>;
}

export function ProjectLauncher({
  projects,
  loading,
  loadError,
  onCreate,
  onUnlockDevice,
  onUnlockPassphrase,
  onDelete,
}: ProjectLauncherProps) {
  const notices = useVaultNotices();
  const [unlockingId, setUnlockingId] = useState<string | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [passphraseProject, setPassphraseProject] = useState<ProjectSummary | null>(null);
  const [recoveryProject, setRecoveryProject] = useState<ProjectSummary | null>(null);
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<ProjectSummary | null>(null);

  const handleUnlock = async (projectId: string) => {
    setUnlockError(null);
    setUnlockingId(projectId);
    try {
      await onUnlockDevice(projectId);
    } catch (cause) {
      setUnlockError(projectErrorMessage(cause));
    } finally {
      setUnlockingId(null);
    }
  };

  const handlePassphraseUnlock = async (passphrase: string) => {
    if (!passphraseProject) return;
    await onUnlockPassphrase(passphraseProject.id, passphrase);
    setPassphraseProject(null);
  };

  return (
    <section className="mx-auto w-full max-w-xl px-8 py-12" aria-labelledby="open-project-title">
      <IconFolder className="text-copy-faint" size={30} stroke={1.35} aria-hidden="true" />
      <h1 className="mt-4 mb-0 text-xl font-semibold tracking-[-0.01em]" id="open-project-title">
        Open project
      </h1>
      <p className="mt-2 mb-0 max-w-lg text-copy-muted text-sm leading-6">
        Choose a local project on this device or create a new one.
      </p>
      <div className="mt-5">
        <Suspense
          fallback={<span className="text-copy-faint text-xs">Loading project controls…</span>}
        >
          <CreateProjectDialog onCreate={onCreate} />
        </Suspense>
      </div>

      <div className="mt-8 border-panel-border border-t pt-3">
        <h2 className="m-0 font-medium text-[11px] text-copy-faint uppercase tracking-[0.12em]">
          Projects on this device
        </h2>
        {loading ? (
          <p className="mt-3 mb-0 text-copy-muted text-xs" role="status">
            Discovering local projects…
          </p>
        ) : null}
        {loadError ? (
          <p className="error-message mt-3" role="alert">
            {loadError}
          </p>
        ) : null}
        {!loading && !loadError && projects.length === 0 ? (
          <p className="mt-3 mb-0 text-copy-faint text-xs">No projects found.</p>
        ) : null}
        {projects.length > 0 ? (
          <ul
            className="mt-2 list-none divide-y divide-panel-border border-panel-border border-y p-0"
            aria-label="Local projects"
          >
            {projects.map((project) => (
              <li className="flex min-h-12 items-center gap-3 py-2" key={project.id}>
                <IconLock
                  className="shrink-0 text-copy-faint"
                  size={15}
                  stroke={1.6}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-copy-secondary text-xs">
                    {project.name ?? "Unnamed local project"}
                  </span>
                </span>
                <Button
                  className="control-button"
                  type="button"
                  disabled={unlockingId !== null}
                  onClick={() => {
                    if (project.unlockMethod === "passphrase") {
                      setPassphraseProject(project);
                    } else {
                      void handleUnlock(project.id);
                    }
                  }}
                >
                  {unlockingId === project.id ? "Unlocking…" : "Unlock project"}
                </Button>
                <Button
                  className="control-button"
                  type="button"
                  disabled={unlockingId !== null}
                  onClick={() => {
                    setRecoveryProject(project);
                  }}
                >
                  Recovery
                </Button>
                <Button
                  className="icon-control text-danger"
                  type="button"
                  aria-label={`Delete ${project.name ?? "unnamed local project"}`}
                  title={`Delete ${project.name ?? "unnamed local project"}`}
                  disabled={unlockingId !== null}
                  onClick={() => setDeleteProjectTarget(project)}
                >
                  <IconTrash size={14} stroke={1.7} aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {unlockError ? (
          <p className="error-message mt-3" role="alert">
            {unlockError}
          </p>
        ) : null}
      </div>
      {passphraseProject ? (
        <Suspense fallback={null}>
          <UnlockProjectDialog
            projectName={passphraseProject.name ?? "Unnamed local project"}
            open
            onOpenChange={(open) => {
              if (!open) setPassphraseProject(null);
            }}
            onUnlock={handlePassphraseUnlock}
          />
        </Suspense>
      ) : null}
      {recoveryProject ? (
        <Suspense fallback={null}>
          <RestoreProjectDialog
            project={recoveryProject}
            open
            onOpenChange={(open) => {
              if (!open) setRecoveryProject(null);
            }}
            onRestored={() => {
              setRecoveryProject(null);
              notices.add({
                title: "Recovery complete",
                description: "Unlock the project to verify it.",
                type: "success",
              });
            }}
          />
        </Suspense>
      ) : null}
      {deleteProjectTarget ? (
        <Suspense fallback={null}>
          <DeleteProjectDialog
            project={deleteProjectTarget}
            open
            onOpenChange={(open) => {
              if (!open) setDeleteProjectTarget(null);
            }}
            onDelete={onDelete}
          />
        </Suspense>
      ) : null}
    </section>
  );
}
