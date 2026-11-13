package net.ouse.nestune

import android.content.Intent
import android.app.DownloadManager
import android.os.Environment
import android.net.Uri
import android.os.Build
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.webkit.WebMessageCompat
import org.json.JSONObject
import java.lang.ref.WeakReference

class MainActivity : TauriActivity() {
    override fun onWebViewCreate(webView: WebView) {
        super.onWebViewCreate(webView)
        NativeMediaService.webView = WeakReference(webView)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "NestuneNative", setOf("https://music.0use.net")) { _, message, origin, mainFrame, reply ->
                if (!mainFrame || origin.scheme != "https" || origin.host != "music.0use.net" || origin.port !in listOf(-1, 443)) return@addWebMessageListener
                if (message.type != WebMessageCompat.TYPE_STRING) return@addWebMessageListener
                val raw = message.data ?: return@addWebMessageListener
                if (raw.length > 8192) return@addWebMessageListener
                try {
                    val data = JSONObject(raw)
                    if (data.optString("type") == "clientInfo") {
                        val info = packageManager.getPackageInfo(packageName, 0)
                        val code = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
                        reply.postMessage(JSONObject().put("type", "clientInfo").put("platform", "android").put("version", info.versionName).put("versionCode", code).put("canDownload", true).toString())
                        return@addWebMessageListener
                    }
                    if (data.optString("type") == "downloadUpdate") {
                        val uri = Uri.parse(data.optString("url"))
                        if (uri.scheme != "https" || uri.host != "music.0use.net" || uri.port !in listOf(-1,443) || !Regex("/api/client-updates/android/[0-9]{1,9}").matches(uri.path ?: "") || uri.query != null || uri.userInfo != null) return@addWebMessageListener
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
                if (url.scheme != "https" || url.host != "music.0use.net") { moveTaskToBack(true); return }
                webView.evaluateJavascript("window.__nestuneBack ? window.__nestuneBack() : false") { handled ->
                    if (handled != "true") {
                        if (webView.canGoBack()) webView.goBack() else moveTaskToBack(true)
                    }
                }
            }
        })
    }

    override fun onDestroy() {
        if (!isChangingConfigurations) {
            stopService(Intent(this, NativeMediaService::class.java))
            NativeMediaService.webView = null
        }
        super.onDestroy()
    }
}
