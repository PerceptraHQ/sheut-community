import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { IconDatabaseSearch, IconX } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import {
  listReportProjectData,
  type ProjectDataSelection,
  type ReportProjectDataItem,
} from "../lib/guided-reports";
import { DialogFrame } from "./DialogFrame";

interface ProjectDataPickerProps {
  allowedKinds?: readonly ReportProjectDataItem["kind"][];
  allowedObjectTypes?: readonly string[];
  compact?: boolean;
  contextLabel?: string;
  onInsert: (reference: ProjectDataSelection) => void;
  projectId: string;
  triggerLabel: string;
  triggerText?: string;
}

export function ProjectDataPicker({
  allowedKinds,
  allowedObjectTypes,
  compact = false,
  contextLabel,
  onInsert,
  projectId,
  triggerLabel,
  triggerText = "Choose project data",
}: ProjectDataPickerProps) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ReportProjectDataItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (allowedKinds && !allowedKinds.includes(item.kind)) return false;
      if (allowedObjectTypes && !allowedObjectTypes.includes(item.objectType)) return false;
      if (!normalized) return true;
      return `${item.label} ${item.objectType} ${item.kind} ${item.summary} ${Object.values(item.values).join(" ")}`
        .toLocaleLowerCase()
        .includes(normalized);
    });
  }, [allowedKinds, allowedObjectTypes, items, query]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next || loaded || loading) return;
    setLoading(true);
    setError(null);
    void listReportProjectData(projectId)
      .then((projectData) => {
        setItems(projectData);
        setLoaded(true);
      })
      .catch(() => setError("Project data could not be loaded."))
      .finally(() => setLoading(false));
  };

  const insert = (item: ReportProjectDataItem) => {
    onInsert({
      kind: item.kind,
      id: item.id,
      label: item.label,
      values: item.values,
    });
    setOpen(false);
    setQuery("");
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Trigger
        render={
          <Button
            className={compact ? "icon-control" : "control-button"}
            type="button"
            aria-label={triggerLabel}
            title={compact ? triggerLabel : undefined}
          />
        }
      >
        <IconDatabaseSearch size={14} stroke={1.7} aria-hidden="true" />
        {compact ? null : triggerText}
      </Dialog.Trigger>
      <DialogFrame width="command">
        <header className="flex h-11 items-center justify-between border-panel-border border-b px-4">
          <Dialog.Title className="m-0 text-sm font-semibold">Insert project data</Dialog.Title>
          <Dialog.Close render={<Button className="icon-control" />} aria-label="Close">
            <IconX size={16} stroke={1.7} aria-hidden="true" />
          </Dialog.Close>
        </header>
        <div className="grid gap-3 p-4">
          <Dialog.Description className="m-0 text-copy-muted text-xs leading-5">
            {contextLabel
              ? `Choose project data compatible with ${contextLabel}. Readable values are inserted while local identifiers stay hidden.`
              : "Choose STIX intelligence, evidence, a document, or an ATT&CK mapping. Readable report values are inserted while local identifiers stay hidden."}
          </Dialog.Description>
          <label className="grid gap-1.5 text-copy-secondary text-xs">
            Search project data
            <input
              className="h-9 rounded-sm border border-panel-border bg-panel-deep px-2.5 text-copy-primary text-sm outline-none focus:border-accent"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              autoComplete="off"
            />
          </label>
          <div className="max-h-80 overflow-y-auto rounded-sm border border-panel-border bg-panel-deep p-1">
            {loading ? (
              <p className="list-message" role="status">
                Loading project data…
              </p>
            ) : error ? (
              <p className="error-message" role="alert">
                {error}
              </p>
            ) : filtered.length === 0 ? (
              <p className="list-message">
                {contextLabel ? "No compatible project data." : "No matching project data."}
              </p>
            ) : (
              filtered.map((item) => (
                <Button
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-sm px-2.5 py-2 text-left hover:bg-panel-hover focus-visible:bg-panel-hover"
                  type="button"
                  key={`${item.kind}:${item.id}`}
                  onClick={() => insert(item)}
                  aria-label={`${item.label} — ${item.objectType}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-copy-primary text-sm">{item.label}</span>
                    {item.summary ? (
                      <span className="block truncate text-copy-faint text-[11px]">
                        {item.summary}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-copy-faint text-[11px] uppercase tracking-wide">
                    {sourceKindLabel(item)}
                  </span>
                </Button>
              ))
            )}
          </div>
        </div>
      </DialogFrame>
    </Dialog.Root>
  );
}

function sourceKindLabel(item: ReportProjectDataItem): string {
  if (item.kind === "catalog_reference") return "TTP";
  if (item.kind === "intelligence") return item.objectType;
  return item.kind.replace("_", " ");
}
