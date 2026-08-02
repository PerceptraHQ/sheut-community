import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useState } from "react";
import {
  commitMitreCatalogUpdate,
  listMitreCatalogStatuses,
  type MitreCatalog,
  type MitreCatalogSnapshot,
  type MitreCatalogStatus,
  type MitreCatalogUpdatePreview,
  mitreErrorMessage,
  previewMitreCatalogUpdate,
  resetMitreCatalog,
} from "../lib/mitre";
import { AlertDialogFrame } from "./AlertDialogFrame";
import { DialogFrame } from "./DialogFrame";
import { useVaultNotices } from "./VaultNotices";

const catalogNames: Readonly<Record<MitreCatalog, string>> = {
  attack_enterprise: "Enterprise ATT&CK",
  attack_mobile: "Mobile ATT&CK",
  attack_ics: "ICS ATT&CK",
  atlas: "ATLAS",
};

interface MitreCatalogUpdateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCatalogChanged: (catalog: MitreCatalogSnapshot) => void;
}

export function MitreCatalogUpdateDialog({
  open,
  onOpenChange,
  onCatalogChanged,
}: MitreCatalogUpdateDialogProps) {
  const notices = useVaultNotices();
  const [statuses, setStatuses] = useState<MitreCatalogStatus[]>([]);
  const [preview, setPreview] = useState<MitreCatalogUpdatePreview | null>(null);
  const [allowDowngrade, setAllowDowngrade] = useState(false);
  const [resettingCatalog, setResettingCatalog] = useState<MitreCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    listMitreCatalogStatuses()
      .then((next) => {
        if (active) setStatuses(next);
      })
      .catch((cause: unknown) => {
        if (active) setError(mitreErrorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (working) return;
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setPreview(null);
      setAllowDowngrade(false);
      setResettingCatalog(null);
      setError(null);
    }
  };

  const handleChoose = async () => {
    setWorking(true);
    setError(null);
    try {
      const next = await previewMitreCatalogUpdate();
      if (next) {
        setPreview(next);
        setAllowDowngrade(false);
      }
    } catch (cause) {
      setError(mitreErrorMessage(cause));
    } finally {
      setWorking(false);
    }
  };

  const handleInstall = async () => {
    if (!preview) return;
    setWorking(true);
    setError(null);
    try {
      const installed = await notices.promise(
        () => commitMitreCatalogUpdate(preview.previewId, allowDowngrade),
        {
          loading: {
            title: `Installing ${catalogNames[preview.catalog]}`,
            description: "Writing the validated offline catalog.",
            type: "info",
          },
          success: {
            title: `${catalogNames[preview.catalog]} ${preview.candidateVersion} installed`,
            description: "The local catalog is active. No network connection is required.",
            type: "success",
          },
          error: (cause) => ({
            title: "Catalog not installed",
            description: mitreErrorMessage(cause),
            type: "info",
          }),
        },
      );
      onCatalogChanged(installed);
      setStatuses(await listMitreCatalogStatuses());
      setPreview(null);
      setAllowDowngrade(false);
    } catch (cause) {
      setError(mitreErrorMessage(cause));
    } finally {
      setWorking(false);
    }
  };

  const handleReset = async () => {
    if (!resettingCatalog) return;
    const catalog = resettingCatalog;
    setWorking(true);
    setError(null);
    try {
      const bundled = await notices.promise(() => resetMitreCatalog(catalog), {
        loading: {
          title: `Restoring bundled ${catalogNames[catalog]}`,
          description: "Removing locally installed catalog files.",
          type: "info",
        },
        success: {
          title: `${catalogNames[catalog]} restored`,
          description: "Sheut is using the catalog bundled with this app release.",
          type: "success",
        },
        error: (cause) => ({
          title: "Bundled catalog not restored",
          description: mitreErrorMessage(cause),
          type: "info",
        }),
      });
      onCatalogChanged(bundled);
      setStatuses(await listMitreCatalogStatuses());
      setResettingCatalog(null);
    } catch (cause) {
      setError(mitreErrorMessage(cause));
    } finally {
      setWorking(false);
    }
  };

  const downgrade = preview?.relation === "downgrade";
  return (
    <>
      <Dialog.Root open={open} onOpenChange={handleOpenChange}>
        <DialogFrame width="wide">
          <header className="flex h-11 items-center justify-between border-panel-border border-b px-4">
            <Dialog.Title className="m-0 text-sm font-semibold">MITRE catalogs</Dialog.Title>
            <Dialog.Close
              render={<Button className="icon-control" />}
              aria-label="Close"
              disabled={working}
            >
              <span aria-hidden="true">×</span>
            </Dialog.Close>
          </header>
          <div className="grid max-h-[75vh] gap-4 overflow-y-auto p-4">
            <Dialog.Description className="m-0 text-copy-muted text-xs leading-5">
              App releases carry tested catalog snapshots. For an offline update between releases,
              download the official STIX 2.1 JSON from the MITRE ATT&CK or ATLAS GitHub release and
              install that local file here. Sheut validates its structure and displays its SHA-256
              digest, but you remain responsible for obtaining it from the official release. Sheut
              never downloads catalogs in the background.
            </Dialog.Description>

            <section className="grid gap-2" aria-label="Installed catalog versions">
              <h3 className="m-0 font-medium text-[11px] text-copy-muted uppercase tracking-[0.12em]">
                Active versions
              </h3>
              {loading ? <p className="list-message">Reading local catalogs…</p> : null}
              {!loading
                ? statuses.map((status) => (
                    <div
                      className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 rounded-sm border border-panel-border bg-panel-deep px-3 py-2"
                      key={status.catalog}
                    >
                      <span className="truncate text-copy-primary text-xs">
                        {catalogNames[status.catalog]}
                      </span>
                      <span className="font-mono text-[11px] text-copy-muted">
                        {status.version}
                      </span>
                      <span className="text-[11px] text-copy-faint">
                        {status.origin === "bundled" ? "Bundled" : "Local file"}
                      </span>
                      {status.origin === "local_file" ? (
                        <Button
                          className="control-button"
                          type="button"
                          disabled={working}
                          onClick={() => setResettingCatalog(status.catalog)}
                        >
                          Restore bundled
                        </Button>
                      ) : (
                        <span className="w-0" aria-hidden="true" />
                      )}
                    </div>
                  ))
                : null}
            </section>

            {preview ? (
              <section
                className="grid gap-3 rounded-sm border border-accent bg-panel-deep p-3"
                aria-label="Catalog update preview"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="m-0 text-sm font-semibold">{catalogNames[preview.catalog]}</h3>
                    <p className="mt-1 mb-0 font-mono text-copy-secondary text-xs">
                      {preview.currentVersion} → {preview.candidateVersion}
                    </p>
                  </div>
                  <span className="rounded-sm bg-panel-hover px-2 py-1 text-[11px] text-copy-secondary uppercase">
                    {preview.relation}
                  </span>
                </div>
                <p className="m-0 text-copy-muted text-xs">
                  {preview.techniqueCount} techniques · {preview.tacticCount} tactics
                </p>
                <p className="m-0 break-all font-mono text-[11px] text-copy-faint">
                  SHA-256 {preview.sha256}
                </p>
                <p className="m-0 break-all text-[11px] text-copy-faint">{preview.sourceUrl}</p>
                {downgrade ? (
                  <label className="flex items-start gap-2 rounded-sm border border-accent/60 bg-panel-base p-2.5 text-copy-secondary text-xs">
                    <input
                      type="checkbox"
                      checked={allowDowngrade}
                      onChange={(event) => setAllowDowngrade(event.currentTarget.checked)}
                    />
                    <span>
                      Install older catalog version
                      <span className="mt-0.5 block text-copy-faint">
                        Existing project mappings are preserved, but some mappings may not be
                        present in the older matrix.
                      </span>
                    </span>
                  </label>
                ) : null}
              </section>
            ) : null}

            {error ? (
              <p className="error-message" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2 border-panel-border border-t pt-3">
              <Button
                className="control-button"
                type="button"
                disabled={working}
                onClick={() => void handleChoose()}
              >
                {working && !preview ? "Reading file…" : "Choose STIX file"}
              </Button>
              {preview ? (
                <Button
                  className="primary-button"
                  type="button"
                  disabled={working || (downgrade && !allowDowngrade)}
                  onClick={() => void handleInstall()}
                >
                  {working ? "Installing…" : "Install catalog"}
                </Button>
              ) : null}
            </div>
          </div>
        </DialogFrame>
      </Dialog.Root>

      <AlertDialog.Root
        open={resettingCatalog !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !working) setResettingCatalog(null);
        }}
      >
        <AlertDialogFrame width="compact">
          <header className="border-panel-border border-b px-4 py-3">
            <AlertDialog.Title className="m-0 text-sm font-semibold">
              Restore bundled catalog?
            </AlertDialog.Title>
          </header>
          <div className="grid gap-4 p-4">
            <AlertDialog.Description className="m-0 text-copy-muted text-xs leading-5">
              The locally installed {resettingCatalog ? catalogNames[resettingCatalog] : "MITRE"}
              catalog will be removed. Project mappings are not deleted.
            </AlertDialog.Description>
            <div className="flex justify-end gap-2 border-panel-border border-t pt-3">
              <AlertDialog.Close render={<Button className="control-button" />} disabled={working}>
                Cancel
              </AlertDialog.Close>
              <Button
                className="danger-button"
                type="button"
                disabled={working}
                onClick={() => void handleReset()}
              >
                Restore bundled
              </Button>
            </div>
          </div>
        </AlertDialogFrame>
      </AlertDialog.Root>
    </>
  );
}
