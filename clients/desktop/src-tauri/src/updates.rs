//! Native package updates. Only the configured HTTPS origin supplies URLs and hashes.
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub struct Updates(pub Arc<Mutex<Value>>);

fn platform() -> &'static str { std::env::consts::OS }
fn snapshot(app: &AppHandle) -> Value {
    let value = app.state::<Updates>().0.lock().unwrap().clone();
    if value.is_null() { json!({"phase":"idle","received":0,"total":0}) } else { value }
}
pub fn request(app: &AppHandle, kind: &str) -> Result<Value, String> {
    if kind == "updateInfo" {
        return Ok(json!({"platform":platform(),"version":env!("CARGO_PKG_VERSION"),
            "updateProtocol":if cfg!(target_os="windows") {1} else {0},"architecture":std::env::consts::ARCH}));
    }
    if kind == "updateStatus" { return Ok(snapshot(app)); }
    #[cfg(target_os="windows")]
    return windows::request(app, kind);
    #[cfg(not(target_os="windows"))]
    Err("此平台请从下载页手动安装客户端".into())
}

#[cfg(target_os="windows")]
mod windows {
    use super::*;
    use std::{fs::{self, File}, io::{Read, Write}, path::PathBuf, time::Duration};
    use sha2::{Digest, Sha256};
    const LIMIT: u64 = 512 * 1024 * 1024;

