package net.ouse.nestune

import android.content.Intent
import android.app.DownloadManager
import android.os.Environment
import android.net.Uri
import android.os.Build
import android.webkit.WebView
import android.view.ViewGroup
import android.view.WindowManager
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.activity.OnBackPressedCallback
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.webkit.WebMessageCompat
import org.json.JSONObject
import java.lang.ref.WeakReference

internal object NestuneOrigin {
    private const val HOST = "nestune.0use.net"
    private const val PORT = 8443
    const val URL = "https://$HOST:$PORT"

    fun allows(uri: Uri): Boolean =
        uri.scheme == "https" && uri.host == HOST && uri.port == PORT && uri.userInfo == null
}

class MainActivity : TauriActivity() {
    private val musicDownloads by lazy { MusicDownloads(this) }
    override fun onWebViewCreate(webView: WebView) {
        super.onWebViewCreate(webView)
        if (Build.VERSION.SDK_INT >= 30) {
            WindowCompat.setDecorFitsSystemWindows(window, false)
            window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING)
            ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
                val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
                val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
                val layout = view.layoutParams as? ViewGroup.MarginLayoutParams
                val bottom = maxOf(bars.bottom, ime.bottom)
                if (layout != null && (layout.leftMargin != bars.left || layout.topMargin != bars.top || layout.rightMargin != bars.right || layout.bottomMargin != bottom)) {
                    layout.setMargins(bars.left, bars.top, bars.right, bottom)
                    view.layoutParams = layout
                }
                insets
            }
            ViewCompat.requestApplyInsets(webView)
        } else window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        NativeMediaService.webView = WeakReference(webView)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "NestuneNative", setOf(NestuneOrigin.URL)) { _, message, origin, mainFrame, reply ->
                if (!mainFrame || !NestuneOrigin.allows(origin)) return@addWebMessageListener
                if (message.type != WebMessageCompat.TYPE_STRING) return@addWebMessageListener
                val raw = message.data ?: return@addWebMessageListener
                if (raw.length > 300000) return@addWebMessageListener
                try {
                    val data = JSONObject(raw)
                    if (data.optString("type") in setOf("lyricsInfo", "lyricsEnable", "lyricsLock", "lyricsData", "lyricsMedia")) {
                        val result = LyricsOverlay.get(this).request(data)
                        if (data.optString("type") == "lyricsEnable" && data.optBoolean("enabled") && !result.optBoolean("permission")) {
                            startActivity(Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
                        }
                        if (data.has("requestId")) reply.postMessage(result.put("requestId", data.optString("requestId").take(80)).toString())
                        return@addWebMessageListener
                    }
                    if (raw.length > 8192) return@addWebMessageListener
                    if (data.optString("type") == "clientInfo") {
                        val info = packageManager.getPackageInfo(packageName, 0)
                        val code = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
                        reply.postMessage(JSONObject().put("type", "clientInfo").put("platform", "android").put("version", info.versionName).put("versionCode", code).put("canDownload", true).put("canDownloadMusic", true).toString())
                        return@addWebMessageListener
                    }
                    if (data.optString("type") == "downloadSong") {
                        musicDownloads.start(data) { result -> reply.postMessage(result.toString()) }
                        return@addWebMessageListener
                    }
                    if (data.optString("type") == "downloadUpdate") {
                        val uri = Uri.parse(data.optString("url"))
                        if (!NestuneOrigin.allows(uri) || !Regex("/api/client-updates/android/[0-9]{1,9}").matches(uri.path ?: "") || uri.query != null) return@addWebMessageListener
                        val request = DownloadManager.Request(uri).setTitle("Nestune 更新")
                            .setMimeType("application/vnd.android.package-archive")
                            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                            .setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, "Nestune-${uri.lastPathSegment}-${System.currentTimeMillis()}.apk")
                        getSystemService(DownloadManager::class.java).enqueue(request)
                        reply.postMessage(JSONObject().put("type", "downloadStarted").toString())
                        return@addWebMessageListener
                    }
                    if (data.optString("type") != "media") return@addWebMessageListener
                    if (data.optString("id").isEmpty()) { stopService(Intent(this, NativeMediaService::class.java)); return@addWebMessageListener }
                    if (!data.optBoolean("playing") && !NativeMediaService.running) return@addWebMessageListener
                    val intent = Intent(this, NativeMediaService::class.java).putExtra("state", raw)
                    if (Build.VERSION.SDK_INT >= 26 && !NativeMediaService.running) startForegroundService(intent) else startService(intent)
                } catch (_: Exception) { /* Ignore malformed or stale page messages. */ }
            }
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val url = Uri.parse(webView.url ?: "")
                if (!NestuneOrigin.allows(url)) { moveTaskToBack(true); return }
                webView.evaluateJavascript("window.__nestuneBack ? window.__nestuneBack() : false") { handled ->
                    if (handled != "true") {
                        if (webView.canGoBack()) webView.goBack() else moveTaskToBack(true)
                    }
                }
            }
        })
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (!musicDownloads.onActivityResult(requestCode, resultCode, data)) super.onActivityResult(requestCode, resultCode, data)
    }

    override fun onResume() {
        super.onResume()
        LyricsOverlay.resume()
    }

    override fun onDestroy() {
        musicDownloads.close()
        if (!isChangingConfigurations) {
            LyricsOverlay.dispose()
            stopService(Intent(this, NativeMediaService::class.java))
            NativeMediaService.webView = null
        }
        super.onDestroy()
    }
}
