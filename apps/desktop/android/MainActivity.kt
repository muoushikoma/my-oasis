// 安卓壳：CI 在 `tauri android init` 之后用它替换生成的 MainActivity.kt（见 .github/workflows/android-build.yml）。
// 给网页一个最小接口 window.OasisAndroid.setImmersive(on)：故事接管页面（ui.takeover）时隐藏状态栏和导航栏，退出时恢复。
// 沉浸时系统返回键/返回手势不再退出应用，而是发给网页一个 "oasis-back" 事件 → 打开客户端的暂停菜单（玩家的出口，故事关不掉）。
package app.myoasis.desktop

import android.os.Bundle
import android.view.KeyEvent
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  private var web: WebView? = null
  @Volatile private var immersive = false

  private val backCallback = object : OnBackPressedCallback(false) {
    override fun handleOnBackPressed() { sendBack() }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    onBackPressedDispatcher.addCallback(this, backCallback)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    web = webView
    webView.addJavascriptInterface(Bridge(), "OasisAndroid")
  }

  private fun sendBack() {
    web?.evaluateJavascript("window.dispatchEvent(new Event('oasis-back'))", null)
  }

  private fun applyImmersive() {
    val c = WindowCompat.getInsetsController(window, window.decorView)
    if (immersive) {
      c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      c.hide(WindowInsetsCompat.Type.systemBars())
    } else {
      c.show(WindowInsetsCompat.Type.systemBars())
    }
    backCallback.isEnabled = immersive
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus && immersive) applyImmersive() // 从别的应用切回来时重新隐藏
  }

  override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
    if (immersive && keyCode == KeyEvent.KEYCODE_BACK) { sendBack(); return true }
    return super.onKeyDown(keyCode, event)
  }

  inner class Bridge {
    @JavascriptInterface
    fun setImmersive(on: Boolean) {
      runOnUiThread { immersive = on; applyImmersive() }
    }
  }
}
