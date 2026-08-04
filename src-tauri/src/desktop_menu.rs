use tauri::{
    App, Emitter,
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
};

const DESKTOP_ACTION_EVENT: &str = "sheut://desktop-action";
const DESKTOP_ACTION_IDS: &[&str] = &[
    "file.new-report",
    "file.save",
    "file.publish",
    "file.lock-project",
    "view.command-palette",
    "view.overview",
    "view.documents",
    "view.intelligence",
    "view.evidence",
    "view.mitre",
    "view.graph",
    "view.settings",
    "view.toggle-primary-sidebar",
    "view.toggle-secondary-sidebar",
    "view.toggle-zen",
    "help.guides",
    "help.guide.document-native-reports",
    "help.about",
];

pub(crate) fn install(app: &mut App) -> tauri::Result<()> {
    let action_item = |id: &'static str, text: &'static str, accelerator: Option<&'static str>| {
        let builder = MenuItemBuilder::with_id(id, text);
        let builder = if let Some(value) = accelerator {
            builder.accelerator(value)
        } else {
            builder
        };
        builder.build(app)
    };

    let new_report = action_item("file.new-report", "New Report…", Some("CmdOrCtrl+Shift+N"))?;
    let save = action_item("file.save", "Save", Some("CmdOrCtrl+S"))?;
    let publish = action_item("file.publish", "Publish…", Some("CmdOrCtrl+Shift+P"))?;
    let lock_project = action_item("file.lock-project", "Lock Project", None)?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&new_report)
        .separator()
        .item(&save)
        .item(&publish)
        .separator()
        .item(&lock_project)
        .separator()
        .quit()
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let command_palette = action_item(
        "view.command-palette",
        "Command Palette…",
        Some("CmdOrCtrl+K"),
    )?;
    let overview = action_item("view.overview", "Project Overview", None)?;
    let documents = action_item("view.documents", "Documents", None)?;
    let intelligence = action_item("view.intelligence", "Intelligence", None)?;
    let evidence = action_item("view.evidence", "Evidence", None)?;
    let mitre = action_item("view.mitre", "MITRE ATT&CK", None)?;
    let graph = action_item("view.graph", "Graph", None)?;
    let settings = action_item("view.settings", "Settings", Some("CmdOrCtrl+,"))?;
    let primary_sidebar = action_item(
        "view.toggle-primary-sidebar",
        "Toggle Primary Sidebar",
        None,
    )?;
    let secondary_sidebar = action_item(
        "view.toggle-secondary-sidebar",
        "Toggle Secondary Sidebar",
        None,
    )?;
    let zen = action_item("view.toggle-zen", "Toggle Zen Mode", None)?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&command_palette)
        .separator()
        .item(&overview)
        .item(&documents)
        .item(&intelligence)
        .item(&evidence)
        .item(&mitre)
        .item(&graph)
        .item(&settings)
        .separator()
        .item(&primary_sidebar)
        .item(&secondary_sidebar)
        .item(&zen)
        .build()?;

    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .fullscreen()
        .separator()
        .close_window()
        .build()?;

    let guides = action_item("help.guides", "Help & Guides", None)?;
    let reports = action_item(
        "help.guide.document-native-reports",
        "Document-native Reports",
        None,
    )?;
    let about = action_item("help.about", "About Sheut", None)?;
    let help = SubmenuBuilder::new(app, "Help")
        .item(&guides)
        .item(&reports)
        .separator()
        .item(&about)
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&file, &edit, &view, &window, &help])
        .build()?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if let Some(action_id) = bounded_action_id(event.id().as_ref()) {
            let _ = app.emit_to("main", DESKTOP_ACTION_EVENT, action_id);
        }
    });
    Ok(())
}

fn bounded_action_id(value: &str) -> Option<&'static str> {
    DESKTOP_ACTION_IDS
        .iter()
        .copied()
        .find(|candidate| *candidate == value)
}

#[cfg(test)]
mod tests {
    use super::{DESKTOP_ACTION_IDS, bounded_action_id};
    use std::collections::HashSet;

    #[test]
    fn desktop_menu_action_ids_are_unique_and_bounded() {
        assert_eq!(
            DESKTOP_ACTION_IDS.len(),
            DESKTOP_ACTION_IDS.iter().collect::<HashSet<_>>().len()
        );
        for action_id in DESKTOP_ACTION_IDS {
            assert_eq!(bounded_action_id(action_id), Some(*action_id));
        }
        assert_eq!(bounded_action_id("help.guide../../untrusted"), None);
        assert_eq!(bounded_action_id("file.delete-project"), None);
    }
}
