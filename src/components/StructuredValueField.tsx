import { Button } from "@base-ui/react/button";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { SelectField } from "./SelectField";

type StructuredValue = null | boolean | number | string | StructuredValue[] | StructuredObject;
type StructuredObject = { [key: string]: StructuredValue };
type ValueKind = "text" | "number" | "boolean" | "object" | "list" | "null";

interface StructuredValueFieldProps {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  rootKind?: "list" | "object";
  value: string;
}

const kindOptions = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "True / false" },
  { value: "object", label: "Property group" },
  { value: "list", label: "List" },
  { value: "null", label: "Empty value" },
] as const;

function valueKind(value: StructuredValue): ValueKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "list";
  if (typeof value === "object") return "object";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "text";
}

function emptyValue(kind: ValueKind): StructuredValue {
  if (kind === "object") return {};
  if (kind === "list") return [];
  if (kind === "number") return 0;
  if (kind === "boolean") return false;
  if (kind === "null") return null;
  return "";
}

function primitiveText(value: StructuredValue): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function parseStructuredValue(value: string, rootKind?: "list" | "object"): StructuredValue {
  if (!value.trim()) return rootKind === "list" ? [] : rootKind === "object" ? {} : "";
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      parsed === null ||
      typeof parsed === "string" ||
      typeof parsed === "number" ||
      typeof parsed === "boolean" ||
      Array.isArray(parsed) ||
      (typeof parsed === "object" && parsed !== null)
    ) {
      return parsed as StructuredValue;
    }
  } catch {
    return rootKind === "list" ? [] : rootKind === "object" ? {} : value;
  }
  return "";
}

function isEmptyRoot(value: StructuredValue): boolean {
  return (
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === "object" && value !== null && Object.keys(value).length === 0)
  );
}

interface NodeEditorProps {
  disabled: boolean;
  label: string;
  level: number;
  onChange: (value: StructuredValue) => void;
  value: StructuredValue;
}

function NodeEditor({ disabled, label, level, onChange, value }: NodeEditorProps) {
  const kind = valueKind(value);
  return (
    <div className="grid min-w-0 gap-2">
      <SelectField
        ariaLabel={`${label} value type`}
        disabled={disabled}
        onChange={(next) => onChange(emptyValue(next as ValueKind))}
        options={kindOptions}
        placeholder="Choose value type"
        value={kind}
      />
      {kind === "object" ? (
        <ObjectEditor
          disabled={disabled}
          label={label}
          level={level + 1}
          onChange={onChange}
          value={value as StructuredObject}
        />
      ) : kind === "list" ? (
        <ListEditor
          disabled={disabled}
          label={label}
          level={level + 1}
          onChange={onChange}
          value={value as StructuredValue[]}
        />
      ) : kind === "boolean" ? (
        <SelectField
          ariaLabel={`${label} value`}
          disabled={disabled}
          onChange={(next) => onChange(next === "true")}
          options={[
            { value: "true", label: "True" },
            { value: "false", label: "False" },
          ]}
          placeholder="Choose a value"
          value={value === true ? "true" : "false"}
        />
      ) : kind === "null" ? (
        <span className="text-[11px] text-copy-faint">
          This property has an explicit null value.
        </span>
      ) : (
        <input
          aria-label={`${label} value`}
          className="h-8 min-w-0 rounded-sm border border-panel-border bg-panel-deep px-2 text-copy-primary text-xs outline-none focus:border-accent"
          disabled={disabled}
          inputMode={kind === "number" ? "decimal" : undefined}
          onChange={(event) =>
            onChange(
              kind === "number"
                ? Number.isFinite(event.currentTarget.valueAsNumber)
                  ? event.currentTarget.valueAsNumber
                  : 0
                : event.currentTarget.value,
            )
          }
          type={kind === "number" ? "number" : "text"}
          value={primitiveText(value)}
        />
      )}
    </div>
  );
}

