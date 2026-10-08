//! Android-side settings/install intents, implemented in Kotlin
//! (`DaymarkSettingsPlugin`). Android 14+ rejects `am start` executed
//! from an app process (SecurityException: package=com.android.shell
//! does not belong to uid=...), so the shell's two "open a system
//! surface" commands go through a Tauri mobile plugin instead — the
//! supported path, where Intents are fired from the real Activity.

#[cfg(target_os = "android")]
use tauri::plugin::PluginApi;
#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;
use tauri::plugin::TauriPlugin;
use tauri::Runtime;
#[cfg(target_os = "android")]
use tauri::Manager;
#[cfg(target_os = "android")]
use tauri::AppHandle;

#[cfg(target_os = "android")]
pub const PLUGIN_IDENTIFIER: &str = "com.daymark.desktop";

/// Handle to the Kotlin plugin; managed as Tauri state on Android.
/// (Android-only: the desktop build never constructs it.)
#[cfg(target_os = "android")]
pub struct DaymarkMobile<R: Runtime>(pub PluginHandle<R>);

#[cfg(target_os = "android")]
pub fn init<R: Runtime, C: serde::de::DeserializeOwned>(
    _app: &AppHandle<R>,
    api: PluginApi<R, C>,
) -> tauri::Result<DaymarkMobile<R>> {
    let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "DaymarkSettingsPlugin")?;
    Ok(DaymarkMobile(handle))
}

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("daymark-mobile")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                // setup hands us &AppHandle directly — no .handle() hop.
                let mobile = init(app, api)?;
                app.manage(mobile);
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, api);
            }
            Ok(())
        })
        .build()
}
