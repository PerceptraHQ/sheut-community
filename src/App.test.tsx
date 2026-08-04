import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import "./components/InvestigationsWorkspace";
import * as documentsApi from "./lib/documents";
import * as projectsApi from "./lib/projects";
import * as telemetryApi from "./lib/telemetry";

vi.mock("./lib/documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/documents")>();
  return {
    ...actual,
    createDocument: vi.fn(),
    deleteDocument: vi.fn(),
    restoreDocument: vi.fn(),
    listDocumentActivity: vi.fn(),
    listDocumentRevisions: vi.fn(),
    compareDocumentRevisions: vi.fn(),
    restoreDocumentRevision: vi.fn(),
    listDocuments: vi.fn(),
    loadDocument: vi.fn(),
    renderSavedDocument: vi.fn(),
    saveDocument: vi.fn(),
  };
});

vi.mock("./lib/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/projects")>();
  return {
    ...actual,
    createProjectBackup: vi.fn(),
    createPassphraseProject: vi.fn(),
    createProject: vi.fn(),
    deleteProject: vi.fn(),
    listProjectBackups: vi.fn(),
    listProjects: vi.fn(),
    lockProject: vi.fn(),
    restoreDeviceProjectBackup: vi.fn(),
    restorePassphraseProjectBackup: vi.fn(),
    unlockPassphraseProject: vi.fn(),
    unlockProject: vi.fn(),
    updateProjectDefaultTlp: vi.fn(),
  };
});

vi.mock("./lib/telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/telemetry")>();
  return {
    ...actual,
    getTelemetryPreference: vi.fn(),
    recordTelemetryEvent: vi.fn(),
    setTelemetryPreference: vi.fn(),
  };
});

