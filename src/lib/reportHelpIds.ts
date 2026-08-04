export const REPORT_HELP_TOPIC_IDS = ["document-native-reports"] as const;

export type ReportHelpTopicId = (typeof REPORT_HELP_TOPIC_IDS)[number];

export const DEFAULT_REPORT_HELP_TOPIC: ReportHelpTopicId = "document-native-reports";

const reportHelpTopicIds = new Set<string>(REPORT_HELP_TOPIC_IDS);

export function isReportHelpTopicId(value: string): value is ReportHelpTopicId {
  return reportHelpTopicIds.has(value);
}
