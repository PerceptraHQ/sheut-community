import { Button } from "@base-ui/react/button";
import { Collapsible } from "@base-ui/react/collapsible";
import { Switch } from "@base-ui/react/switch";
import { Tabs } from "@base-ui/react/tabs";
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { useState } from "react";
import thirdPartyNotices from "../../THIRD_PARTY_NOTICES.md?raw";
import type { ReportHelpTopicId } from "../lib/reportHelp";
import type { TelemetryConsent } from "../lib/telemetry";
import {
  DEFAULT_WORKBENCH_LAYOUT,
  saveWorkbenchLayout,
  type WorkbenchLayoutPreferences,
  type WorkbenchSide,
} from "../lib/workbenchLayout";
import { BrandStudio } from "./BrandStudio";
import { ReportHelpGuides } from "./ReportHelpGuides";

export type SettingsSectionId = "appearance" | "data" | "brand" | "help" | "about";

interface SettingsWorkspaceProps {
  initialHelpTopic?: ReportHelpTopicId;
  initialSection?: SettingsSectionId;
  layout: WorkbenchLayoutPreferences;
  onLayoutChange: (layout: WorkbenchLayoutPreferences) => void;
  onTelemetryPreferenceChange?: (enabled: boolean) => Promise<void>;
  projectId?: string;
  projectName?: string;
  telemetryConsent?: TelemetryConsent;
}

const settingsTabClass =
  "w-full cursor-pointer rounded-sm border-0 bg-transparent px-3 py-2 text-left text-xs text-copy-muted outline-none hover:bg-panel-hover hover:text-copy-primary data-active:bg-panel-hover data-active:text-copy-primary";

