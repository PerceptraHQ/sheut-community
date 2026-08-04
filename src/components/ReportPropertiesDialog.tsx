import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { Field } from "@base-ui/react/field";
import { Fieldset } from "@base-ui/react/fieldset";
import { Input } from "@base-ui/react/input";
import { IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import { type SyntheticEvent, useState } from "react";
import type { ReportAuthor, ReportProperties } from "../lib/documents";
import { DialogFrame } from "./DialogFrame";

interface EditableAuthor extends ReportAuthor {
  editorKey: string;
}

let nextAuthorEditorKey = 0;

function editableAuthor(author: ReportAuthor): EditableAuthor {
  nextAuthorEditorKey += 1;
  return { ...author, editorKey: `report-author-${nextAuthorEditorKey}` };
}

interface ReportPropertiesDialogProps {
  open: boolean;
  properties: ReportProperties;
  onOpenChange: (open: boolean) => void;
  onSave: (properties: ReportProperties) => void;
}

export function ReportPropertiesDialog({
  open,
  properties,
  onOpenChange,
  onSave,
}: ReportPropertiesDialogProps) {
  const [title, setTitle] = useState(properties.title);
  const [authors, setAuthors] = useState<EditableAuthor[]>(() =>
    properties.authors.map(editableAuthor),
  );
  const [organisation, setOrganisation] = useState(properties.producingOrganisation ?? "");
  const [issueDate, setIssueDate] = useState(properties.issueDate);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    const normalizedTitle = title.trim();
    const normalizedAuthors = authors
      .map((author) => ({ name: author.name.trim(), role: author.role?.trim() || undefined }))
      .filter((author) => author.name.length > 0);
    if (!normalizedTitle) {
      setError("Enter a report title.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) {
      setError("Choose a valid issue date.");
      return;
    }
    onSave({
      reportId: properties.reportId,
      title: normalizedTitle,
      authors: normalizedAuthors,
      producingOrganisation: organisation.trim() || undefined,
      issueDate,
    });
    onOpenChange(false);
  };

  const updateAuthor = (index: number, patch: Partial<ReportAuthor>) => {
    setAuthors((current) =>
      current.map((author, authorIndex) =>
        authorIndex === index ? { ...author, ...patch } : author,
      ),
    );
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <DialogFrame width="publication">
        <header className="flex h-11 items-center justify-between border-panel-border border-b px-4">
          <Dialog.Title className="m-0 text-sm font-semibold">Report properties</Dialog.Title>
          <Dialog.Close render={<Button className="icon-control" />} aria-label="Close">
            <IconX size={16} aria-hidden="true" />
          </Dialog.Close>
        </header>
        <form className="grid gap-4 p-4" onSubmit={submit}>
          <div className="grid gap-1.5">
            <span className="text-copy-secondary text-xs font-semibold">Report ID</span>
            <code className="text-copy-secondary text-sm">{properties.reportId}</code>
            <span className="text-[11px] text-copy-faint leading-4">
              Allocated once for this project and never reused.
            </span>
          </div>
          <Field.Root className="grid gap-1.5">
            <Field.Label className="text-copy-secondary text-xs font-semibold">Title</Field.Label>
            <Input
              className="control-input"
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.currentTarget.value)}
            />
          </Field.Root>
          <Field.Root className="grid gap-1.5">
            <Field.Label className="text-copy-secondary text-xs font-semibold">
              Producing organisation
            </Field.Label>
            <Input
              className="control-input"
              value={organisation}
              maxLength={200}
              onChange={(event) => setOrganisation(event.currentTarget.value)}
            />
          </Field.Root>
          <Field.Root className="grid gap-1.5">
            <Field.Label className="text-copy-secondary text-xs font-semibold">
              Issue date
            </Field.Label>
            <Input
              className="control-input"
              type="date"
              value={issueDate}
              onChange={(event) => setIssueDate(event.currentTarget.value)}
            />
          </Field.Root>
          <Fieldset.Root className="grid gap-2 border-0 p-0">
            <div className="flex items-center justify-between gap-3">
              <Fieldset.Legend className="p-0 text-copy-secondary text-xs font-semibold">
                Authors
              </Fieldset.Legend>
              <Button
                className="control-button"
                type="button"
                disabled={authors.length >= 32}
                onClick={() => setAuthors((current) => [...current, editableAuthor({ name: "" })])}
              >
                <IconPlus size={14} aria-hidden="true" /> Add author
              </Button>
            </div>
            {authors.length === 0 ? (
              <p className="m-0 text-copy-faint text-xs">No authors listed.</p>
            ) : null}
            {authors.map((author, index) => (
              <div
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                key={author.editorKey}
              >
                <Field.Root className="col-span-2 sm:col-span-1">
                  <Field.Label className="sr-only">Author {index + 1} name</Field.Label>
                  <Input
                    className="control-input"
                    placeholder="Name"
                    value={author.name}
                    maxLength={120}
                    onChange={(event) => updateAuthor(index, { name: event.currentTarget.value })}
                  />
                </Field.Root>
                <Field.Root>
                  <Field.Label className="sr-only">Author {index + 1} role</Field.Label>
                  <Input
                    className="control-input"
                    placeholder="Role (optional)"
                    value={author.role ?? ""}
                    maxLength={120}
                    onChange={(event) => updateAuthor(index, { role: event.currentTarget.value })}
                  />
                </Field.Root>
                <Button
                  className="icon-control"
                  type="button"
                  aria-label={`Remove author ${index + 1}`}
                  onClick={() =>
                    setAuthors((current) =>
                      current.filter((_, authorIndex) => authorIndex !== index),
                    )
                  }
                >
                  <IconTrash size={14} aria-hidden="true" />
                </Button>
              </div>
            ))}
          </Fieldset.Root>
          {error ? (
            <p className="error-message m-0" role="alert">
              {error}
            </p>
          ) : null}
          <footer className="flex justify-end gap-2 border-panel-border border-t pt-3">
            <Dialog.Close render={<Button className="control-button" type="button" />}>
              Cancel
            </Dialog.Close>
            <Button className="primary-button" type="submit">
              Save properties
            </Button>
          </footer>
        </form>
      </DialogFrame>
    </Dialog.Root>
  );
}
