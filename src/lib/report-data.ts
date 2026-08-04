import { invoke } from "@tauri-apps/api/core";

export interface ProjectDataReference {
  kind: "intelligence" | "evidence" | "document" | "catalog_reference";
  id: string;
  label: string;
}

export interface ReportProjectDataItem extends ProjectDataReference {
  objectType: string;
  summary: string;
  values: Record<string, string>;
  revision?: number;
  sourceVersion?: string;
}

export interface ProjectDataSelection extends ProjectDataReference {
  values: Record<string, string>;
}

export function listReportProjectData(projectId: string): Promise<ReportProjectDataItem[]> {
  return invoke<ReportProjectDataItem[]>("list_report_project_data", { projectId });
}
