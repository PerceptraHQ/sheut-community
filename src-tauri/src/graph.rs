use std::collections::{HashMap, HashSet};
use std::io::Cursor;
use std::sync::Arc;

use image::{ImageEncoder, Rgba, RgbaImage, codecs::png::PngEncoder};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sheut_core::{
    DocumentEnvelope, DocumentKind, GraphViewport, GraphWorkspace, GraphWorkspaceSnapshot,
    ImageAttachmentMetadata, LocalId, Position, Revision, TechniqueObservation, VisualLink,
    WorkspaceItem, WorkspaceItemKind, WorkspaceMode,
};
use sheut_project::{GraphWorkspaceSeedItem, LifecycleErrorCode};
use sheut_stix::{ExistingStixObject, StixDraft};
use uuid::Uuid;

use crate::commands::{
    AppState, CommandError, StixDraftSummary, now_unix_ms, parse_project_id, parse_revision,
    with_manager,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct GraphEdgeSummary {
    id: String,
    kind: GraphEdgeKind,
    source_id: LocalId,
    target_id: LocalId,
    label: String,
    canonical_label: String,
    directed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphSnapshotAttachment {
    attachment: ImageAttachmentMetadata,
    workspace_id: LocalId,
    workspace_revision: Revision,
    workspace_name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum GraphEdgeKind {
    Semantic,
    Reference,
    Visual,
    Draft,
}

fn resolve_stix_edges(
    member_ids: &HashSet<LocalId>,
    objects: &[ExistingStixObject],
    drafts: &[StixDraft],
) -> Vec<GraphEdgeSummary> {
    let stix_ids = objects
        .iter()
        .map(|object| (object.stix_id(), object.local_id()))
        .collect::<HashMap<_, _>>();
    let mut edges = Vec::new();

    for object in objects {
        if !member_ids.contains(&object.local_id()) {
            continue;
        }
        let raw = object.raw();
        if object.object_type() == "relationship" {
            if let (Some(source_id), Some(target_id), Some(canonical_label)) = (
                raw.get("source_ref")
                    .and_then(serde_json::Value::as_str)
                    .and_then(|reference| stix_ids.get(reference))
                    .copied(),
                raw.get("target_ref")
                    .and_then(serde_json::Value::as_str)
                    .and_then(|reference| stix_ids.get(reference))
                    .copied(),
                raw.get("relationship_type")
                    .and_then(serde_json::Value::as_str),
            ) && member_ids.contains(&source_id)
                && member_ids.contains(&target_id)
            {
                edges.push(GraphEdgeSummary {
                    id: object.local_id().to_string(),
                    kind: GraphEdgeKind::Semantic,
                    source_id,
                    target_id,
                    label: readable_relationship_name(canonical_label),
                    canonical_label: canonical_label.to_owned(),
                    directed: true,
                });
            }
            continue;
        }

        if object.object_type() == "sighting" {
            let sighted_id = raw
                .get("sighting_of_ref")
                .and_then(Value::as_str)
                .and_then(|reference| stix_ids.get(reference))
                .copied();
            if let Some(sighted_id) = sighted_id.filter(|id| member_ids.contains(id)) {
                for property in ["observed_data_refs", "where_sighted_refs"] {
                    for context_id in stix_reference_targets(raw.get(property), &stix_ids) {
                        if !member_ids.contains(&context_id) || context_id == sighted_id {
                            continue;
                        }
                        edges.push(GraphEdgeSummary {
                            id: format!("{}:{property}:{context_id}", object.local_id()),
                            kind: GraphEdgeKind::Semantic,
                            source_id: sighted_id,
                            target_id: context_id,
                            label: "Sighting".to_owned(),
                            canonical_label: "sighting".to_owned(),
                            directed: true,
                        });
                    }
                }
            }
            continue;
        }

        let Some(properties) = raw.as_object() else {
            continue;
        };
        for (property, value) in properties {
            if (!property.ends_with("_ref") && !property.ends_with("_refs"))
                || matches!(
                    property.as_str(),
                    "source_ref"
                        | "target_ref"
                        | "sighting_of_ref"
                        | "observed_data_refs"
                        | "where_sighted_refs"
                )
            {
                continue;
            }
            for target_id in stix_reference_targets(Some(value), &stix_ids) {
                if member_ids.contains(&target_id) {
                    edges.push(GraphEdgeSummary {
                        id: format!("{}:{property}:{target_id}", object.local_id()),
                        kind: GraphEdgeKind::Reference,
                        source_id: object.local_id(),
                        target_id,
                        label: readable_relationship_name(
                            property.trim_end_matches("_refs").trim_end_matches("_ref"),
                        ),
                        canonical_label: property.to_owned(),
                        directed: true,
                    });
                }
            }
        }
    }

    for draft in drafts {
        let Some(relationship) = draft.semantic_relationship() else {
            continue;
        };
        if member_ids.contains(&draft.local_id())
            && member_ids.contains(&relationship.source_id())
            && member_ids.contains(&relationship.target_id())
        {
            edges.push(GraphEdgeSummary {
                id: draft.local_id().to_string(),
                kind: GraphEdgeKind::Draft,
                source_id: relationship.source_id(),
                target_id: relationship.target_id(),
                label: readable_relationship_name(relationship.relationship_type()),
                canonical_label: relationship.relationship_type().to_owned(),
                directed: true,
            });
        }
    }
    edges
}

fn stix_reference_targets(
    value: Option<&serde_json::Value>,
    stix_ids: &HashMap<&str, LocalId>,
) -> Vec<LocalId> {
    match value {
        Some(serde_json::Value::String(reference)) => stix_ids
            .get(reference.as_str())
            .copied()
            .into_iter()
            .collect(),
        Some(serde_json::Value::Array(references)) => references
            .iter()
            .filter_map(serde_json::Value::as_str)
            .filter_map(|reference| stix_ids.get(reference).copied())
            .collect(),
        _ => Vec::new(),
    }
}

fn readable_relationship_name(value: &str) -> String {
    let readable = value.replace(['-', '_'], " ");
    let mut characters = readable.chars();
    match characters.next() {
        Some(first) => first.to_uppercase().collect::<String>() + characters.as_str(),
        None => String::new(),
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphWorkspaceSeedInput {
    item_id: String,
    item_kind: WorkspaceItemKind,
    x: f64,
    y: f64,
    pinned: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphPositionInput {
    item_id: String,
    item_kind: WorkspaceItemKind,
    x: f64,
    y: f64,
    pinned: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphWorkspaceStateInput {
    expected_revision: Revision,
    mode: WorkspaceMode,
    viewport: GraphViewport,
    positions: Vec<GraphPositionInput>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphNodeSummary {
    id: LocalId,
    item_kind: WorkspaceItemKind,
    object_type: String,
    display_name: String,
    available: bool,
    source_view: String,
    stix_id: Option<String>,
    timeline_dates: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphWorkspaceView {
    workspace: GraphWorkspace,
    items: Vec<WorkspaceItem>,
    nodes: Vec<GraphNodeSummary>,
    edges: Vec<GraphEdgeSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphItemProperties {
    node: GraphNodeSummary,
    properties: Value,
    inbound: Vec<GraphEdgeSummary>,
    outbound: Vec<GraphEdgeSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GraphRelationshipDraftPreviewSummary {
    visual_link_id: LocalId,
    source_id: LocalId,
    target_id: LocalId,
    source_object_type: String,
    target_object_type: String,
    visual_label: Option<String>,
}

fn parse_workspace_id(value: &str) -> Result<LocalId, CommandError> {
    LocalId::parse(value).map_err(|_| CommandError::new(LifecycleErrorCode::InvalidGraphWorkspace))
}

fn parse_graph_item_id(value: &str) -> Result<LocalId, CommandError> {
    LocalId::parse(value).map_err(|_| CommandError::new(LifecycleErrorCode::GraphItemUnavailable))
}

fn parse_workspace_mode(value: &str) -> Result<WorkspaceMode, CommandError> {
    match value {
        "view" => Ok(WorkspaceMode::View),
        "build" => Ok(WorkspaceMode::Build),
        _ => Err(CommandError::new(LifecycleErrorCode::InvalidGraphWorkspace)),
    }
}

fn parse_seed_inputs(
    inputs: Vec<GraphWorkspaceSeedInput>,
) -> Result<Vec<GraphWorkspaceSeedItem>, CommandError> {
    inputs
        .into_iter()
        .map(|input| {
            Ok(GraphWorkspaceSeedItem::new(
                parse_graph_item_id(&input.item_id)?,
                input.item_kind,
                Position::new(input.x, input.y)
                    .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidGraphWorkspace))?,
                input.pinned,
            ))
        })
        .collect()
}

fn resolve_graph_view(
    snapshot: GraphWorkspaceSnapshot,
    objects: &[ExistingStixObject],
    drafts: &[StixDraft],
    documents: &[DocumentEnvelope],
    observations: &[TechniqueObservation],
) -> GraphWorkspaceView {
    let sources = GraphSourceIndex::new(objects, drafts, documents, observations);
    let member_ids = snapshot
        .items()
        .iter()
        .map(WorkspaceItem::item_id)
        .collect::<HashSet<_>>();
    let mut edges = resolve_stix_edges(&member_ids, objects, drafts);
    edges.extend(snapshot.visual_links().iter().map(|link| {
        let canonical = link.label().unwrap_or("visual-link");
        GraphEdgeSummary {
            id: link.id().to_string(),
            kind: GraphEdgeKind::Visual,
            source_id: link.source_id(),
            target_id: link.target_id(),
            label: readable_relationship_name(canonical),
            canonical_label: canonical.to_owned(),
            directed: false,
        }
    }));
    let nodes = snapshot
        .items()
        .iter()
        .map(|item| resolve_graph_node(item, &sources))
        .collect();
    GraphWorkspaceView {
        workspace: snapshot.workspace().clone(),
        items: snapshot.items().to_vec(),
        nodes,
        edges,
    }
}

struct GraphSourceIndex<'a> {
    objects: HashMap<LocalId, &'a ExistingStixObject>,
    drafts: HashMap<LocalId, &'a StixDraft>,
    documents: HashMap<LocalId, &'a DocumentEnvelope>,
    observations: HashMap<LocalId, &'a TechniqueObservation>,
}

impl<'a> GraphSourceIndex<'a> {
    fn new(
        objects: &'a [ExistingStixObject],
        drafts: &'a [StixDraft],
        documents: &'a [DocumentEnvelope],
        observations: &'a [TechniqueObservation],
    ) -> Self {
        Self {
            objects: objects.iter().map(|item| (item.local_id(), item)).collect(),
            drafts: drafts.iter().map(|item| (item.local_id(), item)).collect(),
            documents: documents.iter().map(|item| (item.id(), item)).collect(),
            observations: observations.iter().map(|item| (item.id(), item)).collect(),
        }
    }
}

fn resolve_graph_node(item: &WorkspaceItem, sources: &GraphSourceIndex<'_>) -> GraphNodeSummary {
    match item.item_kind() {
        WorkspaceItemKind::Intelligence => sources
            .objects
            .get(&item.item_id())
            .map(|object| GraphNodeSummary {
                id: item.item_id(),
                item_kind: item.item_kind(),
                object_type: object.object_type().to_owned(),
                display_name: display_name_from_value(object.raw(), object.stix_id()),
                available: true,
                source_view: "intelligence".to_owned(),
                stix_id: Some(object.stix_id().to_owned()),
                timeline_dates: timeline_values(object.raw()),
            })
            .or_else(|| {
                sources
                    .drafts
                    .get(&item.item_id())
                    .map(|draft| GraphNodeSummary {
                        id: item.item_id(),
                        item_kind: item.item_kind(),
                        object_type: draft.object_type().to_owned(),
                        display_name: display_name_from_value(
                            &Value::Object(draft.properties().clone()),
                            "Local draft",
                        ),
                        available: true,
                        source_view: "intelligence".to_owned(),
                        stix_id: None,
                        timeline_dates: timeline_values(&Value::Object(draft.properties().clone())),
                    })
            }),
        WorkspaceItemKind::Document => {
            sources
                .documents
                .get(&item.item_id())
                .map(|document| GraphNodeSummary {
                    id: item.item_id(),
                    item_kind: item.item_kind(),
                    object_type: document_kind_name(document.kind()).to_owned(),
                    display_name: document_display_name(document),
                    available: true,
                    source_view: "investigations".to_owned(),
                    stix_id: None,
                    timeline_dates: Vec::new(),
                })
        }
        WorkspaceItemKind::CatalogReference => {
            sources
                .observations
                .get(&item.item_id())
                .map(|observation| GraphNodeSummary {
                    id: item.item_id(),
                    item_kind: item.item_kind(),
                    object_type: "attack-pattern".to_owned(),
                    display_name: observation.reference().technique_id().to_owned(),
                    available: true,
                    source_view: "mitre".to_owned(),
                    stix_id: None,
                    timeline_dates: Vec::new(),
                })
        }
        WorkspaceItemKind::Evidence => None,
    }
    .unwrap_or_else(|| GraphNodeSummary {
        id: item.item_id(),
        item_kind: item.item_kind(),
        object_type: "unavailable".to_owned(),
        display_name: "Unavailable item".to_owned(),
        available: false,
        source_view: "unavailable".to_owned(),
        stix_id: None,
        timeline_dates: Vec::new(),
    })
}

fn timeline_values(value: &Value) -> Vec<String> {
    const TIMELINE_FIELDS: [&str; 12] = [
        "created",
        "modified",
        "first_seen",
        "last_seen",
        "valid_from",
        "valid_until",
        "first_observed",
        "last_observed",
        "published",
        "submitted",
        "analysis_started",
        "analysis_ended",
    ];
    let mut values = TIMELINE_FIELDS
        .iter()
        .filter_map(|field| value.get(*field).and_then(Value::as_str))
        .filter(|value| !value.trim().is_empty() && value.len() <= 64)
        .map(str::to_owned)
        .collect::<Vec<_>>();
    values.sort();
    values.dedup();
    values
}

fn display_name_from_value(value: &Value, fallback: &str) -> String {
    ["name", "value", "subject", "title"]
        .iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .filter(|name| !name.trim().is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| fallback.to_owned())
}

fn document_kind_name(kind: DocumentKind) -> &'static str {
    match kind {
        DocumentKind::Investigation => "investigation",
        DocumentKind::AnalystNote => "analyst-note",
        DocumentKind::Report => "report",
    }
}

fn document_display_name(document: &DocumentEnvelope) -> String {
    document
        .root()
        .get("content")
        .and_then(Value::as_array)
        .and_then(|nodes| nodes.first())
        .and_then(|node| node.get("content"))
        .and_then(Value::as_array)
        .and_then(|nodes| nodes.first())
        .and_then(|node| node.get("text"))
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| readable_relationship_name(document_kind_name(document.kind())))
}

fn graph_item_properties_value(
    item_id: LocalId,
    node: &GraphNodeSummary,
    objects: &[ExistingStixObject],
    drafts: &[StixDraft],
    documents: &[DocumentEnvelope],
    observations: &[TechniqueObservation],
) -> Value {
    if let Some(object) = objects.iter().find(|object| object.local_id() == item_id) {
        return object.raw().clone();
    }
    if let Some(draft) = drafts.iter().find(|draft| draft.local_id() == item_id) {
        return Value::Object(draft.properties().clone());
    }
    if let Some(document) = documents.iter().find(|document| document.id() == item_id) {
        return serde_json::to_value(document).unwrap_or(Value::Null);
    }
    if let Some(observation) = observations
        .iter()
        .find(|observation| observation.id() == item_id)
    {
        return serde_json::to_value(observation).unwrap_or(Value::Null);
    }
    serde_json::json!({
        "status": "unavailable",
        "itemType": node.object_type,
    })
}

#[tauri::command]
pub(crate) async fn list_graph_workspaces(
    project_id: String,
    include_deleted: bool,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<GraphWorkspace>, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let now = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.list_graph_workspaces(project_id, include_deleted, now)
    })
    .await
}

#[tauri::command]
pub(crate) async fn create_graph_workspace(
    project_id: String,
    name: String,
    mode: String,
    items: Vec<GraphWorkspaceSeedInput>,
    state: tauri::State<'_, AppState>,
) -> Result<GraphWorkspaceView, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let mode = parse_workspace_mode(&mode)?;
    let items = parse_seed_inputs(items)?;
    let now = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        let snapshot = manager.create_graph_workspace(project_id, name, mode, &items, now)?;
        let objects = manager.list_stix_objects(project_id, now)?;
        let drafts = manager.list_stix_drafts(project_id, now)?;
        let documents = manager.list_documents(project_id, now)?;
        let observations = manager.list_technique_observations(project_id, now)?;
        Ok(resolve_graph_view(
            snapshot,
            &objects,
            &drafts,
            &documents,
            &observations,
        ))
    })
    .await
}

#[tauri::command]
pub(crate) async fn load_graph_workspace(
    project_id: String,
    workspace_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<GraphWorkspaceView, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let now = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        let snapshot = manager.load_graph_workspace(project_id, workspace_id, now)?;
        let objects = manager.list_stix_objects(project_id, now)?;
        let drafts = manager.list_stix_drafts(project_id, now)?;
        let documents = manager.list_documents(project_id, now)?;
        let observations = manager.list_technique_observations(project_id, now)?;
        Ok(resolve_graph_view(
            snapshot,
            &objects,
            &drafts,
            &documents,
            &observations,
        ))
    })
    .await
}

