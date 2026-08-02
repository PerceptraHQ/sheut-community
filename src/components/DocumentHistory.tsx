import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import {
  compareDocumentRevisions,
  type DocumentActivityEntry,
  type DocumentEnvelope,
  type DocumentRevisionDiff,
  type DocumentRevisionSummary,
  documentErrorMessage,
  listDocumentActivity,
  listDocumentRevisions,
  restoreDocumentRevision,
} from "../lib/documents";
import { AlertDialogFrame } from "./AlertDialogFrame";
import { DialogFrame } from "./DialogFrame";
import { useVaultNotices } from "./VaultNotices";

interface DocumentHistoryProps {
  projectId: string;
  document: DocumentEnvelope;
  onRestored: (document: DocumentEnvelope) => void;
}

export function DocumentHistory({ projectId, document, onRestored }: DocumentHistoryProps) {
  const notices = useVaultNotices();
  const [loadedDocument, setLoadedDocument] = useState<DocumentEnvelope | null>(null);
  const [activity, setActivity] = useState<DocumentActivityEntry[]>([]);
  const [revisions, setRevisions] = useState<DocumentRevisionSummary[]>([]);
  const [diff, setDiff] = useState<DocumentRevisionDiff | null>(null);
  const [restoreRevision, setRestoreRevision] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      listDocumentActivity(projectId, document.id),
      listDocumentRevisions(projectId, document.id),
    ])
      .then(([nextActivity, nextRevisions]) => {
        if (!active) return;
        setActivity(nextActivity);
        setRevisions(nextRevisions);
        setDiff(null);
        setError(null);
        setLoadedDocument(document);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setActivity([]);
        setRevisions([]);
        setDiff(null);
        setError(documentErrorMessage(cause));
        setLoadedDocument(document);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [document, projectId]);

  const historyIsCurrent = loadedDocument === document;
  const visibleActivity = historyIsCurrent ? activity : [];
  const visibleRevisions = historyIsCurrent ? revisions : [];
  const visibleDiff = historyIsCurrent ? diff : null;
  const visibleError = historyIsCurrent ? error : null;
  const visibleLoading = !historyIsCurrent || loading;
  const restorableRevisions = new Set(
    visibleRevisions
      .filter((revision) => revision.revision < document.revision)
      .map((revision) => revision.revision),
  );
  const actionableActivity = new Set<number>();
  const representedRevisions = new Set<number>();
  for (const entry of visibleActivity) {
    if (representedRevisions.has(entry.revision)) continue;
    representedRevisions.add(entry.revision);
    if (restorableRevisions.has(entry.revision)) actionableActivity.add(entry.sequence);
  }

  const handleCompare = async (revision: number) => {
    setWorking(true);
    setError(null);
    try {
      setDiff(await compareDocumentRevisions(projectId, document.id, revision, document.revision));
    } catch (cause) {
      setError(documentErrorMessage(cause));
    } finally {
      setWorking(false);
    }
  };

  const handleRestore = async () => {
    if (restoreRevision === null) return;
    setWorking(true);
    setError(null);
    try {
      const restored = await notices.promise(
        () => restoreDocumentRevision(projectId, document.id, restoreRevision, document.revision),
        {
          loading: {
            title: `Restoring revision ${restoreRevision}`,
            description: "Creating a new encrypted revision.",
            type: "info",
          },
          success: (saved) => ({
            title: `Restored as revision ${saved.revision}`,
            description: "The earlier content is now the current document.",
            type: "success",
          }),
          error: (cause) => ({
            title: "Revision not restored",
            description: documentErrorMessage(cause),
            type: "info",
          }),
        },
      );
      setRestoreRevision(null);
      onRestored(restored);
    } catch (cause) {
      setError(documentErrorMessage(cause));
    } finally {
      setWorking(false);
    }
  };

  return (
    <section
      className="document-history border-panel-border border-t"
      aria-label="Document history"
    >
      <header className="flex items-center justify-between px-3 py-2">
        <h3 className="m-0 font-medium text-[11px] text-copy-muted uppercase tracking-[0.12em]">
          Activity
        </h3>
        <span className="font-mono text-[11px] text-copy-faint">current r{document.revision}</span>
      </header>
      {visibleLoading ? <p className="list-message">Loading history…</p> : null}
      {visibleError ? (
        <p className="error-message mx-3 mb-3" role="alert">
          {visibleError}
        </p>
      ) : null}
      {!visibleLoading && visibleActivity.length === 0 ? (
        <p className="list-message">No saved activity yet.</p>
      ) : null}
      {visibleActivity.length > 0 ? (
        <ol className="document-history-timeline">
          {visibleActivity.map((entry) => {
            const canRestore = actionableActivity.has(entry.sequence);
            return (
              <li key={entry.sequence}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-copy-secondary text-xs">
                    {activityLabel(entry)} · r{entry.revision}
                  </span>
                  <time className="text-[11px] text-copy-faint">
                    {formatTimestamp(entry.occurredAtUnixMs)}
                  </time>
                </div>
                {entry.sourceRevision ? (
                  <p className="mt-1 mb-0 text-[11px] text-copy-faint">
                    Content from r{entry.sourceRevision}
                  </p>
                ) : null}
                {canRestore ? (
                  <div className="mt-2 flex gap-1">
                    <Button
                      className="history-action"
                      type="button"
                      disabled={working}
                      onClick={() => void handleCompare(entry.revision)}
                      aria-label={`Compare revision ${entry.revision} with revision ${document.revision}`}
                    >
                      Compare
                    </Button>
                    <Button
                      className="history-action"
                      type="button"
                      disabled={working}
                      onClick={() => setRestoreRevision(entry.revision)}
                      aria-label={`Restore revision ${entry.revision}`}
                    >
                      Restore
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      <RevisionComparisonDialog diff={visibleDiff} onClose={() => setDiff(null)} />

      <AlertDialog.Root
        open={restoreRevision !== null}
        onOpenChange={(open) => {
          if (!open && !working) setRestoreRevision(null);
        }}
      >
        <AlertDialogFrame width="compact">
          <div className="grid gap-4 p-4">
            <AlertDialog.Title className="m-0 text-sm font-semibold">
              Restore revision {restoreRevision}
            </AlertDialog.Title>
            <AlertDialog.Description className="m-0 text-copy-muted text-xs leading-5">
              This keeps every existing snapshot and creates revision {document.revision + 1}
              with the selected content.
            </AlertDialog.Description>
            <div className="flex justify-end gap-2 border-panel-border border-t pt-3">
              <AlertDialog.Close render={<Button className="control-button" />} disabled={working}>
                Cancel
              </AlertDialog.Close>
              <Button
                className="primary-button"
                type="button"
                disabled={working}
                onClick={() => void handleRestore()}
              >
                {working ? "Restoring…" : `Restore as revision ${document.revision + 1}`}
              </Button>
            </div>
          </div>
        </AlertDialogFrame>
      </AlertDialog.Root>
    </section>
  );
}

function RevisionComparisonDialog({
  diff,
  onClose,
}: {
  diff: DocumentRevisionDiff | null;
  onClose: () => void;
}) {
  const hasChanges = diff?.segments.some((segment) => segment.kind !== "unchanged") ?? false;
  return (
    <Dialog.Root open={diff !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogFrame width="wide">
        {diff ? (
          <div className="grid max-h-[min(48rem,88vh)] grid-rows-[auto_1fr_auto] overflow-hidden">
            <header className="flex h-11 items-center justify-between border-panel-border border-b px-4">
              <Dialog.Title className="m-0 text-sm font-semibold">
                Compare revision {diff.fromRevision} with current revision {diff.toRevision}
              </Dialog.Title>
              <Dialog.Close
                render={<Button className="icon-control" />}
                aria-label="Close comparison"
              >
                <IconX size={16} stroke={1.7} aria-hidden="true" />
              </Dialog.Close>
            </header>
            <div className="overflow-y-auto p-4">
              <Dialog.Description className="m-0 text-copy-muted text-xs leading-5">
                Read the document as tracked changes. Unmarked text is unchanged between the two
                saved versions.
              </Dialog.Description>
              <fieldset className="document-comparison-legend">
                <legend className="sr-only">Comparison legend</legend>
                <span className="document-comparison-removed">
                  Removed from the earlier version
                </span>
                <span className="document-comparison-added">Added in the current version</span>
              </fieldset>
              {hasChanges ? (
                <article
                  className="document-comparison-copy"
                  aria-label={`Text changes from revision ${diff.fromRevision} to revision ${diff.toRevision}`}
                >
                  {diff.segments.map((segment, index) => {
                    const key = `${segment.kind}-${index}`;
                    if (segment.kind === "removed") {
                      return (
                        <del className="document-comparison-removed" key={key}>
                          {segment.text}
                        </del>
                      );
                    }
                    if (segment.kind === "added") {
                      return (
                        <ins className="document-comparison-added" key={key}>
                          {segment.text}
                        </ins>
                      );
                    }
                    return <span key={key}>{segment.text}</span>;
                  })}
                </article>
              ) : (
                <p className="document-comparison-empty">These revisions have the same text.</p>
              )}
              {diff.simplified ? (
                <p className="document-comparison-note">
                  This was a large rewrite, so the changed passage is shown as one removal and one
                  addition.
                </p>
              ) : null}
            </div>
            <footer className="flex justify-end border-panel-border border-t p-3">
              <Dialog.Close render={<Button className="control-button" />}>Close</Dialog.Close>
            </footer>
          </div>
        ) : null}
      </DialogFrame>
    </Dialog.Root>
  );
}

function activityLabel(entry: DocumentActivityEntry): string {
  if (entry.kind === "restored_revision") return "Restored revision";
  return `${entry.kind.charAt(0).toUpperCase()}${entry.kind.slice(1)}`;
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}
