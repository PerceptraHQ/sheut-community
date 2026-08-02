import { Button } from "@base-ui/react/button";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { EditorSection } from "./EditorSection";
import { StructuredValueField } from "./StructuredValueField";

export interface StixCustomPropertyRow {
  id: number;
  name: string;
  value: string;
}

interface StixCustomPropertiesProps {
  disabled: boolean;
  onAdd: () => void;
  onRemove: (id: number) => void;
  onUpdate: (id: number, values: Partial<Pick<StixCustomPropertyRow, "name" | "value">>) => void;
  rows: readonly StixCustomPropertyRow[];
}

export function StixCustomProperties({
  disabled,
  onAdd,
  onRemove,
  onUpdate,
  rows,
}: StixCustomPropertiesProps) {
  return (
    <EditorSection
      action={
        <Button className="control-button" disabled={disabled} type="button" onClick={onAdd}>
          <IconPlus size={13} aria-hidden="true" />
          Add custom property
        </Button>
      }
      description="Use an x_ name, choose the value type, and let Sheut serialize it."
      title="Custom properties"
    >
      {rows.map((row) => (
        <div
          className="grid items-start gap-2 min-[720px]:grid-cols-[minmax(10rem,0.7fr)_minmax(16rem,1.3fr)_2rem]"
          key={row.id}
        >
          <div className="grid gap-1">
            <label className="text-[11px] text-copy-faint" htmlFor={`custom-name-${row.id}`}>
              Property name
            </label>
            <input
              className="h-8 rounded-sm border border-panel-border bg-panel-deep px-2 text-copy-primary text-xs"
              disabled={disabled}
              id={`custom-name-${row.id}`}
              value={row.name}
              onChange={(event) => onUpdate(row.id, { name: event.currentTarget.value })}
            />
          </div>
          <div className="grid gap-1">
            <span className="text-[11px] text-copy-faint">Property value</span>
            <StructuredValueField
              disabled={disabled}
              label={row.name || `Custom property ${row.id}`}
              onChange={(value) => onUpdate(row.id, { value })}
              value={row.value}
            />
          </div>
          <Button
            aria-label={`Remove ${row.name}`}
            className="icon-control size-8"
            disabled={disabled}
            type="button"
            onClick={() => onRemove(row.id)}
          >
            <IconTrash size={13} aria-hidden="true" />
          </Button>
        </div>
      ))}
    </EditorSection>
  );
}
