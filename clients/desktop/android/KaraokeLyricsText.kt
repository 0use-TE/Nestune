package net.ouse.nestune

import android.content.Context
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Shader
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ReplacementSpan
import android.widget.TextView
import org.json.JSONObject
import java.text.BreakIterator
import java.util.Locale
import kotlin.math.roundToInt

/** Draws the original text once, then clips a shared flowing gradient to sung words. */
class KaraokeLyricsText(context: Context) : TextView(context) {
    private data class Word(val time: Double, val duration: Double, val text: String)
    private var current: JSONObject? = null
    private var seconds = 0.0
    private var scrollStart = 0.0
    private var scrollEnd = 0.0
    private var phase = 0f
    private var direction = 1
    private var speed = 14
    private var gradient: LinearGradient? = null
    private var gradientWidth = 0
    private val matrix = Matrix()

    fun clear(value: String) { current = null; scrollTo(0, 0); if (text.toString() != value) text = value }

    fun render(line: JSONObject, position: Double, nextTime: Double, duration: Double, seed: Long) {
        seconds = position
        if (current !== line) {
            current = line
            val text = line.optString("text"); val time = line.optDouble("t")
            scrollStart = time
            scrollEnd = if (line.optDouble("d") > 0) time + line.optDouble("d") else if (nextTime > time) nextTime else if (duration > time) duration else time + 5
            scrollTo(0, 0)
            val supplied = line.optJSONArray("words")
            var words = (0 until (supplied?.length() ?: 0).coerceAtMost(128)).mapNotNull { index ->
                supplied?.optJSONObject(index)?.let { Word(it.optDouble("t", -1.0), it.optDouble("d", -1.0), it.optString("text")) }
            }
            words = words.filter { it.text.isNotEmpty() }
            if (words.isEmpty() || words.joinToString("") { it.text } != text || words.any { !it.time.isFinite() || !it.duration.isFinite() || it.time < time || it.time > 86400 || it.duration < 0 || it.duration > 120 }) {
                val breaker = BreakIterator.getCharacterInstance(Locale.ROOT); breaker.setText(text)
                val characters = ArrayList<String>(); var start = breaker.first(); var end = breaker.next()
                while (end != BreakIterator.DONE) { characters.add(text.substring(start, end)); start = end; end = breaker.next() }
                val finish = if (line.optDouble("d") > 0) time + line.optDouble("d") else if (nextTime > time) nextTime else if (duration > time) duration else time + 5
                val length = (finish - time).coerceIn(.2, 10.0)
                words = characters.mapIndexed { index, value -> Word(time + length * index / characters.size, length / characters.size, value) }
            }
            var hash = 2166136261L.toInt() xor seed.toInt()
            val key = String.format(Locale.ROOT, "%.3f", time) + ":" + text
            for (character in key) hash = (hash xor character.code) * 16777619
            phase = (hash and 65535) / 65536f; direction = if (hash and 65536 != 0) 1 else -1; speed = 14 + ((hash ushr 17) % 9)
            val styled = SpannableString(text); var offset = 0
            for (word in words) {
                styled.setSpan(SungSpan(word), offset, offset + word.text.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                offset += word.text.length
            }
            setText(styled, BufferType.SPANNABLE)
        }
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        layout?.takeIf { it.lineCount > 0 }?.let { lineLayout ->
            // TextView centers a horizontally scrolling line within its virtual layout.
            val left = lineLayout.getLineLeft(0)
            val lineWidth = lineLayout.getLineRight(0) - left
            val available = width - compoundPaddingLeft - compoundPaddingRight
            val overflow = (lineWidth - available).coerceAtLeast(0f)
            val progress = if (current == null) 0.0 else ((seconds - scrollStart) / (scrollEnd - scrollStart).coerceAtLeast(.2) - .12) / .76
            val offset = progress.coerceIn(0.0, 1.0)
            val scroll = if (lineLayout.getParagraphDirection(0) < 0) 1.0 - offset else offset
            val target = (left - (available - lineWidth).coerceAtLeast(0f) / 2 + overflow * scroll).roundToInt()
            if (scrollX != target) scrollTo(target, 0)
        }

        if (width != gradientWidth) {
            gradientWidth = width
            gradient = LinearGradient(0f, 0f, (width * 2).coerceAtLeast(1).toFloat(), 0f,
                intArrayOf(0xff73acf0.toInt(), 0xff9bbded.toInt(), 0xffedd083.toInt(), 0xfff1d78e.toInt(), 0xff9bbded.toInt(), 0xff73acf0.toInt()),
                floatArrayOf(0f, .22f, .46f, .54f, .78f, 1f), Shader.TileMode.REPEAT)
        }
        val animate = android.provider.Settings.Global.getFloat(context.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f
        matrix.setTranslate(width * 2 * phase + if (animate) (-seconds * speed * direction).toFloat() else 0f, 0f)
        gradient?.setLocalMatrix(matrix)
        super.onDraw(canvas)
    }

    private inner class SungSpan(private val word: Word) : ReplacementSpan() {
        override fun getSize(paint: Paint, text: CharSequence, start: Int, end: Int, fm: Paint.FontMetricsInt?): Int = kotlin.math.ceil(paint.measureText(text, start, end).toDouble()).toInt()
        override fun draw(canvas: Canvas, text: CharSequence, start: Int, end: Int, x: Float, top: Int, y: Int, bottom: Int, paint: Paint) {
            canvas.drawText(text, start, end, x, y.toFloat(), paint)
            val progress = if (seconds < word.time) 0.0 else if (word.duration > 0) ((seconds - word.time) / word.duration).coerceIn(0.0, 1.0) else 1.0
            if (progress <= 0 || gradient == null) return
            val saved = canvas.save(); val shader = paint.shader
            canvas.clipRect(x, top.toFloat(), x + paint.measureText(text, start, end) * progress.toFloat(), bottom.toFloat())
            paint.shader = gradient; canvas.drawText(text, start, end, x, y.toFloat(), paint); paint.shader = shader; canvas.restoreToCount(saved)
        }
    }
}
