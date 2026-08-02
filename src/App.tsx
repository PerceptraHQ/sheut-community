import { Button } from "@base-ui/react/button";
import {
  IconGitFork,
  IconLayoutGrid,
  IconLock,
  IconNotes,
  IconPhoto,
  IconSettings,
  IconTopologyStar3,
} from "@tabler/icons-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import { ActivityRail } from "./components/ActivityRail";
import type { CreateProjectRequest } from "./components/CreateProjectDialog";
import { ProjectExplorer } from "./components/ProjectExplorer";
import { ProjectLauncher } from "./components/ProjectLauncher";
import type { SettingsSectionId } from "./components/SettingsWorkspace";
import { useVaultNotices, VaultNoticeProvider } from "./components/VaultNotices";
import { WorkspaceErrorBoundary } from "./components/WorkspaceErrorBoundary";
import { WorkspaceLoadingState } from "./components/WorkspaceState";
import {
  DESKTOP_ACTION_EVENT,
  type DesktopActionId,
  desktopActionFromKeyboardEvent,
  helpTopicFromDesktopAction,
  isDesktopActionId,
  type WorkspaceActionId,
} from "./lib/desktopActions";
import type { DocumentEnvelope } from "./lib/documents";
import type { GraphItemProperties } from "./lib/graph";
import type { MitreTechniqueSelection } from "./lib/mitre";
import type { SearchDestination } from "./lib/projectSearch";
import {
  createPassphraseProject,
  createProject,
  deleteProject,
  listProjects,
  lockProject,
  PROJECTS_AUTO_LOCKED_EVENT,
  type ProjectSummary,
  projectErrorMessage,
  projectsAutoLockedFromEvent,
  unlockPassphraseProject,
  unlockProject,
} from "./lib/projects";
import type { ReportHelpTopicId } from "./lib/reportHelp";
import { saveWorkbenchLayout, type WorkbenchLayoutPreferences } from "./lib/workbenchLayout";

const loadInvestigationsWorkspace = () => import("./components/InvestigationsWorkspace");
const InvestigationsWorkspace = lazy(async () => ({
  default: (await loadInvestigationsWorkspace()).InvestigationsWorkspace,
}));
const loadIntelligenceWorkspace = () => import("./components/IntelligenceWorkspace");
const IntelligenceWorkspace = lazy(async () => ({
  default: (await loadIntelligenceWorkspace()).IntelligenceWorkspace,
}));
const EvidenceWorkspace = lazy(async () => ({
  default: (await import("./components/EvidenceWorkspace")).EvidenceWorkspace,
}));
const ProjectOverview = lazy(async () => ({
  default: (await import("./components/ProjectOverview")).ProjectOverview,
}));
const loadMitreWorkspace = () => import("./components/MitreWorkspace");
const MitreWorkspace = lazy(async () => ({
  default: (await loadMitreWorkspace()).MitreWorkspace,
}));
const GraphWorkspace = lazy(async () => ({
  default: (await import("./components/graph/GraphWorkspace")).GraphWorkspace,
}));
const WindowTitleBar = lazy(async () => ({
  default: (await import("./components/WindowTitleBar")).WindowTitleBar,
}));
const ProjectInspector = lazy(async () => ({
  default: (await import("./components/ProjectInspector")).ProjectInspector,
}));
const ProjectCommandPalette = lazy(async () => ({
  default: (await import("./components/ProjectCommandPalette")).ProjectCommandPalette,
}));
const SettingsWorkspace = lazy(async () => ({
  default: (await import("./components/SettingsWorkspace")).SettingsWorkspace,
}));

type WorkspaceView = SearchDestination;