#[tauri::command]
pub(crate) async fn create_graph_snapshot_attachment(
    project_id: String,
    document_id: String,
    workspace_id: String,
    expected_revision: u64,
    state: tauri::State<'_, AppState>,
) -> Result<GraphSnapshotAttachment, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let document_id = crate::commands::parse_document_id(&document_id)?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let expected_revision = parse_revision(expected_revision)?;
    let now = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        let snapshot = manager.load_graph_workspace(project_id, workspace_id, now)?;
        if snapshot.workspace().revision() != expected_revision {
            return Err(sheut_project::LifecycleError::from_code(
                LifecycleErrorCode::RevisionConflict,
            ));
        }
        let objects = manager.list_stix_objects(project_id, now)?;
        let drafts = manager.list_stix_drafts(project_id, now)?;
        let documents = manager.list_documents(project_id, now)?;
        let observations = manager.list_technique_observations(project_id, now)?;
        let view = resolve_graph_view(snapshot, &objects, &drafts, &documents, &observations);
        let payload = render_graph_snapshot_png(&view)?;
        let file_name = format!("graph-{}-r{}.png", workspace_id, expected_revision.get());
        let attachment =
            manager.create_image_attachment(project_id, document_id, file_name, payload, now)?;
        Ok(GraphSnapshotAttachment {
            attachment,
            workspace_id,
            workspace_revision: expected_revision,
            workspace_name: view.workspace.name().to_owned(),
        })
    })
    .await
}