function ObjectEditor({
  disabled,
  label,
  level,
  onChange,
  value,
}: Omit<NodeEditorProps, "value"> & {
  value: StructuredObject;
}) {
  const entries = Object.entries(value);
  const addEntry = () => {
    let index = entries.length + 1;
    while (Object.hasOwn(value, `property_${index}`)) index += 1;
    onChange({ ...value, [`property_${index}`]: "" });
  };
  return (
    <div className="grid gap-2 rounded-sm border border-panel-border bg-panel-raised/35 p-2">
      {entries.map(([key, child], index) => (
        <div
          className="grid gap-2 min-[720px]:grid-cols-[minmax(9rem,0.7fr)_minmax(14rem,1.3fr)_2rem]"
          key={key}
        >
          <input
            aria-label={`${label} property ${index + 1} name`}
            className="h-8 min-w-0 rounded-sm border border-panel-border bg-panel-deep px-2 text-copy-primary text-xs outline-none focus:border-accent"
            disabled={disabled}
            onChange={(event) => {
              const nextKey = event.currentTarget.value;
              if (!nextKey || (nextKey !== key && Object.hasOwn(value, nextKey))) return;
              const next = Object.fromEntries(
                entries.map(([entryKey, entryValue]) =>
                  entryKey === key ? [nextKey, entryValue] : [entryKey, entryValue],
                ),
              );
              onChange(next);
            }}
            placeholder="Property name"
            value={key}
          />
          <NodeEditor
            disabled={disabled}
            label={`${label} ${key}`}
            level={level}
            onChange={(nextValue) => onChange({ ...value, [key]: nextValue })}
            value={child}
          />
          <Button
            aria-label={`Remove ${label} property ${key}`}
            className="icon-control size-8"
            disabled={disabled}
            onClick={() =>
              onChange(Object.fromEntries(entries.filter(([entryKey]) => entryKey !== key)))
            }
            type="button"
          >
            <IconTrash size={13} aria-hidden="true" />
          </Button>
        </div>
      ))}
      {level < 6 ? (
        <Button
          className="control-button w-fit"
          disabled={disabled}
          onClick={addEntry}
          type="button"
        >
          <IconPlus size={13} aria-hidden="true" />
          Add property
        </Button>
      ) : null}
    </div>
  );
}

function ListEditor({
  disabled,
  label,
  level,
  onChange,
  value,
}: Omit<NodeEditorProps, "value"> & {
  value: StructuredValue[];
}) {
  const [rows, setRows] = useState<Array<{ id: string; value: StructuredValue }>>(() =>
    value.map((item) => ({ id: crypto.randomUUID(), value: item })),
  );
  const updateRows = (nextRows: Array<{ id: string; value: StructuredValue }>) => {
    setRows(nextRows);
    onChange(nextRows.map((row) => row.value));
  };
  return (
    <div className="grid gap-2 rounded-sm border border-panel-border bg-panel-raised/35 p-2">
      {rows.map((row, index) => (
        <div className="grid gap-2 min-[720px]:grid-cols-[minmax(14rem,1fr)_2rem]" key={row.id}>
          <NodeEditor
            disabled={disabled}
            label={`${label} item ${index + 1}`}
            level={level}
            onChange={(nextValue) =>
              updateRows(
                rows.map((item) => (item.id === row.id ? { ...item, value: nextValue } : item)),
              )
            }
            value={row.value}
          />
          <Button
            aria-label={`Remove ${label} item ${index + 1}`}
            className="icon-control size-8"
            disabled={disabled}
            onClick={() => updateRows(rows.filter((item) => item.id !== row.id))}
            type="button"
          >
            <IconTrash size={13} aria-hidden="true" />
          </Button>
        </div>
      ))}
      {level < 6 ? (
        <Button
          className="control-button w-fit"
          disabled={disabled}
          onClick={() => updateRows([...rows, { id: crypto.randomUUID(), value: "" }])}
          type="button"
        >
          <IconPlus size={13} aria-hidden="true" />
          Add item
        </Button>
      ) : null}
    </div>
  );
}

export function StructuredValueField({
  disabled,
  label,
  onChange,
  rootKind,
  value,
}: StructuredValueFieldProps) {
  const parsed = parseStructuredValue(value, rootKind);
  const update = (next: StructuredValue) => onChange(isEmptyRoot(next) ? "" : JSON.stringify(next));

  if (rootKind === "object") {
    return (
      <ObjectEditor
        disabled={disabled}
        label={label}
        level={0}
        onChange={update}
        value={
          typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {}
        }
      />
    );
  }
  if (rootKind === "list") {
    return (
      <ListEditor
        disabled={disabled}
        label={label}
        level={0}
        onChange={update}
        value={Array.isArray(parsed) ? parsed : []}
      />
    );
  }
  return (
    <NodeEditor disabled={disabled} label={label} level={0} onChange={update} value={parsed} />
  );
}
