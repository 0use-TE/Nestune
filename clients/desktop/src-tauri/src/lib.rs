#[cfg(desktop)]
use tauri::{webview::NewWindowResponse, Manager};
use tauri::{
    webview::{PermissionKind, PermissionResponse},
    Url, WebviewUrl, WebviewWindowBuilder,
};

const HOME: &str = "https://music.0use.net/";
#[cfg(desktop)]
mod lyrics;

fn trusted(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("music.0use.net")
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
}

#[cfg(desktop)]
fn open_external(url: &Url) {
    if url.scheme() == "https" && url.username().is_empty() && url.password().is_none() {
        let _ = open::that_detached(url.as_str());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(desktop)]
    let smoke_test = std::env::args().any(|arg| arg == "--smoke-test" || arg == "--lyrics-qa");
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.invoke_handler(tauri::generate_handler![lyrics::lyrics_command]);
    #[cfg(desktop)]
    let builder = if smoke_test { builder } else { builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    })) };
    builder
        .setup(move |app| {
            let builder =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::External(HOME.parse()?))
                    .title("Nestune")
                    .background_color(tauri::window::Color(15, 15, 14, 255))
                    .initialization_script(concat!(
                        "Object.defineProperty(navigator, 'userAgent', {",
                        "value: navigator.userAgent + ' NestuneDesktop/",
                        env!("CARGO_PKG_VERSION"),
                        " Tauri', configurable: true });",
                        "if(!/Android/.test(navigator.userAgent)){Object.defineProperty(window,'NestuneDesktop',{value:Object.freeze({request:data=>window.__TAURI_INTERNALS__.invoke('lyrics_command',{data})})});}"
                    ))
                    .on_navigation(|url| {
                        if trusted(url) || url.as_str() == "about:blank" {
                            return true;
                        }
                        #[cfg(desktop)]
                        open_external(url);
                        false
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
            #[cfg(desktop)]
            let builder = {
                let app_handle = app.handle().clone();
                let mut builder = builder
                    .inner_size(1180.0, 800.0)
                    .min_inner_size(390.0, 600.0)
                    .center()
                    .visible(!smoke_test)
                    .disable_drag_drop_handler()
                    .on_new_window(move |url, _| {
                        if trusted(&url) {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.navigate(url);
                            }
                        } else {
                            open_external(&url);
                        }
                        NewWindowResponse::Deny
                    });
                if smoke_test {
                    builder = builder.data_directory(
                        std::env::temp_dir()
                            .join(format!("nestune-tauri-check-{}", std::process::id())),
                    );
                }
                builder
            };
            #[cfg(all(desktop, debug_assertions))]
            let builder = if std::env::args().any(|arg| arg == "--lyrics-qa") {
                builder.initialization_script(include_str!("../qa/desktop-lyrics.js"))
                    .on_document_title_changed(|window, title| {
                        if let Some(raw) = title.strip_prefix("NestuneQA:") {
                            if let Ok(mut value) = serde_json::from_str::<serde_json::Value>(raw) {
                                if let Some(lyrics) = window.app_handle().get_webview_window("lyrics") {
                                    value["visible"] = serde_json::json!(lyrics.is_visible().ok());
                                    value["alwaysOnTop"] = serde_json::json!(lyrics.is_always_on_top().ok());
                                    value["decorated"] = serde_json::json!(lyrics.is_decorated().ok());
                                }
                                let file = std::env::temp_dir().join(format!("Nestune-lyrics-qa-{}.json", std::process::id()));
                                let _ = std::fs::write(file, value.to_string());
                            }
                        }
                    })
            } else { builder };
            let main = builder.build()?;
            #[cfg(desktop)]
            {
                let handle = app.handle().clone();
                main.on_window_event(move |event| {
                    if matches!(event, tauri::WindowEvent::CloseRequested { .. }) { lyrics::persist(&handle); handle.exit(0); }
                });
                lyrics::setup(app.handle(), smoke_test)?;
            }
            #[cfg(mobile)]
            let _ = main;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Unable to start Nestune")
        .run(|app, event| {
            #[cfg(desktop)]
            if matches!(event, tauri::RunEvent::Exit) { lyrics::persist(app); }
            #[cfg(mobile)]
            let _ = (app, event);
        });
}
