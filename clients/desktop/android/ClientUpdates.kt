package net.ouse.nestune

import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean

/** The native updater discovers releases itself; JavaScript never supplies a package URL or hash. */
internal class ClientUpdates(private val activity: Activity, private val transport: ((String) -> HttpURLConnection)? = null) {
    private val busy = AtomicBoolean(false)
    private val monitor = Any()
    private var state = JSONObject().put("phase", "idle")
    private var verified: JSONObject? = null
    private val destination get() = File(activity.cacheDir, "client-update.apk")
    private fun set(phase: String, received: Long = 0, total: Long = 0, error: String? = null) = synchronized(monitor) {
        state = JSONObject().put("phase", phase).put("received", received).put("total", total)
        if (error != null) state.put("error", error)
    }
    fun snapshot(): JSONObject = synchronized(monitor) { JSONObject(state.toString()) }
    fun request(type: String): JSONObject {
        when (type) {
            "updateInfo" -> {
                val info = activity.packageManager.getPackageInfo(activity.packageName, 0)
                return JSONObject().put("platform", "android").put("version", info.versionName).put("updateProtocol", 1)
                    .put("versionCode", if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong())
            }
            "updateStart" -> if (busy.compareAndSet(false, true)) {
                verified = null; set("checking")
                Thread {
                    try { download() }
                    catch (error: Exception) { destination.delete(); set("error", error = error.message ?: "下载失败，请重试") }
                    finally { busy.set(false) }
                }.apply { name = "Nestune-client-update"; start() }
            }
            "updateInstall" -> install()
            "updateStatus" -> Unit
            else -> throw IllegalArgumentException("未知更新操作")
        }
        return snapshot()
    }
    private fun connection(path: String): HttpURLConnection {
        transport?.let { return it(path) }
        val uri = Uri.parse(NestuneOrigin.URL + path)
        require(NestuneOrigin.allows(uri)) { "更新地址无效" }
        return (URL(uri.toString()).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15000; readTimeout = 30000; instanceFollowRedirects = false
            setRequestProperty("Accept-Encoding", "identity")
            if (responseCode != 200) { val code = responseCode; disconnect(); throw IllegalStateException("下载服务器返回 $code，请重试") }
        }
    }
    private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it.toInt() and 255) }
    private fun validatePackage(file: File, item: JSONObject) {
        require(file.length() == item.getLong("size")) { "安装包大小不正确，请重试" }
        val hash = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input -> val buffer = ByteArray(65536); while (true) { val n = input.read(buffer); if (n < 0) break; hash.update(buffer, 0, n) } }
        require(hex(hash.digest()) == item.getString("sha256")) { "安装包校验失败，请重试" }
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val archive = activity.packageManager.getPackageArchiveInfo(file.absolutePath, flags) ?: throw IllegalStateException("安装包无法识别")
        val current = activity.packageManager.getPackageInfo(activity.packageName, flags)
        require(archive.packageName == activity.packageName) { "安装包应用不匹配" }
        val code = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode else archive.versionCode.toLong()
        val currentCode = if (Build.VERSION.SDK_INT >= 28) current.longVersionCode else current.versionCode.toLong()
        require(code == item.getLong("versionCode") && code > currentCode) { "安装包版本不正确" }
        val expected = if (Build.VERSION.SDK_INT >= 28) current.signingInfo?.apkContentsSigners else current.signatures
        val actual = if (Build.VERSION.SDK_INT >= 28) archive.signingInfo?.apkContentsSigners else archive.signatures
        require(!expected.isNullOrEmpty() && !actual.isNullOrEmpty() && expected.map { hex(it.toByteArray()) }.toSet() == actual.map { hex(it.toByteArray()) }.toSet()) { "安装包签名与当前客户端不一致" }
    }
    private fun download() {
        val manifestConnection = connection("/api/client-updates")
        val manifest = try {
            val bytes = manifestConnection.inputStream.use { it.readBytesLimited(65536) }
            JSONObject(String(bytes, Charsets.UTF_8))
        } finally { manifestConnection.disconnect() }
        val item = manifest.getJSONObject("android")
        val code = item.getLong("versionCode"); val total = item.getLong("size")
        require(code in 1..999999999 && total in 1..536870912 && Regex("[a-f0-9]{64}").matches(item.getString("sha256"))) { "更新信息无效" }
        require(item.getString("url") == "/api/client-updates/android/$code") { "安装包地址无效" }
        val installed = activity.packageManager.getPackageInfo(activity.packageName, 0)
        val installedCode = if (Build.VERSION.SDK_INT >= 28) installed.longVersionCode else installed.versionCode.toLong()
        require(code > installedCode) { "客户端已是最新版本" }
        val partial = File(activity.cacheDir, "client-update.partial")
        try {
            val download = connection(item.getString("url"))
            try {
                var received = 0L
                download.inputStream.use { input -> partial.outputStream().use { output ->
                    val buffer = ByteArray(65536)
                    while (true) {
                        val n = input.read(buffer); if (n < 0) break
                        received += n; require(received <= total) { "安装包大小超出发布信息" }
                        output.write(buffer, 0, n); set("downloading", received, total)
                    }
                    output.fd.sync()
                } }
                set("verifying", received, total); validatePackage(partial, item)
            } finally { download.disconnect() }
            destination.delete(); check(partial.renameTo(destination)) { "无法保存安装包" }
            synchronized(monitor) { verified = item }; set("ready", total, total)
        } finally { partial.delete() }
    }
    private fun java.io.InputStream.readBytesLimited(limit: Int): ByteArray {
        val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(4096)
        while (true) { val n = read(buffer); if (n < 0) break; require(output.size() + n <= limit) { "更新信息过大" }; output.write(buffer, 0, n) }
        return output.toByteArray()
    }
    private fun install() {
        val item = synchronized(monitor) { verified } ?: throw IllegalStateException("请先下载客户端更新")
        if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
            set("permission", item.getLong("size"), item.getLong("size"))
            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
            return
        }
        // Check again immediately before granting the system installer access.
        validatePackage(destination, item)
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", destination)
        activity.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        set("ready", item.getLong("size"), item.getLong("size"))
    }
}
