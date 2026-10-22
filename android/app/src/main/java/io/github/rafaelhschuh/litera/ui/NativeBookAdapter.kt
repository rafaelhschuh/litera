package io.github.rafaelhschuh.litera.ui

import android.graphics.BitmapFactory
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.core.content.withStyledAttributes
import androidx.recyclerview.widget.RecyclerView
import io.github.rafaelhschuh.litera.R
import io.github.rafaelhschuh.litera.data.LiteraRepository
import io.github.rafaelhschuh.litera.data.NativeBook
import kotlinx.coroutines.*

/** The same native book row is used by home, search, library and favorites. */
class NativeBookAdapter(
    private val books: List<NativeBook>, private val repository: LiteraRepository,
    private val scope: CoroutineScope, private val open: (NativeBook) -> Unit,
    private val headings: Map<Int, String> = emptyMap(),
) : RecyclerView.Adapter<NativeBookAdapter.Holder>() {
    class Holder(val row: LinearLayout, val cover: ImageView, val title: TextView, val author: TextView, val progress: TextView, val heading: TextView) : RecyclerView.ViewHolder(row) {
        var job: Job? = null
    }
    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val context = parent.context
        val padding = context.resources.getDimensionPixelSize(R.dimen.space_4)
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(padding, padding / 2, padding, padding / 2)
            minimumHeight = padding * 8
            isFocusable = true
            context.withStyledAttributes(attrs = intArrayOf(android.R.attr.selectableItemBackground)) { background = getDrawable(0) }
            layoutParams = RecyclerView.LayoutParams(-1, -2)
        }
        val heading = TextView(context).apply {
            setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX,context.resources.getDimension(R.dimen.text_book_title))
            setTextColor(ContextCompat.getColor(context, R.color.litera_text))
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setPadding(0,padding,0,padding)
        }
        row.addView(heading)
        val inner = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
        row.addView(inner, LinearLayout.LayoutParams(-1,-2))
        val cover = ImageView(context).apply {
            scaleType = ImageView.ScaleType.FIT_CENTER
            importantForAccessibility = ImageView.IMPORTANT_FOR_ACCESSIBILITY_NO
            setBackgroundColor(ContextCompat.getColor(context, R.color.litera_surface))
        }
        inner.addView(cover, LinearLayout.LayoutParams(padding * 5, padding * 15 / 2))
        val details = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setPadding(padding, 0, 0, 0) }
        fun label(size: Int, color: Int) = TextView(context).apply { setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX,resources.getDimension(size)); setTextColor(ContextCompat.getColor(context, color)) }
        val title = label(R.dimen.text_book_title, R.color.litera_text).apply { maxLines = 3; setTypeface(typeface, android.graphics.Typeface.BOLD) }
        val author = label(R.dimen.text_caption, R.color.litera_muted).apply { maxLines = 2 }
        val progress = label(R.dimen.text_caption, R.color.litera_accent)
        details.addView(title); details.addView(author); details.addView(progress)
        inner.addView(details, LinearLayout.LayoutParams(0, -2, 1f))
        return Holder(row, cover, title, author, progress, heading)
    }
    override fun getItemCount() = books.size
    override fun onBindViewHolder(holder: Holder, position: Int) {
        val book = books[position]
        holder.job?.cancel()
        holder.heading.text = headings[book.id].orEmpty()
        holder.heading.visibility = if(headings.containsKey(book.id)) android.view.View.VISIBLE else android.view.View.GONE
        holder.title.text = book.title
        holder.author.text = book.author ?: holder.row.context.getString(R.string.native_unknown_author)
        holder.progress.text = book.progressRatio?.let { holder.row.context.getString(R.string.native_progress, (it * 100).toInt()) } ?: book.format.uppercase()
        holder.cover.setImageResource(R.drawable.ic_litera)
        holder.row.setOnClickListener { open(book) }
        if (book.hasCover) holder.job = scope.launch {
            try {
                val bytes = repository.cover(book.id)
                val bitmap = withContext(Dispatchers.Default) {
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                    val options = BitmapFactory.Options().apply { inSampleSize = maxOf(1, bounds.outWidth / 320, bounds.outHeight / 480) }
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                }
                ensureActive()
                holder.cover.setImageBitmap(bitmap)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { /* The native placeholder keeps the library usable. */ }
        }
    }
    override fun onViewRecycled(holder: Holder) { holder.job?.cancel(); holder.cover.setImageDrawable(null) }
}