function Workbench() {
  const notices = useVaultNotices();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [currentProject, setCurrentProject] = useState<ProjectSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lockError, setLockError] = useState<string | null>(null);
  const [locking, setLocking] = useState(false);
  const [activeView, setActiveView] = useState<WorkspaceView>("overview");
  const [documentBusy, setDocumentBusy] = useState(false);
  const [explorerCollapsed, setExplorerCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<DocumentEnvelope | null>(null);
  const [externallyRestoredDocument, setExternallyRestoredDocument] =
    useState<DocumentEnvelope | null>(null);
  const [selectedMitreTechnique, setSelectedMitreTechnique] =
    useState<MitreTechniqueSelection | null>(null);
  const [mitreRefreshKey, setMitreRefreshKey] = useState(0);
  const [selectedGraphItem, setSelectedGraphItem] = useState<GraphItemProperties | null>(null);
  const [graphFocusMode, setGraphFocusMode] = useState(false);
  const [zenMode, setZenMode] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [workspaceActionRequest, setWorkspaceActionRequest] = useState<{
    action: WorkspaceActionId;
    requestKey: number;
  } | null>(null);
  const [settingsRequest, setSettingsRequest] = useState<{
    section: SettingsSectionId;
    helpTopic?: ReportHelpTopicId;
  }>({ section: "appearance" });
  const [workbenchLayout, setWorkbenchLayout] = useState<WorkbenchLayoutPreferences>({
    activityBarPosition: "left",
    activityBarVisible: true,
    centeredLayout: false,
    primarySideBarVisible: true,
    secondarySideBarPosition: "right",
    secondarySideBarVisible: true,
  });
  const panelStateBeforeGraphFocus = useRef({ explorer: false, inspector: false });
  const explorerCollapsedRef = useRef(explorerCollapsed);
  const inspectorCollapsedRef = useRef(inspectorCollapsed);
  const mitreSelectionRequest = useRef(0);
  const workspaceActionSequence = useRef(0);
  const handleDocumentBusyChange = useCallback((busy: boolean) => setDocumentBusy(busy), []);
  const handleSelectedDocumentChange = useCallback(
    (document: DocumentEnvelope | null) => setSelectedDocument(document),
    [],
  );
  const handleWorkspaceActionHandled = useCallback((requestKey: number) => {
    setWorkspaceActionRequest((current) => (current?.requestKey === requestKey ? null : current));
  }, []);
  const handleSelectView = useCallback((view: WorkspaceView) => {
    setActiveView(view);
    if (view !== "investigations") {
      setSelectedDocument(null);
      setExternallyRestoredDocument(null);
    }
    if (view !== "mitre") setSelectedMitreTechnique(null);
    if (view !== "graph") setSelectedGraphItem(null);
  }, []);

  const handleGraphFocusModeChange = useCallback((active: boolean) => {
    setGraphFocusMode(active);
    if (active) {
      panelStateBeforeGraphFocus.current = {
        explorer: explorerCollapsedRef.current,
        inspector: inspectorCollapsedRef.current,
      };
      setExplorerCollapsed(true);
      setInspectorCollapsed(true);
      return;
    }
    setExplorerCollapsed(panelStateBeforeGraphFocus.current.explorer);
    setInspectorCollapsed(panelStateBeforeGraphFocus.current.inspector);
  }, []);

  useEffect(() => {
    explorerCollapsedRef.current = explorerCollapsed;
    inspectorCollapsedRef.current = inspectorCollapsed;
  }, [explorerCollapsed, inspectorCollapsed]);

  const handleSelectMitreTechnique = useCallback((selection: MitreTechniqueSelection) => {
    mitreSelectionRequest.current += 1;
    setSelectedMitreTechnique({
      ...selection,
      requestKey: mitreSelectionRequest.current,
    });
    setInspectorCollapsed(false);
  }, []);

  useEffect(() => {
    let active = true;
    listProjects()
      .then((discovered) => {
        if (active) setProjects(discovered);
      })
      .catch((cause: unknown) => {
        if (active) setLoadError(projectErrorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!currentProject) return;
    const timer = window.setTimeout(() => {
      void Promise.all([
        loadInvestigationsWorkspace().then(({ prefetchDocumentEditor }) =>
          prefetchDocumentEditor(),
        ),
        loadIntelligenceWorkspace(),
        loadMitreWorkspace(),
      ]);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [currentProject]);

  const handleCreate = async ({
    name,
    unlockMethod,
    defaultTlpMarking,
    passphrase,
  }: CreateProjectRequest) => {
    const created =
      unlockMethod === "passphrase"
        ? await createPassphraseProject(name, defaultTlpMarking, passphrase ?? "")
        : await createProject(name, defaultTlpMarking);
    setProjects((existing) => [
      ...existing.filter((project) => project.id !== created.id),
      created,
    ]);
    setCurrentProject(created);
    handleSelectView("overview");
    notices.add({
      title: "Project created",
      description: `${created.name ?? name} is open.`,
      type: "success",
    });
  };

  const handleUnlockDevice = async (projectId: string) => {
    const unlocked = await unlockProject(projectId);
    setProjects((existing) =>
      existing.map((project) => (project.id === unlocked.id ? unlocked : project)),
    );
    setCurrentProject(unlocked);
    handleSelectView("overview");
    notices.add({
      title: "Project unlocked",
      description: `${unlocked.name ?? "Local project"} is ready.`,
      type: "success",
    });
  };

  const handleUnlockPassphrase = async (projectId: string, passphrase: string) => {
    const unlocked = await unlockPassphraseProject(projectId, passphrase);
    setProjects((existing) =>
      existing.map((project) => (project.id === unlocked.id ? unlocked : project)),
    );
    setCurrentProject(unlocked);
    handleSelectView("overview");
    notices.add({
      title: "Project unlocked",
      description: `${unlocked.name ?? "Local project"} is ready.`,
      type: "success",
    });
  };

  const handleLock = useCallback(async () => {
    if (!currentProject) return;
    setLockError(null);
    setLocking(true);
    try {
      await lockProject(currentProject.id);
      setProjects((existing) =>
        existing.map((project) =>
          project.id === currentProject.id ? { ...project, locked: true } : project,
        ),
      );
      setCurrentProject(null);
      handleSelectView("overview");
      notices.add({
        title: "Project locked",
        description: `${currentProject.name ?? "Local project"} is closed.`,
        type: "success",
      });
    } catch (cause) {
      setLockError(projectErrorMessage(cause));
    } finally {
      setLocking(false);
    }
  }, [currentProject, handleSelectView, notices]);

  const handleDeleteProject = async (projectId: string) => {
    await deleteProject(projectId);
    setProjects((existing) => existing.filter((project) => project.id !== projectId));
    notices.add({
      title: "Project deleted",
      description: "The project and all of its local data were removed.",
      type: "success",
    });
  };

  const handleDesktopAction = useCallback(
    (action: DesktopActionId) => {
      const helpTopic = helpTopicFromDesktopAction(action);
      if (helpTopic) {
        setSettingsRequest({ section: "help", helpTopic });
        handleSelectView("settings");
        return;
      }
      if (action === "help.guides") {
        setSettingsRequest({ section: "help" });
        handleSelectView("settings");
        return;
      }
      if (action === "help.about") {
        setSettingsRequest({ section: "about" });
        handleSelectView("settings");
        return;
      }
      if (action === "view.command-palette") {
        if (!documentBusy) setCommandPaletteOpen((open) => !open);
        return;
      }
      if (action === "view.settings") {
        setSettingsRequest({ section: "appearance" });
        handleSelectView("settings");
        return;
      }
      let destination: WorkspaceView | undefined;
      switch (action) {
        case "view.overview":
          destination = "overview";
          break;
        case "view.documents":
          destination = "investigations";
          break;
        case "view.intelligence":
          destination = "intelligence";
          break;
        case "view.evidence":
          destination = "evidence";
          break;
        case "view.mitre":
          destination = "mitre";
          break;
        case "view.graph":
          destination = "graph";
          break;
      }
      if (destination) {
        if (destination === "overview" || currentProject) handleSelectView(destination);
        return;
      }
      if (action === "view.toggle-primary-sidebar" || action === "view.toggle-secondary-sidebar") {
        setWorkbenchLayout((current) => {
          const next = {
            ...current,
            ...(action === "view.toggle-primary-sidebar"
              ? { primarySideBarVisible: !current.primarySideBarVisible }
              : { secondarySideBarVisible: !current.secondarySideBarVisible }),
          };
          saveWorkbenchLayout(next);
          return next;
        });
        return;
      }
      if (action === "view.toggle-zen") {
        setZenMode((enabled) => !enabled);
        return;
      }
      if (action === "file.lock-project") {
        if (!documentBusy && currentProject) void handleLock();
        return;
      }
      if (action === "file.new-report" || action === "file.save" || action === "file.publish") {
        if (!currentProject) return;
        if (action !== "file.new-report" && activeView !== "investigations") return;
        workspaceActionSequence.current += 1;
        setWorkspaceActionRequest({ action, requestKey: workspaceActionSequence.current });
        if (activeView !== "investigations") handleSelectView("investigations");
      }
    },
    [activeView, currentProject, documentBusy, handleLock, handleSelectView],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const action = desktopActionFromKeyboardEvent(event);
      if (!action) return;
      event.preventDefault();
      handleDesktopAction(action);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleDesktopAction]);

  useEffect(() => {
    let removeListener: (() => void) | undefined;
    let active = true;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<unknown>(DESKTOP_ACTION_EVENT, (event) => {
          if (isDesktopActionId(event.payload)) handleDesktopAction(event.payload);
        }),
      )
      .then((unlisten) => {
        if (active) {
          removeListener = unlisten;
        } else {
          unlisten();
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
      removeListener?.();
    };
  }, [handleDesktopAction]);

  useEffect(() => {
    let removeListener: (() => void) | undefined;
    let active = true;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<unknown>(PROJECTS_AUTO_LOCKED_EVENT, (event) => {
          const payload = projectsAutoLockedFromEvent(event.payload);
          if (!payload) return;
          const lockedProjectIds = new Set(payload.projectIds);
          setProjects((existing) =>
            existing.map((project) =>
              lockedProjectIds.has(project.id) ? { ...project, locked: true } : project,
            ),
          );
          if (!currentProject || !lockedProjectIds.has(currentProject.id)) return;
          setCurrentProject(null);
          setLockError(null);
          handleSelectView("overview");
          notices.add({
            title: "Project locked after inactivity",
            description: `${currentProject.name ?? "Local project"} was locked after ${payload.idleTimeoutMinutes} minutes.`,
            type: "info",
          });
        }),
      )
      .then((unlisten) => {
        if (active) {
          removeListener = unlisten;
        } else {
          unlisten();
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
      removeListener?.();
    };
  }, [currentProject, handleSelectView, notices]);

  return (
    <div
      className="workbench bg-workbench text-copy-primary"
      data-explorer-collapsed={explorerCollapsed}
      data-inspector-collapsed={inspectorCollapsed}
      data-inspector-context={activeView === "mitre" ? "mitre" : "default"}
      data-canvas-focus={graphFocusMode}
      data-activity-bar-position={workbenchLayout.activityBarPosition}
      data-activity-bar-visible={workbenchLayout.activityBarVisible && !zenMode}
      data-primary-sidebar-visible={
        workbenchLayout.primarySideBarVisible && !zenMode && activeView !== "settings"
      }
      data-secondary-sidebar-position={workbenchLayout.secondarySideBarPosition}
      data-secondary-sidebar-visible={
        workbenchLayout.secondarySideBarVisible && !zenMode && activeView !== "settings"
      }
      data-centered-layout={
        workbenchLayout.centeredLayout && activeView !== "graph" && activeView !== "settings"
      }
      data-zen-mode={zenMode}
    >
      <Suspense
        fallback={<div className="window-title-bar border-panel-border border-b bg-panel-deep" />}
      >
        <WindowTitleBar
          closeBlocked={documentBusy || locking}
          layout={workbenchLayout}
          onLayoutChange={setWorkbenchLayout}
          onOpenSearchResult={(result) => {
            if (result.document) {
              setSelectedDocument(result.document);
              setExternallyRestoredDocument(result.document);
              handleSelectView("investigations");
              return;
            }
            handleSelectView(result.destination);
          }}
          onZenModeChange={setZenMode}
          projectId={currentProject?.id ?? null}
          projectName={currentProject?.name ?? null}
          searchDisabled={documentBusy || locking}
          zenMode={zenMode}
        />
      </Suspense>
      <div className="workbench-body min-h-0">
        <ActivityRail
          activeView={activeView}
          onSelectProjects={() => handleSelectView("overview")}
          onSelectSettings={() => handleSelectView("settings")}
        />
        <ProjectExplorer
          project={currentProject}
          activeView={activeView}
          navigationBlocked={documentBusy}
          onSelectOverview={() => handleSelectView("overview")}
          onSelectView={handleSelectView}
          collapsed={explorerCollapsed}
          onToggleCollapsed={() => setExplorerCollapsed((collapsed) => !collapsed)}
        />

        <main className="workspace min-w-0 bg-workbench" data-active-view={activeView}>
          <header
            className="command-bar flex min-w-0 items-center gap-3 border-panel-border border-b bg-panel-deep px-3"
            role="toolbar"
            aria-label="Command bar"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-copy-secondary text-xs">
                {currentProject?.name ?? "No project open"}
              </span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {currentProject ? (
                <Button
                  className="control-button"
                  type="button"
                  onClick={() => void handleLock()}
                  disabled={locking || documentBusy}
                  title={documentBusy ? "Wait for the document save to finish" : "Lock project"}
                >
                  <IconLock size={13} stroke={1.7} aria-hidden="true" />
                  {locking ? "Locking…" : "Lock"}
                </Button>
              ) : null}
            </div>
          </header>

          <nav
            className="tab-bar flex h-9 min-w-0 items-stretch border-panel-border border-b bg-panel-base"
            id="workspace-tabs"
            aria-label="Workspace tabs"
          >
            {activeView !== "investigations" ? (
              <div className="flex h-8 min-w-36 items-center self-end border-panel-border border-x border-t bg-workbench px-3 text-copy-secondary text-xs">
                {activeView === "settings"
                  ? "Settings"
                  : currentProject
                    ? activeView === "intelligence"
                      ? "Intelligence"
                      : activeView === "evidence"
                        ? "Evidence"
                        : activeView === "mitre"
                          ? "MITRE ATT&CK"
                          : activeView === "graph"
                            ? "Graph"
                            : "Project overview"
                    : "Welcome"}
              </div>
            ) : null}
            {activeView === "investigations" && currentProject ? (
              <div className="workspace-tab-lock ml-auto flex shrink-0 items-center gap-2 border-panel-border border-l px-1">
                <Button
                  aria-label="Lock project"
                  className="control-button h-8"
                  type="button"
                  onClick={() => void handleLock()}
                  disabled={locking || documentBusy}
                  title={documentBusy ? "Wait for the document save to finish" : "Lock project"}
                >
                  <IconLock size={13} stroke={1.7} aria-hidden="true" />
                  {locking ? "Locking…" : "Lock"}
                </Button>
              </div>
            ) : null}
          </nav>

          <div
            className={`canvas min-h-0 ${activeView === "graph" || activeView === "evidence" || activeView === "settings" ? "overflow-hidden" : "overflow-auto"}`}
          >
            {lockError ? (
              <p className="error-message m-4" role="alert">
                {lockError}
              </p>
            ) : null}
            <WorkspaceErrorBoundary
              key={`${currentProject?.id ?? "none"}-${activeView}`}
              onLeave={() => handleSelectView("overview")}
            >
              {currentProject && activeView === "investigations" ? (
                <Suspense
                  fallback={
                    <WorkspaceLoadingState
                      icon={<IconNotes size={26} aria-hidden="true" />}
                      title="Loading documents"
                      description="Preparing the local document workspace."
                    />
                  }
                >
                  <InvestigationsWorkspace
                    key={`${currentProject.id}-${externallyRestoredDocument?.id ?? "none"}-${externallyRestoredDocument?.revision ?? 0}`}
                    actionRequest={workspaceActionRequest}
                    onActionHandled={handleWorkspaceActionHandled}
                    projectId={currentProject.id}
                    defaultTlpMarking={currentProject.defaultTlpMarking ?? "clear"}
                    onBusyChange={handleDocumentBusyChange}
                    onSelectedDocumentChange={handleSelectedDocumentChange}
                    externalDocument={externallyRestoredDocument}
                  />
                </Suspense>
              ) : currentProject && activeView === "intelligence" ? (
                <Suspense
                  fallback={
                    <WorkspaceLoadingState
                      icon={<IconGitFork size={26} aria-hidden="true" />}
                      title="Loading intelligence"
                      description="Reading encrypted STIX objects and drafts."
                    />
                  }
                >
                  <IntelligenceWorkspace projectId={currentProject.id} />
                </Suspense>
              ) : currentProject && activeView === "evidence" ? (
                <Suspense
                  fallback={
                    <WorkspaceLoadingState
                      icon={<IconPhoto size={26} aria-hidden="true" />}
                      title="Loading evidence"
                      description="Reading encrypted project Evidence metadata."
                    />
                  }
                >
                  <EvidenceWorkspace projectId={currentProject.id} />
                </Suspense>
              ) : currentProject && activeView === "mitre" ? (
                <Suspense
                  fallback={
                    <WorkspaceLoadingState
                      icon={<IconLayoutGrid size={26} aria-hidden="true" />}
                      title="Loading MITRE ATT&CK"
                      description="Opening the pinned offline knowledge base."
                    />
                  }
                >
                  <MitreWorkspace
                    projectId={currentProject.id}
                    refreshKey={mitreRefreshKey}
                    onSelectTechnique={handleSelectMitreTechnique}
                    onCatalogChanged={() => setSelectedMitreTechnique(null)}
                  />
                </Suspense>
              ) : currentProject && activeView === "graph" ? (
                <Suspense
                  fallback={
                    <WorkspaceLoadingState
                      icon={<IconTopologyStar3 size={26} aria-hidden="true" />}
                      title="Loading graph workspace"
                      description="Resolving local nodes, links, and saved positions."
                    />
                  }
                >
                  <GraphWorkspace
                    key={currentProject.id}
                    projectId={currentProject.id}
                    onSelectionChange={(properties) => {
                      setSelectedGraphItem(properties);
                      if (properties) setInspectorCollapsed(false);
                    }}
                    onFocusModeChange={handleGraphFocusModeChange}
                  />
                </Suspense>
              ) : activeView === "settings" ? (
                <Suspense
                  fallback={
                    <WorkspaceLoadingState
                      icon={<IconSettings size={26} aria-hidden="true" />}
                      title="Loading settings"
                    />
                  }
                >
                  <SettingsWorkspace
                    key={`${settingsRequest.section}:${settingsRequest.helpTopic ?? ""}`}
                    initialHelpTopic={settingsRequest.helpTopic}
                    initialSection={settingsRequest.section}
                    layout={workbenchLayout}
                    onLayoutChange={setWorkbenchLayout}
                    projectId={currentProject?.id}
                    projectName={currentProject?.name ?? undefined}
                  />
                </Suspense>
              ) : currentProject ? (
                <Suspense
                  fallback={
                    <WorkspaceLoadingState
                      icon={<IconLock size={26} aria-hidden="true" />}
                      title="Loading project overview"
                    />
                  }
                >
                  <ProjectOverview project={currentProject} onNavigate={handleSelectView} />
                </Suspense>
              ) : (
                <ProjectLauncher
                  projects={projects}
                  loading={loading}
                  loadError={loadError}
                  onCreate={handleCreate}
                  onUnlockDevice={handleUnlockDevice}
                  onUnlockPassphrase={handleUnlockPassphrase}
                  onDelete={handleDeleteProject}
                />
              )}
            </WorkspaceErrorBoundary>
          </div>
        </main>

        <Suspense
          fallback={
            <aside
              className="inspector min-w-0 border-panel-border border-l bg-panel-base"
              aria-label="Inspector"
            />
          }
        >
          <ProjectInspector
            project={currentProject}
            document={activeView === "investigations" ? selectedDocument : null}
            mitreSelection={activeView === "mitre" ? selectedMitreTechnique : null}
            graphProperties={activeView === "graph" ? selectedGraphItem : null}
            onOpenGraphSource={(sourceView) => {
              if (
                sourceView === "investigations" ||
                sourceView === "intelligence" ||
                sourceView === "mitre"
              ) {
                handleSelectView(sourceView);
              }
            }}
            collapsed={inspectorCollapsed}
            onToggleCollapsed={() => setInspectorCollapsed((collapsed) => !collapsed)}
            onDocumentRestored={(document) => {
              setSelectedDocument(document);
              setExternallyRestoredDocument(document);
            }}
            onTechniqueObservationChange={() => setMitreRefreshKey((current) => current + 1)}
            onProjectUpdated={(updated) => {
              setCurrentProject(updated);
              setProjects((existing) =>
                existing.map((project) => (project.id === updated.id ? updated : project)),
              );
            }}
          />
        </Suspense>
      </div>
      {commandPaletteOpen ? (
        <Suspense fallback={null}>
          <ProjectCommandPalette
            open
            projectId={currentProject?.id ?? null}
            onOpenChange={setCommandPaletteOpen}
            onNavigate={(destination) => {
              if (destination === "settings" || currentProject) handleSelectView(destination);
            }}
            onOpenDocument={(document) => {
              setSelectedDocument(document);
              setExternallyRestoredDocument(document);
              handleSelectView("investigations");
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

function App() {
  return (
    <VaultNoticeProvider>
      <Workbench />
    </VaultNoticeProvider>
  );
}

export default App;
