#[cfg(desktop)]
use tauri::{webview::NewWindowResponse, Manager};
use tauri::{
    webview::{PermissionKind, PermissionResponse},
    Url, WebviewUrl, WebviewWindowBuilder,
};

const HOME: &str = "https://music.0use.net/";

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
    let smoke_test = std::env::args().any(|arg| arg == "--smoke-test");
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));
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
                        " Tauri', configurable: true });"
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
            builder.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Unable to start Nestune");
}
