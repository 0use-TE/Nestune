use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Preferences {
    enabled: bool,
    locked: bool,
    panel: bool,
    x: Option<i32>,
    y: Option<i32>,
}

pub struct Runtime {
    preferences: Preferences,
    data: Value,
    media: Value,
}

fn info(preferences: &Preferences) -> Value {
    json!({ "supported": true, "platform": "desktop", "permission": true,
        "enabled": preferences.enabled, "locked": preferences.locked, "panel": preferences.panel })
}

fn notify(app: &AppHandle, preferences: &Preferences) {
    if let Some(overlay) = app.get_webview_window("lyrics") {
        let _ = overlay.eval(format!("window.nestuneLyricsState && window.nestuneLyricsState({})", info(preferences)));
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.eval(format!("window.dispatchEvent(new CustomEvent('nt:lyrics-state',{{detail:{}}}))", info(preferences)));
    }
}

pub fn persist(app: &AppHandle) {
    let Some(state) = app.try_state::<Mutex<Runtime>>() else { return };
    let Ok(runtime) = state.lock() else { return };
    let folder = if std::env::args().any(|arg| matches!(arg.as_str(), "--smoke-test" | "--lyrics-qa" | "--lyrics-controls-qa")) {
        Ok(std::env::temp_dir().join(format!("nestune-lyrics-check-{}", std::process::id())))
    } else { app.path().app_config_dir() };
    if let Ok(folder) = folder {
        if std::fs::create_dir_all(&folder).is_ok() {
            if let Ok(data) = serde_json::to_vec(&runtime.preferences) {
                let temporary = folder.join("lyrics-window.new");
                if std::fs::write(&temporary, data).is_ok() {
                    let _ = std::fs::rename(temporary, folder.join("lyrics-window.json"));
                }
            }
        }
    }
}

pub fn setup(app: &AppHandle, smoke_test: bool) -> tauri::Result<()> {
    let mut preferences = app.path().app_config_dir().ok()
        .and_then(|folder| std::fs::read(folder.join("lyrics-window.json")).ok())
        .and_then(|data| serde_json::from_slice::<Preferences>(&data).ok()).unwrap_or_default();
    if smoke_test { preferences.enabled = false; preferences.locked = false; }
    #[cfg(debug_assertions)]
    let controls_qa = std::env::args().any(|arg| arg == "--lyrics-controls-qa");
    #[cfg(debug_assertions)]
    if controls_qa { preferences.enabled = true; preferences.locked = true; }
    app.manage(Mutex::new(Runtime { preferences: preferences.clone(), data: Value::Null, media: Value::Null }));
    let builder = WebviewWindowBuilder::new(app, "lyrics", WebviewUrl::App("lyrics.html".into()))
        .title("Nestune · 桌面歌词").inner_size(620.0, 138.0).min_inner_size(280.0, 100.0)
        .decorations(false).transparent(true).shadow(false).always_on_top(true)
        .skip_taskbar(true).focused(false).resizable(true).visible(false)
        .background_color(tauri::window::Color(0, 0, 0, 0))
        .on_navigation(|url| local_lyrics_url(url))
        .on_permission_request(|_, _| tauri::webview::PermissionResponse::Deny);
    #[cfg(debug_assertions)]
    let builder = if std::env::args().any(|arg| arg == "--lyrics-qa") {
        builder.on_document_title_changed(|_, title| {
            if let Some(raw) = title.strip_prefix("NestuneLyricsViewQA:") {
                if serde_json::from_str::<Value>(raw).is_ok() {
                    let file = std::env::temp_dir().join(format!("Nestune-lyrics-view-qa-{}.json", std::process::id()));
                    let _ = std::fs::write(file, raw);
                }
            }
        })
    } else { builder };
    #[cfg(debug_assertions)]
    let builder = if controls_qa {
        builder.initialization_script(include_str!("../qa/lyrics-controls.js"))
            .on_document_title_changed(|window, title| {
                if let Some(raw) = title.strip_prefix("NestuneControlsQA:") {
                    if serde_json::from_str::<Value>(raw).is_ok() {
                        let file = std::env::temp_dir().join(format!("Nestune-controls-qa-{}.json", std::process::id()));
                        let _ = std::fs::write(file, raw);
                        window.app_handle().exit(0);
                    }
                }
            })
    } else { builder };
    let window = builder.build()?;
    let restored = if let (Some(x), Some(y)) = (preferences.x, preferences.y) {
        let visible = window.available_monitors()?.iter().any(|monitor| {
            let origin = monitor.position(); let size = monitor.size();
            x >= origin.x - 500 && x < origin.x + size.width as i32 - 80
                && y >= origin.y && y < origin.y + size.height as i32 - 70
        });
        if visible { window.set_position(PhysicalPosition::new(x, y))?; }
        visible
    } else { false };
    if !restored {
        if let Some(monitor) = window.primary_monitor()? {
            let scale = monitor.scale_factor();
            let size = monitor.size(); let origin = monitor.position();
            window.set_position(PhysicalPosition::new(
                origin.x + ((size.width as f64 - 620.0 * scale) / 2.0).max(0.0) as i32,
                origin.y + (size.height as f64 - 210.0 * scale).max(0.0) as i32,
            ))?;
        }
    }
    let handle = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Moved(position) = event {
            if let Some(state) = handle.try_state::<Mutex<Runtime>>() {
                if let Ok(mut runtime) = state.lock() {
                    runtime.preferences.x = Some(position.x); runtime.preferences.y = Some(position.y);
                }
            }
        }
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if let Some(window) = handle.get_webview_window("lyrics") { let _ = window.hide(); }
            if let Some(state) = handle.try_state::<Mutex<Runtime>>() {
                if let Ok(mut runtime) = state.lock() { runtime.preferences.enabled = false; notify(&handle, &runtime.preferences); }
            }
            persist(&handle);
        }
    });
    // Locking fixes the position. Keep the toolbar interactive, including after
    // restoring a lock saved by an older click-through implementation.
    window.set_ignore_cursor_events(false)?;
    let show = preferences.enabled;
    #[cfg(debug_assertions)]
    let show = show && !controls_qa;
    if show { window.show()?; }
    Ok(())
}

