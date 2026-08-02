import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";

const repository = resolve(import.meta.dirname, "..");
const tauriDirectory = resolve(repository, "src-tauri");

const config = JSON.parse(await readFile(resolve(tauriDirectory, "tauri.conf.json"), "utf8"));
const capability = JSON.parse(
  await readFile(resolve(tauriDirectory, "capabilities/default.json"), "utf8"),
);
const commandManifest = await readFile(resolve(tauriDirectory, "src/command_manifest.rs"), "utf8");
const rustEntryPoint = await readFile(resolve(tauriDirectory, "src/lib.rs"), "utf8");
const isolationSource = await readFile(resolve(tauriDirectory, "isolation/index.js"), "utf8");
const viteConfigSource = await readFile(resolve(repository, "vite.config.ts"), "utf8");
const expectedSecurityHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Content-Type-Options": "nosniff",
};

const manifestCommands = new Set(
  [...commandManifest.matchAll(/"([a-z][a-z0-9_]*)"/g)].map((m) => m[1]),
);
const handlerBlock = rustEntryPoint.match(/generate_handler!\[([\s\S]*?)\]/)?.[1];
if (!handlerBlock) throw new Error("Tauri invoke handler could not be inspected");
const handlerCommands = new Set(
  [...handlerBlock.matchAll(/(?:commands|graph)::([a-z][a-z0-9_]*)/g)].map((match) => match[1]),
);
const capabilityCommands = new Set(
  capability.permissions
    .filter((permission) => typeof permission === "string" && permission.startsWith("allow-"))
    .map((permission) => permission.replace(/^allow-/, "").replaceAll("-", "_")),
);
const windowPermissions = new Set(
  capability.permissions.filter(
    (permission) => typeof permission === "string" && permission.startsWith("core:window:"),
  ),
);
const expectedWindowPermissions = new Set([
  "core:window:allow-close",
  "core:window:allow-is-fullscreen",
  "core:window:allow-minimize",
  "core:window:allow-set-fullscreen",
  "core:window:allow-start-dragging",
  "core:window:allow-toggle-maximize",
]);
const openerPermission = capability.permissions.find(
  (permission) =>
    typeof permission === "object" && permission?.identifier === "opener:allow-open-url",
);
if (
  JSON.stringify(openerPermission?.allow) !==
  JSON.stringify([{ url: "https://mitre.org/*" }, { url: "https://*.mitre.org/*" }])
) {
  throw new Error("External catalog links must remain restricted to HTTPS MITRE hosts");
}

for (const [label, actual] of [
  ["invoke handler", handlerCommands],
  ["main-window capability", capabilityCommands],
]) {
  if (!setsEqual(manifestCommands, actual)) {
    throw new Error(`${label} commands differ from the application ACL manifest`);
  }
}

if (config.app.withGlobalTauri !== false) throw new Error("Global Tauri API must stay disabled");
if (config.app.windows?.length !== 1 || config.app.windows[0]?.decorations !== false) {
  throw new Error("The main window must use the reviewed custom title bar");
}
if (!setsEqual(windowPermissions, expectedWindowPermissions)) {
  throw new Error("Custom title bar permissions differ from the reviewed window action set");
}
if (config.app.security.freezePrototype !== true)
  throw new Error("Prototype freezing must stay enabled");