export function SettingsWorkspace({
  initialHelpTopic,
  initialSection = "appearance",
  layout,
  onLayoutChange,
  onTelemetryPreferenceChange = () => Promise.resolve(),
  projectId,
  projectName,
  telemetryConsent = "disabled",
}: SettingsWorkspaceProps) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(initialSection);
  const [telemetryBusy, setTelemetryBusy] = useState(false);
  const [telemetryError, setTelemetryError] = useState(false);

  const patchLayout = (patch: Partial<WorkbenchLayoutPreferences>) => {
    const next = { ...layout, ...patch };
    saveWorkbenchLayout(next);
    onLayoutChange(next);
  };

  const resetLayout = () => {
    const next = { ...DEFAULT_WORKBENCH_LAYOUT };
    saveWorkbenchLayout(next);
    onLayoutChange(next);
  };

  const changeTelemetryPreference = async (enabled: boolean) => {
    setTelemetryBusy(true);
    setTelemetryError(false);
    try {
      await onTelemetryPreferenceChange(enabled);
    } catch {
      setTelemetryError(true);
    } finally {
      setTelemetryBusy(false);
    }
  };

  return (
    <Tabs.Root
      className="grid h-full min-h-0 grid-cols-[12rem_minmax(0,1fr)]"
      onValueChange={(value) => setActiveSection(value as SettingsSectionId)}
      orientation="vertical"
      value={activeSection}
    >
      <aside className="border-panel-border border-r bg-panel-base p-2" aria-label="Settings">
        <div className="px-3 pt-2 pb-3">
          <p className="m-0 text-[11px] text-copy-faint uppercase tracking-[0.12em]">Application</p>
          <h1 className="mt-1 mb-0 text-sm font-semibold">Settings</h1>
        </div>
        <Tabs.List className="grid gap-0.5" aria-label="Settings sections">
          <Tabs.Tab className={settingsTabClass} value="appearance">
            Appearance & layout
          </Tabs.Tab>
          <Tabs.Tab className={settingsTabClass} value="data">
            Data & security
          </Tabs.Tab>
          {projectId && projectName ? (
            <Tabs.Tab className={settingsTabClass} value="brand">
              Brand Studio
            </Tabs.Tab>
          ) : null}
          <Tabs.Tab className={settingsTabClass} value="help">
            Help & guides
          </Tabs.Tab>
          <Tabs.Tab className={settingsTabClass} value="about">
            About & notices
          </Tabs.Tab>
        </Tabs.List>
      </aside>

      <div className="min-h-0 overflow-y-auto">
        <Tabs.Panel className="mx-auto max-w-3xl px-8 py-10" value="appearance">
          <SettingsHeading
            title="Appearance & layout"
            description="Shape the workbench around the current analysis task. These preferences stay on this device."
          />
          <SettingsSection title="Visibility">
            <SettingSwitch
              checked={layout.activityBarVisible}
              label="Activity bar"
              description="Show application-level navigation and Settings."
              onCheckedChange={(activityBarVisible) => patchLayout({ activityBarVisible })}
            />
            <SettingSwitch
              checked={layout.primarySideBarVisible}
              label="Primary sidebar"
              description="Show project and workspace navigation."
              onCheckedChange={(primarySideBarVisible) => patchLayout({ primarySideBarVisible })}
            />
            <SettingSwitch
              checked={layout.secondarySideBarVisible}
              label="Secondary sidebar"
              description="Show Properties and linked-item inspection."
              onCheckedChange={(secondarySideBarVisible) =>
                patchLayout({ secondarySideBarVisible })
              }
            />
            <SettingSwitch
              checked={layout.centeredLayout}
              label="Centered layout"
              description="Keep reading and editing surfaces at a comfortable measure."
              onCheckedChange={(centeredLayout) => patchLayout({ centeredLayout })}
            />
          </SettingsSection>

          <SettingsSection title="Panel alignment">
            <PositionSetting
              label="Primary dock"
              value={layout.activityBarPosition}
              onValueChange={(activityBarPosition) => patchLayout({ activityBarPosition })}
            />
            <PositionSetting
              label="Secondary sidebar"
              value={layout.secondarySideBarPosition}
              onValueChange={(secondarySideBarPosition) =>
                patchLayout({ secondarySideBarPosition })
              }
            />
          </SettingsSection>

          <div className="mt-6 border-panel-border border-t pt-4">
            <Button className="control-button" type="button" onClick={resetLayout}>
              Reset workbench layout
            </Button>
          </div>
        </Tabs.Panel>

        <Tabs.Panel className="mx-auto max-w-3xl px-8 py-10" value="data">
          <SettingsHeading
            title="Data & security"
            description="Community keeps ordinary project work local and offline."
          />
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <InformationCard
              title="Encrypted project storage"
              description="Project content is persisted by Rust in a SQLCipher-compatible SQLite database. React receives no database keys, SQL, or filesystem paths."
            />
            <InformationCard
              title="Offline by default"
              description="There is no account or project-data network traffic. Anonymous diagnostics and usage events are sent only after explicit opt-in."
            />
            <InformationCard
              title="Recovery belongs to Community"
              description="Encrypted recovery points and portable local import/export are not paid features."
            />
            <InformationCard
              title="Explicit semantics"
              description="Visual links remain visual until an analyst explicitly validates a separate STIX relationship draft."
            />
          </div>
          <SettingsSection title="Telemetry controls">
            <SettingSwitch
              checked={telemetryConsent === "enabled"}
              label="Anonymous diagnostics and usage"
              description="Send fixed event names for coarse feature use and unexpected application failures."
              disabled={telemetryBusy}
              onCheckedChange={(enabled) => void changeTelemetryPreference(enabled)}
            />
          </SettingsSection>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <InformationCard
              title="Collected after opt-in"
              description="Application version, operating-system family, CPU architecture, random installation identifier, event time, and one fixed allowlisted event name."
            />
            <InformationCard
              title="Never collected"
              description="Project identifiers or content; graph data; report titles, sections, fields, rows, or prose; STIX objects; evidence metadata or files; notes; attachments; searches; paths; URLs; error messages; credentials; or identity."
            />
          </div>
          <p className="mt-3 mb-0 text-copy-faint text-[11px] leading-5">
            {telemetryConsent === "enabled"
              ? "Telemetry is enabled. Turning it off removes the local installation identifier and stops future reports."
              : "Telemetry is off. Sheut sends no diagnostic network requests and keeps no telemetry installation identifier."}
          </p>
          {telemetryError ? (
            <p className="error-message mt-3" role="alert">
              Sheut could not save the telemetry setting. The previous setting remains active.
            </p>
          ) : null}
          <p className="mt-5 mb-0 text-copy-faint text-xs leading-5">
            Managed connectors, collaboration, SSO, organization policy, centralized key management,
            and managed backups belong to Enterprise.
          </p>
        </Tabs.Panel>

        {projectId && projectName ? (
          <Tabs.Panel className="mx-auto max-w-4xl px-8 py-10" value="brand">
            <BrandStudio projectId={projectId} projectName={projectName} />
          </Tabs.Panel>
        ) : null}

        <Tabs.Panel className="mx-auto max-w-6xl px-8 py-10" value="help">
          <SettingsHeading
            title="Help & guides"
            description="Offline guidance for choosing, completing, validating, and publishing every document and report type."
          />
          <ReportHelpGuides initialTopic={initialHelpTopic} />
        </Tabs.Panel>

        <Tabs.Panel className="mx-auto max-w-3xl px-8 py-10" value="about">
          <SettingsHeading
            title="About Sheut Community"
            description="A local-first cyber threat intelligence workbench by PerceptraHQ."
          />
          <dl className="mt-6 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
            <dt className="text-copy-faint">Version</dt>
            <dd className="m-0 text-copy-secondary">0.1.0 pre-alpha</dd>
            <dt className="text-copy-faint">Application license</dt>
            <dd className="m-0 text-copy-secondary">Mozilla Public License 2.0</dd>
            <dt className="text-copy-faint">Runtime policy</dt>
            <dd className="m-0 text-copy-secondary">Local-first and offline during ordinary use</dd>
          </dl>

          <section className="mt-8" aria-labelledby="third-party-notices-title">
            <h2 className="m-0 text-sm font-semibold" id="third-party-notices-title">
              Third-party notices
            </h2>
            <p className="mt-1 mb-4 text-copy-muted text-xs leading-5">
              Licenses and provenance for bundled software, fonts, catalogs, and STIX artwork.
            </p>
            <div className="overflow-hidden rounded-sm border border-panel-border bg-panel-base">
              {noticeSections.map((section) => (
                <Collapsible.Root
                  className="border-panel-border border-b last:border-b-0"
                  key={section.heading}
                >
                  <Collapsible.Trigger
                    render={
                      <Button
                        className="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-3 py-2.5 text-left text-copy-secondary text-xs outline-none hover:bg-panel-hover hover:text-copy-primary"
                        type="button"
                      />
                    }
                  >
                    <span className="min-w-0 flex-1">{section.heading}</span>
                    <span
                      className="text-copy-faint group-data-panel-open:rotate-90"
                      aria-hidden="true"
                    >
                      ›
                    </span>
                  </Collapsible.Trigger>
                  <Collapsible.Panel className="border-panel-border border-t bg-panel-deep px-3 py-3">
                    <p className="m-0 whitespace-pre-wrap text-[11px] text-copy-muted leading-5">
                      {section.body}
                    </p>
                  </Collapsible.Panel>
                </Collapsible.Root>
              ))}
            </div>
          </section>
        </Tabs.Panel>
      </div>
    </Tabs.Root>
  );
}

