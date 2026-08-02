export const REPORT_HELP_TOPIC_IDS = [
  "investigations-and-analyst-notes",
  "threat-actor-profile",
  "intrusion-analysis",
  "campaign-report",
  "executive-report",
  "blank-guided-report",
  "illicit-ecosystem-report",
] as const;

export type ReportHelpTopicId = (typeof REPORT_HELP_TOPIC_IDS)[number];

export const DEFAULT_REPORT_HELP_TOPIC: ReportHelpTopicId = "investigations-and-analyst-notes";

const reportHelpTopicIds = new Set<string>(REPORT_HELP_TOPIC_IDS);

export function isReportHelpTopicId(value: string): value is ReportHelpTopicId {
  return reportHelpTopicIds.has(value);
}
