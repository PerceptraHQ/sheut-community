import { Button } from "@base-ui/react/button";
import { IconDatabase, IconLock } from "@tabler/icons-react";
import { lazy, Suspense, useState } from "react";
import type { DocumentEnvelope } from "../lib/documents";
import type { GraphItemProperties } from "../lib/graph";
import type { MitreTechniqueSelection } from "../lib/mitre";
import {
  type ProjectSummary,
  projectErrorMessage,
  type TlpMarking,
  updateProjectDefaultTlp,
} from "../lib/projects";
import { ScrollAreaFrame } from "./ScrollAreaFrame";
import { SelectField } from "./SelectField";
import { tlpSelectOptions } from "./TlpBadge";

const ProjectBackups = lazy(async () => {
  const module = await import("./ProjectBackups");
  return { default: module.ProjectBackups };
});

const DocumentHistory = lazy(async () => {
  const module = await import("./DocumentHistory");
  return { default: module.DocumentHistory };
});

const MitreTechniqueInspector = lazy(async () => {
  const module = await import("./MitreTechniqueInspector");
  return { default: module.MitreTechniqueInspector };
});

const GraphItemInspector = lazy(async () => {
  const module = await import("./graph/GraphItemInspector");
  return { default: module.GraphItemInspector };
});

interface ProjectInspectorProps {
  project: ProjectSummary | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  document: DocumentEnvelope | null;
  onDocumentRestored: (document: DocumentEnvelope) => void;
  mitreSelection: MitreTechniqueSelection | null;
  graphProperties: GraphItemProperties | null;
  onOpenGraphSource: (sourceView: string) => void;
  onTechniqueObservationChange: () => void;
  onProjectUpdated: (project: ProjectSummary) => void;
}

export function ProjectInspector({
  project,
  collapsed,
  onToggleCollapsed,
  document,
  onDocumentRestored,
  mitreSelection,
  graphProperties,
  onOpenGraphSource,
  onTechniqueObservationChange,
  onProjectUpdated,
}: ProjectInspectorProps) {
  const [updatingTlp, setUpdatingTlp] = useState(false);
  const [tlpError, setTlpError] = useState<string | null>(null);

  const handleTlpChange = async (marking: TlpMarking) => {
    if (!project || marking === project.defaultTlpMarking) return;
    setUpdatingTlp(true);
    setTlpError(null);
    try {
      onProjectUpdated(await updateProjectDefaultTlp(project.id, marking));
    } catch (cause) {
      setTlpError(projectErrorMessage(cause));
    } finally {
      setUpdatingTlp(false);
    }
  };
  return (
    <aside
      className="inspector min-w-0 border-panel-border border-l bg-panel-base"
      aria-label="Inspector"
      data-collapsed={collapsed}
      data-context={
        graphProperties ? "graph" : mitreSelection ? "mitre" : document ? "document" : "project"
      }
    >
      <header className="inspector-header border-panel-border border-b">
        {!collapsed ? (
          <h2 className="m-0 font-medium text-[11px] text-copy-muted uppercase tracking-[0.12em]">
            Properties
          </h2>
        ) : null}
        <Button
          className="icon-control panel-collapse-control"
          type="button"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? "Expand properties" : "Collapse properties"}
          title={collapsed ? "Expand properties" : "Collapse properties"}
        >
          <span aria-hidden="true">{collapsed ? "‹" : "›"}</span>
        </Button>
      </header>
      {collapsed ? (
        <div className="grid justify-items-center gap-2 py-2 text-copy-faint">
          <IconLock
            size={15}
            stroke={1.7}
            aria-label={project ? "Project unlocked" : "No project open"}
          />
          {project ? (
            <IconDatabase size={15} stroke={1.7} aria-label="Stored on this device" />
          ) : null}
        </div>
      ) : project ? (
        <ScrollAreaFrame className="h-[calc(100%-36px)]" contentClassName="min-w-0">
          {!document && !mitreSelection && !graphProperties ? (
            <dl className="m-0 divide-y divide-panel-border text-xs">
              <div className="px-3 py-3">
                <dt className="text-[11px] text-copy-faint uppercase tracking-wider">Local ID</dt>
                <dd className="mt-1 mb-0 break-all font-mono text-[11px] text-copy-secondary">
                  {project.id}
                </dd>
              </div>
              {project.defaultTlpMarking ? (
                <div className="px-3 py-3">
                  <dt>
                    <SelectField
                      ariaLabel="Project default TLP marking"
                      disabled={updatingTlp}
                      label="Default report marking"
                      onChange={(value) => void handleTlpChange(value as TlpMarking)}
                      options={tlpSelectOptions}
                      placeholder="Choose a TLP marking"
                      value={project.defaultTlpMarking}
                    />
                  </dt>
                  <dd className="mt-1.5 mb-0 text-[11px] text-copy-faint leading-4">
                    Used for new publications unless overridden.
                  </dd>
                  {tlpError ? (
                    <p className="error-message mt-2" role="alert">
                      {tlpError}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="grid gap-2 px-3 py-3 text-copy-secondary">
                <div className="flex items-center gap-2">
                  <IconLock size={14} stroke={1.7} aria-hidden="true" />
                  <span>Project unlocked</span>
                </div>
                <div className="flex items-center gap-2">
                  <IconDatabase size={14} stroke={1.7} aria-hidden="true" />
                  <span>Stored on this device</span>
                </div>
              </div>
            </dl>
          ) : null}
          {!document && !mitreSelection && !graphProperties ? (
            <Suspense fallback={null}>
              <ProjectBackups key={project.id} projectId={project.id} />
            </Suspense>
          ) : null}
          {document ? (
            <Suspense fallback={<p className="list-message">Loading history…</p>}>
              <DocumentHistory
                key={`${document.id}-${document.revision}`}
                projectId={project.id}
                document={document}
                onRestored={onDocumentRestored}
              />
            </Suspense>
          ) : null}
          {mitreSelection ? (
            <Suspense fallback={<p className="list-message">Loading technique…</p>}>
              <MitreTechniqueInspector
                key={`${mitreSelection.catalog}-${mitreSelection.version}-${mitreSelection.technique.id}-${mitreSelection.tacticId ?? "none"}-${mitreSelection.requestKey ?? 0}`}
                projectId={project.id}
                selection={mitreSelection}
                onObservationChange={onTechniqueObservationChange}
              />
            </Suspense>
          ) : null}
          {graphProperties ? (
            <Suspense fallback={<p className="list-message">Loading graph properties…</p>}>
              <GraphItemInspector properties={graphProperties} onOpenSource={onOpenGraphSource} />
            </Suspense>
          ) : null}
        </ScrollAreaFrame>
      ) : (
        <div className="grid h-[calc(100%-2.25rem)] place-items-center p-6 text-center">
          <div>
            <IconLock
              className="mx-auto text-copy-faint"
              size={22}
              stroke={1.4}
              aria-hidden="true"
            />
            <p className="mt-3 mb-0 text-copy-muted text-xs leading-5">
              Open a project to inspect its local properties.
            </p>
          </div>
        </div>
      )}
    </aside>
  );
}