fn render_graph_snapshot_png(
    view: &GraphWorkspaceView,
) -> Result<Vec<u8>, sheut_project::LifecycleError> {
    const WIDTH: u32 = 1600;
    const HEIGHT: u32 = 900;
    const MARGIN: f64 = 100.0;
    let mut image = RgbaImage::from_pixel(WIDTH, HEIGHT, Rgba([248, 250, 252, 255]));
    let positions = view
        .items
        .iter()
        .map(|item| (item.item_id(), item.position()))
        .collect::<HashMap<_, _>>();
    let (min_x, max_x, min_y, max_y) = graph_position_bounds(positions.values().copied());
    let project = |position: Position| {
        let available_width = f64::from(WIDTH) - MARGIN * 2.0;
        let available_height = f64::from(HEIGHT) - MARGIN * 2.0;
        let x = MARGIN + (position.x - min_x) / (max_x - min_x).max(1.0) * available_width;
        let y = MARGIN + (position.y - min_y) / (max_y - min_y).max(1.0) * available_height;
        (x.round() as i32, y.round() as i32)
    };
    for edge in &view.edges {
        let (Some(source), Some(target)) = (
            positions.get(&edge.source_id),
            positions.get(&edge.target_id),
        ) else {
            continue;
        };
        draw_line(
            &mut image,
            project(*source),
            project(*target),
            Rgba([89, 105, 122, 255]),
        );
    }
    for node in &view.nodes {
        let Some(position) = positions.get(&node.id) else {
            continue;
        };
        let fill = if !node.available {
            Rgba([154, 164, 175, 255])
        } else {
            match node.item_kind {
                WorkspaceItemKind::Intelligence => Rgba([3, 79, 158, 255]),
                WorkspaceItemKind::Evidence => Rgba([49, 90, 60, 255]),
                WorkspaceItemKind::Document => Rgba([122, 31, 31, 255]),
                WorkspaceItemKind::CatalogReference => Rgba([96, 56, 152, 255]),
            }
        };
        draw_node(&mut image, project(*position), fill);
    }
    let mut payload = Cursor::new(Vec::new());
    PngEncoder::new(&mut payload)
        .write_image(
            image.as_raw(),
            WIDTH,
            HEIGHT,
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|_| {
            sheut_project::LifecycleError::from_code(LifecycleErrorCode::InvalidAttachment)
        })?;
    Ok(payload.into_inner())
}

