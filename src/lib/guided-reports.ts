/** Guided-report contracts over revisioned Rust validation and encrypted persistence. */
import { invoke } from "@tauri-apps/api/core";
import type { DocumentExportOutcome, DocumentPublicationOptions, DocumentRoot } from "./documents";

export type BuiltinReportTemplate =
  | "threat_actor_profile"
  | "intrusion_analysis"
  | "campaign_report"
  | "executive_report"
  | "blank_guided_report";

export type ReportFieldKind =
  | "short_text"
  | "long_text"
  | "narrative"
  | "date"
  | "confidence"
  | "choice"
  | "project_references"
  | "repeatable_rows";

export interface ReportTemplateField {
  key: string;
  label: string;
  help_text: string | null;
  kind: ReportFieldKind;
  required: boolean;
  columns: string[];
  options?: string[];
}

export interface ReportTemplateSection {
  key: string;
  title: string;
  optional: boolean;
  guidance?: string | null;
  fields: ReportTemplateField[];
}

export interface ReportTemplateDefinition {
  schema_version: 1;
  id: string;
  revision: number;
  builtin: BuiltinReportTemplate | null;
  name: string;
  description: string;
  sections: ReportTemplateSection[];
}

export interface ProjectDataReference {
  kind: "intelligence" | "evidence" | "document" | "catalog_reference";
  id: string;
  label: string;
}

export interface ReportProjectDataItem extends ProjectDataReference {
  objectType: string;
  summary: string;
  values: Record<string, string>;
}

export interface ProjectDataSelection extends ProjectDataReference {
  values: Record<string, string>;
}

export interface GuidedReportRowReference {
  rowIndex: number;
  column: string;
  reference: ProjectDataReference;
}

export type GuidedReportFieldValue =
  | { type: "text"; value: string }
  | { type: "narrative"; value: DocumentRoot }
  | { type: "rows"; value: Array<Record<string, string>> }
  | {
      type: "linked_rows";
      value: { rows: Array<Record<string, string>>; references: GuidedReportRowReference[] };
    }
  | { type: "project_references"; value: ProjectDataReference[] };

export interface GuidedReport {
  schema_version: 1;
  id: string;
  revision: number;
  template_id: string;
  template_revision: number;
  title: string;
  included_sections: string[];
  section_dispositions?: Record<string, ReportSectionDisposition>;
  fields: Record<string, GuidedReportFieldValue>;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  deleted_at_unix_ms: number | null;
}

export type ReportSectionDisposition = "active" | "not_applicable";

export interface ReportReadinessWarning {
  section_key: string;
  field_key: string;
  message: string;
}

export interface EvidenceFileMetadata {
  id: string;
  revision: number;
  mediaType: string;
  fileName: string;
  byteLen: number;
  sha256: string;
  title: string;
  description: string;
  source: string;
  capturedAt: string | null;
  sourceUrl: string;
  tags: string[];
  analystNotes: string;
  createdAtUnixMs: number;
  updatedAtUnixMs: number;
}

export interface EvidenceMetadataInput {
  title: string;
  description: string;
  source: string;
  capturedAt: string | null;
  sourceUrl: string;
  tags: string[];
  analystNotes: string;
}

export function listReportTemplates(projectId: string): Promise<ReportTemplateDefinition[]> {
  return invoke<ReportTemplateDefinition[]>("list_report_templates", { projectId });
}

export function createCustomReportTemplate(
  projectId: string,
  baseTemplateId: string,
  name: string,
  description: string,
  additionalSections: ReportTemplateSection[],
): Promise<ReportTemplateDefinition> {
  return invoke<ReportTemplateDefinition>("create_custom_report_template", {
    projectId,
    baseTemplateId,
    name,
    description,
    additionalSections,
  });
}

export function listGuidedReports(projectId: string): Promise<GuidedReport[]> {
  return invoke<GuidedReport[]>("list_guided_reports", { projectId });
}

export function listReportProjectData(projectId: string): Promise<ReportProjectDataItem[]> {
  return invoke<ReportProjectDataItem[]>("list_report_project_data", { projectId });
}

export function createGuidedReport(projectId: string, templateId: string): Promise<GuidedReport> {
  return invoke<GuidedReport>("create_guided_report", { projectId, templateId });
}