if (config.app.security.dangerousDisableAssetCspModification !== false) {
  throw new Error("Tauri CSP modification must stay enabled");
}
if (config.app.security.assetProtocol?.enable === true) {
  throw new Error("The filesystem-backed Tauri Asset Protocol must stay disabled");
}
if ("dangerousRemoteUrlIpcAccess" in config.app.security) {
  throw new Error("Remote URL IPC access must not be configured");
}
if (config.app.security.pattern?.use !== "isolation") {
  throw new Error("Tauri's isolation pattern must protect Sheut IPC");
}
if (JSON.stringify(capability.windows) !== JSON.stringify(["main"])) {
  throw new Error("Application commands must be scoped to the main window");
}
if (!setsEqual(new Set(capability.platforms), new Set(["linux", "macOS", "windows"]))) {
  throw new Error("The capability must remain desktop-only");
}
if (config.bundle.resources?.["../THIRD_PARTY_NOTICES.md"] !== "THIRD_PARTY_NOTICES.md") {
  throw new Error("Packaged applications must include third-party notices");
}
if (JSON.stringify(config.app.security.headers) !== JSON.stringify(expectedSecurityHeaders)) {
  throw new Error("Production security headers differ from the reviewed policy");
}
for (const [header, value] of Object.entries(expectedSecurityHeaders)) {
  if (
    !viteConfigSource.includes(JSON.stringify(header)) ||
    !viteConfigSource.includes(JSON.stringify(value))
  ) {
    throw new Error(`Vite development and preview servers are missing ${header}`);
  }
}
if (!viteConfigSource.includes("headers: securityHeaders")) {
  throw new Error("Vite development and preview servers must apply the reviewed security headers");
}

const csp = config.app.security.csp;
for (const required of [
  "default-src 'self'",
  "connect-src 'self' ipc: http://ipc.localhost",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
]) {
  if (!csp.includes(required)) throw new Error(`Tauri CSP is missing: ${required}`);
}
if (/https:|asset:|\*|'unsafe-eval'/.test(csp)) {
  throw new Error("Tauri CSP permits an unsafe source");
}

const sandbox = { TextEncoder, URL, window: Object.create(null) };
vm.runInNewContext(isolationSource, sandbox, { filename: "src-tauri/isolation/index.js" });
const hook = sandbox.window.__TAURI_ISOLATION_HOOK__;
if (typeof hook !== "function") throw new Error("Isolation hook is not installed");