fn graph_position_bounds(positions: impl Iterator<Item = Position>) -> (f64, f64, f64, f64) {
    let mut bounds = (
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
    );
    for position in positions {
        bounds.0 = bounds.0.min(position.x);
        bounds.1 = bounds.1.max(position.x);
        bounds.2 = bounds.2.min(position.y);
        bounds.3 = bounds.3.max(position.y);
    }
    if !bounds.0.is_finite() {
        (0.0, 1.0, 0.0, 1.0)
    } else {
        bounds
    }
}

fn draw_line(image: &mut RgbaImage, start: (i32, i32), end: (i32, i32), color: Rgba<u8>) {
    let (mut x0, mut y0) = start;
    let (x1, y1) = end;
    let dx = (x1 - x0).abs();
    let sx = if x0 < x1 { 1 } else { -1 };
    let dy = -(y1 - y0).abs();
    let sy = if y0 < y1 { 1 } else { -1 };
    let mut error = dx + dy;
    loop {
        if let (Ok(x), Ok(y)) = (u32::try_from(x0), u32::try_from(y0))
            && x < image.width()
            && y < image.height()
        {
            image.put_pixel(x, y, color);
        }
        if x0 == x1 && y0 == y1 {
            break;
        }
        let doubled = error * 2;
        if doubled >= dy {
            error += dy;
            x0 += sx;
        }
        if doubled <= dx {
            error += dx;
            y0 += sy;
        }
    }
}

