import { Select } from "@base-ui/react/select";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import type { ReactNode } from "react";

export interface SelectFieldOption {
  icon?: ReactNode;
  label: string;
  secondary?: string;
  value: string;
}

interface SelectFieldProps {
  ariaLabel: string;
  disabled?: boolean;
  label?: string;
  leadingIcon?: ReactNode;
  onChange: (value: string) => void;
  options: readonly SelectFieldOption[];
  placeholder: string;
  required?: boolean;
  triggerClassName?: string;
  value: string | null;
}

const defaultTriggerClassName =
  "flex h-9 w-full min-w-0 items-center gap-2 rounded-sm border border-panel-border bg-panel-deep px-2.5 text-copy-primary text-xs outline-none focus:border-accent";

export function SelectField({
  ariaLabel,
  disabled = false,
  label,
  leadingIcon,
  onChange,
  options,
  placeholder,
  required = false,
  triggerClassName = defaultTriggerClassName,
  value,
}: SelectFieldProps) {
  const selected = options.find((option) => option.value === value);
  return (
    <div className="grid min-w-0 gap-1.5">
      {label ? <span className="text-copy-secondary text-xs">{label}</span> : null}
      <Select.Root
        disabled={disabled}
        required={required}
        value={value}
        onValueChange={(next) => next && onChange(next)}
      >
        <Select.Trigger
          aria-label={ariaLabel}
          aria-required={required}
          className={triggerClassName}
        >
          {(selected?.icon ?? leadingIcon) ? (
            <span className="flex shrink-0 items-center">{selected?.icon ?? leadingIcon}</span>
          ) : null}
          <span
            className={
              selected
                ? "min-w-0 flex-1 truncate text-left"
                : "min-w-0 flex-1 truncate text-left text-copy-faint"
            }
          >
            {selected?.label ?? placeholder}
          </span>
          <IconChevronDown className="ml-auto shrink-0" size={13} aria-hidden="true" />
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner
            className="z-50 w-[var(--anchor-width)] max-w-[var(--available-width)]"
            sideOffset={4}
          >
            <Select.Popup className="max-h-72 w-full min-w-0 max-w-[var(--available-width)] overflow-y-auto rounded-sm border border-panel-border bg-panel-raised p-1 shadow-xl ring-1 ring-white/5">
              {options.map((option) => (
                <Select.Item
                  className="grid w-full min-w-0 cursor-default grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 rounded-sm px-2 py-1.5 text-copy-secondary text-xs outline-none data-highlighted:bg-panel-hover data-highlighted:text-copy-primary"
                  key={option.value}
                  value={option.value}
                >
                  <Select.ItemIndicator className="col-start-1">
                    <IconCheck size={12} aria-hidden="true" />
                  </Select.ItemIndicator>
                  <Select.ItemText
                    className="col-start-2 flex min-w-0 flex-1 items-start gap-2 leading-4"
                    data-slot="item-text"
                  >
                    {option.icon ? <span className="shrink-0">{option.icon}</span> : null}
                    <span className="min-w-0 flex-1 whitespace-normal break-words">
                      {option.label}
                    </span>
                  </Select.ItemText>
                  {option.secondary ? (
                    <span className="col-start-3 max-w-24 shrink-0 break-words text-right text-copy-faint text-[11px] leading-4">
                      {option.secondary}
                    </span>
                  ) : null}
                </Select.Item>
              ))}
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
