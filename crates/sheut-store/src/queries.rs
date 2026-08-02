use rusqlite::{Connection, OptionalExtension, Result, Transaction, params};

pub(super) struct ImageAttachmentRow {
    pub(super) media_type: String,
    pub(super) file_name: String,
    pub(super) byte_len: i64,
    pub(super) payload: Vec<u8>,
}

pub(super) struct EvidenceFileMetadataRow {
    pub(super) id: String,
    pub(super) revision: i64,
    pub(super) media_type: String,
    pub(super) file_name: String,
    pub(super) byte_len: i64,
    pub(super) sha256: String,
    pub(super) title: String,
    pub(super) description: String,
    pub(super) source: String,
    pub(super) captured_at: Option<String>,
    pub(super) source_url: String,
    pub(super) tags_json: String,
    pub(super) analyst_notes: String,
    pub(super) created_at_unix_ms: i64,
    pub(super) updated_at_unix_ms: i64,
}

pub(super) struct EvidenceFileRow {
    pub(super) metadata: EvidenceFileMetadataRow,
    pub(super) payload: Vec<u8>,
}

pub(super) struct BrandAssetRow {
    pub(super) role: String,
    pub(super) media_type: String,
    pub(super) file_name: String,
    pub(super) byte_len: i64,
    pub(super) payload: Vec<u8>,
}

pub(super) struct BrandAssetInsert<'a> {
    pub(super) id: &'a str,
    pub(super) profile_id: &'a str,
    pub(super) role: &'a str,
    pub(super) media_type: &'a str,
    pub(super) file_name: &'a str,
    pub(super) byte_len: i64,
    pub(super) payload: &'a [u8],
}

pub(super) struct EvidenceFileInsert<'a> {
    pub(super) id: &'a str,
    pub(super) media_type: &'a str,
    pub(super) file_name: &'a str,
    pub(super) byte_len: i64,
    pub(super) sha256: &'a str,
    pub(super) title: &'a str,
    pub(super) description: &'a str,
    pub(super) source: &'a str,
    pub(super) captured_at: Option<&'a str>,
    pub(super) source_url: &'a str,
    pub(super) tags_json: &'a str,
    pub(super) analyst_notes: &'a str,
    pub(super) created_at_unix_ms: i64,
    pub(super) updated_at_unix_ms: i64,
    pub(super) payload: &'a [u8],
}

pub(super) struct DocumentRevisionRow {
    pub(super) revision: i64,
    pub(super) saved_at_unix_ms: i64,
}

pub(super) struct DocumentActivityRow {
    pub(super) sequence: i64,
    pub(super) kind: String,
    pub(super) revision: i64,
    pub(super) source_revision: Option<i64>,
    pub(super) occurred_at_unix_ms: i64,
}

pub(super) struct StixObjectRow {
    pub(super) local_id: String,
    pub(super) payload: Vec<u8>,
}

pub(super) struct StixDraftRow {
    pub(super) local_id: String,
    pub(super) object_type: String,
    pub(super) properties: Vec<u8>,
    pub(super) semantic_relationship: Option<Vec<u8>>,
    pub(super) replaces_stix_id: Option<String>,
}

pub(super) struct GraphWorkspaceItemRow {
    pub(super) item_id: String,
    pub(super) item_kind: String,
    pub(super) x: f64,
    pub(super) y: f64,
    pub(super) pinned: bool,
}

pub(super) struct GraphVisualLinkRow {
    pub(super) id: String,
    pub(super) source_id: String,
    pub(super) target_id: String,
    pub(super) label: Option<String>,
}