fn draw_node(image: &mut RgbaImage, center: (i32, i32), fill: Rgba<u8>) {
    const HALF_WIDTH: i32 = 44;
    const HALF_HEIGHT: i32 = 24;
    for y in center.1 - HALF_HEIGHT..=center.1 + HALF_HEIGHT {
        for x in center.0 - HALF_WIDTH..=center.0 + HALF_WIDTH {
            let border = x == center.0 - HALF_WIDTH
                || x == center.0 + HALF_WIDTH
                || y == center.1 - HALF_HEIGHT
                || y == center.1 + HALF_HEIGHT;
            if let (Ok(x), Ok(y)) = (u32::try_from(x), u32::try_from(y))
                && x < image.width()
                && y < image.height()
            {
                image.put_pixel(
                    x,
                    y,
                    if border {
                        Rgba([15, 23, 42, 255])
                    } else {
                        fill
                    },
                );
            }
        }
    }
}

#[tauri::command]
pub(crate) async fn list_graph_source_items(
    project_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<GraphNodeSummary>, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let now = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        let objects = manager.list_stix_objects(project_id, now)?;
        let drafts = manager.list_stix_drafts(project_id, now)?;
        let documents = manager.list_documents(project_id, now)?;
        let observations = manager.list_technique_observations(project_id, now)?;
        let sources = GraphSourceIndex::new(&objects, &drafts, &documents, &observations);
        let placeholder_workspace = LocalId::from_uuid(Uuid::nil());
        let mut nodes = Vec::new();
        for object in &objects {
            let item = WorkspaceItem::new(
                placeholder_workspace,
                object.local_id(),
                WorkspaceItemKind::Intelligence,
                Position::new(0.0, 0.0).expect("zero graph position is valid"),
                false,
            );
            nodes.push(resolve_graph_node(&item, &sources));
        }
        for draft in &drafts {
            if sources.objects.contains_key(&draft.local_id()) {
                continue;
            }
            let item = WorkspaceItem::new(
                placeholder_workspace,
                draft.local_id(),
                WorkspaceItemKind::Intelligence,
                Position::new(0.0, 0.0).expect("zero graph position is valid"),
                false,
            );
            nodes.push(resolve_graph_node(&item, &sources));
        }
        for document in &documents {
            let item = WorkspaceItem::new(
                placeholder_workspace,
                document.id(),
                WorkspaceItemKind::Document,
                Position::new(0.0, 0.0).expect("zero graph position is valid"),
                false,
            );
            nodes.push(resolve_graph_node(&item, &sources));
        }
        for observation in &observations {
            let item = WorkspaceItem::new(
                placeholder_workspace,
                observation.id(),
                WorkspaceItemKind::CatalogReference,
                Position::new(0.0, 0.0).expect("zero graph position is valid"),
                false,
            );
            nodes.push(resolve_graph_node(&item, &sources));
        }
        Ok(nodes)
    })
    .await
}

