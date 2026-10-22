package io.github.rafaelhschuh.litera.data

import org.json.JSONObject

data class NativeUser(val id: Int, val username: String, val displayName: String, val role: String)
data class NativeBook(val id: Int, val title: String, val author: String?, val description: String?, val format: String, val pageCount: Int?, val hasCover: Boolean, val favorite: Boolean, val progressRatio: Double?, val fileRevision: String, val completed: Boolean)
data class BookPage(val books: List<NativeBook>, val page: Int, val pages: Int, val total: Int)
data class HomeBooks(val continueReading: List<NativeBook>, val recentlyAdded: List<NativeBook>)
data class NativePreferences(val theme: String = "light", val fontScale: Int = 100, val lineHeight: String = "normal", val margins: String = "normal", val appTheme: String = "system", val reducedMotion: Boolean = false, val pdfInvert: Boolean = false)
data class NativeProgress(val locator: JSONObject, val progressRatio: Double, val revision: Int, val completed: Boolean = false, val format: String = "") { val ratio: Double get() = progressRatio }
data class NativeChapter(val href: String, val label: String)
class ApiFailure(val status: Int, val code: String, override val message: String) : Exception(message)