macro_rules! revisioned_payload_queries {
    (
        $insert:ident,
        $update:ident,
        $insert_revision:ident,
        $load:ident,
        $list:ident,
        $table:literal,
        $revision_table:literal,
        $revision_owner:literal,
        $visibility_column:literal
    ) => {
        pub(super) fn $insert(
            transaction: &Transaction<'_>,
            id: &str,
            revision: i64,
            payload: &[u8],
        ) -> Result<usize> {
            transaction.execute(
                concat!(
                    "INSERT INTO ",
                    $table,
                    " (id, revision, payload) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO NOTHING"
                ),
                params![id, revision, payload],
            )
        }

        pub(super) fn $update(
            transaction: &Transaction<'_>,
            id: &str,
            revision: i64,
            payload: &[u8],
            expected_revision: i64,
        ) -> Result<usize> {
            transaction.execute(
                concat!(
                    "UPDATE ",
                    $table,
                    " SET revision = ?2, payload = ?3 WHERE id = ?1 AND revision = ?4 AND ",
                    $visibility_column,
                    " IS NULL"
                ),
                params![id, revision, payload, expected_revision],
            )
        }

        pub(super) fn $insert_revision(
            transaction: &Transaction<'_>,
            id: &str,
            revision: i64,
            saved_at_unix_ms: i64,
            payload: &[u8],
        ) -> Result<usize> {
            transaction.execute(
                concat!(
                    "INSERT INTO ",
                    $revision_table,
                    " (",
                    $revision_owner,
                    ", revision, saved_at_unix_ms, payload) VALUES (?1, ?2, ?3, ?4)"
                ),
                params![id, revision, saved_at_unix_ms, payload],
            )
        }

        pub(super) fn $load(connection: &Connection, id: &str) -> Result<Option<Vec<u8>>> {
            connection
                .query_row(
                    concat!(
                        "SELECT payload FROM ",
                        $table,
                        " WHERE id = ?1 AND ",
                        $visibility_column,
                        " IS NULL"
                    ),
                    [id],
                    |row| row.get(0),
                )
                .optional()
        }

        pub(super) fn $list(connection: &Connection) -> Result<Vec<Vec<u8>>> {
            let mut statement = connection.prepare(concat!(
                "SELECT payload FROM ",
                $table,
                " WHERE ",
                $visibility_column,
                " IS NULL ORDER BY id"
            ))?;
            let rows = statement.query_map([], |row| row.get(0))?;
            rows.collect()
        }
    };
}

revisioned_payload_queries!(
    insert_guided_report,
    update_guided_report,
    insert_guided_report_revision,
    load_guided_report,
    list_guided_reports,
    "guided_reports",
    "guided_report_revisions",
    "report_id",
    "deleted_at_unix_ms"
);

pub(super) fn list_all_guided_reports(connection: &Connection) -> Result<Vec<Vec<u8>>> {
    let mut statement = connection.prepare("SELECT payload FROM guided_reports ORDER BY id")?;
    let rows = statement.query_map([], |row| row.get(0))?;
    rows.collect()
}

pub(super) fn load_report_number_sequence(
    transaction: &Transaction<'_>,
    prefix: &str,
) -> Result<Option<i64>> {
    transaction
        .query_row(
            "SELECT next_value FROM report_number_sequences WHERE prefix = ?1",
            [prefix],
            |row| row.get(0),
        )
        .optional()
}

pub(super) fn upsert_report_number_sequence(
    transaction: &Transaction<'_>,
    prefix: &str,
    next_value: i64,
) -> Result<usize> {
    transaction.execute(
        "INSERT INTO report_number_sequences (prefix, next_value) VALUES (?1, ?2) \
         ON CONFLICT(prefix) DO UPDATE SET next_value = excluded.next_value",
        params![prefix, next_value],
    )
}

pub(super) fn soft_delete_guided_report(
    connection: &Connection,
    id: &str,
    deleted_at_unix_ms: i64,
) -> Result<usize> {
    connection.execute(
        "UPDATE guided_reports SET deleted_at_unix_ms = ?2 \
         WHERE id = ?1 AND deleted_at_unix_ms IS NULL",
        params![id, deleted_at_unix_ms],
    )
}

pub(super) fn restore_guided_report(connection: &Connection, id: &str) -> Result<usize> {
    connection.execute(
        "UPDATE guided_reports SET deleted_at_unix_ms = NULL \
         WHERE id = ?1 AND deleted_at_unix_ms IS NOT NULL",
        [id],
    )
}

pub(super) fn insert_brand_asset(
    connection: &Connection,
    asset: BrandAssetInsert<'_>,
) -> Result<usize> {
    connection.execute(
        "INSERT INTO brand_assets \
         (id, profile_id, role, media_type, file_name, byte_len, payload) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(id) DO NOTHING",
        params![
            asset.id,
            asset.profile_id,
            asset.role,
            asset.media_type,
            asset.file_name,
            asset.byte_len,
            asset.payload
        ],
    )
}

pub(super) fn load_brand_asset(
    connection: &Connection,
    profile_id: &str,
    id: &str,
) -> Result<Option<BrandAssetRow>> {
    connection
        .query_row(
            "SELECT a.role, a.media_type, a.file_name, a.byte_len, a.payload \
             FROM brand_assets a JOIN brand_profiles p ON p.id = a.profile_id \
             WHERE a.profile_id = ?1 AND a.id = ?2 AND p.archived_at_unix_ms IS NULL",
            params![profile_id, id],
            |row| {
                Ok(BrandAssetRow {
                    role: row.get(0)?,
                    media_type: row.get(1)?,
                    file_name: row.get(2)?,
                    byte_len: row.get(3)?,
                    payload: row.get(4)?,
                })
            },
        )
        .optional()
}

