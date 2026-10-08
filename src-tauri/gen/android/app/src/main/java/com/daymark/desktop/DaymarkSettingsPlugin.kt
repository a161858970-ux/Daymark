package com.daymark.desktop

import android.app.Activity
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

/**
 * Kotlin-side intents for Daymark.
 *
 * Android 14+ rejects `am start` executed from an app process, so every
 * system surface the shell opens goes through here with a real Intent.
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

  @InvokeArg
  class StartDownloadArgs {
    lateinit var url: String
    lateinit var fileName: String
  }

  @InvokeArg
  class QueryDownloadArgs {
    lateinit var id: String
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

  /**
   * Fire the system package installer for an APK on disk.
   *
   * The intent is pinned to the REAL installer package. resolveActivity()
   * alone is not enough — it handed us the system resolver
   * (com.android.intentresolver, not a handler: "No Activity found"), and
   * with no pin MIUI shows the "open with" chooser that attributes the
   * install to whichever app the user picks (WPS…). So: enumerate
   * handlers, favourite any *packageinstaller* package, fall back to the
   * first non-resolver handler, and if a pinned start still fails, retry
   * unpinned (a chooser beats crashing).
   */
  private fun fireInstaller(file: File): String? {
    if (!file.exists()) return "安装包不存在: ${file.path}"
    return try {
      val uri = FileProvider.getUriForFile(
        activity,
        "${activity.packageName}.fileprovider",
        file,
      )
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package.archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      @Suppress("DEPRECATION")
      val handlers =
        activity.packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
      val packages = handlers.mapNotNull { it.activityInfo?.packageName }.distinct()
      val installer = packages.firstOrNull { it.contains("packageinstaller", ignoreCase = true) }
        ?: packages.firstOrNull {
          !it.contains("intentresolver", ignoreCase = true) && it != activity.packageName
        }
      if (installer != null) intent.setPackage(installer)
      try {
        activity.startActivity(intent)
      } catch (notFound: ActivityNotFoundException) {
        intent.setPackage(null)
        activity.startActivity(intent)
      }
      null
    } catch (e: Exception) {
      "调起安装器失败: ${e.message}"
    }
  }

  @Command
  fun openApkInstaller(invoke: Invoke) {
    val args = invoke.parseArgs(InstallerArgs::class.java)
    val error = fireInstaller(File(args.destPath))
    if (error != null) invoke.reject(error) else invoke.resolve()
  }

  /**
   * Hand the update download to the SYSTEM DownloadManager: progress is
   * shown in the notification shade natively, the download survives the
   * app being backgrounded, and completion posts the system's own
   * notification — the shell keeps working while bytes move.
   */
  @Command
  fun startUpdateDownload(invoke: Invoke) {
    val args = invoke.parseArgs(StartDownloadArgs::class.java)
    try {
      // DownloadManager refuses app-internal paths ("Unsupported path"
      // for /data/data/...); the app-specific EXTERNAL dir is the
      // sanctioned destination and needs no storage permission.
      val dest = updateFile(args.fileName)
      if (dest.exists()) dest.delete()
      val dm = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
      val request = DownloadManager.Request(Uri.parse(args.url)).apply {
        setMimeType("application/vnd.android.package.archive")
        setTitle("拾序更新")
        setDescription("正在下载新版本…")
        setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        setDestinationInExternalFilesDir(activity, UPDATE_DIR_TYPE, args.fileName)
      }
      val id = dm.enqueue(request)
      lastUpdateFileName = args.fileName
      val out = JSObject()
      out.put("id", id.toString())
      invoke.resolveObject(out)
    } catch (e: Exception) {
      invoke.reject("创建下载失败: ${e.message}")
    }
  }

  @Command
  fun queryUpdateDownload(invoke: Invoke) {
    val args = invoke.parseArgs(QueryDownloadArgs::class.java)
    val out = JSObject()
    try {
      val dm = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
      val id = args.id.toLongOrNull()
      var cursor: android.database.Cursor? = null
      if (id != null) {
        cursor = dm.query(DownloadManager.Query().setFilterById(id))
      }
      if (cursor == null || !cursor.moveToFirst()) {
        out.put("status", "running")
      } else {
        val status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
        out.put(
          "status",
          when (status) {
            DownloadManager.STATUS_SUCCESSFUL -> "done"
            DownloadManager.STATUS_FAILED -> "failed"
            else -> "running"
          },
        )
      }
      cursor?.close()
      invoke.resolveObject(out)
    } catch (e: Exception) {
      invoke.reject("查询下载失败: ${e.message}")
    }
  }

  /**
   * Open the installer for the downloaded update. Falls back to the
   * canonical cache file name so a notification tap still works after
   * the app process was restarted since the download finished.
   */
  @Command
  fun openUpdateInstaller(invoke: Invoke) {
    val fileName = lastUpdateFileName ?: DEFAULT_UPDATE_FILE_NAME
    val error = fireInstaller(updateFile(fileName))
    if (error != null) invoke.reject(error) else invoke.resolve()
  }

  /** Canonical on-disk location for the update package — the SAME place
   *  DownloadManager writes it, so the notification tap always finds it. */
  private fun updateFile(fileName: String): File {
    val dir = activity.getExternalFilesDir(UPDATE_DIR_TYPE) ?: activity.cacheDir
    return File(dir, fileName)
  }

  companion object {
    private const val DEFAULT_UPDATE_FILE_NAME = "daymark-update.apk"
    private const val UPDATE_DIR_TYPE = "update"
    private var lastUpdateFileName: String? = null
  }
}