fn local_lyrics_url(url: &tauri::Url) -> bool {
    url.path() == "/lyrics.html" && url.username().is_empty() && url.password().is_none()
        && ((url.scheme() == "tauri" && url.host_str() == Some("localhost"))
            || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost")))
}

fn bounded_data(data: &Value) -> bool {
    if data.to_string().len() > 300_000 { return false }
    match data.get("type").and_then(Value::as_str) {
        Some("lyricsData") => data.get("id").and_then(Value::as_str).is_some_and(|s| s.len() <= 640)
            && data.get("title").and_then(Value::as_str).is_some_and(|s| s.len() <= 1024)
            && data.get("lines").and_then(Value::as_array).is_some_and(|lines| lines.len() <= 1200 && lines.iter().all(|line| {
                line.get("t").and_then(Value::as_f64).is_some_and(|t| t.is_finite() && (0.0..=86400.0).contains(&t))
                    && line.get("text").and_then(Value::as_str).is_some_and(|text| text.len() <= 1024)
                    && line.get("tr").is_none_or(|tr| tr.as_str().is_some_and(|text| text.len() <= 1024))
            })),
        Some("lyricsMedia") => data.get("id").and_then(Value::as_str).is_some_and(|s| s.len() <= 640)
            && data.get("position").and_then(Value::as_f64).is_some_and(|t| t.is_finite() && (0.0..=86400.0).contains(&t))
            && data.get("playing").and_then(Value::as_bool).is_some(),
        _ => false,
    }
}

#[tauri::command]
pub async fn lyrics_command(app: AppHandle, window: WebviewWindow, data: Value) -> Result<Value, String> {
    let url = window.url().map_err(|_| "无法读取窗口来源")?;
    let main = window.label() == "main" && super::trusted(&url);
    let local = window.label() == "lyrics" && local_lyrics_url(&url);
    if !main && !local { return Err("不允许此来源操作歌词窗口".into()) }
    let kind = data.get("type").and_then(Value::as_str).ok_or("无效操作")?;
    let state = app.state::<Mutex<Runtime>>();
    let mut runtime = state.lock().map_err(|_| "歌词窗口繁忙")?;
    let overlay = app.get_webview_window("lyrics").ok_or("歌词窗口不可用")?;
    match kind {
        "lyricsInfo" => {},
        "lyricsSnapshot" if local => return Ok(json!({ "state": info(&runtime.preferences), "data": runtime.data, "media": runtime.media })),
        #[cfg(all(debug_assertions, target_os = "windows"))]
        "lyricsControlsProbe" if local && std::env::args().any(|arg| arg == "--lyrics-controls-qa") => {
            #[link(name = "user32")]
            extern "system" { fn GetWindowLongW(hwnd: *mut std::ffi::c_void, index: i32) -> i32; }
            let hwnd = overlay.hwnd().map_err(|_| "Probe window missing")?;
            let style = unsafe { GetWindowLongW(hwnd.0, -20) };
            return Ok(json!({ "state": info(&runtime.preferences), "clickThrough": style & 0x20 != 0,
                "visible": overlay.is_visible().map_err(|_| "Probe visibility failed")? }));
        },
        #[cfg(debug_assertions)]
        "lyricsProbe" if main && std::env::args().any(|arg| arg == "--lyrics-qa") => {
            overlay.eval("document.title='NestuneLyricsViewQA:'+JSON.stringify({line:document.getElementById('line').textContent,translation:document.getElementById('translation').textContent,title:document.getElementById('title').textContent})").map_err(|_| "Probe failed")?;
        },
        "lyricsData" | "lyricsMedia" if main => {
            if !bounded_data(&data) { return Err("歌词数据格式无效或过长".into()) }
            let target = if kind == "lyricsData" { &mut runtime.data } else { &mut runtime.media };
            *target = data.clone();
            if runtime.preferences.enabled {
                let handler = if kind == "lyricsData" { "nestuneLyricsData" } else { "nestuneLyricsMedia" };
                overlay.eval(format!("window.{handler} && window.{handler}({data})")).map_err(|_| "无法更新歌词")?;
            }
        },
        "lyricsEnable" => {
            let enabled = data.get("enabled").and_then(Value::as_bool).ok_or("缺少开关状态")?;
            if local && enabled { return Err("请从播放器打开桌面歌词".into()) }
            runtime.preferences.enabled = enabled;
            if enabled {
                overlay.eval(format!("window.nestuneLyricsData && window.nestuneLyricsData({});window.nestuneLyricsMedia && window.nestuneLyricsMedia({})", runtime.data, runtime.media)).map_err(|_| "无法更新歌词")?;
                overlay.set_ignore_cursor_events(false).map_err(|_| "无法恢复歌词按钮")?;
                overlay.show().map_err(|_| "无法显示歌词窗口")?;
            } else { overlay.hide().map_err(|_| "无法关闭歌词窗口")?; }
        },
        "lyricsLock" => {
            runtime.preferences.locked = data.get("locked").and_then(Value::as_bool).ok_or("缺少锁定状态")?;
            overlay.set_ignore_cursor_events(false).map_err(|_| "无法恢复歌词按钮")?;
        },
        "lyricsPanel" if local => {
            runtime.preferences.panel = data.get("panel").and_then(Value::as_bool).ok_or("缺少背景状态")?;
        },
        "lyricsDrag" if local && !runtime.preferences.locked => {
            drop(runtime);
            overlay.start_dragging().map_err(|_| "无法拖动歌词窗口")?;
            return Ok(json!({ "ok": true }));
        },
        _ => return Err("不支持此歌词窗口操作".into()),
    }
    let response = info(&runtime.preferences);
    if !matches!(kind, "lyricsInfo" | "lyricsData" | "lyricsMedia") {
        notify(&app, &runtime.preferences); drop(runtime); persist(&app);
    }
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_external_or_lookalike_lyrics_pages() {
        for url in ["https://music.0use.net/lyrics.html", "https://tauri.localhost.evil/lyrics.html", "file:///lyrics.html"] {
            assert!(!local_lyrics_url(&url.parse().unwrap()));
        }
        assert!(local_lyrics_url(&"http://tauri.localhost/lyrics.html".parse().unwrap()));
    }
    #[test]
    fn rejects_malformed_or_unbounded_clock_data() {
        assert!(bounded_data(&json!({ "type": "lyricsMedia", "id": "a", "position": 3.0, "playing": true })));
        assert!(!bounded_data(&json!({ "type": "lyricsMedia", "id": "a", "position": -1, "playing": true })));
        assert!(!bounded_data(&json!({ "type": "lyricsData", "id": "a", "title": "b", "lines": [{ "t": "bad", "text": "a" }] })));
    }
}