revisioned_payload_queries!(
    insert_report_template,
    update_report_template,
    insert_report_template_revision,
    load_report_template,
    list_report_templates,
    "report_templates",
    "report_template_revisions",
    "template_id",
    "archived_at_unix_ms"
);

pub(super) fn load_brand_profile_revision(
    connection: &Connection,
    id: &str,
    revision: i64,
) -> Result<Option<Vec<u8>>> {
    connection
        .query_row(
            "SELECT payload FROM brand_profile_revisions WHERE profile_id = ?1 AND revision = ?2",
            params![id, revision],
            |row| row.get(0),
        )
        .optional()
}

revisioned_payload_queries!(
    insert_brand_profile,
    update_brand_profile,
    insert_brand_profile_revision,
    load_brand_profile,
    list_brand_profiles,
    "brand_profiles",
    "brand_profile_revisions",
    "profile_id",
    "archived_at_unix_ms"
);

pub(super) fn insert_publication_record(
    connection: &Connection,
    id: &str,
    created_at_unix_ms: i64,
    payload: &[u8],
) -> Result<usize> {
    connection.execute(
        "INSERT INTO publication_history (id, created_at_unix_ms, payload) \
         VALUES (?1, ?2, ?3) ON CONFLICT(id) DO NOTHING",
        params![id, created_at_unix_ms, payload],
    )
}

pub(super) fn list_publication_records(connection: &Connection) -> Result<Vec<Vec<u8>>> {
    let mut statement = connection
        .prepare("SELECT payload FROM publication_history ORDER BY created_at_unix_ms DESC, id")?;
    let rows = statement.query_map([], |row| row.get(0))?;
    rows.collect()
}

pub(super) fn insert_graph_workspace(
    transaction: &Transaction<'_>,
    id: &str,
    revision: i64,
    deleted_at_unix_ms: Option<i64>,
    payload: &[u8],
) -> Result<usize> {
    transaction.execute(
        "INSERT INTO graph_workspaces (id, revision, deleted_at_unix_ms, payload) \
         VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO NOTHING",
        params![id, revision, deleted_at_unix_ms, payload],
    )
}

pub(super) fn update_graph_workspace(
    transaction: &Transaction<'_>,
    id: &str,
    revision: i64,
    deleted_at_unix_ms: Option<i64>,
    payload: &[u8],
    expected_revision: i64,
) -> Result<usize> {
    transaction.execute(
        "UPDATE graph_workspaces \
         SET revision = ?2, deleted_at_unix_ms = ?3, payload = ?4 \
         WHERE id = ?1 AND revision = ?5",
        params![id, revision, deleted_at_unix_ms, payload, expected_revision],
    )
}

pub(super) fn load_graph_workspace(
    connection: &Connection,
    id: &str,
    include_deleted: bool,
) -> Result<Option<Vec<u8>>> {
    connection
        .query_row(
            "SELECT payload FROM graph_workspaces \
             WHERE id = ?1 AND (?2 = 1 OR deleted_at_unix_ms IS NULL)",
            params![id, include_deleted],
            |row| row.get(0),
        )
        .optional()
}

pub(super) fn list_graph_workspaces(
    connection: &Connection,
    include_deleted: bool,
) -> Result<Vec<Vec<u8>>> {
    let mut statement = connection.prepare(
        "SELECT payload FROM graph_workspaces \
         WHERE ?1 = 1 OR deleted_at_unix_ms IS NULL ORDER BY id",
    )?;
    let rows = statement.query_map([include_deleted], |row| row.get(0))?;
    rows.collect()
}

pub(super) fn insert_graph_workspace_item(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    item_id: &str,
    item_kind: &str,
    x: f64,
    y: f64,
    pinned: bool,
) -> Result<usize> {
    transaction.execute(
        "INSERT INTO graph_workspace_items \
         (workspace_id, item_id, item_kind, x, y, pinned) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(workspace_id, item_id) DO NOTHING",
        params![workspace_id, item_id, item_kind, x, y, pinned],
    )
}

