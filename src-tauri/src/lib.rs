//! Daymark shell entry point.
//!
//! Desktop gets a system tray: closing the window parks the app in the tray
//! (2026-10-07 decision: tray resident + close-to-tray + menu), and the tray
//! menu is the only place that really quits the app. Android has no tray.

#[cfg(not(mobile))]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
#[cfg(not(mobile))]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
#[cfg(not(mobile))]
use tauri::Manager;

/// What both the tray's "打开主界面" item and a tray left-click do.
#[cfg(not(mobile))]
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Android-only APK hot-update: the official updater plugin's mobile
/// `install_inner` is a no-op (verified in tauri-plugin-updater 2.13.2
/// source), so the shell downloads the APK into the app cache (path handed
/// over by JS via the path plugin) and hands it to the system package
/// installer through a FileProvider content URI.
/// First-launch permission guidance: open the system settings surface the
/// named permission lives on (no OEM API exposes these in-process; each
/// target is a plain `am start` against a standard Settings action).
#[tauri::command]
fn android_open_settings(kind: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        const PKG: &str = "com.daymark.desktop";
        let mut command = std::process::Command::new("am");
        command.arg("start");
        match kind.as_str() {
            // System dialog: "let this app ignore battery optimisations?"
            "battery" => {
                command.args([
                    "-a",
                    "android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
                    "-d",
                    &format!("package:{PKG}"),
                ]);
            }
            // Alarms & reminders special-access page for this package.
            "exact_alarm" => {
                command.args([
                    "-a",
                    "android.settings.REQUEST_SCHEDULE_EXACT_ALARM",
                    "--es",
                    "android.provider.extra.PACKAGE_NAME",
                    PKG,
                ]);
            }
            // App details — where MIUI keeps 自启动 + 省电策略 switches.
            "app_details" => {
                command.args([
                    "-a",
                    "android.settings.APPLICATION_DETAILS_SETTINGS",
                    "-d",
                    &format!("package:{PKG}"),
                ]);
            }
            _ => return Err("未知设置项".to_string()),
        }
        let output = command
            .output()
            .map_err(|e| format!("无法打开设置: {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "打开设置失败: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = kind;
        Err("该设置仅安卓提供".to_string())
    }
}

#[tauri::command]
async fn android_install_apk(url: String, dest_path: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let resp = reqwest::get(&url)
            .await
            .map_err(|e| format!("下载失败: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("下载失败: HTTP {}", resp.status()));
        }
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("读取下载内容失败: {e}"))?;
        let dest = std::path::Path::new(&dest_path);
        if let Some(parent) = dest.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        std::fs::write(dest, &bytes).map_err(|e| format!("写入缓存失败: {e}"))?;
        let name = dest
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| "非法文件名".to_string())?;
        // file_paths.xml maps cache root under the name `my_cache_images`.
        let uri = format!(
            "content://com.daymark.desktop.fileprovider/my_cache_images/{name}"
        );
        let out = std::process::Command::new("am")
            .args([
                "start",
                "-a",
                "android.intent.action.VIEW",
                "-d",
                &uri,
                "-t",
                "application/vnd.android.package.archive",
                "--grant-read-uri-permission",
            ])
            .output()
            .map_err(|e| format!("调起安装器失败: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "安装器启动失败: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (url, dest_path);
        Err("APK 更新仅在安卓版提供".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        // pubkey/endpoints come from tauri.conf (plugins.updater) via Config.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            android_install_apk,
            android_open_settings,
        ])
        .setup(|app| {
            #[cfg(not(mobile))]
            {
                let show = MenuItem::with_id(app, "show", "打开主界面", true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", "退出 Daymark", true, None::<&str>)?;
                let menu = Menu::with_items(
                    app,
                    &[
                        &show,
                        &PredefinedMenuItem::separator(app)?,
                        &quit as &dyn tauri::menu::IsMenuItem<tauri::Wry>,
                    ],
                )?;
                TrayIconBuilder::with_id("main")
                    .icon(
                        app.default_window_icon()
                            .expect("missing window icon")
                            .clone(),
                    )
                    .tooltip("Daymark 拾序")
                    .show_menu_on_left_click(false)
                    .menu(&menu)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => show_main_window(app),
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            show_main_window(tray.app_handle());
                        }
                    })
                    .build(app)?;
            }
            #[cfg(mobile)]
            let _ = &app;
            Ok(())
        })
        .on_window_event(|window, event| {
            // The custom titlebar's ✕ parks the window in the tray; only the
            // tray menu's "退出" quits (app.exit bypasses this event).
            #[cfg(not(mobile))]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
            #[cfg(mobile)]
            let _ = (window, event);
        })
        .run(tauri::generate_context!())
        .expect("error while running Daymark");
}
