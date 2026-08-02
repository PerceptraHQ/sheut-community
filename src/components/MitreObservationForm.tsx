import { Button } from "@base-ui/react/button";
import { useState } from "react";
import type {
  AnalyticConfidence,
  TechniqueAssessment,
  TechniqueObservation,
  TechniqueObservationValues,
  TechniqueOutcome,
} from "../lib/mitre";
import { SelectField } from "./SelectField";

const assessmentOptions = [
  { value: "observed", label: "Observed" },
  { value: "suspected", label: "Suspected" },
  { value: "ruled_out", label: "Ruled out" },
] as const;

const outcomeOptions = [
  { value: "unknown", label: "Unknown" },
  { value: "attempted", label: "Attempted" },
  { value: "successful", label: "Successful" },
  { value: "prevented", label: "Prevented" },
] as const;

const confidenceOptions = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
] as const;

function toDateTimeInput(timestamp: number | null) {
  if (timestamp === null) return "";
  const date = new Date(timestamp);
  const local = new Date(timestamp - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDateTimeInput(value: string) {
  if (value === "") return null;
  const timestamp = new Date(value).getTime();
  return Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : null;
}

interface MitreObservationFormProps {
  initial?: TechniqueObservation;
  saving: boolean;
  onCancel: () => void;
  onSubmit: (values: TechniqueObservationValues) => Promise<void>;
}

export function MitreObservationForm({
  initial,
  saving,
  onCancel,
  onSubmit,
}: MitreObservationFormProps) {
  const [assessment, setAssessment] = useState<TechniqueAssessment>(
    initial?.assessment ?? "suspected",
  );
  const [outcome, setOutcome] = useState<TechniqueOutcome>(initial?.outcome ?? "unknown");
  const [confidence, setConfidence] = useState<AnalyticConfidence>(initial?.confidence ?? "medium");
  const [narrative, setNarrative] = useState(initial?.narrative ?? "");
  const [firstSeen, setFirstSeen] = useState(toDateTimeInput(initial?.firstSeenUnixMs ?? null));
  const [lastSeen, setLastSeen] = useState(toDateTimeInput(initial?.lastSeenUnixMs ?? null));
  const availableOutcomes =
    assessment === "ruled_out" ? outcomeOptions.slice(0, 1) : outcomeOptions;

  return (
    <form
      className="grid gap-2.5 border-panel-border border-t px-3 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({
          assessment,
          outcome,
          confidence,
          narrative,
          firstSeenUnixMs: fromDateTimeInput(firstSeen),
          lastSeenUnixMs: fromDateTimeInput(lastSeen),
        });
      }}
    >
      <h3 className="m-0 text-[11px] text-copy-faint uppercase tracking-wider">
        {initial ? "Edit mapping" : "New mapping"}
      </h3>
      <div className="grid grid-cols-3 gap-1.5">
        <SelectField
          ariaLabel="Assessment"
          label="Assessment"
          onChange={(value) => {
            const next = value as TechniqueAssessment;
            setAssessment(next);
            if (next === "ruled_out") setOutcome("unknown");
          }}
          options={assessmentOptions}
          placeholder="Choose assessment"
          required
          value={assessment}
        />
        <SelectField
          ariaLabel="Outcome"
          label="Outcome"
          onChange={(value) => setOutcome(value as TechniqueOutcome)}
          options={availableOutcomes}
          placeholder="Choose outcome"
          required
          value={outcome}
        />
        <SelectField
          ariaLabel="Analytic confidence"
          label="Confidence"
          onChange={(value) => setConfidence(value as AnalyticConfidence)}
          options={confidenceOptions}
          placeholder="Choose confidence"
          required
          value={confidence}
        />
      </div>
      <label className="grid gap-1.5 text-copy-secondary text-xs">
        Why this technique is mapped
        <textarea
          className="min-h-20 resize-y rounded-sm border border-panel-border bg-panel-deep px-2.5 py-2 text-copy-primary text-xs leading-5 outline-none focus:border-accent"
          aria-label="Analyst narrative"
          maxLength={4000}
          required
          value={narrative}
          onChange={(event) => setNarrative(event.currentTarget.value)}
        />
        <span className="justify-self-end text-[11px] text-copy-faint">
          {narrative.length}/4000
        </span>
      </label>
      <details className="rounded-sm border border-panel-border bg-panel-deep">
        <summary className="cursor-pointer px-2.5 py-2 text-[11px] text-copy-muted hover:text-copy-primary">
          Timing (optional)
        </summary>
        <div className="grid gap-2 border-panel-border border-t p-2.5">
          <label className="grid gap-1 text-[11px] text-copy-secondary">
            First seen
            <input
              className="h-8 min-w-0 rounded-sm border border-panel-border bg-panel-base px-2 text-[11px] text-copy-primary outline-none focus:border-accent"
              type="datetime-local"
              value={firstSeen}
              onChange={(event) => setFirstSeen(event.currentTarget.value)}
            />
          </label>
          <label className="grid gap-1 text-[11px] text-copy-secondary">
            Last seen
            <input
              className="h-8 min-w-0 rounded-sm border border-panel-border bg-panel-base px-2 text-[11px] text-copy-primary outline-none focus:border-accent"
              type="datetime-local"
              value={lastSeen}
              onChange={(event) => setLastSeen(event.currentTarget.value)}
            />
          </label>
        </div>
      </details>
      <div className="sticky bottom-0 flex justify-end gap-2 border-panel-border border-t bg-panel-base pt-2">
        <Button className="control-button" type="button" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        <Button className="primary-button" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save mapping"}
        </Button>
      </div>
    </form>
  );
}
