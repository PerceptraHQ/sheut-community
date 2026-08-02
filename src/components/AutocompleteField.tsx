import { Autocomplete } from "@base-ui/react/autocomplete";
import { IconChevronDown } from "@tabler/icons-react";
import { type ReactNode, useId } from "react";

export interface AutocompleteFieldOption {
  icon?: ReactNode;
  label: string;
  secondary?: string;
  value: string;
}

interface AutocompleteFieldProps {
  ariaLabel?: string;
  description?: ReactNode;
  disabled?: boolean;
  emptyMessage?: string;
  label: string;
  onChange: (value: string) => void;
  options: readonly AutocompleteFieldOption[];
  placeholder: string;
  value: string;
}

export function AutocompleteField({
  ariaLabel,
  description,
  disabled = false,
  emptyMessage = "No matching suggestions",
  label,
  onChange,
  options,
  placeholder,
  value,
}: AutocompleteFieldProps) {
  const inputId = useId();
  const descriptionId = useId();

  return (
    <Autocomplete.Root
      autoHighlight
      disabled={disabled}
      filter={(option, query) =>
        `${option.label} ${option.secondary ?? ""} ${option.value}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase())
      }
      itemToStringValue={(option) => option.value}
      items={options}
      onValueChange={(nextValue) => onChange(nextValue)}
      value={value}
    >
      <div className="grid min-w-0 gap-1.5">
        <label className="text-copy-secondary text-xs" htmlFor={inputId}>
          {label}
        </label>
        <Autocomplete.InputGroup className="relative flex h-9 min-w-0 items-center rounded-sm border border-panel-border bg-panel-deep focus-within:border-accent">
          <Autocomplete.Input
            aria-label={ariaLabel}
            aria-describedby={description ? descriptionId : undefined}
            className="h-full min-w-0 flex-1 border-0 bg-transparent px-2.5 text-copy-primary text-xs outline-none placeholder:text-copy-faint"
            id={inputId}
            placeholder={placeholder}
          />
          <Autocomplete.Trigger
            aria-label={`Open ${label} suggestions`}
            className="flex h-full w-8 shrink-0 items-center justify-center border-0 bg-transparent text-copy-muted"
          >
            <IconChevronDown size={13} aria-hidden="true" />
          </Autocomplete.Trigger>
        </Autocomplete.InputGroup>
        {description ? (
          <span className="text-[11px] text-copy-faint leading-4" id={descriptionId}>
            {description}
          </span>
        ) : null}
      </div>
      <Autocomplete.Portal>
        <Autocomplete.Positioner
          className="z-50 max-w-[var(--available-width)] outline-none"
          sideOffset={4}
        >
          <Autocomplete.Popup className="w-[var(--anchor-width)] max-w-[var(--available-width)] origin-[var(--transform-origin)] rounded-sm border border-panel-border bg-panel-raised shadow-xl ring-1 ring-white/5 transition-[scale,opacity] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <Autocomplete.Empty className="px-3 py-4 text-copy-faint text-xs">
              {emptyMessage}
            </Autocomplete.Empty>
            <Autocomplete.List className="max-h-[min(18rem,var(--available-height))] overflow-y-auto overscroll-contain p-1 outline-none">
              {(option: AutocompleteFieldOption) => (
                <Autocomplete.Item
                  className="grid w-full min-w-0 cursor-default grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-sm px-2 py-1.5 text-copy-secondary text-xs outline-none data-highlighted:bg-panel-hover data-highlighted:text-copy-primary"
                  key={option.value}
                  value={option}
                >
                  <span className="flex min-w-0 items-start gap-2">
                    {option.icon ? <span className="shrink-0">{option.icon}</span> : null}
                    <span className="min-w-0 break-words leading-4">{option.label}</span>
                  </span>
                  {option.secondary ? (
                    <span className="max-w-24 shrink-0 break-words text-right text-copy-faint text-[11px] leading-4">
                      {option.secondary}
                    </span>
                  ) : null}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
