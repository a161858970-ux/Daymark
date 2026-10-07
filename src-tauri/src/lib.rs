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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
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