#[tauri::command]
pub(crate) async fn rename_graph_workspace(
    project_id: String,
    workspace_id: String,
    expected_revision: u64,
    name: String,
    state: tauri::State<'_, AppState>,
) -> Result<GraphWorkspace, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let expected_revision = parse_revision(expected_revision)?;
    let now = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.rename_graph_workspace(project_id, workspace_id, expected_revision, name, now)
    })
    .await
}

#[tauri::command]
pub(crate) async fn delete_graph_workspace(
    project_id: String,
    workspace_id: String,
    expected_revision: u64,
    state: tauri::State<'_, AppState>,
) -> Result<GraphWorkspace, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let expected_revision = parse_revision(expected_revision)?;
    let now = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.delete_graph_workspace(project_id, workspace_id, expected_revision, now)
    })
    .await
}

#[tauri::command]
pub(crate) async fn restore_graph_workspace(
    project_id: String,
    workspace_id: String,
    expected_revision: u64,
    state: tauri::State<'_, AppState>,
) -> Result<GraphWorkspace, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let expected_revision = parse_revision(expected_revision)?;
    let now = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.restore_graph_workspace(project_id, workspace_id, expected_revision, now)
    })
    .await
}

#[tauri::command]
pub(crate) async fn add_graph_workspace_items(
    project_id: String,
    workspace_id: String,
    expected_revision: u64,
    items: Vec<GraphWorkspaceSeedInput>,
    state: tauri::State<'_, AppState>,
) -> Result<GraphWorkspace, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let expected_revision = parse_revision(expected_revision)?;
    let items = parse_seed_inputs(items)?;
    let now = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.add_graph_workspace_items(project_id, workspace_id, expected_revision, &items, now)
    })
    .await
}

#[tauri::command]
pub(crate) async fn remove_graph_workspace_items(
    project_id: String,
    workspace_id: String,
    expected_revision: u64,
    item_ids: Vec<String>,
    state: tauri::State<'_, AppState>,
) -> Result<GraphWorkspace, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let expected_revision = parse_revision(expected_revision)?;
    let item_ids = item_ids
        .iter()
        .map(|id| parse_graph_item_id(id))
        .collect::<Result<Vec<_>, _>>()?;
    let now = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.remove_graph_workspace_items(
            project_id,
            workspace_id,
            expected_revision,
            &item_ids,
            now,
        )
    })
    .await
}

#[tauri::command]
pub(crate) async fn save_graph_workspace_state(
    project_id: String,
    workspace_id: String,
    update: GraphWorkspaceStateInput,
    state: tauri::State<'_, AppState>,
) -> Result<GraphWorkspace, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let positions = update
        .positions
        .into_iter()
        .map(|position| {
            Ok(WorkspaceItem::new(
                workspace_id,
                parse_graph_item_id(&position.item_id)?,
                position.item_kind,
                Position::new(position.x, position.y)
                    .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidGraphWorkspace))?,
                position.pinned,
            ))
        })
        .collect::<Result<Vec<_>, CommandError>>()?;
    let now = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.save_graph_workspace_state(
            project_id,
            workspace_id,
            update.expected_revision,
            update.mode,
            update.viewport,
            &positions,
            now,
        )
    })
    .await
}

#[tauri::command]
pub(crate) async fn create_graph_visual_link(
    project_id: String,
    workspace_id: String,
    expected_revision: u64,
    source_id: String,
    target_id: String,
    label: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<GraphWorkspace, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let expected_revision = parse_revision(expected_revision)?;
    let source_id = parse_graph_item_id(&source_id)?;
    let target_id = parse_graph_item_id(&target_id)?;
    let now = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.create_graph_visual_link(
            project_id,
            workspace_id,
            expected_revision,
            source_id,
            target_id,
            label.as_deref(),
            now,
        )
    })
    .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn update_graph_visual_link(
    project_id: String,
    workspace_id: String,
    expected_revision: u64,
    link_id: String,
    source_id: String,
    target_id: String,
    label: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<GraphWorkspace, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let expected_revision = parse_revision(expected_revision)?;
    let link = VisualLink::new(
        parse_graph_item_id(&link_id)?,
        workspace_id,
        parse_graph_item_id(&source_id)?,
        parse_graph_item_id(&target_id)?,
        label.as_deref(),
    )
    .map_err(|_| CommandError::new(LifecycleErrorCode::InvalidGraphWorkspace))?;
    let now = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.update_graph_visual_link(project_id, workspace_id, expected_revision, &link, now)
    })
    .await
}

#[tauri::command]
pub(crate) async fn delete_graph_visual_link(
    project_id: String,
    workspace_id: String,
    expected_revision: u64,
    link_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<GraphWorkspace, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let expected_revision = parse_revision(expected_revision)?;
    let link_id = parse_graph_item_id(&link_id)?;
    let now = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        manager.delete_graph_visual_link(project_id, workspace_id, expected_revision, link_id, now)
    })
    .await
}

