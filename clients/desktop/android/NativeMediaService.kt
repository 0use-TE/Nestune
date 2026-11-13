package net.ouse.nestune

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import android.webkit.WebView
import org.json.JSONObject
import java.lang.ref.WeakReference

class NativeMediaService : Service() {
    companion object {
        @Volatile var running = false
        var webView: WeakReference<WebView>? = null
        private const val CHANNEL = "nestune_playback"
        private const val NOTIFICATION = 1001
        fun dispatch(action: String, position: Long? = null) {
            val view = webView?.get() ?: return
            val data = JSONObject().put("action", action)
            if (position != null) data.put("position", position / 1000.0)
            view.post {
                val url = Uri.parse(view.url ?: "")
                if (url.scheme == "https" && url.host == "music.0use.net" && url.port in listOf(-1, 443))
                    view.evaluateJavascript("window.dispatchEvent(new CustomEvent('nt:media', {detail: $data}))", null)
            }
        }
    }
    private lateinit var session: MediaSession

    override fun onCreate() {
        super.onCreate()
        running = true
        if (Build.VERSION.SDK_INT >= 26) {
            val channel = NotificationChannel(CHANNEL, "音乐播放", NotificationManager.IMPORTANCE_LOW)
            channel.setShowBadge(false)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
        session = MediaSession(this, "Nestune")
        session.setSessionActivity(openApp())
        session.setCallback(object : MediaSession.Callback() {
            override fun onPlay() { dispatch("play") }
            override fun onPause() { dispatch("pause") }
            override fun onSkipToNext() { dispatch("next") }
            override fun onSkipToPrevious() { dispatch("previous") }
            override fun onSeekTo(pos: Long) { dispatch("seek", pos.coerceAtLeast(0)) }
            override fun onStop() { dispatch("pause"); stopSelf() }
        })
        session.isActive = true
    }

    private fun openApp() = PendingIntent.getActivity(this, 0,
        Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun action(name: String, code: Int) = PendingIntent.getService(this, code,
        Intent(this, NativeMediaService::class.java).setAction(name),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val control = intent?.action
        if (control != null) {
            when (control) {
                "play", "pause", "next", "previous" -> dispatch(control)
                "stop" -> { dispatch("pause"); stopSelf() }
            }
            return START_NOT_STICKY
        }
        val raw = intent?.getStringExtra("state") ?: run { stopSelf(); return START_NOT_STICKY }
        val data = try { JSONObject(raw) } catch (_: Exception) { stopSelf(); return START_NOT_STICKY }
        val playing = data.optBoolean("playing")
        val position = (data.optDouble("position", 0.0).coerceIn(0.0, 86400.0) * 1000).toLong()
        val duration = (data.optDouble("duration", 0.0).coerceIn(0.0, 86400.0) * 1000).toLong()
        val title = data.optString("title").take(256)
        val artist = data.optString("artist").take(512)
        session.setMetadata(MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist).putString(MediaMetadata.METADATA_KEY_ALBUM, data.optString("album").take(256))
            .putLong(MediaMetadata.METADATA_KEY_DURATION, duration).build())
        session.setPlaybackState(PlaybackState.Builder()
            .setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS or PlaybackState.ACTION_SEEK_TO or PlaybackState.ACTION_STOP)
            .setState(if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, position, if (playing) 1f else 0f, SystemClock.elapsedRealtime()).build())
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
        val notification = builder.setSmallIcon(android.R.drawable.ic_media_play).setContentTitle(title).setContentText(artist)
            .setContentIntent(openApp()).setVisibility(Notification.VISIBILITY_PUBLIC).setOnlyAlertOnce(true).setShowWhen(false)
            .setOngoing(playing).setDeleteIntent(action("stop", 4))
            .addAction(android.R.drawable.ic_media_previous, "上一首", action("previous", 1))
            .addAction(if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play, if (playing) "暂停" else "播放", action(if (playing) "pause" else "play", 2))
            .addAction(android.R.drawable.ic_media_next, "下一首", action("next", 3))
            .setStyle(Notification.MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0, 1, 2)).build()
        startForeground(NOTIFICATION, notification)
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null
    override fun onTaskRemoved(rootIntent: Intent?) { dispatch("pause"); stopSelf() }
    override fun onDestroy() {
        running = false
        session.isActive = false
        session.release()
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
}
