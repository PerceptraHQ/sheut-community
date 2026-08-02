#[path = "src/command_manifest.rs"]
mod command_manifest;

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(command_manifest::COMMAND_NAMES),
        ),
    )
    .expect("failed to build the Tauri application manifest")
}