#[tauri::command]
pub(crate) async fn load_graph_item_properties(
    project_id: String,
    workspace_id: String,
    item_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<GraphItemProperties, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let item_id = parse_graph_item_id(&item_id)?;
    let now = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        let snapshot = manager.load_graph_workspace(project_id, workspace_id, now)?;
        if !snapshot
            .items()
            .iter()
            .any(|item| item.item_id() == item_id)
        {
            return Err(sheut_project::LifecycleError::from_code(
                LifecycleErrorCode::GraphItemUnavailable,
            ));
        }
        let objects = manager.list_stix_objects(project_id, now)?;
        let drafts = manager.list_stix_drafts(project_id, now)?;
        let documents = manager.list_documents(project_id, now)?;
        let observations = manager.list_technique_observations(project_id, now)?;
        let view = resolve_graph_view(snapshot, &objects, &drafts, &documents, &observations);
        let node = view
            .nodes
            .iter()
            .find(|node| node.id == item_id)
            .cloned()
            .ok_or_else(|| {
                sheut_project::LifecycleError::from_code(LifecycleErrorCode::GraphItemUnavailable)
            })?;
        let properties = graph_item_properties_value(
            item_id,
            &node,
            &objects,
            &drafts,
            &documents,
            &observations,
        );
        let inbound = view
            .edges
            .iter()
            .filter(|edge| edge.target_id == item_id)
            .cloned()
            .collect();
        let outbound = view
            .edges
            .iter()
            .filter(|edge| edge.source_id == item_id)
            .cloned()
            .collect();
        Ok(GraphItemProperties {
            node,
            properties,
            inbound,
            outbound,
        })
    })
    .await
}

#[tauri::command]
pub(crate) async fn preview_graph_relationship_draft(
    project_id: String,
    workspace_id: String,
    link_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<GraphRelationshipDraftPreviewSummary, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let link_id = parse_graph_item_id(&link_id)?;
    let now = now_unix_ms()?;
    with_manager(Arc::clone(&state.projects), move |manager| {
        let preview =
            manager.preview_graph_relationship_draft(project_id, workspace_id, link_id, now)?;
        let link = preview.visual_link();
        Ok(GraphRelationshipDraftPreviewSummary {
            visual_link_id: link.id(),
            source_id: link.source_id(),
            target_id: link.target_id(),
            source_object_type: preview.source_object_type().to_owned(),
            target_object_type: preview.target_object_type().to_owned(),
            visual_label: link.label().map(str::to_owned),
        })
    })
    .await
}

