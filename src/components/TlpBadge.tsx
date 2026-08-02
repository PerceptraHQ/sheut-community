import type { TlpMarking } from "../lib/projects";
import type { SelectFieldOption } from "./SelectField";

const tlpColorClasses: Readonly<Record<TlpMarking, string>> = {
  red: "bg-[#FF2B2B]",
  amber_strict: "bg-[#FFC000]",
  amber: "bg-[#FFC000]",
  green: "bg-[#33FF00]",
  clear: "bg-white",
};

const tlpLabels: Readonly<Record<TlpMarking, string>> = {
  red: "TLP:RED",
  amber_strict: "TLP:AMBER+STRICT",
  amber: "TLP:AMBER",
  green: "TLP:GREEN",
  clear: "TLP:CLEAR",
};

export function TlpSwatch({ marking }: { marking: TlpMarking }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-4 place-items-center rounded-sm bg-black ring-1 ring-panel-border"
    >
      <span className={`size-2 rounded-full ${tlpColorClasses[marking]}`} />
    </span>
  );
}

export function TlpBadge({ marking }: { marking: TlpMarking }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-sm bg-black px-1.5 py-1 font-semibold text-[11px] text-white ring-1 ring-panel-border">
      <span aria-hidden="true" className={`size-2 rounded-full ${tlpColorClasses[marking]}`} />
      {tlpLabels[marking]}
    </span>
  );
}

export const tlpSelectOptions: readonly SelectFieldOption[] = [
  {
    value: "red",
    label: "TLP:RED — Named recipients",
    icon: <TlpSwatch marking="red" />,
  },
  {
    value: "amber_strict",
    label: "TLP:AMBER+STRICT — Organization only",
    icon: <TlpSwatch marking="amber_strict" />,
  },
  {
    value: "amber",
    label: "TLP:AMBER — Organization and clients",
    icon: <TlpSwatch marking="amber" />,
  },
  {
    value: "green",
    label: "TLP:GREEN — Community",
    icon: <TlpSwatch marking="green" />,
  },
  {
    value: "clear",
    label: "TLP:CLEAR — No restriction",
    icon: <TlpSwatch marking="clear" />,
  },
];