function SettingsHeading({ title, description }: { title: string; description: string }) {
  return (
    <header>
      <h2 className="m-0 text-xl font-semibold">{title}</h2>
      <p className="mt-2 mb-0 max-w-2xl text-copy-muted text-sm leading-6">{description}</p>
    </header>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="mt-7"
      aria-labelledby={`settings-${title.toLocaleLowerCase().replaceAll(" ", "-")}`}
    >
      <h3
        className="m-0 border-panel-border border-b pb-2 text-[11px] text-copy-faint uppercase tracking-wider"
        id={`settings-${title.toLocaleLowerCase().replaceAll(" ", "-")}`}
      >
        {title}
      </h3>
      <div className="divide-y divide-panel-border">{children}</div>
    </section>
  );
}

function SettingSwitch({
  checked,
  disabled = false,
  label,
  description,
  onCheckedChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  description: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  const switchId = `settings-${label.toLocaleLowerCase().replaceAll(" ", "-")}`;
  const descriptionId = `${switchId}-description`;
  return (
    <div className="flex items-center gap-5 py-3">
      <span className="min-w-0 flex-1">
        <label
          className="block cursor-pointer text-copy-primary text-xs font-medium"
          htmlFor={switchId}
        >
          {label}
        </label>
        <span className="mt-0.5 block text-[11px] text-copy-faint leading-4" id={descriptionId}>
          {description}
        </span>
      </span>
      <Switch.Root
        id={switchId}
        nativeButton
        render={<button type="button" />}
        checked={checked}
        disabled={disabled}
        className="flex h-5 w-9 shrink-0 rounded-full border border-panel-border bg-panel-deep p-0.5 transition-colors data-checked:border-accent data-checked:bg-accent"
        onCheckedChange={onCheckedChange}
        aria-describedby={descriptionId}
      >
        <Switch.Thumb className="size-3.5 rounded-full bg-copy-muted transition-transform data-checked:translate-x-4 data-checked:bg-white" />
      </Switch.Root>
    </div>
  );
}

function PositionSetting({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: WorkbenchSide;
  onValueChange: (value: WorkbenchSide) => void;
}) {
  return (
    <div className="flex items-center gap-5 py-3">
      <span className="min-w-0 flex-1 text-copy-primary text-xs font-medium">{label}</span>
      <ToggleGroup
        className="inline-flex overflow-hidden rounded-sm border border-panel-border bg-panel-deep"
        aria-label={`${label} position`}
        value={[value]}
        onValueChange={(values) => {
          const next = values[0];
          if (next === "left" || next === "right") onValueChange(next);
        }}
      >
        <Toggle
          className="h-7 min-w-14 cursor-pointer border-0 border-panel-border border-r bg-transparent px-2 text-[11px] text-copy-muted outline-none hover:bg-panel-hover data-pressed:bg-accent-soft data-pressed:text-accent-bright"
          value="left"
        >
          Left
        </Toggle>
        <Toggle
          className="h-7 min-w-14 cursor-pointer border-0 bg-transparent px-2 text-[11px] text-copy-muted outline-none hover:bg-panel-hover data-pressed:bg-accent-soft data-pressed:text-accent-bright"
          value="right"
        >
          Right
        </Toggle>
      </ToggleGroup>
    </div>
  );
}

function InformationCard({ title, description }: { title: string; description: string }) {
  return (
    <article className="rounded-sm border border-panel-border bg-panel-base p-4">
      <h3 className="m-0 text-copy-primary text-xs font-semibold">{title}</h3>
      <p className="mt-1.5 mb-0 text-[11px] text-copy-muted leading-5">{description}</p>
    </article>
  );
}

const noticeSections = thirdPartyNotices
  .split(/\n(?=## )/u)
  .filter((section) => section.startsWith("## "))
  .map((section) => {
    const [heading, ...body] = section.split("\n");
    return {
      heading: heading.replace(/^## /u, "").trim(),
      body: body.join("\n").trim(),
    };
  });
