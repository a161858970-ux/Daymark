//! Daymark shell entry point.
//!
//! Desktop gets a system tray: closing the window parks the app in the tray
//! (2026-10-07 decision: tray resident + close-to-tray + menu), and the tray
//! menu is the only place that really quits the app. Android has no tray.

mod daymark_mobile;

#[cfg(not(mobile))]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
#[cfg(not(mobile))]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager; // used by tray (desktop) AND mobile plugin state

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
fn android_open_settings(app: tauri::AppHandle, kind: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        // Android 14+ blocks `am start` from app processes — the Kotlin
        // plugin fires the real Settings Intent from the Activity.
        let mobile = app.state::<crate::daymark_mobile::DaymarkMobile<tauri::Wry>>();
        mobile
            .0
            .run_mobile_plugin::<()>("openSettings", serde_json::json!({ "kind": kind }))
            .map_err(|e| format!("打开设置失败: {e}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (&app, kind);
        Err("该设置仅安卓提供".to_string())
    }
}

#[tauri::command]
async fn android_install_apk(
    app: tauri::AppHandle,
    url: String,
    dest_path: String,
) -> Result<(), String> {
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
        // Android 14+ blocks `am start` from app processes — hand the
        // file to the Kotlin plugin, which fires the installer Intent.
        let mobile = app.state::<crate::daymark_mobile::DaymarkMobile<tauri::Wry>>();
        mobile
            .0
            .run_mobile_plugin::<()>(
                "openApkInstaller",
                serde_json::json!({ "destPath": dest_path }),
            )
            .map_err(|e| format!("调起安装器失败: {e}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (&app, url, dest_path);
        Err("APK 更新仅在安卓版提供".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        // pubkey/endpoints come from tauri.conf (plugins.updater) via Config.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(daymark_mobile::plugin())
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
