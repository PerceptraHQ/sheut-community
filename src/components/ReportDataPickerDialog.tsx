import { Button } from "@base-ui/react/button";
import { Checkbox } from "@base-ui/react/checkbox";
import { Dialog } from "@base-ui/react/dialog";
import { Field } from "@base-ui/react/field";
import { IconCheck, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { listReportProjectData, type ReportProjectDataItem } from "../lib/report-data";
import { DialogFrame } from "./DialogFrame";

export type ReportDataPickerMode = "project" | "mitre";

interface ReportDataPickerDialogProps {
  mode: ReportDataPickerMode;
  onInsertMitre: (items: ReportProjectDataItem[]) => void;
  onInsertProject: (item: ReportProjectDataItem, display: "inline" | "block") => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  projectId: string;
}

export function ReportDataPickerDialog({
  mode,
  onInsertMitre,
  onInsertProject,
  onOpenChange,
  open,
  projectId,
}: ReportDataPickerDialogProps) {
  const [items, setItems] = useState<ReportProjectDataItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listReportProjectData(projectId)
      .then((result) => {
        if (!cancelled) setItems(result);
      })
      .catch(() => {
        if (!cancelled) setError("Project data could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  const available = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (mode === "mitre" && item.kind !== "catalog_reference") return false;
      if (mode === "project" && item.kind === "catalog_reference") return false;
      if (!normalized) return true;
      return `${item.label} ${item.objectType} ${item.summary} ${Object.values(item.values).join(" ")}`
        .toLocaleLowerCase()
        .includes(normalized);
    });
  }, [items, mode, query]);
  const selected = items.filter((item) => selectedIds.includes(item.id));
  const selectProject = (id: string) => setSelectedIds([id]);
  const toggleMitre = (id: string, checked: boolean) =>
    setSelectedIds((current) =>
      checked ? [...new Set([...current, id])] : current.filter((candidate) => candidate !== id),
    );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <DialogFrame width="command">
        <header className="flex h-11 items-center justify-between border-panel-border border-b px-4">
          <Dialog.Title className="m-0 text-sm font-semibold">
            {mode === "mitre" ? "Insert MITRE observations" : "Insert project data"}
          </Dialog.Title>
          <Dialog.Close render={<Button className="icon-control" />} aria-label="Close">
            <IconX size={16} stroke={1.7} aria-hidden="true" />
          </Dialog.Close>
        </header>
        <div className="grid gap-3 p-4">
          <Dialog.Description className="m-0 text-copy-muted text-xs leading-5">
            {mode === "mitre"
              ? "Select one or more recorded observations. The report stores their current revisions and frozen display text."
              : "Select a project record. The report stores its stable local ID and a frozen readable snapshot."}
          </Dialog.Description>
          <Field.Root>
            <Field.Label className="mb-1.5 block text-copy-secondary text-xs">Search</Field.Label>
            <Field.Control
              className="h-9 w-full rounded-sm border border-panel-border bg-panel-deep px-2.5 text-copy-primary text-sm outline-none focus:border-accent"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              autoComplete="off"
            />
          </Field.Root>
          <div className="report-data-results" role={mode === "mitre" ? "group" : "listbox"}>
            {loading ? (
              <p className="list-message" role="status">
                Loading project data…
              </p>
            ) : error ? (
              <p className="error-message" role="alert">
                {error}
              </p>
            ) : available.length === 0 ? (
              <p className="list-message">No matching records.</p>
            ) : (
              available.map((item) => {
                const checked = selectedIds.includes(item.id);
                return mode === "mitre" ? (
                  <div className="report-data-option" key={item.id}>
                    <Checkbox.Root
                      className="report-data-checkbox"
                      checked={checked}
                      aria-label={`Select ${item.label}`}
                      onCheckedChange={(value) => toggleMitre(item.id, value === true)}
                    >
                      <Checkbox.Indicator>
                        <IconCheck size={12} stroke={2} aria-hidden="true" />
                      </Checkbox.Indicator>
                    </Checkbox.Root>
                    <ReportDataLabel item={item} />
                  </div>
                ) : (
                  <Button
                    className="report-data-option"
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={checked}
                    onClick={() => selectProject(item.id)}
                  >
                    <span className="report-data-radio" data-selected={checked || undefined} />
                    <ReportDataLabel item={item} />
                  </Button>
                );
              })
            )}
          </div>
        </div>
        <footer className="flex min-h-12 items-center justify-end gap-2 border-panel-border border-t px-4 py-2">
          <Dialog.Close render={<Button className="control-button" type="button" />}>
            Cancel
          </Dialog.Close>
          {mode === "mitre" ? (
            <Button
              className="control-button control-button-primary"
              type="button"
              disabled={selected.length === 0}
              onClick={() => onInsertMitre(selected)}
            >
              Insert selected
            </Button>
          ) : (
            <>
              <Button
                className="control-button"
                type="button"
                disabled={selected.length !== 1}
                onClick={() => selected[0] && onInsertProject(selected[0], "inline")}
              >
                Insert inline
              </Button>
              <Button
                className="control-button control-button-primary"
                type="button"
                disabled={selected.length !== 1}
                onClick={() => selected[0] && onInsertProject(selected[0], "block")}
              >
                Insert block
              </Button>
            </>
          )}
        </footer>
      </DialogFrame>
    </Dialog.Root>
  );
}

function ReportDataLabel({ item }: { item: ReportProjectDataItem }) {
  return (
    <span className="min-w-0 flex-1 text-left">
      <span className="block truncate text-copy-primary text-sm">{item.label}</span>
      <span className="block truncate text-copy-faint text-[11px]">
        {item.summary || item.objectType}
      </span>
    </span>
  );
}
