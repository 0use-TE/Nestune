package net.ouse.nestune

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.webkit.CookieManager
import androidx.documentfile.provider.DocumentFile
import org.json.JSONObject
import java.io.InputStream
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Uses Android's document picker; no broad storage permission or public download token. */
class MusicDownloads(private val activity: Activity) {
    private data class Job(val id: String, val song: String, val level: String, val name: String, val lyrics: Boolean,
                           val cookie: String, val reply: (JSONObject) -> Unit)
    private val busy = AtomicBoolean(false)
    private val executor = Executors.newSingleThreadExecutor()
    private val preferences = activity.getSharedPreferences("music-downloads", 0)
    private var pending: Job? = null

    fun start(data: JSONObject, reply: (JSONObject) -> Unit) {
        val id = data.optString("requestId")
        if (!Regex("[A-Za-z0-9-]{1,80}").matches(id)) return
        val song = data.optString("songId")
        val level = data.optString("level")
        fun reject(message: String) = reply(JSONObject().put("type", "musicDownloadError").put("requestId", id).put("error", message))
        if (!Regex("(?:[0-9]{1,20}|upload-[a-f0-9]{32})").matches(song) ||
            level !in setOf("standard", "exhigh", "lossless", "hires", "original") ||
            (level == "original") != song.startsWith("upload-")) { reject("无效的下载请求"); return }
        if (!busy.compareAndSet(false, true)) { reject("已有歌曲正在下载，请稍后重试"); return }
        val title = data.optString("title").take(160)
        val artist = data.optString("artist").take(160)
        val name = listOf(title, artist).filter { it.isNotBlank() }.joinToString(" - ")
            .replace(Regex("[<>:\"/\\\\|?*\\x00-\\x1f]"), "_").trim().take(100).trimEnd('.', ' ').ifBlank { "Nestune" }
        val job = Job(id, song, level, name, data.optBoolean("includeLyrics"), CookieManager.getInstance().getCookie(ORIGIN) ?: "", reply)
        try {
            val saved = preferences.getString("folder", null)?.let(Uri::parse)
            val permitted = saved != null && activity.contentResolver.persistedUriPermissions.any { it.uri == saved && it.isWritePermission }
            if (permitted && saved != null && DocumentFile.fromTreeUri(activity, saved)?.canWrite() == true) { download(job, saved); return }
            pending = job
            activity.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION), PICK_FOLDER)
        } catch (_: Exception) { pending = null; busy.set(false); reject("无法打开音乐文件夹，请重试") }
    }

    fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
        if (requestCode != PICK_FOLDER) return false
        val job = pending ?: return true
        pending = null
        val uri = data?.data
        if (resultCode != Activity.RESULT_OK || uri == null) { finish(job, "musicDownloadCancelled"); return true }
        try {
            val flags = (data?.flags ?: 0) and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            activity.contentResolver.takePersistableUriPermission(uri, flags)
            if (DocumentFile.fromTreeUri(activity, uri)?.canWrite() != true) throw IllegalStateException()
            preferences.edit().putString("folder", uri.toString()).apply()
            download(job, uri)
        } catch (_: Exception) { finish(job, "musicDownloadError", "请允许写入所选音乐文件夹") }
        return true
    }

    private fun download(job: Job, uri: Uri) {
        executor.execute {
            var audioFile: DocumentFile? = null
            var audioComplete = false
            try {
                val folder = DocumentFile.fromTreeUri(activity, uri) ?: throw IllegalStateException("找不到音乐文件夹，请重新选择")
                val existing = folder.listFiles().mapNotNull { it.name?.substringBeforeLast('.')?.lowercase(Locale.ROOT) }.toSet()
                var stem = job.name
                var index = 2
                while (stem.lowercase(Locale.ROOT) in existing) { stem = "${job.name} (${index++})" }
                val connection = open(job, "/api/songs/${job.song}/download?level=${job.level}", "POST")
                try {
                    val type = connection.contentType?.substringBefore(';') ?: ""
                    val ext = connection.getHeaderField("X-Audio-Format") ?: ""
                    if (!type.startsWith("audio/") || ext !in setOf("mp3", "flac", "m4a", "aac", "wav", "ogg")) throw IllegalStateException("服务器返回了无效的音频文件")
                    audioFile = folder.createFile(type, "$stem.$ext") ?: throw IllegalStateException("无法创建音乐文件")
                    connection.inputStream.use { input ->
                        val count = activity.contentResolver.openOutputStream(audioFile!!.uri, "w")?.use { output -> input.copyTo(output) }
                            ?: throw IllegalStateException("无法写入音乐文件")
                        if (count == 0L) throw IllegalStateException("服务器返回了空的音频文件")
                    }
                    audioComplete = true
                } finally { connection.disconnect() }
                val coverSaved = runCatching {
                    val path = if (job.song.startsWith("upload-")) "/api/uploads/${job.song}/cover" else "/api/songs/${job.song}/cover"
                    val cover = open(job, path)
                    try {
                        val type = cover.contentType?.substringBefore(';') ?: ""
                        val ext = mapOf("image/jpeg" to "jpg", "image/png" to "png", "image/webp" to "webp")[type] ?: return@runCatching false
                        val bytes = cover.inputStream.use { bounded(it, 2 * 1024 * 1024) }
                        saveCompanion(folder, "$stem.$ext", type, bytes)
                    } finally { cover.disconnect() }
                }.getOrDefault(false)
                val lyricsSaved = job.lyrics && runCatching {
                    val lyrics = open(job, "/api/songs/${job.song}/lyrics")
                    val payload = try { JSONObject(lyrics.inputStream.use { bounded(it, 1024 * 1024) }.toString(Charsets.UTF_8)) } finally { lyrics.disconnect() }
                    val lines = payload.optJSONArray("lines")
                    val synced = (0 until (lines?.length() ?: 0)).mapNotNull { n ->
                        val line = lines!!.optJSONObject(n) ?: return@mapNotNull null
                        val time = line.optDouble("t", Double.NaN)
                        val text = line.optString("text").replace(Regex("[\\r\\n]+"), " ")
                        if (!time.isFinite() || time < 0 || time > 360000 || text.isBlank()) return@mapNotNull null
                        val ms = Math.round(time * 1000)
                        String.format(Locale.ROOT, "[%02d:%02d.%03d]%s", ms / 60000, ms / 1000 % 60, ms % 1000, text)
                    }.joinToString("\n")
                    val text = synced.ifBlank { payload.optString("plainText").trim() }
                    val bytes = text.toByteArray(Charsets.UTF_8)
                    text.isNotEmpty() && bytes.size <= 128 * 1024 && saveCompanion(folder, "$stem.${if (synced.isNotEmpty()) "lrc" else "txt"}", "text/plain", bytes)
                }.getOrDefault(false)
                finish(job, "musicDownloadComplete", coverSaved = coverSaved, lyricsSaved = lyricsSaved)
            } catch (error: Exception) {
                if (!audioComplete) runCatching { audioFile?.delete() }
                finish(job, "musicDownloadError", error.message ?: "下载失败，请重试")
            }
        }
    }

    private fun open(job: Job, path: String, method: String = "GET"): HttpURLConnection {
        val connection = URL(ORIGIN + path).openConnection() as HttpURLConnection
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 20000
        connection.readTimeout = 300000
        connection.requestMethod = method
        connection.setRequestProperty("Cookie", job.cookie)
        connection.setRequestProperty("Origin", ORIGIN)
        try {
            val code = connection.responseCode
            if (code !in 200..299) {
                val message = runCatching { connection.errorStream?.use { JSONObject(bounded(it, 16384).toString(Charsets.UTF_8)).optString("error") } }.getOrNull()
                throw IllegalStateException(message?.takeIf { it.isNotBlank() } ?: "下载失败（HTTP $code）")
            }
            return connection
        } catch (error: Exception) { connection.disconnect(); throw error }
    }

    private fun saveCompanion(folder: DocumentFile, name: String, type: String, bytes: ByteArray): Boolean {
        val file = folder.createFile(type, name) ?: return false
        return try {
            activity.contentResolver.openOutputStream(file.uri, "w")?.use { it.write(bytes) } ?: throw IllegalStateException()
            true
        } catch (_: Exception) { runCatching { file.delete() }; false }
    }

    private fun bounded(input: InputStream, max: Int): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            if (output.size() + count > max) throw IllegalStateException("附加文件过大")
            output.write(buffer, 0, count)
        }
        return output.toByteArray()
    }

    private fun finish(job: Job, type: String, error: String? = null, coverSaved: Boolean = false, lyricsSaved: Boolean = false) {
        busy.set(false)
        activity.runOnUiThread { runCatching {
            job.reply(JSONObject().put("type", type).put("requestId", job.id).put("error", error)
                .put("coverSaved", coverSaved).put("lyricsSaved", lyricsSaved))
        } }
    }

    fun close() { executor.shutdown() }

    companion object { private const val PICK_FOLDER = 0x4E55; private const val ORIGIN = NestuneOrigin.URL }
}
