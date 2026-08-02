(function installSheutIsolationHook() {
  const canonicalId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const documentKinds = new Set(["investigation", "analyst_note"]);
  const exportFormats = new Set(["html", "pdf", "docx"]);
  const paperSizes = new Set(["a4", "letter"]);
  const pageOrientations = new Set(["portrait", "landscape"]);
  const publicationStatuses = new Set(["draft", "final"]);
  const brandAssetRoles = new Set(["logo", "compact_mark", "cover_artwork"]);
  const brandTypefaces = new Set(["geist", "geist_mono", "source_serif4"]);
  const coverTreatments = new Set(["minimal", "editorial", "artwork"]);
  const contentDensities = new Set(["compact", "comfortable", "spacious"]);
  const tableTreatments = new Set(["grid", "banded", "minimal"]);
  const sectionTreatments = new Set(["rule", "band", "plain"]);
  const duplicateDecisions = new Set([
    "keep_existing",
    "replace_version",
    "merge_supported_fields",
    "cancel",
  ]);
  const mitreCatalogs = new Set(["attack_enterprise", "attack_mobile", "attack_ics", "atlas"]);
  const techniqueAssessments = new Set(["observed", "suspected", "ruled_out"]);
  const techniqueOutcomes = new Set(["unknown", "attempted", "successful", "prevented"]);
  const analyticConfidence = new Set(["low", "medium", "high"]);
  const graphModes = new Set(["view", "build"]);
  const graphItemKinds = new Set(["intelligence", "evidence", "document", "catalog_reference"]);
  const reportReferenceKinds = new Set([
    "intelligence",
    "evidence",
    "document",
    "catalog_reference",
  ]);
  const reportSectionDispositions = new Set(["active", "not_applicable"]);
  const tlpMarkings = new Set(["clear", "green", "amber", "amber_strict", "red"]);
  const windowActions = new Set([
    "plugin:window|close",
    "plugin:window|minimize",
    "plugin:window|toggle_maximize",
    "plugin:window|is_fullscreen",
    "plugin:window|start_dragging",
  ]);
  const utf8 = new TextEncoder();

  const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  const isId = (value) => typeof value === "string" && canonicalId.test(value);
  const isBoundedString = (value, minimum, maximum) =>
    typeof value === "string" &&
    Array.from(value.trim()).length >= minimum &&
    Array.from(value).length <= maximum &&
    Array.from(value).every((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && codePoint >= 32 && codePoint !== 127;
    });
  const isPassphrase = (value) =>
    typeof value === "string" &&
    utf8.encode(value).byteLength >= 12 &&
    utf8.encode(value).byteLength <= 1024;
  const isProjectName = (value) =>
    typeof value === "string" &&
    value.trim().length > 0 &&
    Array.from(value.trim()).length <= 120 &&
    Array.from(value).every((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && codePoint >= 32 && codePoint !== 127;
    });
  const isReportTitle = (value) =>
    typeof value === "string" &&
    value.trim().length > 0 &&
    Array.from(value.trim()).length <= 240 &&
    Array.from(value).every((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && codePoint >= 32 && codePoint !== 127;
    });
  const isLayerName = (value) =>
    typeof value === "string" &&
    value.trim().length > 0 &&
    Array.from(value.trim()).length <= 160 &&
    Array.from(value).every((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && codePoint >= 32 && codePoint !== 127;
    });
  const isFileName = (value) =>
    typeof value === "string" &&
    value.trim().length > 0 &&
    Array.from(value).length <= 96 &&
    !/[\\/]/.test(value) &&
    Array.from(value).every((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && codePoint >= 32 && codePoint !== 127;
    });
  const isEvidenceText = (value, maximum) =>
    typeof value === "string" &&
    Array.from(value).length <= maximum &&
    Array.from(value).every((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint !== undefined &&
        (codePoint >= 32 || character === "\n" || character === "\r" || character === "\t") &&
        codePoint !== 127
      );
    });
  const isEvidenceMetadata = (value) =>
    isRecord(value) &&
    isBoundedString(value.title, 1, 200) &&
    isEvidenceText(value.description, 100_000) &&
    isEvidenceText(value.source, 500) &&
    (value.capturedAt === null ||
      (typeof value.capturedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.capturedAt))) &&
    isEvidenceText(value.sourceUrl, 4_096) &&
    (value.sourceUrl === "" || /^https?:\/\//.test(value.sourceUrl)) &&
    Array.isArray(value.tags) &&
    value.tags.length <= 32 &&
    value.tags.every((tag) => isBoundedString(tag, 1, 64)) &&
    isEvidenceText(value.analystNotes, 100_000);
  const isGuidedReportFields = (fields) => {
    if (!isRecord(fields) || Object.keys(fields).length === 0 || Object.keys(fields).length > 256) {
      return false;
    }
    for (const [key, field] of Object.entries(fields)) {
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || !isRecord(field)) return false;
      if (field.type === "text") {
        if (typeof field.value !== "string" || Array.from(field.value).length > 100_000) {
          return false;
        }
      } else if (field.type === "narrative") {
        if (!isRecord(field.value) || field.value.type !== "doc") return false;
      } else if (field.type === "rows") {
        if (!Array.isArray(field.value) || field.value.length > 2_000) return false;
        for (const row of field.value) {
          if (!isRecord(row) || Object.keys(row).length > 64) return false;
          for (const [column, value] of Object.entries(row)) {
            if (
              Array.from(column).length === 0 ||
              Array.from(column).length > 80 ||
              typeof value !== "string" ||
              Array.from(value).length > 100_000
            ) {
              return false;
            }
          }
        }
      } else if (field.type === "project_references") {
        if (!Array.isArray(field.value) || field.value.length > 256) return false;
        for (const reference of field.value) {
          if (
            !isRecord(reference) ||
            !reportReferenceKinds.has(reference.kind) ||
            !isId(reference.id) ||
            typeof reference.label !== "string" ||
            Array.from(reference.label).length === 0 ||
            Array.from(reference.label).length > 500
          ) {
            return false;
          }
        }
      } else {
        return false;
      }
    }
    try {
      return utf8.encode(JSON.stringify(fields)).byteLength <= 1024 * 1024;
    } catch {
      return false;
    }
  };
  const isBrandProfileInput = (input) => {
    if (!isRecord(input)) return false;
    const text = (value, max) =>
      typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= max;
    const color = (value) => typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value);
    const furniture = input.pageFurniture;
    return (
      text(input.name, 120) &&
      text(input.organizationName, 200) &&
      (input.contact === null ||
        (typeof input.contact === "string" && Array.from(input.contact).length <= 500)) &&
      color(input.primaryColor) &&
      color(input.secondaryColor) &&
      color(input.accentColor) &&
      color(input.textColor) &&
      color(input.backgroundColor) &&
      brandTypefaces.has(input.headingTypeface) &&
      brandTypefaces.has(input.bodyTypeface) &&
      brandTypefaces.has(input.monoTypeface) &&
      paperSizes.has(input.defaultPaperSize) &&
      pageOrientations.has(input.defaultOrientation) &&
      coverTreatments.has(input.coverTreatment) &&
      contentDensities.has(input.density) &&
      tableTreatments.has(input.tableTreatment) &&
      sectionTreatments.has(input.sectionTreatment) &&
      isRecord(furniture) &&
      typeof furniture.header === "boolean" &&
      typeof furniture.footer === "boolean" &&
      typeof furniture.marking === "boolean" &&
      typeof furniture.page_numbers === "boolean"
    );
  };
  const isApprovedMitreUrl = (value) => {
    if (typeof value !== "string") return false;
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        (url.hostname === "mitre.org" || url.hostname.endsWith(".mitre.org"))
      );
    } catch {
      return false;
    }
  };
  const isStixType = (value) =>
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 250 &&
    /^[a-z][a-z0-9-]*$/.test(value) &&
    !value.includes("--");
  const isRelationshipType = (value) =>
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 64 &&
    /^[a-z][a-z0-9-]*$/.test(value);
  const isStixProperties = (value) => {
    if (!isRecord(value)) return false;
    try {
      return utf8.encode(JSON.stringify(value)).byteLength <= 1024 * 1024;
    } catch {
      return false;
    }
  };
  const isOptionalTimestamp = (value) =>
    value === null || value === undefined || (Number.isSafeInteger(value) && value >= 0);
  const isTechniqueNarrative = (value) =>
    typeof value === "string" &&
    value.trim().length > 0 &&
    Array.from(value.trim()).length <= 4000 &&
    utf8.encode(value).byteLength <= 16000 &&
    Array.from(value).every((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint !== undefined &&
        (codePoint >= 32 || character === "\n" || character === "\r" || character === "\t") &&
        codePoint !== 127
      );
    });
  const isMitreReference = (value) => {
    if (
      !isRecord(value) ||
      !mitreCatalogs.has(value.catalog) ||
      typeof value.version !== "string" ||
      value.version.length < 1 ||
      value.version.length > 32 ||
      !/^[A-Za-z0-9.-]+$/.test(value.version) ||
      typeof value.techniqueId !== "string"
    ) {
      return false;
    }
    const isAtlas = value.catalog === "atlas";
    const validTechnique = isAtlas
      ? /^AML\.T[0-9]{4}(?:\.[0-9]{3})?$/.test(value.techniqueId)
      : /^T[0-9]{4}(?:\.[0-9]{3})?$/.test(value.techniqueId);
    const validTactic =
      value.tacticId === null ||
      value.tacticId === undefined ||
      (typeof value.tacticId === "string" &&
        (isAtlas ? /^AML\.TA[0-9]{4}$/.test(value.tacticId) : /^TA[0-9]{4}$/.test(value.tacticId)));
    return validTechnique && validTactic;
  };
  const isTechniqueObservationValues = (payload) =>
    techniqueAssessments.has(payload.assessment) &&
    techniqueOutcomes.has(payload.outcome) &&
    analyticConfidence.has(payload.confidence) &&
    isTechniqueNarrative(payload.narrative) &&
    isOptionalTimestamp(payload.firstSeenUnixMs) &&
    isOptionalTimestamp(payload.lastSeenUnixMs);
  const isGraphCoordinate = (value) =>
    typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1000000;
  const isGraphZoom = (value) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0.1 && value <= 8;
  const isGraphItem = (value) =>
    isRecord(value) &&
    isId(value.itemId) &&
    graphItemKinds.has(value.itemKind) &&
    isGraphCoordinate(value.x) &&
    isGraphCoordinate(value.y) &&
    typeof value.pinned === "boolean";
  const isGraphLabel = (value) =>
    value === null ||
    value === undefined ||
    (typeof value === "string" &&
      value.trim().length > 0 &&
      Array.from(value.trim()).length <= 120);
  const ids = (payload, ...names) =>
    isRecord(payload) && names.every((name) => isId(payload[name]));
  const isBrandProfileSelection = (payload) =>
    (payload.brandProfileId === null && payload.brandProfileRevision === null) ||
    (isId(payload.brandProfileId) &&
      Number.isSafeInteger(payload.brandProfileRevision) &&
      payload.brandProfileRevision >= 1);
  const isPublicationRelease = (payload) =>
    typeof payload.releaseVersion === "string" &&
    /^[vV]?\d{1,5}\.\d{1,5}(?:\.\d{1,5})?$/.test(payload.releaseVersion.trim()) &&
    publicationStatuses.has(payload.publicationStatus) &&
    typeof payload.includeReleaseHistory === "boolean" &&
    (payload.changeNote === null ||
      (typeof payload.changeNote === "string" &&
        payload.changeNote.trim().length > 0 &&
        Array.from(payload.changeNote).length <= 2_000));
  const isPublicationSelections = (payload) =>
    isRecord(payload.pageFurniture) &&
    ["header", "footer", "marking", "page_numbers"].every(
      (key) => typeof payload.pageFurniture[key] === "boolean",
    ) &&
    Array.isArray(payload.includedSections) &&
    payload.includedSections.length <= 256 &&
    payload.includedSections.every(
      (key) => typeof key === "string" && /^[a-z0-9_]{1,64}$/.test(key),
    ) &&
    Array.isArray(payload.appendices) &&
    payload.appendices.length <= 256 &&
    payload.appendices.every(
      (name) =>
        typeof name === "string" && name.trim().length > 0 && Array.from(name).length <= 200,
    );
  const passphraseProject = (payload) =>
    isRecord(payload) && isId(payload.projectId) && isPassphrase(payload.passphrase);
  const passphraseBackup = (payload) =>
    isRecord(payload) &&
    isId(payload.projectId) &&
    isId(payload.backupId) &&
    isPassphrase(payload.passphrase);

  const validators = Object.freeze({
    list_projects: (payload) => isRecord(payload) && Object.keys(payload).length === 0,
    list_graph_workspaces: (payload) =>
      ids(payload, "projectId") && typeof payload.includeDeleted === "boolean",
    list_graph_source_items: (payload) => ids(payload, "projectId"),
    create_graph_workspace: (payload) =>
      ids(payload, "projectId") &&
      isProjectName(payload.name) &&
      graphModes.has(payload.mode) &&
      Array.isArray(payload.items) &&
      payload.items.length <= 5000 &&
      payload.items.every(isGraphItem),
    load_graph_workspace: (payload) => ids(payload, "projectId", "workspaceId"),
    rename_graph_workspace: (payload) =>
      ids(payload, "projectId", "workspaceId") &&
      Number.isSafeInteger(payload.expectedRevision) &&
      payload.expectedRevision >= 1 &&
      isProjectName(payload.name),
    delete_graph_workspace: (payload) =>
      ids(payload, "projectId", "workspaceId") &&
      Number.isSafeInteger(payload.expectedRevision) &&
      payload.expectedRevision >= 1,
    restore_graph_workspace: (payload) =>
      ids(payload, "projectId", "workspaceId") &&
      Number.isSafeInteger(payload.expectedRevision) &&
      payload.expectedRevision >= 1,
    add_graph_workspace_items: (payload) =>
      ids(payload, "projectId", "workspaceId") &&
      Number.isSafeInteger(payload.expectedRevision) &&
      payload.expectedRevision >= 1 &&
      Array.isArray(payload.items) &&
      payload.items.length > 0 &&
      payload.items.length <= 1000 &&
      payload.items.every(isGraphItem),
    remove_graph_workspace_items: (payload) =>
      ids(payload, "projectId", "workspaceId") &&
      Number.isSafeInteger(payload.expectedRevision) &&
      payload.expectedRevision >= 1 &&
      Array.isArray(payload.itemIds) &&
      payload.itemIds.length > 0 &&
      payload.itemIds.length <= 1000 &&
      payload.itemIds.every(isId),
    save_graph_workspace_state: (payload) =>
      ids(payload, "projectId", "workspaceId") &&
      isRecord(payload.update) &&
      Number.isSafeInteger(payload.update.expectedRevision) &&
      payload.update.expectedRevision >= 1 &&
      graphModes.has(payload.update.mode) &&
      isRecord(payload.update.viewport) &&
      isGraphCoordinate(payload.update.viewport.x) &&
      isGraphCoordinate(payload.update.viewport.y) &&
      isGraphZoom(payload.update.viewport.zoom) &&
      Array.isArray(payload.update.positions) &&
      payload.update.positions.length <= 1000 &&
      payload.update.positions.every(isGraphItem),
    create_graph_visual_link: (payload) =>
      ids(payload, "projectId", "workspaceId", "sourceId", "targetId") &&
      Number.isSafeInteger(payload.expectedRevision) &&
      payload.expectedRevision >= 1 &&
      payload.sourceId !== payload.targetId &&
      isGraphLabel(payload.label),
    update_graph_visual_link: (payload) =>
      ids(payload, "projectId", "workspaceId", "linkId", "sourceId", "targetId") &&
      Number.isSafeInteger(payload.expectedRevision) &&
      payload.expectedRevision >= 1 &&
      payload.sourceId !== payload.targetId &&
      isGraphLabel(payload.label),
    delete_graph_visual_link: (payload) =>
      ids(payload, "projectId", "workspaceId", "linkId") &&
      Number.isSafeInteger(payload.expectedRevision) &&
      payload.expectedRevision >= 1,
    load_graph_item_properties: (payload) => ids(payload, "projectId", "workspaceId", "itemId"),
    preview_graph_relationship_draft: (payload) =>
      ids(payload, "projectId", "workspaceId", "linkId"),
    commit_graph_relationship_draft: (payload) =>
      ids(payload, "projectId", "workspaceId", "linkId") &&
      isRelationshipType(payload.relationshipType) &&
      isStixProperties(payload.properties),
    list_stix_objects: (payload) => ids(payload, "projectId"),
    delete_stix_object: (payload) => ids(payload, "projectId", "objectId"),
    list_stix_drafts: (payload) => ids(payload, "projectId"),
    create_stix_draft: (payload) =>
      ids(payload, "projectId") &&
      isStixType(payload.objectType) &&
      isStixProperties(payload.properties),
    create_stix_revision_draft: (payload) => ids(payload, "projectId", "objectId"),
    update_stix_draft: (payload) =>
      ids(payload, "projectId", "draftId") &&
      isStixType(payload.objectType) &&
      isStixProperties(payload.properties),
    create_stix_relationship_draft: (payload) =>
      ids(payload, "projectId", "sourceId", "targetId") &&
      isRelationshipType(payload.relationshipType) &&
      isStixProperties(payload.properties),
    update_stix_relationship_draft: (payload) =>
      ids(payload, "projectId", "draftId", "sourceId", "targetId") &&
      isRelationshipType(payload.relationshipType) &&
      isStixProperties(payload.properties),
    delete_stix_draft: (payload) => ids(payload, "projectId", "draftId"),
    preview_stix_import: (payload) => ids(payload, "projectId"),
    discard_stix_import_preview: (payload) => ids(payload, "projectId", "previewId"),
    commit_stix_import: (payload) =>
      ids(payload, "projectId", "previewId") &&
      Array.isArray(payload.decisions) &&
      payload.decisions.length <= 5000 &&
      payload.decisions.every((decision) => duplicateDecisions.has(decision)),
    preview_stix_export: (payload) => ids(payload, "projectId"),
    discard_stix_export_preview: (payload) => ids(payload, "projectId", "previewId"),
    commit_stix_export: (payload) =>
      ids(payload, "projectId", "previewId") && isFileName(payload.fileName),
    list_documents: (payload) => ids(payload, "projectId"),
    get_mitre_catalog: (payload) => isRecord(payload) && mitreCatalogs.has(payload.catalog),
    list_mitre_catalog_statuses: (payload) =>
      isRecord(payload) && Object.keys(payload).length === 0,
    preview_mitre_catalog_update: (payload) =>
      isRecord(payload) && Object.keys(payload).length === 0,
    commit_mitre_catalog_update: (payload) =>
      ids(payload, "previewId") && typeof payload.allowDowngrade === "boolean",
    reset_mitre_catalog: (payload) => isRecord(payload) && mitreCatalogs.has(payload.catalog),
    list_technique_observations: (payload) => ids(payload, "projectId"),
    create_technique_observation: (payload) =>
      ids(payload, "projectId") &&
      isMitreReference(payload.reference) &&
      isTechniqueObservationValues(payload),
    update_technique_observation: (payload) =>
      ids(payload, "projectId", "observationId") &&
      Number.isSafeInteger(payload.expectedRevision) &&
      payload.expectedRevision >= 1 &&
      isTechniqueObservationValues(payload),
    delete_technique_observation: (payload) =>
      ids(payload, "projectId", "observationId") &&
      Number.isSafeInteger(payload.expectedRevision) &&
      payload.expectedRevision >= 1,
    preview_mitre_mapping_import: (payload) => ids(payload, "projectId"),
    commit_mitre_mapping_import: (payload) =>
      ids(payload, "projectId", "previewId") && typeof payload.replaceExisting === "boolean",
    export_mitre_mapping: (payload) => ids(payload, "projectId") && isFileName(payload.fileName),
    preview_navigator_import: (payload) => ids(payload, "projectId"),
    commit_navigator_import: (payload) =>
      ids(payload, "projectId", "previewId") &&
      techniqueAssessments.has(payload.assessment) &&
      techniqueOutcomes.has(payload.outcome) &&
      analyticConfidence.has(payload.confidence) &&
      isTechniqueNarrative(payload.defaultNarrative) &&
      typeof payload.includeDisabled === "boolean",
    export_navigator_projection: (payload) =>
      ids(payload, "projectId") &&
      mitreCatalogs.has(payload.catalog) &&
      isLayerName(payload.layerName) &&
      isFileName(payload.fileName),
    list_project_backups: (payload) => ids(payload, "projectId"),
    create_project: (payload) =>
      isRecord(payload) &&
      isProjectName(payload.name) &&
      tlpMarkings.has(payload.defaultTlpMarking),
    update_project_default_tlp: (payload) =>
      ids(payload, "projectId") && tlpMarkings.has(payload.marking),
    create_document: (payload) => ids(payload, "projectId") && documentKinds.has(payload.kind),
    list_report_templates: (payload) => ids(payload, "projectId"),
    create_custom_report_template: (payload) =>
      ids(payload, "projectId", "baseTemplateId") &&
      isBoundedString(payload.name, 1, 120) &&
      isBoundedString(payload.description, 1, 500) &&
      Array.isArray(payload.additionalSections) &&
      payload.additionalSections.length <= 32 &&
      utf8.encode(JSON.stringify(payload.additionalSections)).byteLength <= 256 * 1024,
    list_guided_reports: (payload) => ids(payload, "projectId"),
    list_report_project_data: (payload) => ids(payload, "projectId"),
    create_guided_report: (payload) => ids(payload, "projectId", "templateId"),
    save_guided_report: (payload) =>
      ids(payload, "projectId", "reportId") &&
      Number.isSafeInteger(payload.expectedRevision) &&
      payload.expectedRevision >= 1 &&
      isReportTitle(payload.title) &&
      isGuidedReportFields(payload.fields),
    get_guided_report_readiness: (payload) => ids(payload, "projectId", "reportId"),
    update_guided_report_section_disposition: (payload) =>
      ids(payload, "projectId", "reportId") &&
      Number.isSafeInteger(payload.expectedRevision) &&
      payload.expectedRevision >= 1 &&
      typeof payload.sectionKey === "string" &&
      /^[a-z][a-z0-9_]{0,63}$/.test(payload.sectionKey) &&
      reportSectionDispositions.has(payload.disposition),
    upgrade_illicit_ecosystem_report: (payload) =>
      ids(payload, "projectId", "reportId") &&
      Number.isSafeInteger(payload.expectedRevision) &&
      payload.expectedRevision >= 1,
    delete_guided_report: (payload) => ids(payload, "projectId", "reportId"),
    restore_guided_report: (payload) => ids(payload, "projectId", "reportId"),
    list_brand_profiles: (payload) => ids(payload, "projectId"),
    create_brand_profile: (payload) =>
      ids(payload, "projectId") && isBrandProfileInput(payload.input),
    update_brand_profile: (payload) =>
      ids(payload, "projectId", "profileId") &&
      Number.isSafeInteger(payload.expectedRevision) &&
      payload.expectedRevision >= 1 &&
      isBrandProfileInput(payload.input),
    pick_brand_asset: (payload) =>
      ids(payload, "projectId", "profileId") &&
      Number.isSafeInteger(payload.expectedRevision) &&
      payload.expectedRevision >= 1 &&
      brandAssetRoles.has(payload.role),
    load_brand_asset: (payload) => ids(payload, "projectId", "profileId", "assetId"),
    delete_document: (payload) => ids(payload, "projectId", "documentId"),
    restore_document: (payload) => ids(payload, "projectId", "documentId"),
    list_document_revisions: (payload) => ids(payload, "projectId", "documentId"),
    list_document_activity: (payload) => ids(payload, "projectId", "documentId"),
    compare_document_revisions: (payload) =>
      ids(payload, "projectId", "documentId") &&
      Number.isSafeInteger(payload.fromRevision) &&
      payload.fromRevision >= 1 &&
      Number.isSafeInteger(payload.toRevision) &&
      payload.toRevision >= 1,
    restore_document_revision: (payload) =>
      ids(payload, "projectId", "documentId") &&
      Number.isSafeInteger(payload.sourceRevision) &&
      payload.sourceRevision >= 1 &&
      Number.isSafeInteger(payload.expectedRevision) &&
      payload.expectedRevision >= 1,
    export_saved_document: (payload) =>
      ids(payload, "projectId", "documentId") &&
      isRecord(payload.options) &&
      exportFormats.has(payload.options.format) &&
      paperSizes.has(payload.options.paperSize) &&
      pageOrientations.has(payload.options.orientation) &&
      tlpMarkings.has(payload.options.tlpMarking) &&
      isBrandProfileSelection(payload.options) &&
      isPublicationRelease(payload.options) &&
      isPublicationSelections(payload.options) &&
      isFileName(payload.options.fileName),
    export_guided_report: (payload) =>
      ids(payload, "projectId", "reportId") &&
      isRecord(payload.options) &&
      exportFormats.has(payload.options.format) &&
      paperSizes.has(payload.options.paperSize) &&
      pageOrientations.has(payload.options.orientation) &&
      tlpMarkings.has(payload.options.tlpMarking) &&
      isBrandProfileSelection(payload.options) &&
      isPublicationRelease(payload.options) &&
      isPublicationSelections(payload.options) &&
      isFileName(payload.options.fileName),
    list_publication_records: (payload) => ids(payload, "projectId"),
    reproduce_publication: (payload) => ids(payload, "projectId", "publicationId"),
    pick_document_image: (payload) => ids(payload, "projectId", "documentId"),
    load_document_image: (payload) => ids(payload, "projectId", "documentId", "attachmentId"),
    import_evidence_image: (payload) => ids(payload, "projectId"),
    import_evidence_file: (payload) => ids(payload, "projectId"),
    list_evidence_files: (payload) => ids(payload, "projectId"),
    load_evidence_image: (payload) => ids(payload, "projectId", "evidenceId"),
    update_evidence_metadata: (payload) =>
      ids(payload, "projectId", "evidenceId") &&
      Number.isSafeInteger(payload.expectedRevision) &&
      payload.expectedRevision >= 1 &&
      isEvidenceMetadata(payload.input),
    delete_evidence_file: (payload) =>
      ids(payload, "projectId", "evidenceId") &&
      Number.isSafeInteger(payload.expectedRevision) &&
      payload.expectedRevision >= 1,
    create_passphrase_project: (payload) =>
      isRecord(payload) &&
      isProjectName(payload.name) &&
      tlpMarkings.has(payload.defaultTlpMarking) &&
      isPassphrase(payload.passphrase),
    create_project_backup: (payload) => ids(payload, "projectId"),
    load_document: (payload) => ids(payload, "projectId", "documentId"),
    save_document: (payload) => {
      if (
        !ids(payload, "projectId", "documentId") ||
        !Number.isSafeInteger(payload.expectedRevision) ||
        payload.expectedRevision < 1 ||
        !isRecord(payload.root) ||
        payload.root.type !== "doc"
      ) {
        return false;
      }
      try {
        return utf8.encode(JSON.stringify(payload.root)).byteLength <= 1024 * 1024;
      } catch {
        return false;
      }
    },
    render_saved_document: (payload) => ids(payload, "projectId", "documentId"),
    unlock_project: (payload) => ids(payload, "projectId"),
    unlock_passphrase_project: passphraseProject,
    lock_project: (payload) => ids(payload, "projectId"),
    delete_project: (payload) => ids(payload, "projectId"),
    restore_device_project_backup: (payload) => ids(payload, "projectId", "backupId"),
    restore_passphrase_project_backup: passphraseBackup,
  });

  window.__TAURI_ISOLATION_HOOK__ = (request) => {
    if (!isRecord(request) || typeof request.cmd !== "string") {
      throw new Error("IPC request rejected");
    }
    if (request.cmd === "plugin:opener|open_url") {
      if (
        !isRecord(request.payload) ||
        !isApprovedMitreUrl(request.payload.url) ||
        (request.payload.with !== undefined && request.payload.with !== null)
      ) {
        throw new Error("IPC request rejected");
      }
      return request;
    }
    if (windowActions.has(request.cmd)) {
      if (
        !isRecord(request.payload) ||
        request.payload.label !== "main" ||
        Object.keys(request.payload).length !== 1
      ) {
        throw new Error("IPC request rejected");
      }
      return request;
    }
    if (request.cmd === "plugin:window|set_fullscreen") {
      if (
        !isRecord(request.payload) ||
        request.payload.label !== "main" ||
        typeof request.payload.value !== "boolean" ||
        Object.keys(request.payload).length !== 2
      ) {
        throw new Error("IPC request rejected");
      }
      return request;
    }
    const validate = validators[request.cmd];
    if (typeof validate !== "function" || !validate(request.payload)) {
      throw new Error("IPC request rejected");
    }
    return request;
  };
})();
