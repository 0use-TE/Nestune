package net.ouse.nestune

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.min

/** Owns only a lyrics overlay. No audio stream, account data or remote resource is opened. */
class LyricsOverlay private constructor(private val context: Context) : android.content.ComponentCallbacks {
    companion object {
        private var current: LyricsOverlay? = null
        fun get(context: Context): LyricsOverlay = current ?: LyricsOverlay(context.applicationContext).also { current = it }
        fun resume() { current?.refreshPermission() }
        fun dispose() { current?.let { it.remove(); it.context.unregisterComponentCallbacks(it) }; current = null }
    }
    private data class Line(val time: Double, val text: String, val translation: String, val timing: JSONObject)
    private val preferences = context.getSharedPreferences("nestune_lyrics", Context.MODE_PRIVATE)
    private val manager = context.getSystemService(WindowManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private var enabled = preferences.getBoolean("enabled", false)
    private var locked = preferences.getBoolean("locked", false)
    private var panel = preferences.getBoolean("panel", false)
    private var pendingPermission = false
    private var root: LinearLayout? = null
    private var textView: KaraokeLyricsText? = null
    private var translationView: TextView? = null
    private var titleView: TextView? = null
    private var toolbar: LinearLayout? = null
    private var layout: WindowManager.LayoutParams? = null
    private var track = ""
    private var title = "Nestune"
    private var lines = emptyList<Line>()
    private var plainText = ""
    private var flowSeed = 0L
    private var trackDuration = 0.0
    private var mediaTrack = ""
    private var position = 0.0
    private var playing = false
    private var positionAt = SystemClock.elapsedRealtime()
    private val hideToolbar = Runnable { toolbar?.visibility = View.GONE }
    private val ticker = object : Runnable {
        override fun run() {
            if (!allowed()) { enabled = false; preferences.edit().putBoolean("enabled", false).apply(); remove(); emit(); return }
            render(); if (root != null) handler.postDelayed(this, if (playing) 33 else 200)
        }
    }
    init { context.registerComponentCallbacks(this) }
    override fun onConfigurationChanged(configuration: android.content.res.Configuration) { if (root != null) { remove(); show() } }
    override fun onLowMemory() {}

    private fun dp(value: Int) = (value * context.resources.displayMetrics.density).toInt()
    private fun allowed() = Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(context)
    fun state() = JSONObject().put("type", "lyricsState").put("supported", true).put("platform", "android")
        .put("permission", allowed()).put("enabled", enabled && allowed()).put("locked", locked)

    fun request(data: JSONObject): JSONObject {
        when (data.optString("type")) {
            "lyricsInfo" -> { if (enabled && allowed()) show() }
            "lyricsEnable" -> {
                val value = data.optBoolean("enabled")
                if (value && !allowed()) { pendingPermission = true; enabled = false }
                else {
                    pendingPermission = false; enabled = value
                    preferences.edit().putBoolean("enabled", enabled).apply()
                    if (enabled) show() else remove()
                }
            }
            "lyricsLock" -> {
                locked = data.optBoolean("locked")
                preferences.edit().putBoolean("locked", locked).apply(); updateFlags()
            }
            "lyricsData" -> {
                track = data.optString("id").take(160); title = data.optString("title").take(256)
                plainText = data.optString("plainText").take(2048)
                flowSeed = data.optLong("flowSeed")
                trackDuration = data.optDouble("duration", 0.0)
                val source = data.optJSONArray("lines")
                val accepted = ArrayList<Line>(); var budget = 60000
                for (i in 0 until min(source?.length() ?: 0, 1200)) {
                    val line = source?.optJSONObject(i) ?: continue
                    val time = line.optDouble("t", -1.0)
                    if (!time.isFinite() || time < 0 || time > 86400) continue
                    val text = line.optString("text").take(256); val translation = line.optString("tr").take(256)
                    budget -= text.length + translation.length + 40; if (budget < 0) break
                    accepted.add(Line(time, text, translation, JSONObject(line.toString()).put("text", text)))
                }
                lines = accepted.sortedBy { it.time }; render()
            }
            "lyricsMedia" -> {
                mediaTrack = data.optString("id").take(160)
                val seconds = data.optDouble("position", 0.0)
                position = if (seconds.isFinite()) seconds.coerceIn(0.0, 86400.0) else 0.0
                playing = data.optBoolean("playing"); positionAt = SystemClock.elapsedRealtime(); render()
            }
            else -> return state().put("error", "不支持此歌词操作")
        }
        return state()
    }

    private fun emit() {
        val view = NativeMediaService.webView?.get() ?: return
        view.post {
            val url = android.net.Uri.parse(view.url ?: "")
            if (NestuneOrigin.allows(url))
                view.evaluateJavascript("window.dispatchEvent(new CustomEvent('nt:lyrics-state',{detail:${state()}}))", null)
        }
    }

    private fun refreshPermission() {
        if (!allowed()) { if (root != null) remove(); emit(); return }
        if (pendingPermission) { pendingPermission = false; enabled = true; preferences.edit().putBoolean("enabled", true).apply() }
        if (enabled) show(); emit()
    }

    private fun label(size: Float, color: Int, bold: Boolean = false) = TextView(context).apply {
        textSize = size; setTextColor(color); gravity = Gravity.CENTER
        maxLines = 2; ellipsize = android.text.TextUtils.TruncateAt.END
        setShadowLayer(dp(2).toFloat(), 0f, dp(1).toFloat(), Color.BLACK)
        if (bold) setTypeface(typeface, Typeface.BOLD)
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
    }

    private fun tool(label: String, action: () -> Unit) = Button(context).apply {
        text = label; textSize = 11f; setTextColor(Color.WHITE)
        contentDescription = label; minWidth = 0; minimumWidth = 0; minHeight = 0; minimumHeight = 0
        setPadding(dp(8), 0, dp(8), 0); isAllCaps = false
        background = GradientDrawable().apply { setColor(0xdc181817.toInt()); cornerRadius = dp(9).toFloat() }
        setOnClickListener { action() }
    }

    private fun background() {
        root?.background = if (panel) GradientDrawable().apply {
            setColor(0xe6181817.toInt()); cornerRadius = dp(16).toFloat(); setStroke(dp(1), 0x24ffffff)
        } else null
    }

    private fun show() {
        if (!enabled || !allowed() || root != null) return
        val metrics = context.resources.displayMetrics
        val view = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
            setPadding(dp(12), dp(7), dp(12), dp(8))
        }
        val controls = LinearLayout(context).apply { gravity = Gravity.END; visibility = View.GONE }
        fun addTool(button: Button) { controls.addView(button, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, dp(32)).apply { marginStart = dp(5) }) }
        addTool(tool("背景") { panel = !panel; preferences.edit().putBoolean("panel", panel).apply(); background() })
        addTool(tool("锁定") { locked = true; preferences.edit().putBoolean("locked", true).apply(); updateFlags(); emit() })
        addTool(tool("关闭") { enabled = false; preferences.edit().putBoolean("enabled", false).apply(); remove(); emit() })
        toolbar = controls; view.addView(controls)
        textView = KaraokeLyricsText(context).apply {
            textSize = 22f; setTextColor(Color.WHITE); gravity = Gravity.CENTER; maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END; setTypeface(typeface, Typeface.BOLD)
            setShadowLayer(dp(2).toFloat(), 0f, dp(1).toFloat(), Color.BLACK)
        }.also { view.addView(it, LinearLayout.LayoutParams(-1, -2)) }
        translationView = label(14f, 0xffeeede7.toInt()).also { view.addView(it, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(4) }) }
        titleView = label(10f, 0xffc5c3bc.toInt()).also { view.addView(it, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(4) }) }
        val width = min(metrics.widthPixels - dp(20), dp(560)).coerceAtLeast(dp(200))
        val params = WindowManager.LayoutParams(width, -2,
            if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.TOP or Gravity.START
            x = preferences.getInt("x", (metrics.widthPixels - width) / 2).coerceIn(0, (metrics.widthPixels - width).coerceAtLeast(0))
            y = preferences.getInt("y", metrics.heightPixels - dp(240)).coerceIn(dp(24), (metrics.heightPixels - dp(150)).coerceAtLeast(dp(24)))
        }
        layout = params; root = view; background()
        var downX = 0f; var downY = 0f; var startX = 0; var startY = 0; var moved = false
        val touch = View.OnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> { downX = event.rawX; downY = event.rawY; startX = params.x; startY = params.y; moved = false; true }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - downX; val dy = event.rawY - downY
                    if (abs(dx) + abs(dy) > dp(6)) moved = true
                    if (moved) {
                        params.x = (startX + dx.toInt()).coerceIn(0, (metrics.widthPixels - width).coerceAtLeast(0))
                        params.y = (startY + dy.toInt()).coerceIn(dp(20), (metrics.heightPixels - view.height).coerceAtLeast(dp(20)))
                        runCatching { manager.updateViewLayout(view, params) }
                    }; true
                }
                MotionEvent.ACTION_UP -> {
                    preferences.edit().putInt("x", params.x).putInt("y", params.y).apply()
                    if (!moved) { controls.visibility = if (controls.visibility == View.VISIBLE) View.GONE else View.VISIBLE; handler.removeCallbacks(hideToolbar); handler.postDelayed(hideToolbar, 3000) }
                    true
                }
                MotionEvent.ACTION_CANCEL -> true
                else -> false
            }
        }
        textView?.setOnTouchListener(touch); translationView?.setOnTouchListener(touch); titleView?.setOnTouchListener(touch)
        try { manager.addView(view, params); updateFlags(); render(); handler.post(ticker) }
        catch (_: Exception) { root = null; enabled = false; preferences.edit().putBoolean("enabled", false).apply(); emit() }
    }

    private fun updateFlags() {
        val view = root ?: return; val params = layout ?: return
        params.flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
            (if (locked) WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE else 0)
        params.alpha = if (locked) 0.75f else 1f
        if (locked) toolbar?.visibility = View.GONE
        runCatching { manager.updateViewLayout(view, params) }
    }

    private fun render() {
        if (root == null) return
        val seconds = position + if (playing) (SystemClock.elapsedRealtime() - positionAt) / 1000.0 else 0.0
        var line: Line? = null
        var nextTime = 0.0
        if (track == mediaTrack) {
            var low = 0; var high = lines.size
            while (low < high) { val middle = (low + high) ushr 1; if (lines[middle].time <= seconds) low = middle + 1 else high = middle }
            line = lines.getOrNull(low - 1); nextTime = lines.getOrNull(low)?.time ?: 0.0
        }
        val text = if (mediaTrack.isEmpty()) "暂无播放" else if (track != mediaTrack) "正在加载歌词" else
            line?.text?.ifEmpty { "间奏" } ?: if (lines.isNotEmpty()) "前奏" else plainText.lineSequence().firstOrNull { it.isNotBlank() } ?: "暂无歌词"
        if (line != null) textView?.render(line.timing, seconds, nextTime, trackDuration, flowSeed)
        else textView?.clear(text)
        val translation = line?.translation ?: ""
        if (translationView?.text?.toString() != translation) translationView?.text = translation
        translationView?.visibility = if (translation.isEmpty()) View.GONE else View.VISIBLE
        if (titleView?.text?.toString() != title) titleView?.text = title
    }

    private fun remove() {
        handler.removeCallbacks(ticker); handler.removeCallbacks(hideToolbar)
        root?.let { runCatching { manager.removeView(it) } }; root = null; toolbar = null
        textView = null; translationView = null; titleView = null; layout = null
    }
}
