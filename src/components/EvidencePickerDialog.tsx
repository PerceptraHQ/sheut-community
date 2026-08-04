import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { Field } from "@base-ui/react/field";
import { Input } from "@base-ui/react/input";
import { IconFileText, IconPhoto, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { type EvidenceFileMetadata, listEvidenceFiles } from "../lib/evidence";
import { DialogFrame } from "./DialogFrame";

export type EvidenceInsertion =
  | { kind: "citation"; evidence: EvidenceFileMetadata }
  | { kind: "figure"; evidence: EvidenceFileMetadata };

interface EvidencePickerDialogProps {
  open: boolean;
  projectId: string;
  onOpenChange: (open: boolean) => void;
  onInsert: (insertion: EvidenceInsertion) => void;
}

export function EvidencePickerDialog({
  open,
  projectId,
  onOpenChange,
  onInsert,
}: EvidencePickerDialogProps) {
  const [items, setItems] = useState<EvidenceFileMetadata[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setLoading(true);
      setError(null);
      try {
        const next = await listEvidenceFiles(projectId);
        if (active) setItems(next);
      } catch {
        if (active) setError("The Evidence vault could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [open, projectId]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return items;
    return items.filter((item) =>
      `${item.title} ${item.fileName} ${item.source} ${item.tags.join(" ")}`
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [items, query]);

  const insert = (insertion: EvidenceInsertion) => {
    onInsert(insertion);
    onOpenChange(false);
    setQuery("");
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <DialogFrame width="command">
        <header className="flex h-11 items-center justify-between border-panel-border border-b px-4">
          <Dialog.Title className="m-0 text-sm font-semibold">Insert Evidence</Dialog.Title>
          <Dialog.Close render={<Button className="icon-control" />} aria-label="Close">
            <IconX size={16} stroke={1.7} aria-hidden="true" />
          </Dialog.Close>
        </header>
        <div className="grid gap-3 p-4">
          <Dialog.Description className="m-0 text-copy-muted text-xs leading-5">
            Cite any vault item in the text, or place supported images as report figures. Referenced
            items are deduplicated automatically in the PDF evidence appendix.
          </Dialog.Description>
          <Field.Root className="grid gap-1.5">
            <Field.Label className="text-copy-secondary text-xs font-semibold">
              Search Evidence
            </Field.Label>
            <Input
              className="control-input"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              autoComplete="off"
            />
          </Field.Root>
          <div className="max-h-[min(30rem,60vh)] overflow-y-auto rounded-sm border border-panel-border bg-panel-deep p-1">
            {loading ? <p className="list-message">Loading Evidence…</p> : null}
            {error ? <p className="error-message">{error}</p> : null}
            {!loading && !error && filtered.length === 0 ? (
              <p className="list-message">No matching Evidence.</p>
            ) : null}
            {filtered.map((evidence) => (
              <article
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-sm px-2.5 py-2 hover:bg-panel-hover"
                key={evidence.id}
              >
                <div className="min-w-0">
                  <h3 className="m-0 truncate text-copy-primary text-sm font-medium">
                    {evidence.title || evidence.fileName}
                  </h3>
                  <p className="mt-0.5 mb-0 truncate text-[11px] text-copy-faint">
                    {evidence.fileName} · {evidence.mediaType}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    className="control-button"
                    type="button"
                    onClick={() => insert({ kind: "citation", evidence })}
                  >
                    <IconFileText size={14} aria-hidden="true" /> Cite
                  </Button>
                  {evidence.mediaType.startsWith("image/") ? (
                    <Button
                      className="control-button"
                      type="button"
                      onClick={() => insert({ kind: "figure", evidence })}
                    >
                      <IconPhoto size={14} aria-hidden="true" /> Figure
                    </Button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </div>
      </DialogFrame>
    </Dialog.Root>
  );
}
