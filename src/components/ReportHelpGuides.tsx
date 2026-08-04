import type { ReportHelpTopicId } from "../lib/reportHelp";

interface ReportHelpGuidesProps {
  initialTopic?: ReportHelpTopicId;
}

export function ReportHelpGuides({ initialTopic }: ReportHelpGuidesProps) {
  return (
    <article
      className="mt-7 max-w-3xl rounded-sm border border-panel-border bg-panel-base px-7 py-6"
      data-help-topic={initialTopic ?? "document-native-reports"}
    >
      <h3 className="m-0 text-lg font-semibold">Document-native reports</h3>
      <p className="mt-2 text-copy-muted text-sm leading-6">
        Reports are blank, revisioned documents. Set the report ID, title, authors, producing
        organisation, and issue date in Report properties, then write the body directly in the
        editor.
      </p>
      <h4 className="mt-6 mb-2 text-sm font-semibold">Structure and pages</h4>
      <ul className="m-0 grid gap-2 pl-5 text-copy-secondary text-xs leading-5">
        <li>Use H1–H3 headings to build the editor outline and the generated PDF contents page.</li>
        <li>
          Insert a page break, or press Mod+Enter, when the next content must start on a new page.
        </li>
        <li>Choose A4 or Letter in the report header to preview the intended page size.</li>
      </ul>
      <h4 className="mt-6 mb-2 text-sm font-semibold">Insert project intelligence</h4>
      <ul className="m-0 grid gap-2 pl-5 text-copy-secondary text-xs leading-5">
        <li>
          Use Insert → Evidence to cite an Evidence vault item or place a supported image. Every
          referenced item is added to the evidence appendix once, in first-appearance order.
        </li>
        <li>
          Project data and MITRE observations are frozen snapshots. Use their visible Refresh action
          only when you deliberately want the latest upstream revision.
        </li>
        <li>
          Graph snapshots are encrypted PNG attachments. Choose inline placement or Analytical
          figures; publication always uses the saved graph revision.
        </li>
      </ul>
      <h4 className="mt-6 mb-2 text-sm font-semibold">Publishing</h4>
      <p className="m-0 text-copy-secondary text-xs leading-5">
        Typst produces the only publication format: PDF. It creates the branded cover, report
        administration, optional release history, nested table of contents, running furniture, page
        numbers, body, analytical figures, and evidence appendix. TLP appears on the cover and the
        running page furniture.
      </p>
    </article>
  );
}
