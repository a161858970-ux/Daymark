package com.daymark.desktop

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File

/**
 * Kotlin-side intents for Daymark.
 *
 * Android 14+ rejects `am start` executed from an app process
 * (SecurityException: package=com.android.shell does not belong to
 * uid=...), so every system surface the shell opens — the APK installer
 * and the first-launch permission settings pages — is fired from here
 * with a real Intent, which is the supported path.
 */
@TauriPlugin
class DaymarkSettingsPlugin(private val activity: Activity) : Plugin(activity) {

  @InvokeArg
  class OpenSettingsArgs {
    lateinit var kind: String
  }

  @InvokeArg
  class InstallerArgs {
    lateinit var destPath: String
  }

  @Command
  fun openSettings(invoke: Invoke) {
    val args = invoke.parseArgs(OpenSettingsArgs::class.java)
    val pkg = activity.packageName
    val intent = when (args.kind) {
      // System dialog: "let this app ignore battery optimisations?"
      "battery" -> Intent(
        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
        Uri.parse("package:$pkg"),
      )
      // Alarms & reminders special-access page for this package.
      "exact_alarm" -> Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
        // Literal string: the EXTRA_PACKAGE_NAME constant is missing from
        // this compileSdk's android.jar, the value is stable AOSP API.
        putExtra("android.provider.extra.PACKAGE_NAME", pkg)
      }
      // App details — where MIUI keeps 自启动 + 省电策略 switches.
      "app_details" -> Intent(
        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
        Uri.parse("package:$pkg"),
      )
      else -> null
    }
    if (intent == null) {
      invoke.reject("未知设置项: ${args.kind}")
      return
    }
    try {
      activity.startActivity(intent)
      invoke.resolve()
    } catch (e: Exception) {
      invoke.reject("无法打开设置: ${e.message}")
    }
  }

  @Command
  fun openApkInstaller(invoke: Invoke) {
    val args = invoke.parseArgs(InstallerArgs::class.java)
    val file = File(args.destPath)
    if (!file.exists()) {
      invoke.reject("安装包不存在: ${args.destPath}")
      return
    }
    try {
      val uri = FileProvider.getUriForFile(
        activity,
        "${activity.packageName}.fileprovider",
        file,
      )
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package.archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      activity.startActivity(intent)
      invoke.resolve()
    } catch (e: Exception) {
      invoke.reject("调起安装器失败: ${e.message}")
    }
  }
}