for (const command of manifestCommands) {
  hook({ cmd: command, payload: validPayload(command), callback: 1, error: 2, options: {} });
}
for (const request of [
  { cmd: "plugin:window|close", payload: { label: "main" } },
  { cmd: "plugin:window|minimize", payload: { label: "main" } },
  { cmd: "plugin:window|toggle_maximize", payload: { label: "main" } },
  { cmd: "plugin:window|is_fullscreen", payload: { label: "main" } },
  { cmd: "plugin:window|set_fullscreen", payload: { label: "main", value: true } },
  { cmd: "plugin:window|start_dragging", payload: { label: "main" } },
]) {
  hook({ ...request, callback: 1, error: 2, options: {} });
}
hook({
  cmd: "plugin:opener|open_url",
  payload: { url: "https://attack.mitre.org/techniques/T1078", with: undefined },
  callback: 1,
  error: 2,
  options: {},
});
for (const rejected of [
  { cmd: "shell_execute", payload: { command: "rm" } },
  { cmd: "plugin:window|close", payload: { label: "other" } },
  { cmd: "plugin:window|maximize", payload: { label: "main" } },
  { cmd: "plugin:window|set_fullscreen", payload: { label: "main", value: "true" } },
  { cmd: "plugin:opener|open_url", payload: { url: "https://attacker.invalid", with: null } },
  {
    cmd: "plugin:opener|open_url",
    payload: { url: "https://attack.mitre.org.evil.invalid/techniques/T1078", with: null },
  },
  {
    cmd: "load_document",
    payload: { projectId: "../../project", documentId: crypto.randomUUID() },
  },
  {
    cmd: "unlock_passphrase_project",
    payload: { projectId: crypto.randomUUID(), passphrase: "x".repeat(1025) },
  },
  {
    cmd: "create_project",
    payload: { name: "Project", defaultTlpMarking: "white" },
  },
  {
    cmd: "create_document",
    payload: { projectId: crypto.randomUUID(), kind: "report" },
  },
  {
    cmd: "update_evidence_metadata",
    payload: {
      projectId: crypto.randomUUID(),
      evidenceId: crypto.randomUUID(),
      expectedRevision: 1,
      input: {
        title: "Capture",
        description: "",
        source: "",
        capturedAt: "2026-02-30",
        sourceUrl: "javascript:alert(1)",
        tags: [],
        analystNotes: "",
      },
    },
  },
  {
    cmd: "export_saved_document",
    payload: {
      projectId: crypto.randomUUID(),
      documentId: crypto.randomUUID(),
      options: {
        format: "pdf",
        paperSize: "tabloid",
        orientation: "portrait",
        tlpMarking: "amber",
        fileName: "../../case",
      },
    },
  },
  {
    cmd: "commit_stix_export",
    payload: {
      projectId: crypto.randomUUID(),
      previewId: crypto.randomUUID(),
      fileName: "../../bundle",
    },
  },
  {
    cmd: "create_stix_relationship_draft",
    payload: {
      projectId: crypto.randomUUID(),
      sourceId: crypto.randomUUID(),
      targetId: crypto.randomUUID(),
      relationshipType: `x${"a".repeat(64)}`,
      properties: {},
    },
  },
  {
    cmd: "commit_graph_relationship_draft",
    payload: {
      projectId: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      linkId: crypto.randomUUID(),
      relationshipType: `x${"a".repeat(64)}`,
      properties: {},
    },
  },
  {
    cmd: "save_graph_workspace_state",
    payload: {
      projectId: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      expectedRevision: 1,
      mode: "build",
      viewport: { x: 0, y: 0, zoom: 1 },
      positions: [
        {
          itemId: crypto.randomUUID(),
          x: 1_000_001,
          y: 0,
          pinned: false,
        },
      ],
    },
  },
  {
    cmd: "create_technique_observation",
    payload: {
      projectId: crypto.randomUUID(),
      reference: {
        catalog: "attack_enterprise",
        version: "19.1",
        techniqueId: "T1059.001'); DROP TABLE technique_observations; --",
        tacticId: "TA0002",
      },
      assessment: "observed",
      outcome: "successful",
      confidence: "high",
      narrative: "Hostile reference",
      firstSeenUnixMs: null,
      lastSeenUnixMs: null,
    },
  },
  {
    cmd: "create_technique_observation",
    payload: {
      projectId: crypto.randomUUID(),
      reference: {
        catalog: "atlas",
        version: "2026.06",
        techniqueId: "AML.T0000",
        tacticId: "AML.TA0002",
      },
      assessment: "suspected",
      outcome: "unknown",
      confidence: "low",
      narrative: "x".repeat(4001),
      firstSeenUnixMs: null,
      lastSeenUnixMs: null,
    },
  },
  {
    cmd: "commit_mitre_catalog_update",
    payload: { previewId: "../../catalog.json", allowDowngrade: true },
  },
  {
    cmd: "reset_mitre_catalog",
    payload: { catalog: "https://attacker.invalid/catalog" },
  },
  {
    cmd: "commit_mitre_mapping_import",
    payload: {
      projectId: crypto.randomUUID(),
      previewId: "../../mapping.json",
      replaceExisting: true,
    },
  },
  {
    cmd: "export_navigator_projection",
    payload: {
      projectId: crypto.randomUUID(),
      catalog: "attack_enterprise",
      layerName: "Operation Northwind",
      fileName: "../../layer.json",
    },
  },
]) {
  let blocked = false;
  try {
    hook({ ...rejected, callback: 1, error: 2, options: {} });
  } catch {
    blocked = true;
  }
  if (!blocked) throw new Error(`Isolation hook accepted an unsafe ${rejected.cmd} request`);
}

console.log(
  `Tauri security: ${manifestCommands.size} application commands explicitly isolated and allowed`,
);

function setsEqual(left, right) {
  return left.size === right.size && [...left].every((item) => right.has(item));
}

