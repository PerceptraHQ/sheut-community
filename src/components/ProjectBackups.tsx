import { Button } from "@base-ui/react/button";
import { useEffect, useState } from "react";
import {
  createProjectBackup,
  listProjectBackups,
  type ProjectBackupSummary,
  projectErrorMessage,
} from "../lib/projects";
import { useVaultNotices } from "./VaultNotices";

interface ProjectBackupsProps {
  projectId: string;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function ProjectBackups({ projectId }: ProjectBackupsProps) {
  const notices = useVaultNotices();
  const [backups, setBackups] = useState<ProjectBackupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listProjectBackups(projectId)
      .then((items) => {
        if (active) setBackups(items);
      })
      .catch((cause: unknown) => {
        if (active) setError(projectErrorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const created = await createProjectBackup(projectId);
      setBackups((existing) => [created, ...existing.filter((item) => item.id !== created.id)]);
      notices.add({
        title: "Recovery point saved",
        description: "An encrypted local recovery point is available.",
        type: "success",
      });
    } catch (cause) {
      setError(projectErrorMessage(cause));
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="border-panel-border border-t px-3 py-3" aria-labelledby="recovery-title">
      <h3 className="m-0 text-[11px] text-copy-faint uppercase tracking-wider" id="recovery-title">
        Recovery points
      </h3>
      <Button
        className="control-button mt-2 w-full"
        type="button"
        onClick={() => void handleCreate()}
        disabled={creating}
      >
        {creating
          ? "Saving…"
          : backups.length > 0
            ? "Create another recovery point"
            : "Create recovery point"}
      </Button>
      <div aria-live="polite">
        {loading ? <p className="mt-2 mb-0 text-[11px] text-copy-faint">Loading…</p> : null}
        {!loading && backups.length === 0 ? (
          <p className="mt-2 mb-0 text-[11px] text-copy-faint leading-4">No recovery points yet.</p>
        ) : null}
        {backups.length > 0 ? (
          <div className="mt-2 rounded-md border border-panel-border bg-panel-subtle px-2.5 py-2">
            <p className="m-0 text-[10px] text-copy-faint uppercase tracking-wider">
              Latest recovery point
            </p>
            <p className="mt-1 mb-0 text-[11px] text-copy-secondary">
              {dateFormatter.format(new Date(backups[0].createdAtUnixMs))}
            </p>
            {backups.length > 1 ? (
              <p className="mt-1 mb-0 text-[10px] text-copy-faint">
                {backups.length - 1} earlier {backups.length === 2 ? "point" : "points"} available
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {error ? (
        <p className="error-message mt-2" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