const PROJECT_ID = "019b0dc2-34c8-7c31-a2e5-c447222ce0b9";
describe("App", () => {
  beforeEach(() => {
    vi.mocked(projectsApi.createProject).mockReset();
    vi.mocked(projectsApi.deleteProject).mockReset().mockResolvedValue();
    vi.mocked(projectsApi.createProjectBackup).mockReset();
    vi.mocked(projectsApi.createPassphraseProject).mockReset();
    vi.mocked(projectsApi.listProjects).mockReset().mockResolvedValue([]);
    vi.mocked(projectsApi.listProjectBackups).mockReset().mockResolvedValue([]);
    vi.mocked(projectsApi.lockProject).mockReset().mockResolvedValue();
    vi.mocked(projectsApi.unlockProject).mockReset();
    vi.mocked(projectsApi.unlockPassphraseProject).mockReset();
    vi.mocked(projectsApi.updateProjectDefaultTlp).mockReset();
    vi.mocked(projectsApi.restoreDeviceProjectBackup).mockReset();
    vi.mocked(projectsApi.restorePassphraseProjectBackup).mockReset();
    vi.mocked(documentsApi.createDocument).mockReset();
    vi.mocked(documentsApi.deleteDocument).mockReset().mockResolvedValue();
    vi.mocked(documentsApi.restoreDocument).mockReset();
    vi.mocked(documentsApi.listDocumentActivity).mockReset().mockResolvedValue([]);
    vi.mocked(documentsApi.listDocumentRevisions).mockReset().mockResolvedValue([]);
    vi.mocked(documentsApi.compareDocumentRevisions).mockReset();
    vi.mocked(documentsApi.restoreDocumentRevision).mockReset();
    vi.mocked(documentsApi.listDocuments).mockReset().mockResolvedValue([]);
    vi.mocked(documentsApi.loadDocument).mockReset();
    vi.mocked(documentsApi.renderSavedDocument).mockReset();
    vi.mocked(documentsApi.saveDocument).mockReset();
    vi.mocked(telemetryApi.getTelemetryPreference)
      .mockReset()
      .mockResolvedValue({ consent: "disabled" });
    vi.mocked(telemetryApi.recordTelemetryEvent).mockReset().mockResolvedValue(false);
    vi.mocked(telemetryApi.setTelemetryPreference).mockReset();
  });

  it("asks for telemetry consent once and keeps collection off by default", async () => {
    const user = userEvent.setup();
    vi.mocked(telemetryApi.getTelemetryPreference).mockResolvedValue({ consent: "unknown" });
    vi.mocked(telemetryApi.setTelemetryPreference).mockResolvedValue({ consent: "disabled" });

    render(<App />);

    const dialog = await screen.findByRole("dialog", {
      name: "Anonymous diagnostics and usage",
    });
    expect(within(dialog).getByText(/graph nodes, edges, labels, or properties/i)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Keep telemetry off" }));

    await waitFor(() => expect(telemetryApi.setTelemetryPreference).toHaveBeenCalledWith(false));
    expect(
      screen.queryByRole("dialog", { name: "Anonymous diagnostics and usage" }),
    ).not.toBeInTheDocument();
  });

  it("renders a compact desktop workbench while locked", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { level: 1, name: "Open project" })).toBeVisible();
    expect(screen.getByRole("img", { name: "Sheut" })).toBeVisible();
    const titleBar = document.querySelector<HTMLElement>(".window-title-bar");
    expect(titleBar).not.toBeNull();
    if (!titleBar) return;
    expect(within(titleBar).queryByRole("img", { name: "Sheut" })).toBeNull();
    expect(screen.getByRole("navigation", { name: "Activity rail" })).toBeVisible();
    expect(screen.getByRole("complementary", { name: "Project explorer" })).toBeVisible();
    expect(screen.getByRole("complementary", { name: "Inspector" })).toBeVisible();
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
    expect(screen.queryByText("Locked")).not.toBeInTheDocument();
    expect(screen.getAllByText("No project open").length).toBeGreaterThan(0);
    expect(screen.queryByText("Encrypted at rest")).not.toBeInTheDocument();
    expect(screen.queryByText("Local encrypted storage")).not.toBeInTheDocument();
    expect(screen.queryByText("STIX 2.1")).not.toBeInTheDocument();
  });

  it("shows an explicit locked status for discovered projects", async () => {
    vi.mocked(projectsApi.listProjects).mockResolvedValue([
      {
        id: PROJECT_ID,
        name: "Idle project",
        locked: true,
        unlockMethod: "device",
        defaultTlpMarking: "amber",
      },
    ]);

    render(<App />);

    expect(await screen.findByText("Idle project")).toBeVisible();
    expect(screen.getByText("Locked")).toBeVisible();
  });

  it("closes an open workspace when project reconciliation finds it locked", async () => {
    const user = userEvent.setup();
    vi.mocked(projectsApi.createProject).mockResolvedValue({
      id: PROJECT_ID,
      name: "Idle project",
      locked: false,
      unlockMethod: "device",
      defaultTlpMarking: "amber",
    });
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Create project" }));
    const dialog = screen.getByRole("dialog", { name: "Create project" });
    await user.type(within(dialog).getByLabelText("Project name"), "Idle project");
    await user.click(within(dialog).getByRole("button", { name: "Create project" }));
    await user.click(await screen.findByRole("button", { name: "Documents" }));
    expect(await screen.findByRole("heading", { name: "Documents" })).toBeVisible();

    vi.mocked(projectsApi.listProjects).mockResolvedValue([
      {
        id: PROJECT_ID,
        name: "Idle project",
        locked: true,
        unlockMethod: "device",
        defaultTlpMarking: "amber",
      },
    ]);
    document.dispatchEvent(new Event("visibilitychange"));

    expect(await screen.findByRole("heading", { level: 1, name: "Open project" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Documents" })).not.toBeInTheDocument();
    expect(screen.getByText("Locked")).toBeVisible();
    expect(
      await screen.findByRole("dialog", { name: "Project locked after inactivity" }),
    ).toBeVisible();
  });

  it("keeps app-level navigation separate from project content", async () => {
    render(<App />);
    const navigation = await screen.findByRole("navigation", { name: "Activity rail" });

    expect(within(navigation).getByRole("button", { name: "Projects" })).toBeEnabled();
    for (const projectSection of ["Documents", "Intelligence", "Graph"]) {
      expect(
        within(navigation).queryByRole("button", { name: projectSection }),
      ).not.toBeInTheDocument();
    }
  });

  it("keeps title-bar project search separate from the keyboard command palette", async () => {
    const user = userEvent.setup();
    render(<App />);

    const search = await screen.findByRole(
      "combobox",
      { name: "Search project data" },
      { timeout: 5_000 },
    );
    expect(search).toBeDisabled();
    expect(
      screen.queryByRole("dialog", { name: "Search project and commands" }),
    ).not.toBeInTheDocument();

    await user.keyboard("{Meta>}k{/Meta}");
    expect(
      await screen.findByRole(
        "dialog",
        { name: "Search project and commands" },
        { timeout: 5_000 },
      ),
    ).toBeVisible();
    expect(screen.getByRole("option", { name: /Settings/ })).toBeVisible();
  });

  it("opens application settings from the activity rail", async () => {
    const user = userEvent.setup();
    render(<App />);

    const settings = await screen.findByRole("button", { name: "Settings" });
    await user.click(settings);

    expect(
      await screen.findByRole("heading", { name: "Appearance & layout" }, { timeout: 5_000 }),
    ).toBeVisible();
    expect(settings).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("tab", { name: "About & notices" })).toBeVisible();
  });

  it("collapses and restores project panels without hiding their controls", async () => {
    const user = userEvent.setup();
    render(<App />);

    const explorer = await screen.findByRole("complementary", { name: "Project explorer" });
    const collapseInspector = await screen.findByRole("button", { name: "Collapse properties" });
    const inspector = collapseInspector.closest("aside");
    expect(inspector).not.toBeNull();
    if (!inspector) return;

    await user.click(within(explorer).getByRole("button", { name: "Collapse project explorer" }));
    expect(explorer).toHaveAttribute("data-collapsed", "true");
    expect(within(explorer).queryByText("Community Edition")).not.toBeInTheDocument();
    expect(explorer.querySelector(".tabler-icon-chevron-down")).not.toBeInTheDocument();
    expect(within(explorer).getByRole("button", { name: "Expand project explorer" })).toBeVisible();

    await user.click(collapseInspector);
    expect(inspector).toHaveAttribute("data-collapsed", "true");
    expect(within(inspector).getByRole("button", { name: "Expand properties" })).toBeVisible();

    await user.click(within(explorer).getByRole("button", { name: "Expand project explorer" }));
    await user.click(within(inspector).getByRole("button", { name: "Expand properties" }));
    expect(explorer).toHaveAttribute("data-collapsed", "false");
    expect(inspector).toHaveAttribute("data-collapsed", "false");
  });

  it("creates an encrypted project from an accessible Base UI dialog", async () => {
    const user = userEvent.setup();
    vi.mocked(projectsApi.createProject).mockResolvedValue({
      id: PROJECT_ID,
      name: "Operation Shadow",
      locked: false,
      unlockMethod: "device",
      defaultTlpMarking: "amber",
    });
    vi.mocked(projectsApi.updateProjectDefaultTlp).mockResolvedValue({
      id: PROJECT_ID,
      name: "Operation Shadow",
      locked: false,
      unlockMethod: "device",
      defaultTlpMarking: "red",
    });
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Create project" }));
    const dialog = screen.getByRole("dialog", { name: "Create project" });
    await user.type(within(dialog).getByLabelText("Project name"), "Operation Shadow");
    await user.click(within(dialog).getByRole("button", { name: "Create project" }));

    await waitFor(() =>
      expect(projectsApi.createProject).toHaveBeenCalledWith("Operation Shadow", "amber"),
    );
    expect(screen.queryByText("Unlocked")).not.toBeInTheDocument();
    expect(screen.getAllByText("Operation Shadow").length).toBeGreaterThan(0);
    expect(
      within(screen.getByRole("toolbar", { name: "Command bar" })).getByText("Operation Shadow"),
    ).toBeVisible();
    expect(screen.getByRole("complementary", { name: "Inspector" })).toHaveTextContent(PROJECT_ID);
    expect(screen.getByRole("complementary", { name: "Inspector" })).toHaveTextContent("TLP:AMBER");
    await user.click(
      within(screen.getByRole("complementary", { name: "Inspector" })).getByRole("combobox", {
        name: "Project default TLP marking",
      }),
    );
    await user.click(screen.getByRole("option", { name: "TLP:RED — Named recipients" }));
    await waitFor(() =>
      expect(projectsApi.updateProjectDefaultTlp).toHaveBeenCalledWith(PROJECT_ID, "red"),
    );
    expect(screen.getByRole("complementary", { name: "Inspector" })).toHaveTextContent("TLP:RED");
    expect(screen.getByRole("complementary", { name: "Inspector" })).not.toHaveTextContent(
      "Operation Shadow",
    );
    expect(screen.getByRole("button", { name: "Lock" })).toBeEnabled();
    const notice = await screen.findByRole("dialog", { name: "Project created" });
    expect(notice).toBeVisible();
    expect(within(notice).getByText("Dismiss")).toBeVisible();
    const explorer = screen.getByRole("complementary", { name: "Project explorer" });
    expect(within(explorer).getByRole("button", { name: "Project overview" })).toHaveTextContent(
      "Overview",
    );
    expect(explorer).not.toHaveTextContent("Operation Shadow");
    expect(within(explorer).getByRole("button", { name: "Documents" })).toBeEnabled();
    expect(within(explorer).queryByRole("button", { name: "Reports" })).not.toBeInTheDocument();
    expect(within(explorer).getByRole("button", { name: "Intelligence" })).toBeEnabled();
    expect(within(explorer).getByRole("button", { name: "MITRE ATT&CK" })).toBeEnabled();
    expect(within(explorer).getByRole("button", { name: "Graph" })).toBeEnabled();
  });

  it("creates and opens an investigation from the project explorer", async () => {
    const user = userEvent.setup();
    const document = {
      schema_version: 1 as const,
      id: "e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
      kind: "investigation" as const,
      revision: 1,
      root: {
        type: "doc" as const,
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Untitled investigation" }],
          },
        ],
      },
    };
    vi.mocked(projectsApi.createProject).mockResolvedValue({
      id: PROJECT_ID,
      name: "Operation Shadow",
      locked: false,
      unlockMethod: "device",
      defaultTlpMarking: "amber",
    });
    vi.mocked(documentsApi.createDocument).mockResolvedValue(document);
    vi.mocked(documentsApi.restoreDocument).mockResolvedValue(document);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Create project" }));
    const dialog = screen.getByRole("dialog", { name: "Create project" });
    await user.type(within(dialog).getByLabelText("Project name"), "Operation Shadow");
    await user.click(within(dialog).getByRole("button", { name: "Create project" }));
    await user.click(screen.getByRole("button", { name: "Documents" }));

    expect(await screen.findByRole("heading", { name: "Documents" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "New Investigation" }));
    await waitFor(() =>
      expect(documentsApi.createDocument).toHaveBeenCalledWith(PROJECT_ID, "investigation"),
    );
    expect((await screen.findAllByText("Untitled investigation")).length).toBeGreaterThan(0);
    expect(await screen.findByRole("dialog", { name: "Investigation created" })).toBeVisible();

    const openDocuments = screen.getByRole("tablist", { name: "Open documents" });
    const workspaceTabs = screen.getByRole("navigation", { name: "Workspace tabs" });
    expect(within(workspaceTabs).getByRole("button", { name: "Quick Note" })).toBeVisible();
    expect(within(workspaceTabs).getByRole("button", { name: "New Investigation" })).toBeVisible();
    expect(within(workspaceTabs).getByRole("button", { name: "New Analyst Note" })).toBeVisible();
    expect(within(workspaceTabs).getByRole("button", { name: "New Report" })).toBeVisible();
    expect(within(workspaceTabs).getByRole("tablist", { name: "Open documents" })).toBe(
      openDocuments,
    );
    const documentPanel = screen.getByRole("complementary", { name: "Document explorer" });
    expect(
      within(openDocuments).getByRole("tab", { name: "Untitled investigation" }),
    ).toHaveAttribute("aria-selected", "true");
    await user.click(
      within(openDocuments).getByRole("button", { name: "Close Untitled investigation" }),
    );
    expect(screen.getByText("No document open")).toBeVisible();
    await user.click(
      within(documentPanel).getByRole("button", { name: /^Open Untitled investigation/ }),
    );
    expect(
      within(openDocuments).getByRole("tab", { name: "Untitled investigation" }),
    ).toHaveAttribute("aria-selected", "true");

    await user.click(
      within(documentPanel).getByRole("button", { name: "Collapse document explorer" }),
    );
    expect(documentPanel).toHaveAttribute("data-collapsed", "true");
    expect(
      within(documentPanel).getByRole("button", { name: "Open Untitled investigation" }),
    ).toHaveAttribute("title", "Untitled investigation");
    expect(
      within(documentPanel).getByRole("button", { name: "Expand document explorer" }),
    ).toBeVisible();
    await user.click(
      within(documentPanel).getByRole("button", { name: "Expand document explorer" }),
    );

    const documentRow = within(documentPanel).getByText("Untitled investigation").closest("button");
    expect(documentRow).not.toBeNull();
    await user.pointer({ target: documentRow as HTMLButtonElement, keys: "[MouseRight]" });
    await user.click(await screen.findByRole("menuitem", { name: "Delete document" }));
    const deleteDialog = await screen.findByRole("alertdialog", {
      name: "Delete Untitled investigation",
    });
    await user.click(within(deleteDialog).getByRole("button", { name: "Delete document" }));
    await waitFor(() =>
      expect(documentsApi.deleteDocument).toHaveBeenCalledWith(PROJECT_ID, document.id),
    );
    expect(screen.queryByText("Untitled investigation")).not.toBeInTheDocument();
    const deletedNotice = await screen.findByRole("dialog", { name: "Document deleted" });
    expect(deletedNotice).toBeVisible();
    await user.click(within(deletedNotice).getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(documentsApi.restoreDocument).toHaveBeenCalledWith(PROJECT_ID, document.id),
    );
    expect((await screen.findAllByText("Untitled investigation")).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Project overview" }));
    expect(await screen.findByRole("heading", { name: "Operation Shadow" })).toBeVisible();
  }, 10_000);

  it("shows failed investigation creation in a redacted toast", async () => {
    const user = userEvent.setup();
    vi.mocked(projectsApi.createProject).mockResolvedValue({
      id: PROJECT_ID,
      name: "Operation Shadow",
      locked: false,
      unlockMethod: "device",
      defaultTlpMarking: "amber",
    });
    vi.mocked(documentsApi.createDocument).mockRejectedValue({
      code: "storage_unavailable",
      filesystemPath: "/private/project.sheut",
    });
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Create project" }));
    const createDialog = screen.getByRole("dialog", { name: "Create project" });
    await user.type(within(createDialog).getByLabelText("Project name"), "Operation Shadow");
    await user.click(within(createDialog).getByRole("button", { name: "Create project" }));
    await user.click(screen.getByRole("button", { name: "Documents" }));
    await user.click(await screen.findByRole("button", { name: "New Investigation" }));

    const notice = await screen.findByRole("dialog", { name: "Investigation not created" });
    expect(notice).toHaveTextContent("The encrypted project store is unavailable");
    expect(document.body).not.toHaveTextContent("/private/project.sheut");
  });

  it("offers quick-note, analyst-note, investigation, and report creation commands", async () => {
    const user = userEvent.setup();
    vi.mocked(projectsApi.createProject).mockResolvedValue({
      id: PROJECT_ID,
      name: "Writing project",
      locked: false,
      unlockMethod: "device",
      defaultTlpMarking: "amber",
    });
    vi.mocked(documentsApi.createDocument).mockImplementation((_projectId, kind) =>
      Promise.resolve({
        schema_version: 1,
        id:
          kind === "report"
            ? "d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb"
            : "e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
        kind,
        revision: 1,
        root:
          kind === "report"
            ? { type: "doc", content: [{ type: "paragraph" }] }
            : {
                type: "doc",
                content: [
                  {
                    type: "heading",
                    attrs: { level: 1 },
                    content: [{ type: "text", text: "Untitled analyst note" }],
                  },
                ],
              },
        reportProperties:
          kind === "report"
            ? {
                reportId: "RPT-0001",
                title: "Untitled report",
                authors: [],
                producingOrganisation: null,
                issueDate: "2026-08-03",
              }
            : undefined,
      }),
    );
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Create project" }));
    const createDialog = screen.getByRole("dialog", { name: "Create project" });
    await user.type(within(createDialog).getByLabelText("Project name"), "Writing project");
    await user.click(within(createDialog).getByRole("button", { name: "Create project" }));
    await user.click(screen.getByRole("button", { name: "Documents" }));

    const workspaceTabs = await screen.findByRole("navigation", { name: "Workspace tabs" });
    expect(
      await within(workspaceTabs).findByRole("button", { name: "New Analyst Note" }),
    ).toBeVisible();
    expect(within(workspaceTabs).getByRole("button", { name: "New Investigation" })).toBeVisible();
    await user.click(within(workspaceTabs).getByRole("button", { name: "Quick Note" }));
    expect((await screen.findAllByText("Untitled analyst note")).length).toBeGreaterThan(0);

    const documentExplorer = screen.getByRole("complementary", { name: "Document explorer" });
    await user.click(
      within(documentExplorer).getByRole("button", { name: "Delete Untitled analyst note" }),
    );
    const deleteNoteDialog = await screen.findByRole("alertdialog", {
      name: "Delete Untitled analyst note",
    });
    await user.click(within(deleteNoteDialog).getByRole("button", { name: "Delete document" }));
    await waitFor(() =>
      expect(documentsApi.deleteDocument).toHaveBeenCalledWith(
        PROJECT_ID,
        "e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
      ),
    );

    await user.click(within(workspaceTabs).getByRole("button", { name: "New Report" }));
    expect((await screen.findAllByText("Untitled report")).length).toBeGreaterThan(0);
    expect(documentsApi.createDocument).toHaveBeenCalledWith(PROJECT_ID, "analyst_note");
    expect(documentsApi.createDocument).toHaveBeenCalledWith(PROJECT_ID, "report");
  });

  it("shows a redacted recovery-oriented message when project creation fails", async () => {
    const user = userEvent.setup();
    vi.mocked(projectsApi.createProject).mockRejectedValue({
      code: "credential_unavailable",
      filesystemPath: "/private/project/key",
    });
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Create project" }));
    const dialog = screen.getByRole("dialog", { name: "Create project" });
    await user.type(within(dialog).getByLabelText("Project name"), "Operation Shadow");
    await user.click(within(dialog).getByRole("button", { name: "Create project" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "The system credential store is unavailable",
    );
    expect(dialog).not.toHaveTextContent("/private/project/key");
  });

  it("discovers a locked project by name instead of UUID and unlocks it", async () => {
    const user = userEvent.setup();
    vi.mocked(projectsApi.listProjects).mockResolvedValue([
      {
        id: PROJECT_ID,
        name: "Recovered investigation",
        locked: true,
        unlockMethod: "device",
        defaultTlpMarking: null,
      },
    ]);
    vi.mocked(projectsApi.unlockProject).mockResolvedValue({
      id: PROJECT_ID,
      name: "Recovered investigation",
      locked: false,
      unlockMethod: "device",
      defaultTlpMarking: "green",
    });
    render(<App />);

    expect(await screen.findByText("Recovered investigation")).toBeVisible();
    expect(screen.queryByText(PROJECT_ID)).not.toBeInTheDocument();
    expect(screen.queryByText("Device credential")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Unlock project" }));

    await waitFor(() => expect(projectsApi.unlockProject).toHaveBeenCalledWith(PROJECT_ID));
    expect(screen.getAllByText("Recovered investigation").length).toBeGreaterThan(0);
    expect(screen.queryByText("Unlocked")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lock" })).toBeEnabled();
    expect(await screen.findByRole("dialog", { name: "Project unlocked" })).toBeVisible();
  });

  it("deletes a locked project only after its exact name is confirmed", async () => {
    const user = userEvent.setup();
    vi.mocked(projectsApi.listProjects).mockResolvedValue([
      {
        id: PROJECT_ID,
        name: "Disposable project",
        locked: true,
        unlockMethod: "device",
        defaultTlpMarking: null,
      },
    ]);
    render(<App />);

    await screen.findByText("Disposable project");
    await user.click(screen.getByRole("button", { name: "Delete Disposable project" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete Disposable project" });
    const confirm = within(dialog).getByLabelText("Type Disposable project to confirm");
    const deleteButton = within(dialog).getByRole("button", { name: "Delete project" });
    expect(deleteButton).toBeDisabled();

    await user.type(confirm, "Disposable project");
    expect(deleteButton).toBeEnabled();
    await user.click(deleteButton);

    await waitFor(() => expect(projectsApi.deleteProject).toHaveBeenCalledWith(PROJECT_ID));
    expect(screen.queryByText("Disposable project")).not.toBeInTheDocument();
    expect(await screen.findByRole("dialog", { name: "Project deleted" })).toBeVisible();
  });

  it("creates a passphrase-protected project only after confirmation", async () => {
    const user = userEvent.setup();
    vi.mocked(projectsApi.createPassphraseProject).mockResolvedValue({
      id: PROJECT_ID,
      name: "Protected project",
      locked: false,
      unlockMethod: "passphrase",
      defaultTlpMarking: "amber",
    });
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Create project" }));
    const dialog = screen.getByRole("dialog", { name: "Create project" });
    await user.type(within(dialog).getByLabelText("Project name"), "Protected project");
    await user.click(within(dialog).getByLabelText("Require passphrase"));
    await user.type(
      within(dialog).getByLabelText("Passphrase", { selector: "input" }),
      "correct horse battery staple",
    );
    await user.type(
      within(dialog).getByLabelText("Confirm passphrase"),
      "correct horse battery staple",
    );
    await user.click(within(dialog).getByRole("button", { name: "Create project" }));

    await waitFor(() =>
      expect(projectsApi.createPassphraseProject).toHaveBeenCalledWith(
        "Protected project",
        "amber",
        "correct horse battery staple",
      ),
    );
    expect(screen.queryByText("Unlocked")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lock" })).toBeEnabled();
  });

  it("requires the project passphrase for a fresh protected unlock", async () => {
    const user = userEvent.setup();
    vi.mocked(projectsApi.listProjects).mockResolvedValue([
      {
        id: PROJECT_ID,
        name: "Protected project",
        locked: true,
        unlockMethod: "passphrase",
        defaultTlpMarking: null,
      },
    ]);
    vi.mocked(projectsApi.unlockPassphraseProject).mockResolvedValue({
      id: PROJECT_ID,
      name: "Protected project",
      locked: false,
      unlockMethod: "passphrase",
      defaultTlpMarking: "amber_strict",
    });
    render(<App />);

    await screen.findByText("Protected project");
    await user.click(screen.getByRole("button", { name: "Unlock project" }));
    const dialog = await screen.findByRole("dialog", { name: "Unlock Protected project" });
    await user.type(within(dialog).getByLabelText("Passphrase"), "correct horse battery staple");
    await user.click(within(dialog).getByRole("button", { name: "Unlock" }));

    await waitFor(() =>
      expect(projectsApi.unlockPassphraseProject).toHaveBeenCalledWith(
        PROJECT_ID,
        "correct horse battery staple",
      ),
    );
    expect(projectsApi.unlockProject).not.toHaveBeenCalled();
    expect(screen.queryByText("Unlocked")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lock" })).toBeEnabled();
    expect(await screen.findByRole("dialog", { name: "Project unlocked" })).toBeVisible();
  });

  it("confirms a successful lock with a vault notification", async () => {
    const user = userEvent.setup();
    vi.mocked(projectsApi.createProject).mockResolvedValue({
      id: PROJECT_ID,
      name: "Lockable project",
      locked: false,
      unlockMethod: "device",
      defaultTlpMarking: "amber",
    });
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Create project" }));
    const dialog = screen.getByRole("dialog", { name: "Create project" });
    await user.type(within(dialog).getByLabelText("Project name"), "Lockable project");
    await user.click(within(dialog).getByRole("button", { name: "Create project" }));
    await user.click(await screen.findByRole("button", { name: "Lock" }));

    await waitFor(() => expect(projectsApi.lockProject).toHaveBeenCalledWith(PROJECT_ID));
    expect(await screen.findByRole("dialog", { name: "Project locked" })).toBeVisible();
    const notificationStack = screen.getByRole("region", { name: "Notifications" });
    expect(within(notificationStack).getAllByRole("dialog")).toHaveLength(2);
    await user.hover(notificationStack);
    await waitFor(() => {
      for (const notification of within(notificationStack).getAllByRole("dialog")) {
        expect(notification).toHaveAttribute("data-expanded");
      }
    });
  });

  it("creates an internal recovery point for the open project", async () => {
    const user = userEvent.setup();
    vi.mocked(projectsApi.createProject).mockResolvedValue({
      id: PROJECT_ID,
      name: "Recovery source",
      locked: false,
      unlockMethod: "device",
      defaultTlpMarking: "amber",
    });
    vi.mocked(projectsApi.createProjectBackup).mockResolvedValue({
      id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      createdAtUnixMs: 1_785_342_000_000,
    });
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Create project" }));
    const createDialog = screen.getByRole("dialog", { name: "Create project" });
    await user.type(within(createDialog).getByLabelText("Project name"), "Recovery source");
    await user.click(within(createDialog).getByRole("button", { name: "Create project" }));

    await user.click(await screen.findByRole("button", { name: "Create recovery point" }));
    await waitFor(() => expect(projectsApi.createProjectBackup).toHaveBeenCalledWith(PROJECT_ID));
    expect(await screen.findByRole("dialog", { name: "Recovery point saved" })).toBeVisible();
    expect(screen.getByText("Latest recovery point")).toBeVisible();
    expect(screen.getByRole("button", { name: "Create another recovery point" })).toBeVisible();
  });

  it("restores a selected device recovery point without a frontend path", async () => {
    const user = userEvent.setup();
    const backupId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    vi.mocked(projectsApi.listProjects).mockResolvedValue([
      {
        id: PROJECT_ID,
        name: "Recoverable",
        locked: true,
        unlockMethod: "device",
        defaultTlpMarking: null,
      },
    ]);
    vi.mocked(projectsApi.listProjectBackups).mockResolvedValue([
      { id: backupId, createdAtUnixMs: 1_785_342_000_000 },
    ]);
    vi.mocked(projectsApi.restoreDeviceProjectBackup).mockResolvedValue();
    render(<App />);

    await screen.findByText("Recoverable");
    await user.click(screen.getByRole("button", { name: "Recovery" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore Recoverable" });
    await user.click(within(dialog).getByRole("button", { name: "Restore recovery point" }));

    await waitFor(() =>
      expect(projectsApi.restoreDeviceProjectBackup).toHaveBeenCalledWith(PROJECT_ID, backupId),
    );
    expect(await screen.findByRole("dialog", { name: "Recovery complete" })).toBeVisible();
    expect(screen.getByText("Unlock the project to verify it.")).toBeVisible();
  });

  it("shows the edition name only in the brand area", async () => {
    render(<App />);

    await screen.findByRole("heading", { level: 1, name: "Open project" });
    expect(screen.getAllByText("Community Edition")).toHaveLength(1);
  });

  it("does not render a marketing-style hero or dashboard", async () => {
    render(<App />);

    await screen.findByRole("heading", { level: 1, name: "Open project" });
    expect(screen.queryByText("Community foundation")).not.toBeInTheDocument();
    expect(screen.queryByText("Every adversary leaves a shadow.")).not.toBeInTheDocument();
  });
});