function validPayload(command) {
  const projectId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const backupId = crypto.randomUUID();
  const attachmentId = crypto.randomUUID();
  const payloads = {
    list_projects: {},
    list_graph_workspaces: { projectId, includeDeleted: false },
    list_graph_source_items: { projectId },
    create_graph_workspace: {
      projectId,
      name: "All intelligence",
      mode: "view",
      items: [],
    },
    load_graph_workspace: { projectId, workspaceId: backupId },
    rename_graph_workspace: {
      projectId,
      workspaceId: backupId,
      expectedRevision: 1,
      name: "Renamed workspace",
    },
    delete_graph_workspace: { projectId, workspaceId: backupId, expectedRevision: 1 },
    restore_graph_workspace: { projectId, workspaceId: backupId, expectedRevision: 2 },
    add_graph_workspace_items: {
      projectId,
      workspaceId: backupId,
      expectedRevision: 1,
      items: [{ itemId: documentId, itemKind: "document", x: 10, y: 20, pinned: false }],
    },
    remove_graph_workspace_items: {
      projectId,
      workspaceId: backupId,
      expectedRevision: 2,
      itemIds: [documentId],
    },
    save_graph_workspace_state: {
      projectId,
      workspaceId: backupId,
      update: {
        expectedRevision: 2,
        mode: "build",
        viewport: { x: 0, y: 0, zoom: 1 },
        positions: [],
      },
    },
    create_graph_visual_link: {
      projectId,
      workspaceId: backupId,
      expectedRevision: 2,
      sourceId: documentId,
      targetId: attachmentId,
      label: "supports",
    },
    update_graph_visual_link: {
      projectId,
      workspaceId: backupId,
      expectedRevision: 3,
      linkId: backupId,
      sourceId: documentId,
      targetId: attachmentId,
      label: "supports",
    },
    delete_graph_visual_link: {
      projectId,
      workspaceId: backupId,
      expectedRevision: 4,
      linkId: backupId,
    },
    load_graph_item_properties: { projectId, workspaceId: backupId, itemId: documentId },
    preview_graph_relationship_draft: {
      projectId,
      workspaceId: backupId,
      linkId: attachmentId,
    },
    commit_graph_relationship_draft: {
      projectId,
      workspaceId: backupId,
      linkId: attachmentId,
      relationshipType: "related-to",
      properties: {},
    },
    list_stix_objects: { projectId },
    delete_stix_object: { projectId, objectId: documentId },
    list_stix_drafts: { projectId },
    create_stix_draft: {
      projectId,
      objectType: "indicator",
      properties: { pattern_type: "stix" },
    },
    create_stix_revision_draft: { projectId, objectId: documentId },
    update_stix_draft: {
      projectId,
      draftId: documentId,
      objectType: "indicator",
      properties: { pattern_type: "stix" },
    },
    create_stix_relationship_draft: {
      projectId,
      sourceId: projectId,
      targetId: documentId,
      relationshipType: "related-to",
      properties: { description: "Analyst link" },
    },
    update_stix_relationship_draft: {
      projectId,
      draftId: backupId,
      sourceId: projectId,
      targetId: documentId,
      relationshipType: "related-to",
      properties: { description: "Updated analyst link" },
    },
    delete_stix_draft: { projectId, draftId: documentId },
    preview_stix_import: { projectId },
    discard_stix_import_preview: { projectId, previewId: backupId },
    commit_stix_import: {
      projectId,
      previewId: backupId,
      decisions: ["keep_existing"],
    },
    preview_stix_export: { projectId },
    discard_stix_export_preview: { projectId, previewId: backupId },
    commit_stix_export: { projectId, previewId: backupId, fileName: "bundle" },
    list_documents: { projectId },
    get_mitre_catalog: { catalog: "attack_enterprise" },
    list_mitre_catalog_statuses: {},
    preview_mitre_catalog_update: {},
    commit_mitre_catalog_update: { previewId: backupId, allowDowngrade: false },
    reset_mitre_catalog: { catalog: "attack_enterprise" },
    list_technique_observations: { projectId },
    create_technique_observation: {
      projectId,
      reference: {
        catalog: "attack_enterprise",
        version: "19.1",
        techniqueId: "T1059.001",
        tacticId: "TA0002",
      },
      assessment: "observed",
      outcome: "successful",
      confidence: "high",
      narrative: "Endpoint telemetry confirmed PowerShell execution.",
      firstSeenUnixMs: 1000,
      lastSeenUnixMs: 2000,
    },
    update_technique_observation: {
      projectId,
      observationId: documentId,
      expectedRevision: 1,
      assessment: "suspected",
      outcome: "unknown",
      confidence: "medium",
      narrative: "Behavior remains under investigation.",
      firstSeenUnixMs: null,
      lastSeenUnixMs: null,
    },
    delete_technique_observation: {
      projectId,
      observationId: documentId,
      expectedRevision: 1,
    },
    preview_mitre_mapping_import: { projectId },
    commit_mitre_mapping_import: {
      projectId,
      previewId: backupId,
      replaceExisting: false,
    },
    export_mitre_mapping: { projectId, fileName: "operation-mapping" },
    preview_navigator_import: { projectId },
    commit_navigator_import: {
      projectId,
      previewId: backupId,
      assessment: "suspected",
      outcome: "unknown",
      confidence: "low",
      defaultNarrative: "Imported from a reviewed Navigator layer.",
      includeDisabled: false,
    },
    export_navigator_projection: {
      projectId,
      catalog: "attack_enterprise",
      layerName: "Operation Northwind",
      fileName: "operation-navigator",
    },
    list_project_backups: { projectId },
    create_project: { name: "Project", defaultTlpMarking: "amber" },
    update_project_default_tlp: { projectId, marking: "green" },
    create_document: { projectId, kind: "investigation" },
    list_report_templates: { projectId },
    create_custom_report_template: {
      projectId,
      baseTemplateId: documentId,
      name: "Piracy Ecosystem Report",
      description: "Project-local guided template",
      additionalSections: [],
    },
    list_guided_reports: { projectId },
    list_report_project_data: { projectId },
    create_guided_report: { projectId, templateId: documentId },
    save_guided_report: {
      projectId,
      reportId: documentId,
      expectedRevision: 1,
      title: "Quarterly threat report",
      fields: { report_title: { type: "text", value: "Quarterly threat report" } },
    },
    update_guided_report_section_disposition: {
      projectId,
      reportId: documentId,
      expectedRevision: 1,
      sectionKey: "attack_mappings",
      disposition: "not_applicable",
    },
    upgrade_illicit_ecosystem_report: {
      projectId,
      reportId: documentId,
      expectedRevision: 1,
    },
    delete_guided_report: { projectId, reportId: documentId },
    restore_guided_report: { projectId, reportId: documentId },
    list_brand_profiles: { projectId },
    create_brand_profile: {
      projectId,
      input: {
        name: "Default",
        organizationName: "Sheut Labs",
        contact: null,
        primaryColor: "#133C55",
        secondaryColor: "#386FA4",
        accentColor: "#59A5D8",
        textColor: "#111827",
        backgroundColor: "#FFFFFF",
        headingTypeface: "geist",
        bodyTypeface: "source_serif4",
        monoTypeface: "geist_mono",
        defaultPaperSize: "a4",
        defaultOrientation: "portrait",
        coverTreatment: "editorial",
        density: "comfortable",
        tableTreatment: "grid",
        sectionTreatment: "band",
        pageFurniture: { header: true, footer: true, marking: true, page_numbers: true },
      },
    },
    update_brand_profile: {
      projectId,
      profileId: documentId,
      expectedRevision: 1,
      input: {
        name: "Default",
        organizationName: "Sheut Labs",
        contact: null,
        primaryColor: "#133C55",
        secondaryColor: "#386FA4",
        accentColor: "#59A5D8",
        textColor: "#111827",
        backgroundColor: "#FFFFFF",
        headingTypeface: "geist",
        bodyTypeface: "source_serif4",
        monoTypeface: "geist_mono",
        defaultPaperSize: "a4",
        defaultOrientation: "portrait",
        coverTreatment: "editorial",
        density: "comfortable",
        tableTreatment: "grid",
        sectionTreatment: "band",
        pageFurniture: { header: true, footer: true, marking: true, page_numbers: true },
      },
    },
    pick_brand_asset: {
      projectId,
      profileId: documentId,
      expectedRevision: 1,
      role: "logo",
    },
    load_brand_asset: { projectId, profileId: documentId, assetId: attachmentId },
    delete_document: { projectId, documentId },
    restore_document: { projectId, documentId },
    list_document_revisions: { projectId, documentId },
    list_document_activity: { projectId, documentId },
    compare_document_revisions: {
      projectId,
      documentId,
      fromRevision: 1,
      toRevision: 2,
    },
    restore_document_revision: {
      projectId,
      documentId,
      sourceRevision: 1,
      expectedRevision: 2,
    },
    export_saved_document: {
      projectId,
      documentId,
      options: {
        format: "html",
        paperSize: "a4",
        orientation: "portrait",
        tlpMarking: "amber",
        brandProfileId: null,
        brandProfileRevision: null,
        releaseVersion: "1.0",
        publicationStatus: "draft",
        includeReleaseHistory: false,
        changeNote: null,
        pageFurniture: { header: true, footer: true, marking: true, page_numbers: true },
        includedSections: ["document"],
        appendices: [],
        fileName: "case-summary",
      },
    },
    export_guided_report: {
      projectId,
      reportId: documentId,
      options: {
        format: "pdf",
        paperSize: "letter",
        orientation: "landscape",
        tlpMarking: "green",
        brandProfileId: documentId,
        brandProfileRevision: 2,
        releaseVersion: "2.0",
        publicationStatus: "final",
        includeReleaseHistory: true,
        changeNote: "Major reassessment after new evidence.",
        pageFurniture: { header: true, footer: true, marking: true, page_numbers: true },
        includedSections: ["executive_summary"],
        appendices: ["evidence_images"],
        fileName: "campaign-report",
      },
    },
    list_publication_records: { projectId },
    reproduce_publication: { projectId, publicationId: documentId },
    pick_document_image: { projectId, documentId },
    load_document_image: { projectId, documentId, attachmentId },
    import_evidence_image: { projectId },
    import_evidence_file: { projectId },
    list_evidence_files: { projectId },
    load_evidence_image: { projectId, evidenceId: attachmentId },
    update_evidence_metadata: {
      projectId,
      evidenceId: attachmentId,
      expectedRevision: 1,
      input: {
        title: "Storefront capture",
        description: "Landing page before redirect.",
        source: "Analyst capture",
        capturedAt: "2026-07-31",
        sourceUrl: "https://piracy.example/",
        tags: ["piracy", "redirect"],
        analystNotes: "Preserve the original bytes.",
      },
    },
    delete_evidence_file: { projectId, evidenceId: attachmentId, expectedRevision: 1 },
    create_passphrase_project: {
      name: "Project",
      defaultTlpMarking: "amber_strict",
      passphrase: "correct horse battery staple",
    },
    create_project_backup: { projectId },
    load_document: { projectId, documentId },
    save_document: {
      projectId,
      documentId,
      expectedRevision: 1,
      root: { type: "doc", content: [] },
    },
    render_saved_document: { projectId, documentId },
    unlock_project: { projectId },
    unlock_passphrase_project: { projectId, passphrase: "correct horse battery staple" },
    lock_project: { projectId },
    delete_project: { projectId },
    restore_device_project_backup: { projectId, backupId },
    restore_passphrase_project_backup: {
      projectId,
      backupId,
      passphrase: "correct horse battery staple",
    },
  };
  return payloads[command];
}