export function saveGuidedReport(
  projectId: string,
  reportId: string,
  expectedRevision: number,
  title: string,
  fields: Record<string, GuidedReportFieldValue>,
): Promise<GuidedReport> {
  return invoke<GuidedReport>("save_guided_report", {
    projectId,
    reportId,
    expectedRevision,
    title,
    fields,
  });
}

export function getGuidedReportReadiness(
  projectId: string,
  reportId: string,
): Promise<ReportReadinessWarning[]> {
  return invoke<ReportReadinessWarning[]>("get_guided_report_readiness", {
    projectId,
    reportId,
  });
}

export function updateGuidedReportSectionDisposition(
  projectId: string,
  reportId: string,
  expectedRevision: number,
  sectionKey: string,
  disposition: ReportSectionDisposition,
): Promise<GuidedReport> {
  return invoke<GuidedReport>("update_guided_report_section_disposition", {
    projectId,
    reportId,
    expectedRevision,
    sectionKey,
    disposition,
  });
}

export function upgradeIllicitEcosystemReport(
  projectId: string,
  reportId: string,
  expectedRevision: number,
): Promise<GuidedReport> {
  return invoke<GuidedReport>("upgrade_illicit_ecosystem_report", {
    projectId,
    reportId,
    expectedRevision,
  });
}

export function deleteGuidedReport(projectId: string, reportId: string): Promise<void> {
  return invoke<void>("delete_guided_report", { projectId, reportId });
}

export function restoreGuidedReport(projectId: string, reportId: string): Promise<GuidedReport> {
  return invoke<GuidedReport>("restore_guided_report", { projectId, reportId });
}

export function exportGuidedReport(
  projectId: string,
  reportId: string,
  options: DocumentPublicationOptions,
): Promise<DocumentExportOutcome> {
  return invoke<DocumentExportOutcome>("export_guided_report", {
    projectId,
    reportId,
    options,
  });
}

export function importEvidenceImage(projectId: string): Promise<EvidenceFileMetadata | null> {
  return invoke<EvidenceFileMetadata | null>("import_evidence_image", { projectId });
}

export function importEvidenceFile(projectId: string): Promise<EvidenceFileMetadata | null> {
  return invoke<EvidenceFileMetadata | null>("import_evidence_file", { projectId });
}

export function listEvidenceFiles(projectId: string): Promise<EvidenceFileMetadata[]> {
  return invoke<EvidenceFileMetadata[]>("list_evidence_files", { projectId });
}

export function loadEvidenceImage(projectId: string, evidenceId: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("load_evidence_image", {
    projectId,
    evidenceId,
  });
}

export function updateEvidenceMetadata(
  projectId: string,
  evidenceId: string,
  expectedRevision: number,
  input: EvidenceMetadataInput,
): Promise<EvidenceFileMetadata> {
  return invoke<EvidenceFileMetadata>("update_evidence_metadata", {
    projectId,
    evidenceId,
    expectedRevision,
    input,
  });
}

export function deleteEvidenceFile(
  projectId: string,
  evidenceId: string,
  expectedRevision: number,
): Promise<void> {
  return invoke<void>("delete_evidence_file", { projectId, evidenceId, expectedRevision });
}

export function guidedReportErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && typeof Reflect.get(error, "code") === "string"
      ? (Reflect.get(error, "code") as string)
      : "";
  if (code === "revision_conflict") return "This report changed elsewhere. Reload it and retry.";
  if (code === "document_not_found") return "That report or template is no longer available.";
  if (code === "project_locked") return "Unlock the project before opening its reports.";
  if (code === "invalid_document") return "This report contains invalid or unsupported values.";
  if (code === "invalid_attachment")
    return "Choose a PNG, JPEG, or WebP image no larger than 10 MiB.";
  if (code === "attachment_not_found") return "That Evidence file is no longer available.";
  return "The guided report could not be saved. Try again.";
}

export function evidenceErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && typeof Reflect.get(error, "code") === "string"
      ? (Reflect.get(error, "code") as string)
      : "";
  if (code === "revision_conflict")
    return "This evidence metadata changed elsewhere. Reload it and retry.";
  if (code === "attachment_not_found") return "That Evidence file is no longer available.";
  if (code === "project_locked") return "Unlock the project before opening its Evidence library.";
  if (code === "invalid_attachment")
    return "Check the title, date, source URL, tags, and notes, then try again.";
  return "The Evidence operation could not be completed. Try again.";
}