    fn folder(app: &AppHandle) -> Result<PathBuf, String> {
        let path = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("updates");
        fs::create_dir_all(&path).map_err(|e| e.to_string())?; Ok(path)
    }
    fn set(app: &AppHandle, value: Value) { *app.state::<Updates>().0.lock().unwrap() = value; }
    fn validate(item: &Value) -> Result<(String,u64,String), String> {
        let code=item["versionCode"].as_u64().filter(|n| *n>0 && *n<=999999999).ok_or("无效更新版本")?;
        let size=item["size"].as_u64().filter(|n| *n>0 && *n<=LIMIT).ok_or("无效安装包大小")?;
        let hash=item["sha256"].as_str().filter(|s| s.len()==64 && s.bytes().all(|c| c.is_ascii_hexdigit())).ok_or("无效安装包校验值")?;
        let suffix=if std::env::consts::ARCH=="aarch64" {"?arch=arm64"} else {""};
        let path=format!("/api/client-updates/windows/{code}{suffix}");
        if item["url"].as_str()!=Some(path.as_str()) { return Err("安装包地址与客户端架构不匹配".into()); }
        Ok((path,size,hash.to_lowercase()))
    }
    fn newer(version: &str) -> bool {
        fn parts(s: &str) -> Option<Vec<u64>> { let p=s.split('.').map(str::parse).collect::<Result<Vec<u64>,_>>().ok()?; if p.len()==3 {Some(p)} else {None} }
        matches!((parts(version),parts(env!("CARGO_PKG_VERSION"))), (Some(a),Some(b)) if a>b)
    }
    fn download(app: &AppHandle) -> Result<(), String> {
        let http=reqwest::blocking::Client::builder().redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(15)).timeout(Duration::from_secs(600)).build().map_err(|e|e.to_string())?;
        let arch=if std::env::consts::ARCH=="aarch64" {"?windows_arch=arm64"} else {""};
        let url=format!("{}api/client-updates{arch}",super::super::HOME);
        let response=http.get(url).send().map_err(|e|format!("检查更新连接失败：{e}"))?.error_for_status().map_err(|e|e.to_string())?;
        let bytes=response.take(65537).bytes().collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
        if bytes.len()>65536 {return Err("更新信息过大".into());}
        let manifest:Value=serde_json::from_slice(&bytes).map_err(|_|"更新信息无效")?;
        let item=&manifest["windows"]; let (path,total,hash)=validate(item)?;
        if !newer(item["version"].as_str().unwrap_or("")) { return Err("客户端已是最新版本".into()); }
        let root=folder(app)?; let partial=root.join("setup.partial"); let ready=root.join("setup.exe");
        let result=(|| {
            let mut response=http.get(format!("{}{}",super::super::HOME.trim_end_matches('/'),path)).send().map_err(|e|format!("下载连接失败：{e}"))?.error_for_status().map_err(|e|e.to_string())?;
            let mut output=File::create(&partial).map_err(|e|e.to_string())?;
            let mut received=0u64; let mut hasher=Sha256::new(); let mut buffer=[0u8;65536];
            loop {
                let n=response.read(&mut buffer).map_err(|e|format!("下载中断：{e}"))?; if n==0 {break;}
                received+=n as u64; if received>total {return Err("安装包大小与发布信息不一致".into());}
                output.write_all(&buffer[..n]).map_err(|e|e.to_string())?;hasher.update(&buffer[..n]);
                set(app,json!({"phase":"downloading","received":received,"total":total}));
            }
            output.sync_all().map_err(|e|e.to_string())?;drop(output);
            set(app,json!({"phase":"verifying","received":received,"total":total}));
            if received!=total || format!("{:x}",hasher.finalize())!=hash {return Err("安装包校验失败，请重新下载".into());}
            if ready.exists() {fs::remove_file(&ready).map_err(|e|e.to_string())?;}
            fs::rename(&partial,&ready).map_err(|e|e.to_string())?;
            set(app,json!({"phase":"ready","received":total,"total":total,"sha256":hash}));Ok(())
        })();
        if result.is_err() {let _=fs::remove_file(partial);} result
    }
    pub fn request(app: &AppHandle, kind: &str) -> Result<Value,String> {
        match kind {
            "updateStart" => {
                let state=app.state::<Updates>();let mut value=state.0.lock().unwrap();
                if matches!(value["phase"].as_str(),Some("checking"|"downloading"|"verifying"|"installing")) {return Ok(value.clone());}
                *value=json!({"phase":"checking","received":0,"total":0});drop(value);
                let handle=app.clone();std::thread::spawn(move || {
                    if let Err(error)=download(&handle) {set(&handle,json!({"phase":"error","error":error}));}
                });Ok(snapshot(app))
            }
            "updateInstall" => {
                let state=snapshot(app);if state["phase"]!="ready" {return Err("请先完成安装包下载".into());}
                let path=folder(app)?.join("setup.exe");
                let hash=format!("{:x}",Sha256::digest(fs::read(&path).map_err(|e|e.to_string())?));
                if state["sha256"].as_str()!=Some(hash.as_str()) {return Err("安装包已变化，请重新下载".into());}
                // Interactive NSIS installer handles elevation/installation. Never install a URL supplied by the page.
                std::process::Command::new(path).arg("/UPDATE").spawn().map_err(|e|format!("无法打开安装程序：{e}"))?;
                set(app,json!({"phase":"installing"}));app.exit(0);Ok(json!({"phase":"installing"}))
            }
            _=>Err("未知更新操作".into())
        }
    }
    #[cfg(test)] mod tests {
        use super::*;
        #[test] fn validates_architecture_and_package_limits() {
            let suffix=if std::env::consts::ARCH=="aarch64" {"?arch=arm64"} else {""};
            let mut value=json!({"versionCode":125,"size":100,"sha256":"a".repeat(64),"url":format!("/api/client-updates/windows/125{suffix}")});
            assert!(validate(&value).is_ok());value["url"]=json!("https://example.com/setup.exe");assert!(validate(&value).is_err());
            value["url"]=json!(format!("/api/client-updates/windows/125{suffix}"));value["size"]=json!(LIMIT+1);assert!(validate(&value).is_err());
            assert!(!newer(env!("CARGO_PKG_VERSION")));assert!(!newer("invalid"));assert!(newer("999.0.0"));
        }
    }
}
