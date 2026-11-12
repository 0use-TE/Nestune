#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    webview::{NewWindowResponse, PermissionKind, PermissionResponse},
    Manager, Url, WebviewUrl, WebviewWindowBuilder,
};

const HOME: &str = "https://music.0use.net/";

fn trusted(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("music.0use.net")
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
}

fn open_external(url: &Url) {
    if url.scheme() == "https" && url.username().is_empty() && url.password().is_none() {
        let _ = open::that_detached(url.as_str());
    }
}

fn main() {
    let smoke_test = std::env::args().any(|arg| arg == "--smoke-test");
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let mut builder =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::External(HOME.parse()?))
                    .title("Nestune")
                    .inner_size(1180.0, 800.0)
                    .min_inner_size(390.0, 600.0)
                    .center()
                    .visible(!smoke_test)
                    .background_color(tauri::window::Color(15, 15, 14, 255))
                    .disable_drag_drop_handler()
                    .initialization_script(concat!(
                        "Object.defineProperty(navigator, 'userAgent', {",
                        "value: navigator.userAgent + ' NestuneDesktop/",
                        env!("CARGO_PKG_VERSION"),
                        " Tauri', configurable: true });"
                    ))
                    .on_navigation(|url| {
                        if trusted(url) || url.as_str() == "about:blank" {
                            return true;
                        }
                        open_external(url);
                        false
                    })
                    .on_new_window(move |url, _| {
                        if trusted(&url) {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.navigate(url);
                            }
                        } else {
                            open_external(&url);
                        }
                        NewWindowResponse::Deny
                    })
                    .on_permission_request(|webview, permission| {
                        if webview.url().is_ok_and(|url| trusted(&url))
                            && matches!(
                                permission,
                                PermissionKind::FileSystemAccess | PermissionKind::Autoplay
                            )
                        {
                            PermissionResponse::Default
                        } else {
                            PermissionResponse::Deny
                        }
                    });
            if smoke_test {
                builder = builder.data_directory(
                    std::env::temp_dir()
                        .join(format!("nestune-tauri-check-{}", std::process::id())),
                );
            }
            builder.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Unable to start Nestune");
}
