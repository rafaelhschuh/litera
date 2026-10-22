package io.github.rafaelhschuh.litera.reader

import io.github.rafaelhschuh.litera.data.NativePreferences
import org.json.JSONObject

data class ReaderPosition(val locator: JSONObject, val ratio: Double, val label: String)
data class ReaderChapter(val title: String, val index: Int)

/** Format-specific renderers expose locations, never just a percentage. */
interface ReaderEngine : AutoCloseable {
    val chapters: List<ReaderChapter>
    fun position(): ReaderPosition?
    fun next()
    fun previous()
    fun go(index: Int)
    fun preferences(value: NativePreferences)
}
