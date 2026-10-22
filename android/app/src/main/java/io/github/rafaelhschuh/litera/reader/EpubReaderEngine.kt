@file:OptIn(org.readium.r2.shared.ExperimentalReadiumApi::class)

package io.github.rafaelhschuh.litera.reader

import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.withResumed
import io.github.rafaelhschuh.litera.data.NativeChapter
import io.github.rafaelhschuh.litera.data.NativePreferences
import io.github.rafaelhschuh.litera.data.NativeProgress
import java.io.File
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.readium.r2.navigator.epub.EpubNavigatorFactory
import org.readium.r2.navigator.epub.EpubNavigatorFragment
import org.readium.r2.navigator.epub.EpubPreferences
import org.readium.r2.navigator.preferences.Theme
import org.readium.r2.shared.publication.Locator
import org.readium.r2.shared.publication.Publication
import org.readium.r2.shared.util.AbsoluteUrl
import org.readium.r2.shared.util.Try
import org.readium.r2.shared.util.asset.AssetRetriever
import org.readium.r2.shared.util.getOrElse
import org.readium.r2.shared.util.http.HttpClient
import org.readium.r2.shared.util.http.HttpError
import org.readium.r2.shared.util.http.HttpRequest
import org.readium.r2.shared.util.http.HttpTry
import org.readium.r2.shared.util.http.HttpStreamResponse
import org.readium.r2.shared.util.mediatype.MediaType
import org.readium.r2.shared.util.toUrl
import org.readium.r2.streamer.PublicationOpener
import org.readium.r2.streamer.parser.epub.EpubParser

