import { Tabs } from "@base-ui/react/tabs";
import { useState } from "react";
import {
  DEFAULT_REPORT_HELP_TOPIC,
  REPORT_HELP_TOPICS,
  type ReportHelpTopic,
  type ReportHelpTopicId,
  reportFieldProjectSource,
} from "../lib/reportHelp";

interface ReportHelpGuidesProps {
  initialTopic?: ReportHelpTopicId;
}

const guideTabClass =
  "w-full cursor-pointer rounded-sm border-0 bg-transparent px-3 py-2 text-left text-xs text-copy-muted outline-none hover:bg-panel-hover hover:text-copy-primary data-active:bg-panel-hover data-active:text-copy-primary";

export function ReportHelpGuides({ initialTopic }: ReportHelpGuidesProps) {
  const [topic, setTopic] = useState<ReportHelpTopicId>(initialTopic ?? DEFAULT_REPORT_HELP_TOPIC);

  return (
    <Tabs.Root
      className="mt-7 grid min-h-[34rem] grid-cols-[14rem_minmax(0,1fr)] overflow-hidden rounded-sm border border-panel-border bg-panel-base"
      onValueChange={(value) => setTopic(value as ReportHelpTopicId)}
      orientation="vertical"
      value={topic}
    >
      <Tabs.List
        aria-label="Document and report guides"
        className="grid content-start gap-0.5 border-panel-border border-r bg-panel-deep p-2"
      >
        {REPORT_HELP_TOPICS.map((guide) => (
          <Tabs.Tab className={guideTabClass} key={guide.id} value={guide.id}>
            {guide.title}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {REPORT_HELP_TOPICS.map((guide) => (
        <Tabs.Panel className="min-w-0 px-7 py-6" key={guide.id} value={guide.id}>
          <ReportGuide guide={guide} />
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  );
}

function ReportGuide({ guide }: { guide: ReportHelpTopic }) {
  return (
    <article className="max-w-3xl">
      <h3 className="m-0 text-lg font-semibold">{guide.title}</h3>
      <p className="mt-2 mb-0 text-copy-muted text-sm leading-6">{guide.summary}</p>

      <GuideSection title="Use this report when">
        <p className="m-0 text-copy-secondary text-xs leading-5">{guide.useWhen}</p>
      </GuideSection>

      <GuideSection title="Workflow">
        <ol className="m-0 grid gap-2 pl-5 text-copy-secondary text-xs leading-5">
          {guide.workflow.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </GuideSection>

      <GuideSection title="Field guidance">
        <ul className="m-0 grid gap-2 pl-5 text-copy-secondary text-xs leading-5">
          {guide.fieldGuidance.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </GuideSection>

      <GuideSection title="Field-by-field examples">
        <p className="mt-0 mb-3 rounded-sm border border-accent/30 bg-accent-soft px-3 py-2 text-copy-secondary text-xs leading-5">
          Every repeatable table cell offers <strong>Insert project data</strong> so you can reuse
          an existing object when it fits. Do not create one STIX object per cell. Create the
          reusable entity once, insert it into the matching entity cell, and type report-only
          context such as status, role, confidence, and explanation manually.
        </p>
        <div className="overflow-x-auto rounded-sm border border-panel-border">
          <table
            aria-label={`${guide.title} field examples`}
            className="w-full min-w-[64rem] border-collapse text-left text-xs"
          >
            <thead className="bg-panel-deep text-copy-faint">
              <tr>
                <th
                  className="w-1/5 border-panel-border border-b px-3 py-2 font-medium"
                  scope="col"
                >
                  Field
                </th>
                <th
                  className="w-[28%] border-panel-border border-b px-3 py-2 font-medium"
                  scope="col"
                >
                  What to enter
                </th>
                <th
                  className="w-1/4 border-panel-border border-b px-3 py-2 font-medium"
                  scope="col"
                >
                  Example
                </th>
                <th className="border-panel-border border-b px-3 py-2 font-medium" scope="col">
                  STIX or project source
                </th>
              </tr>
            </thead>
            <tbody>
              {guide.fieldExamples.map((field) => (
                <tr
                  className="align-top odd:bg-panel-base even:bg-panel-deep/40"
                  key={`${field.field}-${field.example}`}
                >
                  <th
                    className="border-panel-border border-b px-3 py-2 font-medium text-copy-primary"
                    scope="row"
                  >
                    {field.field}
                  </th>
                  <td className="border-panel-border border-b px-3 py-2 text-copy-secondary leading-5">
                    {field.guidance}
                  </td>
                  <td className="border-panel-border border-b px-3 py-2 text-copy-muted leading-5">
                    {field.example}
                  </td>
                  <td className="border-panel-border border-b px-3 py-2 text-copy-muted leading-5">
                    {reportFieldProjectSource(field.field)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GuideSection>

      <GuideSection title="Create STIX data and insert it">
        <ol className="m-0 grid gap-2 pl-5 text-copy-secondary text-xs leading-5">
          <li>
            Open <strong>Intelligence</strong>, choose <strong>New draft</strong>, and select the
            object type named in the table above.
          </li>
          <li>
            Fill the STIX 2.1 required properties using human-readable values. Sheut owns local IDs,
            object timestamps, bounded validation, and STIX IDs on export.
          </li>
          <li>
            Save the local draft. Both drafts and validated imported objects are immediately
            available to report fields through <strong>Insert project data</strong>.
          </li>
          <li>
            In the report, open the matching field or table cell and choose the object. Sheut copies
            a reader-facing name, observable value, date, or explanation—not an internal local ID.
          </li>
          <li>
            Create a STIX Relationship separately in Intelligence only after validating the source,
            target, and relationship type. Graph links never become STIX automatically.
          </li>
        </ol>
      </GuideSection>

      <GuideSection title="Evidence, project data, and publication">
        <p className="m-0 text-copy-secondary text-xs leading-5">
          Project-data insertion copies a human-readable projection into the selected field or table
          column while preserving an explicit reference where the field supports one. Evidence
          remains an encrypted project file and the report stores its reference. Review the Brand
          Profile, TLP marking, paper size, orientation, included sections, appendices, output name,
          and location in Publish. Publishing never changes the report or Brand Profile defaults.
        </p>
      </GuideSection>
    </article>
  );
}

function GuideSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 border-panel-border border-t pt-4">
      <h4 className="mt-0 mb-2 text-[11px] text-copy-faint uppercase tracking-wider">{title}</h4>
      {children}
    </section>
  );
}
