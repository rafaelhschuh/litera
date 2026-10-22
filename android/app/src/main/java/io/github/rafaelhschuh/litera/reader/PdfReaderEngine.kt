package io.github.rafaelhschuh.litera.reader

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import android.widget.FrameLayout
import androidx.fragment.app.FragmentActivity
import androidx.core.graphics.createBitmap
import androidx.lifecycle.lifecycleScope
import io.github.rafaelhschuh.litera.data.NativePreferences
import io.github.rafaelhschuh.litera.data.NativeProgress
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

class PdfReaderEngine(
    private val activity: FragmentActivity,
    container: FrameLayout,
    file: File,
    previous: NativeProgress?,
    preferences: NativePreferences,
    private val changed: (ReaderPosition) -> Unit,
    private val error: (String) -> Unit,
) : ReaderEngine {
    private val renderer = PdfRenderer(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY))
    private val pageView = PdfPageView(activity)
    private var page = (previous?.locator?.optInt("page", 1) ?: 1).coerceIn(1, renderer.pageCount)
    private var job: Job? = null
    private var closed = false
    private var rendered = false
    override val chapters = (1..renderer.pageCount).map { ReaderChapter(activity.getString(io.github.rafaelhschuh.litera.R.string.reader_page,it,renderer.pageCount), it - 1) }

    init {
        container.addView(pageView, FrameLayout.LayoutParams(-1, -1))
        preferences(preferences)
        render()
    }

    override fun position(): ReaderPosition? = if (!rendered) null else ReaderPosition(
        JSONObject().put("type", "pdf-page").put("page", page),
        if (renderer.pageCount <= 1) 1.0 else (page - 1).toDouble() / (renderer.pageCount - 1),
        activity.getString(io.github.rafaelhschuh.litera.R.string.reader_page,page,renderer.pageCount),
    )

    override fun next() { go(page) }
    override fun previous() { go(page - 2) }
    override fun go(index: Int) {
        if (index !in 0 until renderer.pageCount) return
        page = index + 1
        rendered = false
        pageView.reset()
        render()
    }

    private fun render() {
        job?.cancel()
        val requested = page
        job = activity.lifecycleScope.launch {
            try {
                val bitmap = withContext(Dispatchers.IO) {
                    synchronized(renderer) {
                        check(!closed)
                        renderer.openPage(requested - 1).use { pdfPage ->
                            val width = activity.resources.displayMetrics.widthPixels.coerceIn(720, 1800)
                            val height = (width.toDouble() * pdfPage.height / pdfPage.width).toInt().coerceIn(1, 4096)
                            createBitmap(width, height, Bitmap.Config.ARGB_8888).also {
                                it.eraseColor(Color.WHITE)
                                pdfPage.render(it, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                            }
                        }
                    }
                }
                if (!closed && requested == page) {
                    pageView.bitmap = bitmap
                    rendered = true
                    position()?.let(changed)
                } else bitmap.recycle()
            } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
            catch (_: Exception) { if (!closed) error(activity.getString(io.github.rafaelhschuh.litera.R.string.reader_pdf_error)) }
        }
    }

    override fun preferences(value: NativePreferences) {
        pageView.invert = value.pdfInvert
        val paper = when { value.pdfInvert || value.theme == "dark" -> io.github.rafaelhschuh.litera.R.color.reader_paper_dark
            value.theme == "sepia" -> io.github.rafaelhschuh.litera.R.color.reader_paper_sepia
            else -> io.github.rafaelhschuh.litera.R.color.reader_paper_light }
        pageView.setBackgroundColor(androidx.core.content.ContextCompat.getColor(activity,paper))
    }
    override fun close() {
        job?.cancel()
        synchronized(renderer) { if (!closed) { closed = true; renderer.close() } }
        pageView.bitmap = null
    }

    private class PdfPageView(context: Context) : View(context) {
        var bitmap: Bitmap? = null
            set(value) { field?.recycle(); field = value; invalidate() }
        var zoom = 1f
            private set
        var offsetY = 0f
            private set
        private var offsetX = 0f
        private var lastX = 0f
        private var lastY = 0f
        private val bounds = RectF()
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
        var invert = false
            set(value) {
                field = value
                paint.colorFilter = if (value) ColorMatrixColorFilter(ColorMatrix(floatArrayOf(-1f,0f,0f,0f,255f, 0f,-1f,0f,0f,255f, 0f,0f,-1f,0f,255f, 0f,0f,0f,1f,0f))) else null
                invalidate()
            }
        private val scale = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
            override fun onScale(detector: ScaleGestureDetector): Boolean { zoom = (zoom * detector.scaleFactor).coerceIn(1f, 5f); clampOffsets(); invalidate(); return true }
        })
        init { contentDescription = context.getString(io.github.rafaelhschuh.litera.R.string.reader_pdf_description); isFocusable = true; setBackgroundColor(androidx.core.content.ContextCompat.getColor(context, io.github.rafaelhschuh.litera.R.color.litera_background)) }
        fun reset() { zoom = 1f; offsetX = 0f; offsetY = 0f; invalidate() }
        private fun clampOffsets() {
            val image = bitmap ?: return
            val fit = minOf(width.toFloat() / image.width,height.toFloat() / image.height)
            val x = ((image.width * fit * zoom - width) / 2).coerceAtLeast(0f)
            val y = ((image.height * fit * zoom - height) / 2).coerceAtLeast(0f)
            offsetX = offsetX.coerceIn(-x,x); offsetY = offsetY.coerceIn(-y,y)
        }
        override fun onSizeChanged(w: Int,h: Int,oldw: Int,oldh: Int) { super.onSizeChanged(w,h,oldw,oldh); clampOffsets() }
        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val image = bitmap ?: return
            val fit = minOf(width.toFloat() / image.width, height.toFloat() / image.height)
            val w = image.width * fit * zoom
            val h = image.height * fit * zoom
            bounds.set((width-w)/2 + offsetX, (height-h)/2 + offsetY, (width+w)/2 + offsetX, (height+h)/2 + offsetY)
            canvas.drawBitmap(image, null, bounds, paint)
        }
        @SuppressLint("ClickableViewAccessibility")
        override fun onTouchEvent(event: MotionEvent): Boolean {
            scale.onTouchEvent(event)
            if (event.actionMasked == MotionEvent.ACTION_DOWN) { lastX = event.x; lastY = event.y }
            if (event.actionMasked == MotionEvent.ACTION_MOVE && !scale.isInProgress && zoom > 1f) { offsetX += event.x-lastX; offsetY += event.y-lastY; clampOffsets(); lastX = event.x; lastY = event.y; invalidate() }
            if (event.actionMasked == MotionEvent.ACTION_UP) performClick()
            return true
        }
        override fun performClick(): Boolean { super.performClick(); return true }
    }
}
