fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["lyrics_command"]),
    )).expect("Unable to generate native lyrics permissions");
}
