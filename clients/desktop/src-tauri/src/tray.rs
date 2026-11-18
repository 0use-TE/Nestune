use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

const ID: &str = "nestune-tray";
const ACTIONS: [(&str, &str); 7] = [
    ("nestune.show", "打开 Nestune"),
    ("nestune.hide", "隐藏主窗口"),
    ("nestune.toggle", "播放 / 暂停"),
    ("nestune.previous", "上一首"),
    ("nestune.next", "下一首"),
    ("nestune.lyrics", "显示 / 隐藏桌面歌词"),
    ("nestune.quit", "退出 Nestune"),
];

struct TrayState {
    _icon: TrayIcon,
}

pub fn qa_mode() -> bool {
    cfg!(debug_assertions) && std::env::args().any(|arg| arg == "--tray-qa")
}

pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        if !qa_mode() { let _ = window.set_focus(); }
    }
}

#[cfg(target_os = "linux")]
fn host_available() -> bool {
    // An AppIndicator can be created even when the desktop has no tray host.
    // Do not hide the only way back into the app in that environment.
    std::process::Command::new("gdbus")
        .args(["call", "--session", "--timeout", "1", "--dest", "org.freedesktop.DBus",
            "--object-path", "/org/freedesktop/DBus", "--method", "org.freedesktop.DBus.NameHasOwner",
            "org.kde.StatusNotifierWatcher"])
        .output()
        .is_ok_and(|output| output.status.success() && String::from_utf8_lossy(&output.stdout).trim() == "(true,)")
}

#[cfg(not(target_os = "linux"))]
fn host_available() -> bool { true }

pub fn can_hide(app: &AppHandle) -> bool {
    app.try_state::<TrayState>().is_some() && (qa_mode() || host_available())
}

pub fn hide_main(app: &AppHandle) -> bool {
    can_hide(app) && app.get_webview_window("main").is_some_and(|window| window.hide().is_ok())
}

pub fn action(app: &AppHandle, id: &str) {
    match id {
        "nestune.show" => show_main(app),
        "nestune.hide" => { let _ = hide_main(app); },
        "nestune.quit" => {
            #[cfg(target_os = "macos")]
            let handle = app.clone();
            #[cfg(target_os = "macos")]
            let _ = app.run_on_main_thread(move || {
                super::lyrics::persist(&handle);
                handle.exit(0);
            });
            #[cfg(not(target_os = "macos"))]
            { super::lyrics::persist(app); app.exit(0); }
        },
        "nestune.lyrics" => { let _ = super::lyrics::toggle(app); },
        _ => {
            let command = match id {
                "nestune.toggle" => "toggle",
                "nestune.previous" => "previous",
                "nestune.next" => "next",
                _ => return,
            };
            if let Some(window) = app.get_webview_window("main") {
                if window.url().is_ok_and(|url| super::trusted(&url)) {
                    let value = serde_json::to_string(command).expect("static tray action");
                    let _ = window.eval(format!("window.dispatchEvent(new CustomEvent('nt:desktop-control',{{detail:{value}}}))"));
                }
            }
        },
    }
}

#[cfg(target_os = "macos")]
fn template_icon() -> tauri::image::Image<'static> {
    // A small monochrome waveform lets the menu bar choose light/dark ink.
    let mut pixels = vec![0; 36 * 36 * 4];
    for y in 0..36usize {
        for x in 0..36usize {
            if [(9.0, 7.0), (18.0, 12.0), (27.0, 16.0)].iter().any(|(cx, height)| {
                let dx = (x as f64 - cx).abs();
                let dy = ((y as f64 - 18.0).abs() - (height - 2.0)).max(0.0);
                dx * dx + dy * dy <= 4.0
            }) { pixels[(y * 36 + x) * 4 + 3] = 255; }
        }
    }
    tauri::image::Image::new_owned(pixels, 36, 36)
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let items = ACTIONS.iter().map(|(id, text)| MenuItem::with_id(app, *id, *text, true, None::<&str>))
        .collect::<tauri::Result<Vec<_>>>()?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&items[0], &items[1], &separator, &items[2], &items[3], &items[4], &items[5], &items[6]])?;
    let builder = TrayIconBuilder::with_id(ID).menu(&menu).tooltip("Nestune · 关闭窗口后继续播放")
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(|app, event| action(app, event.id.as_ref()))
        .on_tray_icon_event(|tray, event| {
            if matches!(event, TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }) {
                #[cfg(not(target_os = "macos"))]
                show_main(tray.app_handle());
                #[cfg(target_os = "macos")]
                let _ = tray;
            }
        });
    #[cfg(target_os = "macos")]
    let builder = builder.icon(template_icon()).icon_as_template(true);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.icon(app.default_window_icon().ok_or(tauri::Error::AssetNotFound("tray icon".into()))?.clone());
    let icon = builder.build(app)?;
    if qa_mode() { icon.set_visible(false)?; }
    app.manage(TrayState { _icon: icon });
    Ok(())
}

/// Runs native close/reopen/menu-exit checks with an off-screen, isolated window.
#[cfg(debug_assertions)]
pub fn run_qa(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let result = (|| -> Result<serde_json::Value, String> {
            let window = app.get_webview_window("main").ok_or("main missing")?;
            if app.tray_by_id(ID).is_none() || !can_hide(&app) { return Err("tray not registered".into()); }
            if window.is_visible().map_err(|error| error.to_string())? { return Err("QA window must start hidden".into()); }
            action(&app, "nestune.show");
            std::thread::sleep(std::time::Duration::from_millis(250));
            if !window.is_visible().map_err(|error| error.to_string())? { return Err("restore failed".into()); }
            window.close().map_err(|error| error.to_string())?;
            std::thread::sleep(std::time::Duration::from_millis(250));
            if app.get_webview_window("main").is_none() || window.is_visible().map_err(|error| error.to_string())? {
                return Err("close did not keep the hidden window alive".into());
            }
            action(&app, "nestune.show");
            std::thread::sleep(std::time::Duration::from_millis(250));
            if !window.is_visible().map_err(|error| error.to_string())? { return Err("reopen after close failed".into()); }
            action(&app, "nestune.hide");
            std::thread::sleep(std::time::Duration::from_millis(100));
            if window.is_visible().map_err(|error| error.to_string())? { return Err("hide menu failed".into()); }
            Ok(serde_json::json!({"tray":true,"restore":true,"closeHides":true,"reopen":true,"hideMenu":true,"menuItems":ACTIONS.iter().map(|item| item.0).collect::<Vec<_>>()}))
        })();
        let code = if result.is_ok() { 0 } else { 1 };
        let value = match result { Ok(value) => value, Err(error) => serde_json::json!({"error":error}) };
        let file = std::env::temp_dir().join(format!("Nestune-tray-qa-{}.json", std::process::id()));
        let _ = std::fs::write(file, value.to_string());
        println!("NESTUNE_TRAY_QA={value}");
        if code == 0 { action(&app, "nestune.quit"); } else { app.exit(code); }
    });
}
