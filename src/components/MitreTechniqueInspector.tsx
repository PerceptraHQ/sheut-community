import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Button } from "@base-ui/react/button";
import { useEffect, useState } from "react";
import {
  createTechniqueObservation,
  deleteTechniqueObservation,
  listTechniqueObservations,
  type MitreTechniqueSelection,
  mitreErrorMessage,
  type TechniqueObservation,
  type TechniqueObservationValues,
  updateTechniqueObservation,
} from "../lib/mitre";
import { AlertDialogFrame } from "./AlertDialogFrame";
import { CatalogDescription } from "./CatalogDescription";
import { MitreObservationForm } from "./MitreObservationForm";
import { useVaultNotices } from "./VaultNotices";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function titleCase(value: string) {
  return value
    .split("_")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function mappingCardClass(observation: TechniqueObservation) {
  if (observation.assessment === "observed") return "border-accent/80 bg-[#102b46]";
  if (observation.assessment === "suspected") return "border-[#4b79aa] bg-[#172638]";
  return "border-copy-faint/60 bg-[#242832]";
}

interface MitreTechniqueInspectorProps {
  projectId: string;
  selection: MitreTechniqueSelection;
  onObservationChange: () => void;
}

export function MitreTechniqueInspector({
  projectId,
  selection,
  onObservationChange,
}: MitreTechniqueInspectorProps) {
  const notices = useVaultNotices();
  const [observations, setObservations] = useState<TechniqueObservation[]>([]);
  const [editing, setEditing] = useState<TechniqueObservation | "new" | null>(
    selection.createMapping ? "new" : null,
  );
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<TechniqueObservation | null>(null);

  useEffect(() => {
    let active = true;
    listTechniqueObservations(projectId)
      .then((items) => {
        if (!active) return;
        setObservations(
          items.filter(
            (item) =>
              item.reference.catalog === selection.catalog &&
              item.reference.version === selection.version &&
              item.reference.techniqueId === selection.technique.id,
          ),
        );
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
  }, [projectId, selection]);

  const handleSave = async (values: TechniqueObservationValues) => {
    setSaving(true);
    setError(null);
    try {
      const saved = await notices.promise(
        () =>
          editing === "new" || editing === null
            ? createTechniqueObservation(
                projectId,
                {
                  catalog: selection.catalog,
                  version: selection.version,
                  techniqueId: selection.technique.id,
                  tacticId: selection.tacticId,
                },
                values,
              )
            : updateTechniqueObservation(projectId, editing.id, editing.revision, values),
        {
          loading: { title: "Saving project mapping" },
          success: { title: "Project mapping saved", type: "success" },
          error: (cause) => ({
            title: "Observation not saved",
            description: mitreErrorMessage(cause),
          }),
        },
      );
      setObservations((current) => [
        saved,
        ...current.filter((observation) => observation.id !== saved.id),
      ]);
      setEditing(null);
      onObservationChange();
    } catch (cause) {
      setError(mitreErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!removing) return;
    setSaving(true);
    setError(null);
    try {
      const removed = removing;
      await notices.promise(
        () => deleteTechniqueObservation(projectId, removed.id, removed.revision),
        {
          loading: { title: "Removing project mapping", type: "info" },
          success: {
            title: "Project mapping removed",
            description: "The MITRE catalog technique and STIX objects were not changed.",
            type: "success",
          },
          error: (cause) => ({
            title: "Mapping not removed",
            description: mitreErrorMessage(cause),
            type: "info",
          }),
        },
      );
      setObservations((current) => current.filter((item) => item.id !== removed.id));
      setRemoving(null);
      onObservationChange();
    } catch (cause) {
      setError(mitreErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="mitre-technique-title">
      <div className="grid gap-2 px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="m-0 font-mono text-[11px] text-copy-faint">
              {selection.technique.id} · {selection.version}
            </p>
            <h3 className="mt-1 mb-0 text-sm font-semibold" id="mitre-technique-title">
              {selection.technique.name}
            </h3>
          </div>
          {!editing ? (
            <Button
              className="control-button shrink-0"
              type="button"
              onClick={() => setEditing("new")}
            >
              Add mapping
            </Button>
          ) : null}
        </div>
        <CatalogDescription description={selection.technique.description} />
        {selection.technique.platforms.length > 0 ? (
          <p className="m-0 text-[11px] text-copy-faint">
            Platforms: {selection.technique.platforms.join(", ")}
          </p>
        ) : null}
      </div>

      {editing ? (
        <MitreObservationForm
          key={editing === "new" ? "new" : `${editing.id}-${editing.revision}`}
          initial={editing === "new" ? undefined : editing}
          saving={saving}
          onCancel={() => setEditing(null)}
          onSubmit={handleSave}
        />
      ) : null}

      <div className="border-panel-border border-t px-3 py-3">
        <h4 className="m-0 text-[11px] text-copy-faint uppercase tracking-wider">
          Project mappings
        </h4>
        {loading ? <p className="mt-2 mb-0 text-[11px] text-copy-faint">Loading…</p> : null}
        {!loading && observations.length === 0 ? (
          <p className="mt-2 mb-0 text-[11px] text-copy-faint leading-4">
            This technique is not mapped in the project yet. Add a mapping to record how it was
            assessed and what happened.
          </p>
        ) : null}
        <ul className="mt-2 mb-0 grid list-none gap-2 p-0">
          {observations.map((observation) => (
            <li
              className={`rounded-sm border p-2 transition-colors hover:border-accent-hover ${mappingCardClass(observation)}`}
              key={observation.id}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="m-0 text-[11px] font-medium text-copy-secondary">
                  {titleCase(observation.assessment)} · {titleCase(observation.outcome)} ·{" "}
                  {titleCase(observation.confidence)}
                </p>
                <span className="flex shrink-0 items-center gap-2">
                  <Button
                    className="cursor-pointer border-0 bg-transparent p-0 text-[11px] text-accent-hover"
                    type="button"
                    onClick={() => setEditing(observation)}
                  >
                    Edit
                  </Button>
                  <Button
                    className="cursor-pointer border-0 bg-transparent p-0 text-[11px] text-danger"
                    type="button"
                    onClick={() => setRemoving(observation)}
                  >
                    Remove
                  </Button>
                </span>
              </div>
              <p className="mt-1.5 mb-0 whitespace-pre-wrap text-[11px] text-copy-muted leading-4">
                {observation.narrative}
              </p>
              <p className="mt-1.5 mb-0 text-[11px] text-copy-faint">
                Updated {dateFormatter.format(new Date(observation.updatedAtUnixMs))}
              </p>
            </li>
          ))}
        </ul>
        {error ? (
          <p className="error-message mt-2" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <AlertDialog.Root
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
      >
        <AlertDialogFrame>
          <div className="grid gap-3 p-4">
            <AlertDialog.Title className="m-0 text-sm font-semibold">
              Remove project mapping?
            </AlertDialog.Title>
            <AlertDialog.Description className="m-0 text-copy-muted text-xs leading-5">
              This removes only the selected analyst mapping from this encrypted project. The
              catalog technique and every STIX object remain unchanged.
            </AlertDialog.Description>
            <div className="flex justify-end gap-2">
              <AlertDialog.Close render={<Button className="control-button" />} disabled={saving}>
                Cancel
              </AlertDialog.Close>
              <Button
                className="danger-button"
                disabled={saving}
                onClick={() => void handleRemove()}
              >
                {saving ? "Removing…" : "Remove mapping"}
              </Button>
            </div>
          </div>
        </AlertDialogFrame>
      </AlertDialog.Root>
    </section>
  );
}