#[tauri::command]
pub(crate) async fn commit_graph_relationship_draft(
    project_id: String,
    workspace_id: String,
    link_id: String,
    relationship_type: String,
    properties: Value,
    state: tauri::State<'_, AppState>,
) -> Result<StixDraftSummary, CommandError> {
    let project_id = parse_project_id(&project_id)?;
    let workspace_id = parse_workspace_id(&workspace_id)?;
    let link_id = parse_graph_item_id(&link_id)?;
    let now = now_unix_ms()?;
    let draft = with_manager(Arc::clone(&state.projects), move |manager| {
        manager.commit_graph_relationship_draft(
            project_id,
            workspace_id,
            link_id,
            relationship_type,
            properties,
            now,
        )
    })
    .await?;
    Ok(StixDraftSummary::from(&draft))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relationship_objects_resolve_to_directed_semantic_edges() {
        let source_id = LocalId::parse("e7c44850-9f67-4d26-b7e3-0d4ee82339ef").unwrap();
        let target_id = LocalId::parse("d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb").unwrap();
        let relationship_id = LocalId::parse("4f3d8e34-7c64-4d41-8b68-d7a334e1a884").unwrap();
        let objects = vec![
            ExistingStixObject::new(
                source_id,
                serde_json::json!({
                    "type": "indicator",
                    "spec_version": "2.1",
                    "id": "indicator--e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
                    "created": "2020-01-01T00:00:00.000Z",
                    "modified": "2020-01-01T00:00:00.000Z",
                    "pattern": "[domain-name:value = 'example.test']",
                    "pattern_type": "stix",
                    "valid_from": "2020-01-01T00:00:00.000Z"
                }),
            )
            .unwrap(),
            ExistingStixObject::new(
                target_id,
                serde_json::json!({
                    "type": "malware",
                    "spec_version": "2.1",
                    "id": "malware--d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
                    "created": "2020-01-01T00:00:00.000Z",
                    "modified": "2020-01-01T00:00:00.000Z",
                    "name": "Fixture malware",
                    "is_family": false
                }),
            )
            .unwrap(),
            ExistingStixObject::new(
                relationship_id,
                serde_json::json!({
                    "type": "relationship",
                    "spec_version": "2.1",
                    "id": "relationship--4f3d8e34-7c64-4d41-8b68-d7a334e1a884",
                    "created": "2020-01-01T00:00:00.000Z",
                    "modified": "2020-01-01T00:00:00.000Z",
                    "relationship_type": "indicates",
                    "source_ref": "indicator--e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
                    "target_ref": "malware--d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb"
                }),
            )
            .unwrap(),
        ];
        let members = [source_id, target_id, relationship_id]
            .into_iter()
            .collect::<HashSet<_>>();

        let edges = resolve_stix_edges(&members, &objects, &[]);

        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].kind, GraphEdgeKind::Semantic);
        assert_eq!(edges[0].source_id, source_id);
        assert_eq!(edges[0].target_id, target_id);
        assert_eq!(edges[0].canonical_label, "indicates");
        assert!(edges[0].directed);
    }

    #[test]
    fn sighting_objects_resolve_to_edges_without_using_the_sighting_as_an_endpoint() {
        let sighted_id = LocalId::parse("e7c44850-9f67-4d26-b7e3-0d4ee82339ef").unwrap();
        let context_id = LocalId::parse("d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb").unwrap();
        let sighting_id = LocalId::parse("4f3d8e34-7c64-4d41-8b68-d7a334e1a884").unwrap();
        let objects = vec![
            ExistingStixObject::new(
                sighted_id,
                serde_json::json!({
                    "type": "malware",
                    "spec_version": "2.1",
                    "id": "malware--e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
                    "created": "2020-01-01T00:00:00.000Z",
                    "modified": "2020-01-01T00:00:00.000Z",
                    "name": "Fixture malware",
                    "is_family": false
                }),
            )
            .unwrap(),
            ExistingStixObject::new(
                context_id,
                serde_json::json!({
                    "type": "identity",
                    "spec_version": "2.1",
                    "id": "identity--d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb",
                    "created": "2020-01-01T00:00:00.000Z",
                    "modified": "2020-01-01T00:00:00.000Z",
                    "name": "Fixture organization",
                    "identity_class": "organization"
                }),
            )
            .unwrap(),
            ExistingStixObject::new(
                sighting_id,
                serde_json::json!({
                    "type": "sighting",
                    "spec_version": "2.1",
                    "id": "sighting--4f3d8e34-7c64-4d41-8b68-d7a334e1a884",
                    "created": "2020-01-01T00:00:00.000Z",
                    "modified": "2020-01-01T00:00:00.000Z",
                    "sighting_of_ref": "malware--e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
                    "where_sighted_refs": [
                        "identity--d35e8b1e-10c7-4ee5-9f2b-c6ac197ca8eb"
                    ]
                }),
            )
            .unwrap(),
        ];
        let members = [sighted_id, context_id, sighting_id]
            .into_iter()
            .collect::<HashSet<_>>();

        let edges = resolve_stix_edges(&members, &objects, &[]);

        assert_eq!(edges.len(), 1);
        assert_eq!(edges[0].kind, GraphEdgeKind::Semantic);
        assert_eq!(edges[0].source_id, sighted_id);
        assert_eq!(edges[0].target_id, context_id);
        assert_ne!(edges[0].source_id, sighting_id);
        assert_ne!(edges[0].target_id, sighting_id);
        assert_eq!(edges[0].canonical_label, "sighting");
        assert!(edges[0].directed);
    }

    #[test]
    fn timeline_metadata_includes_all_distinct_bounded_stix_dates() {
        let value = serde_json::json!({
            "created": "2020-01-01T00:00:00.000Z",
            "modified": "2020-01-04T00:00:00.000Z",
            "valid_from": "2020-01-02T00:00:00.000Z",
            "first_seen": "2020-01-03T00:00:00.000Z",
            "last_seen": "2020-01-04T00:00:00.000Z",
            "analysis_ended": "x".repeat(65),
            "not_a_date_field": "2020-01-05T00:00:00.000Z"
        });

        assert_eq!(
            timeline_values(&value),
            vec![
                "2020-01-01T00:00:00.000Z",
                "2020-01-02T00:00:00.000Z",
                "2020-01-03T00:00:00.000Z",
                "2020-01-04T00:00:00.000Z",
            ]
        );
    }

    #[test]
    fn graph_snapshots_are_deterministic_valid_pngs() {
        let workspace_id = LocalId::parse("4f3d8e34-7c64-4d41-8b68-d7a334e1a884").unwrap();
        let item_id = LocalId::parse("e7c44850-9f67-4d26-b7e3-0d4ee82339ef").unwrap();
        let workspace = GraphWorkspace::new(
            workspace_id,
            "Snapshot fixture",
            WorkspaceMode::View,
            GraphViewport::new(0.0, 0.0, 1.0).unwrap(),
            1_000,
        )
        .unwrap();
        let view = GraphWorkspaceView {
            workspace,
            items: vec![WorkspaceItem::new(
                workspace_id,
                item_id,
                WorkspaceItemKind::Intelligence,
                Position::new(40.0, 60.0).unwrap(),
                false,
            )],
            nodes: vec![GraphNodeSummary {
                id: item_id,
                item_kind: WorkspaceItemKind::Intelligence,
                object_type: "indicator".to_owned(),
                display_name: "Fixture indicator".to_owned(),
                available: true,
                source_view: "intelligence".to_owned(),
                stix_id: None,
                timeline_dates: Vec::new(),
            }],
            edges: Vec::new(),
        };

        let first = render_graph_snapshot_png(&view).unwrap();
        let second = render_graph_snapshot_png(&view).unwrap();

        assert_eq!(first, second);
        assert!(first.starts_with(b"\x89PNG\r\n\x1a\n"));
        let decoded = image::load_from_memory(&first).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (1600, 900));
    }
}
