import { Combobox } from "@base-ui/react/combobox";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import { type ReactNode, useId } from "react";

export interface ComboboxFieldOption<Value extends string = string> {
  icon?: ReactNode;
  label: string;
  secondary?: string;
  value: Value;
}

interface ComboboxFieldProps<Value extends string> {
  description?: ReactNode;
  disabled?: boolean;
  emptyMessage?: string;
  label: string;
  onChange: (value: Value) => void;
  options: readonly ComboboxFieldOption<Value>[];
  placeholder: string;
  value: Value | null;
}

export function ComboboxField<Value extends string>({
  description,
  disabled = false,
  emptyMessage = "No matching options",
  label,
  onChange,
  options,
  placeholder,
  value,
}: ComboboxFieldProps<Value>) {
  const inputId = useId();
  const descriptionId = useId();
  const selectedOption = options.find((option) => option.value === value) ?? null;

  return (
    <Combobox.Root
      autoHighlight
      disabled={disabled}
      itemToStringLabel={(option) => option.label}
      itemToStringValue={(option) => option.value}
      items={options}
      onValueChange={(next) => next && onChange(next.value)}
      value={selectedOption}
    >
      <div className="grid min-w-0 gap-1.5">
        <label className="text-copy-secondary text-xs" htmlFor={inputId}>
          {label}
        </label>
        <Combobox.InputGroup className="relative flex h-9 min-w-0 items-center rounded-sm border border-panel-border bg-panel-deep focus-within:border-accent">
          <Combobox.Input
            aria-describedby={description ? descriptionId : undefined}
            autoComplete="off"
            className="h-full min-w-0 flex-1 border-0 bg-transparent px-2.5 text-copy-primary text-xs outline-none placeholder:text-copy-faint"
            id={inputId}
            placeholder={placeholder}
          />
          <Combobox.Trigger
            aria-label={`Open ${label}`}
            className="flex h-full w-8 shrink-0 items-center justify-center border-0 bg-transparent text-copy-muted"
          >
            <IconChevronDown size={13} aria-hidden="true" />
          </Combobox.Trigger>
        </Combobox.InputGroup>
        {description ? (
          <span className="text-[11px] text-copy-faint leading-4" id={descriptionId}>
            {description}
          </span>
        ) : null}
      </div>
      <Combobox.Portal>
        <Combobox.Positioner
          className="z-50 w-[var(--anchor-width)] max-w-[var(--available-width)] outline-none"
          sideOffset={4}
        >
          <Combobox.Popup className="w-full min-w-0 max-w-[var(--available-width)] origin-[var(--transform-origin)] rounded-sm border border-panel-border bg-panel-raised shadow-xl ring-1 ring-white/5 transition-[scale,opacity] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <Combobox.Empty className="px-3 py-4 text-copy-faint text-xs">
              {emptyMessage}
            </Combobox.Empty>
            <Combobox.List className="max-h-[min(18rem,var(--available-height))] overflow-y-auto overscroll-contain p-1 outline-none">
              {(option: ComboboxFieldOption<Value>) => {
                return (
                  <Combobox.Item
                    className="grid w-full min-w-0 cursor-default grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 rounded-sm px-2 py-1.5 text-copy-secondary text-xs outline-none data-highlighted:bg-panel-hover data-highlighted:text-copy-primary"
                    key={option.value}
                    value={option}
                  >
                    <Combobox.ItemIndicator className="col-start-1">
                      <IconCheck size={12} aria-hidden="true" />
                    </Combobox.ItemIndicator>
                    <span className="col-start-2 flex min-w-0 items-start gap-2">
                      {option.icon ? <span className="shrink-0">{option.icon}</span> : null}
                      <span className="min-w-0 flex-1 break-words leading-4">{option.label}</span>
                    </span>
                    {option.secondary ? (
                      <span className="col-start-3 max-w-24 shrink-0 break-words text-right text-copy-faint text-[11px] leading-4">
                        {option.secondary}
                      </span>
                    ) : null}
                  </Combobox.Item>
                );
              }}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
