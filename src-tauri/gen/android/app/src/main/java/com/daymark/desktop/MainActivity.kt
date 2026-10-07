package com.daymark.desktop

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
  }

  // System back peels in-page layers first: the page answers through
  // window.__daymarkBack (apps/web/src/backButton.ts) — Escape closes
  // whatever overlay is open, one layer per press. Only an unconsumed
  // press at the root page backgrounds the task (Android convention)
  // instead of finishing the activity, which used to kill the whole app.
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    onBackPressedDispatcher.addCallback(
      this,
      object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          webView.evaluateJavascript(
            "(window.__daymarkBack ? window.__daymarkBack() === true : false)",
          ) { result ->
            if (result != "true") {
              moveTaskToBack(true)
            }
          }
        }
      },
    )
  }
}