pub(super) fn list_graph_workspace_items(
    connection: &Connection,
    workspace_id: &str,
) -> Result<Vec<GraphWorkspaceItemRow>> {
    let mut statement = connection.prepare(
        "SELECT item_id, item_kind, x, y, pinned FROM graph_workspace_items \
         WHERE workspace_id = ?1 ORDER BY item_id",
    )?;
    let rows = statement.query_map([workspace_id], |row| {
        Ok(GraphWorkspaceItemRow {
            item_id: row.get(0)?,
            item_kind: row.get(1)?,
            x: row.get(2)?,
            y: row.get(3)?,
            pinned: row.get(4)?,
        })
    })?;
    rows.collect()
}

pub(super) fn count_graph_workspace_items(
    transaction: &Transaction<'_>,
    workspace_id: &str,
) -> Result<i64> {
    transaction.query_row(
        "SELECT count(*) FROM graph_workspace_items WHERE workspace_id = ?1",
        [workspace_id],
        |row| row.get(0),
    )
}

pub(super) fn update_graph_workspace_item(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    item_id: &str,
    x: f64,
    y: f64,
    pinned: bool,
) -> Result<usize> {
    transaction.execute(
        "UPDATE graph_workspace_items SET x = ?3, y = ?4, pinned = ?5 \
         WHERE workspace_id = ?1 AND item_id = ?2",
        params![workspace_id, item_id, x, y, pinned],
    )
}

pub(super) fn delete_graph_workspace_item(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    item_id: &str,
) -> Result<usize> {
    transaction.execute(
        "DELETE FROM graph_workspace_items WHERE workspace_id = ?1 AND item_id = ?2",
        params![workspace_id, item_id],
    )
}

pub(super) fn insert_graph_visual_link(
    transaction: &Transaction<'_>,
    id: &str,
    workspace_id: &str,
    source_id: &str,
    target_id: &str,
    label: Option<&str>,
) -> Result<usize> {
    transaction.execute(
        "INSERT INTO graph_visual_links (id, workspace_id, source_id, target_id, label) \
         VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(id) DO NOTHING",
        params![id, workspace_id, source_id, target_id, label],
    )
}

pub(super) fn list_graph_visual_links(
    connection: &Connection,
    workspace_id: &str,
) -> Result<Vec<GraphVisualLinkRow>> {
    let mut statement = connection.prepare(
        "SELECT id, source_id, target_id, label FROM graph_visual_links \
         WHERE workspace_id = ?1 ORDER BY id",
    )?;
    let rows = statement.query_map([workspace_id], |row| {
        Ok(GraphVisualLinkRow {
            id: row.get(0)?,
            source_id: row.get(1)?,
            target_id: row.get(2)?,
            label: row.get(3)?,
        })
    })?;
    rows.collect()
}

pub(super) fn count_graph_visual_links(
    transaction: &Transaction<'_>,
    workspace_id: &str,
) -> Result<i64> {
    transaction.query_row(
        "SELECT count(*) FROM graph_visual_links WHERE workspace_id = ?1",
        [workspace_id],
        |row| row.get(0),
    )
}

pub(super) fn update_graph_visual_link(
    transaction: &Transaction<'_>,
    id: &str,
    workspace_id: &str,
    source_id: &str,
    target_id: &str,
    label: Option<&str>,
) -> Result<usize> {
    transaction.execute(
        "UPDATE graph_visual_links SET source_id = ?3, target_id = ?4, label = ?5 \
         WHERE id = ?1 AND workspace_id = ?2",
        params![id, workspace_id, source_id, target_id, label],
    )
}

pub(super) fn delete_graph_visual_link(
    transaction: &Transaction<'_>,
    id: &str,
    workspace_id: &str,
) -> Result<usize> {
    transaction.execute(
        "DELETE FROM graph_visual_links WHERE id = ?1 AND workspace_id = ?2",
        params![id, workspace_id],
    )
}

pub(super) fn insert_project(connection: &Connection, payload: &[u8]) -> Result<usize> {
    connection.execute(
        "INSERT INTO project_metadata (singleton, payload) VALUES (1, ?1) \
         ON CONFLICT(singleton) DO NOTHING",
        [payload],
    )
}

pub(super) fn load_project(connection: &Connection) -> Result<Option<Vec<u8>>> {
    connection
        .query_row(
            "SELECT payload FROM project_metadata WHERE singleton = 1",
            [],
            |row| row.get(0),
        )
        .optional()
}

pub(super) fn update_project(connection: &Connection, payload: &[u8]) -> Result<usize> {
    connection.execute(
        "UPDATE project_metadata SET payload = ?1 WHERE singleton = 1",
        [payload],
    )
}