class EpubReaderEngine private constructor(
    private val activity: FragmentActivity,
    private val publication: Publication,
    private val spine: List<NativeChapter>,
    private val fragment: EpubNavigatorFragment,
    private val safeFile: File,
    private val changed: (ReaderPosition) -> Unit,
) : ReaderEngine {
    private var observer: Job? = null
    override val chapters: List<ReaderChapter> = publication.readingOrder.mapIndexed { index, link ->
        ReaderChapter(spine.getOrNull(index)?.label ?: link.title ?: activity.getString(io.github.rafaelhschuh.litera.R.string.reader_chapter,index + 1), index)
    }

    fun observe() {
        observer = activity.lifecycleScope.launch {
            fragment.currentLocator.collect { position()?.let(changed) }
        }
    }

    override fun position(): ReaderPosition? {
        val locator = fragment.currentLocator.value
        val index = publication.readingOrder.indexOfFirst { it.href.resolve().toString().substringBefore('#') == locator.href.toString().substringBefore('#') }.takeIf { it >= 0 } ?: return null
        val inside = (locator.locations.progression ?: 0.0).coerceIn(0.0, 1.0)
        val ratio = (locator.locations.totalProgression ?: ((index + inside) / chapters.size.coerceAtLeast(1))).coerceIn(0.0, 1.0)
        val json = JSONObject().put("type", "epub-cfi")
            .put("cfi", "epubcfi(/6/${(index + 1) * 2}!/4/2)")
            .put("chapterHref", spine.getOrNull(index)?.href ?: publication.readingOrder[index].href.toString())
            .put("chapterProgression", inside)
        return ReaderPosition(json, ratio, "${chapters[index].title} · ${(ratio * 100).toInt()}%")
    }

    override fun next() { fragment.goForward(animated = false) }
    override fun previous() { fragment.goBackward(animated = false) }
    override fun go(index: Int) { publication.readingOrder.getOrNull(index)?.let { fragment.go(it, false) } }
    override fun preferences(value: NativePreferences) { fragment.submitPreferences(epubPreferences(value)) }
    override fun close() {
        observer?.cancel()
        publication.close()
        safeFile.delete()
    }

    companion object {
        suspend fun open(activity: FragmentActivity, containerId: Int, file: File, spine: List<NativeChapter>, previous: NativeProgress?, preferences: NativePreferences, changed: (ReaderPosition) -> Unit, onError: (String) -> Unit): EpubReaderEngine {
            val safe = File(activity.cacheDir, "epub-reader-${java.util.UUID.randomUUID()}.epub")
            var opened: Publication? = null
            try {
                val publication = withContext(Dispatchers.IO) {
                    SafeEpub.prepare(file, safe)
                    // No credentials, HTTP resources or remote publication dependencies enter the engine.
                    val offline = object : HttpClient {
                        override suspend fun stream(request: HttpRequest): HttpTry<HttpStreamResponse> = Try.failure(HttpError.IO(IOException("Remote EPUB resources are blocked")))
                    }
                    val retriever = AssetRetriever(activity.contentResolver, offline)
                    val asset = retriever.retrieve(safe.toUrl(isDirectory = false), MediaType.EPUB).getOrElse { throw IOException(it.toString()) }
                    PublicationOpener(EpubParser(offline)).open(asset, allowUserInteraction = false).getOrElse { throw IOException(it.toString()) }.also { opened = it }
                }
                require(publication.readingOrder.isNotEmpty()) { "EPUB sem capítulos legíveis" }
                val savedHref = previous?.locator?.optString("chapterHref")
                val byHref = spine.indexOfFirst { it.href == savedHref }.takeIf { it >= 0 }
                val byCfi = previous?.locator?.optString("cfi")?.let { Regex("/6/([0-9]+)").find(it)?.groupValues?.get(1)?.toIntOrNull()?.let { step -> step / 2 - 1 } }
                val index = (byHref ?: byCfi ?: 0).coerceIn(0, publication.readingOrder.lastIndex)
                val progression = previous?.locator?.takeIf { it.has("chapterProgression") }?.optDouble("chapterProgression")
                    ?: previous?.let { (it.progressRatio * publication.readingOrder.size - index).coerceIn(0.0, 1.0) } ?: 0.0
                val link = publication.readingOrder[index]
                val initial = Locator(href = link.href.resolve(), mediaType = link.mediaType ?: MediaType.XHTML, locations = Locator.Locations(progression = progression.coerceIn(0.0, 1.0)))
                val factory = EpubNavigatorFactory(publication).createFragmentFactory(initialLocator = initial, initialPreferences = epubPreferences(preferences), listener = object : EpubNavigatorFragment.Listener {
                    override fun onExternalLinkActivated(url: AbsoluteUrl) { onError(activity.getString(io.github.rafaelhschuh.litera.R.string.reader_link_blocked)) }
                    override fun onResourceLoadFailed(href: org.readium.r2.shared.util.Url, error: org.readium.r2.shared.util.data.ReadError) { onError(activity.getString(io.github.rafaelhschuh.litera.R.string.reader_resource_error)) }
                }, configuration = EpubNavigatorFragment.Configuration(shouldApplyInsetsPadding = false))
                val fragment = factory.instantiate(activity.classLoader, EpubNavigatorFragment::class.java.name) as EpubNavigatorFragment
                activity.lifecycle.withResumed { activity.supportFragmentManager.beginTransaction().replace(containerId, fragment).commitNow() }
                return EpubReaderEngine(activity, publication, spine, fragment, safe, changed).also { it.observe() }
            } catch(error: Throwable) {
                opened?.close(); safe.delete()
                throw error
            }
        }

        private fun epubPreferences(prefs: NativePreferences) = EpubPreferences(
            fontSize = prefs.fontScale / 100.0,
            lineHeight = when (prefs.lineHeight) { "compact" -> 1.4; "relaxed" -> 1.9; else -> 1.65 },
            pageMargins = when (prefs.margins) { "narrow" -> 0.5; "wide" -> 1.5; else -> 1.0 },
            theme = when (prefs.theme) { "dark" -> Theme.DARK; "sepia" -> Theme.SEPIA; else -> Theme.LIGHT },
            publisherStyles = false,
        )
    }
}
