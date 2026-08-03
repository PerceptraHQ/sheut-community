#![forbid(unsafe_code)]

//! Desktop composition root and auditable Tauri capability surface.
//! Every webview request reaches Rust through the explicit invoke-handler list below.

use std::time::{Duration, Instant};

mod commands;
mod desktop_menu;
mod export;
mod graph;
mod telemetry;

pub fn run() {
    let application = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            commands::initialize(app)?;
            telemetry::initialize(app)?;
            desktop_menu::install(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_projects,
            graph::list_graph_workspaces,
            graph::list_graph_source_items,
            graph::create_graph_workspace,
            graph::load_graph_workspace,
            graph::rename_graph_workspace,
            graph::delete_graph_workspace,
            graph::restore_graph_workspace,
            graph::add_graph_workspace_items,
            graph::remove_graph_workspace_items,
            graph::save_graph_workspace_state,
            graph::create_graph_visual_link,
            graph::update_graph_visual_link,
            graph::delete_graph_visual_link,
            graph::load_graph_item_properties,
            graph::preview_graph_relationship_draft,
            graph::commit_graph_relationship_draft,
            commands::list_stix_objects,
            commands::list_stix_drafts,
            commands::create_stix_draft,
            commands::create_stix_revision_draft,
            commands::update_stix_draft,
            commands::create_stix_relationship_draft,
            commands::update_stix_relationship_draft,
            commands::delete_stix_draft,
            commands::delete_stix_object,
            commands::preview_stix_import,
            commands::discard_stix_import_preview,
            commands::commit_stix_import,
            commands::preview_stix_export,
            commands::discard_stix_export_preview,
            commands::commit_stix_export,
            commands::list_documents,
            commands::get_mitre_catalog,
            commands::list_mitre_catalog_statuses,
            commands::preview_mitre_catalog_update,
            commands::commit_mitre_catalog_update,
            commands::reset_mitre_catalog,
            commands::list_technique_observations,
            commands::create_technique_observation,
            commands::update_technique_observation,
            commands::delete_technique_observation,
            commands::preview_mitre_mapping_import,
            commands::commit_mitre_mapping_import,
            commands::export_mitre_mapping,
            commands::preview_navigator_import,
            commands::commit_navigator_import,
            commands::export_navigator_projection,
            commands::list_project_backups,
            commands::create_project,
            commands::update_project_default_tlp,
            commands::create_document,
            commands::list_report_templates,
            commands::create_custom_report_template,
            commands::list_guided_reports,
            commands::list_report_project_data,
            commands::create_guided_report,
            commands::save_guided_report,
            commands::get_guided_report_readiness,
            commands::update_guided_report_section_disposition,
            commands::upgrade_illicit_ecosystem_report,
            commands::delete_guided_report,
            commands::restore_guided_report,
            commands::list_brand_profiles,
            commands::create_brand_profile,
            commands::update_brand_profile,
            commands::pick_brand_asset,
            commands::load_brand_asset,
            commands::delete_document,
            commands::restore_document,
            commands::list_document_revisions,
            commands::list_document_activity,
            commands::compare_document_revisions,
            commands::restore_document_revision,
            commands::export_saved_document,
            commands::export_guided_report,
            commands::list_publication_records,
            commands::reproduce_publication,
            commands::pick_document_image,
            commands::load_document_image,
            commands::import_evidence_image,
            commands::import_evidence_file,
            commands::list_evidence_files,
            commands::load_evidence_image,
            commands::update_evidence_metadata,
            commands::delete_evidence_file,
            commands::create_passphrase_project,
            commands::create_project_backup,
            commands::load_document,
            commands::save_document,
            commands::render_saved_document,
            commands::unlock_project,
            commands::unlock_passphrase_project,
            commands::lock_project,
            commands::delete_project,
            commands::restore_device_project_backup,
            commands::restore_passphrase_project_backup,
            telemetry::get_telemetry_preference,
            telemetry::set_telemetry_preference,
            telemetry::record_telemetry_event,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    let mut last_idle_check = Instant::now();
    application.run(move |app, event| match event {
        tauri::RunEvent::MainEventsCleared
            if last_idle_check.elapsed() >= Duration::from_secs(60) =>
        {
            last_idle_check = Instant::now();
            commands::lock_idle_projects(app);
        }
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } if label == "main" => commands::lock_all_projects(app),
        tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
            commands::lock_all_projects(app);
        }
        _ => {}
    });
}