pub(super) fn insert_document(
    transaction: &Transaction<'_>,
    id: &str,
    revision: i64,
    payload: &[u8],
) -> Result<usize> {
    transaction.execute(
        "INSERT INTO documents (id, revision, payload) VALUES (?1, ?2, ?3) \
         ON CONFLICT(id) DO NOTHING",
        params![id, revision, payload],
    )
}

pub(super) fn update_document(
    transaction: &Transaction<'_>,
    id: &str,
    revision: i64,
    payload: &[u8],
    expected_revision: i64,
) -> Result<usize> {
    transaction.execute(
        "UPDATE documents SET revision = ?2, payload = ?3 \
         WHERE id = ?1 AND revision = ?4 AND deleted_at_unix_ms IS NULL",
        params![id, revision, payload, expected_revision],
    )
}

pub(super) fn insert_document_revision(
    transaction: &Transaction<'_>,
    id: &str,
    revision: i64,
    saved_at_unix_ms: i64,
    payload: &[u8],
) -> Result<usize> {
    transaction.execute(
        "INSERT INTO document_revisions \
         (document_id, revision, saved_at_unix_ms, payload) VALUES (?1, ?2, ?3, ?4)",
        params![id, revision, saved_at_unix_ms, payload],
    )
}

pub(super) fn insert_document_activity(
    transaction: &Transaction<'_>,
    id: &str,
    kind: &str,
    revision: i64,
    source_revision: Option<i64>,
    occurred_at_unix_ms: i64,
) -> Result<usize> {
    transaction.execute(
        "INSERT INTO document_activity \
         (document_id, kind, revision, source_revision, occurred_at_unix_ms) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, kind, revision, source_revision, occurred_at_unix_ms],
    )
}

pub(super) fn load_document(connection: &Connection, id: &str) -> Result<Option<Vec<u8>>> {
    connection
        .query_row(
            "SELECT payload FROM documents \
             WHERE id = ?1 AND deleted_at_unix_ms IS NULL",
            [id],
            |row| row.get(0),
        )
        .optional()
}

pub(super) fn load_document_record(connection: &Connection, id: &str) -> Result<Option<Vec<u8>>> {
    connection
        .query_row("SELECT payload FROM documents WHERE id = ?1", [id], |row| {
            row.get(0)
        })
        .optional()
}

pub(super) fn list_documents(connection: &Connection) -> Result<Vec<Vec<u8>>> {
    let mut statement = connection
        .prepare("SELECT payload FROM documents WHERE deleted_at_unix_ms IS NULL ORDER BY id")?;
    let rows = statement.query_map([], |row| row.get(0))?;
    rows.collect()
}

pub(super) fn insert_technique_observation(
    transaction: &Transaction<'_>,
    id: &str,
    revision: i64,
    payload: &[u8],
) -> Result<usize> {
    transaction.execute(
        "INSERT INTO technique_observations (id, revision, payload) VALUES (?1, ?2, ?3) \
         ON CONFLICT(id) DO NOTHING",
        params![id, revision, payload],
    )
}

pub(super) fn update_technique_observation(
    transaction: &Transaction<'_>,
    id: &str,
    revision: i64,
    payload: &[u8],
    expected_revision: i64,
) -> Result<usize> {
    transaction.execute(
        "UPDATE technique_observations SET revision = ?2, payload = ?3 \
         WHERE id = ?1 AND revision = ?4",
        params![id, revision, payload, expected_revision],
    )
}

pub(super) fn import_technique_observation(
    transaction: &Transaction<'_>,
    id: &str,
    revision: i64,
    payload: &[u8],
    replace_existing: bool,
) -> Result<usize> {
    if replace_existing {
        transaction.execute(
            "INSERT INTO technique_observations (id, revision, payload) VALUES (?1, ?2, ?3) \
             ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, payload = excluded.payload",
            params![id, revision, payload],
        )
    } else {
        insert_technique_observation(transaction, id, revision, payload)
    }
}

pub(super) fn list_technique_observations(connection: &Connection) -> Result<Vec<Vec<u8>>> {
    let mut statement =
        connection.prepare("SELECT payload FROM technique_observations ORDER BY id")?;
    let rows = statement.query_map([], |row| row.get(0))?;
    rows.collect()
}

pub(super) fn delete_technique_observation(
    transaction: &Transaction<'_>,
    id: &str,
    expected_revision: i64,
) -> Result<usize> {
    transaction.execute(
        "DELETE FROM technique_observations WHERE id = ?1 AND revision = ?2",
        params![id, expected_revision],
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn upsert_stix_object(
    transaction: &Transaction<'_>,
    local_id: &str,
    stix_id: &str,
    object_type: &str,
    modified: Option<&str>,
    version_key: &str,
    payload: &[u8],
) -> Result<usize> {
    transaction.execute(
        "INSERT INTO stix_objects \
         (local_id, stix_id, object_type, modified, version_key, payload) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
         ON CONFLICT(local_id) DO UPDATE SET \
         stix_id = excluded.stix_id, object_type = excluded.object_type, \
         modified = excluded.modified, version_key = excluded.version_key, \
         payload = excluded.payload",
        params![
            local_id,
            stix_id,
            object_type,
            modified,
            version_key,
            payload
        ],
    )
}

pub(super) fn list_stix_objects(connection: &Connection) -> Result<Vec<StixObjectRow>> {
    let mut statement =
        connection.prepare("SELECT local_id, payload FROM stix_objects ORDER BY local_id")?;
    let rows = statement.query_map([], |row| {
        Ok(StixObjectRow {
            local_id: row.get(0)?,
            payload: row.get(1)?,
        })
    })?;
    rows.collect()
}

pub(super) fn delete_stix_object(connection: &Connection, local_id: &str) -> Result<usize> {
    connection.execute(
        "DELETE FROM stix_objects WHERE local_id = ?1",
        params![local_id],
    )
}

pub(super) fn delete_stix_object_in_transaction(
    transaction: &Transaction<'_>,
    local_id: &str,
) -> Result<usize> {
    transaction.execute(
        "DELETE FROM stix_objects WHERE local_id = ?1",
        params![local_id],
    )
}

pub(super) fn upsert_stix_draft(
    connection: &Connection,
    local_id: &str,
    object_type: &str,
    properties: &[u8],
    semantic_relationship: Option<&[u8]>,
    replaces_stix_id: Option<&str>,
) -> Result<usize> {
    connection.execute(
        "INSERT INTO stix_drafts \
         (local_id, object_type, properties, semantic_relationship, replaces_stix_id) \
         VALUES (?1, ?2, ?3, ?4, ?5) \
         ON CONFLICT(local_id) DO UPDATE SET \
         object_type = excluded.object_type, properties = excluded.properties, \
         semantic_relationship = excluded.semantic_relationship, \
         replaces_stix_id = excluded.replaces_stix_id",
        params![
            local_id,
            object_type,
            properties,
            semantic_relationship,
            replaces_stix_id
        ],
    )
}

pub(super) fn list_stix_drafts(connection: &Connection) -> Result<Vec<StixDraftRow>> {
    let mut statement = connection.prepare(
        "SELECT local_id, object_type, properties, semantic_relationship, replaces_stix_id \
             FROM stix_drafts ORDER BY local_id",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(StixDraftRow {
            local_id: row.get(0)?,
            object_type: row.get(1)?,
            properties: row.get(2)?,
            semantic_relationship: row.get(3)?,
            replaces_stix_id: row.get(4)?,
        })
    })?;
    rows.collect()
}

pub(super) fn delete_stix_draft(connection: &Connection, local_id: &str) -> Result<usize> {
    connection.execute("DELETE FROM stix_drafts WHERE local_id = ?1", [local_id])
}

pub(super) fn load_document_revision(
    connection: &Connection,
    id: &str,
    revision: i64,
) -> Result<Option<Vec<u8>>> {
    connection
        .query_row(
            "SELECT r.payload FROM document_revisions r \
             JOIN documents d ON d.id = r.document_id \
             WHERE r.document_id = ?1 AND r.revision = ?2 \
             AND d.deleted_at_unix_ms IS NULL",
            params![id, revision],
            |row| row.get(0),
        )
        .optional()
}

pub(super) fn load_document_revision_for_publication(
    connection: &Connection,
    id: &str,
    revision: i64,
) -> Result<Option<Vec<u8>>> {
    connection
        .query_row(
            "SELECT payload FROM document_revisions WHERE document_id = ?1 AND revision = ?2",
            params![id, revision],
            |row| row.get(0),
        )
        .optional()
}

pub(super) fn load_guided_report_revision(
    connection: &Connection,
    id: &str,
    revision: i64,
) -> Result<Option<Vec<u8>>> {
    connection
        .query_row(
            "SELECT payload FROM guided_report_revisions WHERE report_id = ?1 AND revision = ?2",
            params![id, revision],
            |row| row.get(0),
        )
        .optional()
}

pub(super) fn load_report_template_revision(
    connection: &Connection,
    id: &str,
    revision: i64,
) -> Result<Option<Vec<u8>>> {
    connection
        .query_row(
            "SELECT payload FROM report_template_revisions WHERE template_id = ?1 AND revision = ?2",
            params![id, revision],
            |row| row.get(0),
        )
        .optional()
}

pub(super) fn list_document_revisions(
    connection: &Connection,
    id: &str,
) -> Result<Vec<DocumentRevisionRow>> {
    let mut statement = connection.prepare(
        "SELECT r.revision, r.saved_at_unix_ms FROM document_revisions r \
         JOIN documents d ON d.id = r.document_id \
         WHERE r.document_id = ?1 AND d.deleted_at_unix_ms IS NULL \
         ORDER BY r.revision DESC",
    )?;
    let rows = statement.query_map([id], |row| {
        Ok(DocumentRevisionRow {
            revision: row.get(0)?,
            saved_at_unix_ms: row.get(1)?,
        })
    })?;
    rows.collect()
}

pub(super) fn list_document_activity(
    connection: &Connection,
    id: &str,
) -> Result<Vec<DocumentActivityRow>> {
    let mut statement = connection.prepare(
        "SELECT a.sequence, a.kind, a.revision, a.source_revision, a.occurred_at_unix_ms \
         FROM document_activity a JOIN documents d ON d.id = a.document_id \
         WHERE a.document_id = ?1 AND d.deleted_at_unix_ms IS NULL \
         ORDER BY a.sequence DESC LIMIT 100",
    )?;
    let rows = statement.query_map([id], |row| {
        Ok(DocumentActivityRow {
            sequence: row.get(0)?,
            kind: row.get(1)?,
            revision: row.get(2)?,
            source_revision: row.get(3)?,
            occurred_at_unix_ms: row.get(4)?,
        })
    })?;
    rows.collect()
}

pub(super) fn active_document_revision(
    transaction: &Transaction<'_>,
    id: &str,
) -> Result<Option<i64>> {
    transaction
        .query_row(
            "SELECT revision FROM documents \
             WHERE id = ?1 AND deleted_at_unix_ms IS NULL",
            [id],
            |row| row.get(0),
        )
        .optional()
}

pub(super) fn deleted_document_revision(
    transaction: &Transaction<'_>,
    id: &str,
) -> Result<Option<i64>> {
    transaction
        .query_row(
            "SELECT revision FROM documents \
             WHERE id = ?1 AND deleted_at_unix_ms IS NOT NULL",
            [id],
            |row| row.get(0),
        )
        .optional()
}

pub(super) fn soft_delete_document(
    transaction: &Transaction<'_>,
    id: &str,
    deleted_at_unix_ms: i64,
) -> Result<usize> {
    transaction.execute(
        "UPDATE documents SET deleted_at_unix_ms = ?2 \
         WHERE id = ?1 AND deleted_at_unix_ms IS NULL",
        params![id, deleted_at_unix_ms],
    )
}

pub(super) fn restore_document(transaction: &Transaction<'_>, id: &str) -> Result<usize> {
    transaction.execute(
        "UPDATE documents SET deleted_at_unix_ms = NULL \
         WHERE id = ?1 AND deleted_at_unix_ms IS NOT NULL",
        [id],
    )
}

pub(super) fn delete_document(connection: &Connection, id: &str) -> Result<usize> {
    connection.execute("DELETE FROM documents WHERE id = ?1", [id])
}

pub(super) fn insert_image_attachment(
    connection: &Connection,
    id: &str,
    document_id: &str,
    media_type: &str,
    file_name: &str,
    byte_len: i64,
    payload: &[u8],
) -> Result<usize> {
    connection.execute(
        "INSERT INTO document_image_attachments \
         (id, document_id, media_type, file_name, byte_len, payload) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(id) DO NOTHING",
        params![id, document_id, media_type, file_name, byte_len, payload],
    )
}

pub(super) fn load_image_attachment(
    connection: &Connection,
    document_id: &str,
    id: &str,
) -> Result<Option<ImageAttachmentRow>> {
    connection
        .query_row(
            "SELECT a.media_type, a.file_name, a.byte_len, a.payload \
             FROM document_image_attachments a \
             JOIN documents d ON d.id = a.document_id \
             WHERE a.document_id = ?1 AND a.id = ?2 AND d.deleted_at_unix_ms IS NULL",
            params![document_id, id],
            |row| {
                Ok(ImageAttachmentRow {
                    media_type: row.get(0)?,
                    file_name: row.get(1)?,
                    byte_len: row.get(2)?,
                    payload: row.get(3)?,
                })
            },
        )
        .optional()
}

pub(super) fn insert_evidence_file(
    connection: &Connection,
    evidence: EvidenceFileInsert<'_>,
) -> Result<usize> {
    connection.execute(
        "INSERT INTO evidence_files \
         (id, revision, media_type, file_name, byte_len, sha256, title, description, source, \
          captured_at, source_url, tags_json, analyst_notes, created_at_unix_ms, \
          updated_at_unix_ms, payload) \
         VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15) \
         ON CONFLICT(id) DO NOTHING",
        params![
            evidence.id,
            evidence.media_type,
            evidence.file_name,
            evidence.byte_len,
            evidence.sha256,
            evidence.title,
            evidence.description,
            evidence.source,
            evidence.captured_at,
            evidence.source_url,
            evidence.tags_json,
            evidence.analyst_notes,
            evidence.created_at_unix_ms,
            evidence.updated_at_unix_ms,
            evidence.payload
        ],
    )
}

pub(super) fn list_evidence_files(connection: &Connection) -> Result<Vec<EvidenceFileMetadataRow>> {
    let mut statement = connection.prepare(
        "SELECT id, revision, media_type, file_name, byte_len, sha256, title, description, source, \
                captured_at, source_url, tags_json, analyst_notes, created_at_unix_ms, \
                updated_at_unix_ms \
         FROM evidence_files ORDER BY created_at_unix_ms DESC, id",
    )?;
    statement
        .query_map([], |row| {
            Ok(EvidenceFileMetadataRow {
                id: row.get(0)?,
                revision: row.get(1)?,
                media_type: row.get(2)?,
                file_name: row.get(3)?,
                byte_len: row.get(4)?,
                sha256: row.get(5)?,
                title: row.get(6)?,
                description: row.get(7)?,
                source: row.get(8)?,
                captured_at: row.get(9)?,
                source_url: row.get(10)?,
                tags_json: row.get(11)?,
                analyst_notes: row.get(12)?,
                created_at_unix_ms: row.get(13)?,
                updated_at_unix_ms: row.get(14)?,
            })
        })?
        .collect()
}

pub(super) fn load_evidence_file(
    connection: &Connection,
    id: &str,
) -> Result<Option<EvidenceFileRow>> {
    connection
        .query_row(
            "SELECT id, revision, media_type, file_name, byte_len, sha256, title, description, \
                    source, captured_at, source_url, tags_json, analyst_notes, created_at_unix_ms, \
                    updated_at_unix_ms, payload \
             FROM evidence_files WHERE id = ?1",
            params![id],
            |row| {
                Ok(EvidenceFileRow {
                    metadata: EvidenceFileMetadataRow {
                        id: row.get(0)?,
                        revision: row.get(1)?,
                        media_type: row.get(2)?,
                        file_name: row.get(3)?,
                        byte_len: row.get(4)?,
                        sha256: row.get(5)?,
                        title: row.get(6)?,
                        description: row.get(7)?,
                        source: row.get(8)?,
                        captured_at: row.get(9)?,
                        source_url: row.get(10)?,
                        tags_json: row.get(11)?,
                        analyst_notes: row.get(12)?,
                        created_at_unix_ms: row.get(13)?,
                        updated_at_unix_ms: row.get(14)?,
                    },
                    payload: row.get(15)?,
                })
            },
        )
        .optional()
}

pub(super) fn update_evidence_metadata(
    connection: &Connection,
    evidence: &EvidenceFileMetadataRow,
    expected_revision: i64,
) -> Result<usize> {
    connection.execute(
        "UPDATE evidence_files SET revision = ?2, title = ?3, description = ?4, source = ?5, \
         captured_at = ?6, source_url = ?7, tags_json = ?8, analyst_notes = ?9, \
         updated_at_unix_ms = ?10 WHERE id = ?1 AND revision = ?11",
        params![
            evidence.id,
            evidence.revision,
            evidence.title,
            evidence.description,
            evidence.source,
            evidence.captured_at,
            evidence.source_url,
            evidence.tags_json,
            evidence.analyst_notes,
            evidence.updated_at_unix_ms,
            expected_revision,
        ],
    )
}

pub(super) fn delete_evidence_file(
    connection: &Connection,
    id: &str,
    expected_revision: i64,
) -> Result<usize> {
    connection.execute(
        "DELETE FROM evidence_files WHERE id = ?1 AND revision = ?2",
        params![id, expected_revision],
    )
}
