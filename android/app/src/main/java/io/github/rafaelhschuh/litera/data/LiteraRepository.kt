package io.github.rafaelhschuh.litera.data

import android.content.Context
import android.annotation.SuppressLint
import io.github.rafaelhschuh.litera.ServerOrigin
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.security.MessageDigest

/** Native client of the existing API. All network/disk work runs on Dispatchers.IO. */
// KTX edit cannot report commit failures; durable state requires that result.
@SuppressLint("UseKtx")
class LiteraRepository(context: Context, private val origin: ServerOrigin) {
    private val preferences = context.getSharedPreferences("litera-native-${origin.profileName}", Context.MODE_PRIVATE)
    private val root = File(context.filesDir, "native-books/${origin.profileName}")
    private val cookies = EncryptedCookieJar(context.applicationContext, origin)
    private val api = NativeTransport(origin, cookies)
    private val coverSlots = Semaphore(4)
    private val covers = object : android.util.LruCache<Int,ByteArray>(12_000_000) {
        override fun sizeOf(key: Int,value: ByteArray) = value.size
    }
    private val progressMutex = Mutex()
    private val journal = ProgressJournal(
        read = { key -> preferences.getString("draft-$key",null) },
        write = { key, value -> check(preferences.edit().putString("draft-$key",value).commit()) { "Progresso local indisponível" } },
    )
    @Volatile private var identityGeneration = 0L
    @Volatile var user: NativeUser? = preferences.getString("user", null)?.let { runCatching { parseUser(JSONObject(it)) }.getOrNull() }
        private set

    suspend fun session(): NativeUser = io {
        val value = parseUser(api.json("/api/v1/auth/me").getJSONObject("user"))
        setUser(value)
        value
    }

    suspend fun login(username: String, password: String): NativeUser = io {
        val value = parseUser(api.json("/api/v1/auth/login", "POST", JSONObject().put("username", username).put("password", password)).getJSONObject("user"))
        setUser(value)
        value
    }

    suspend fun logout() = io {
        try { api.json("/api/v1/auth/logout", "POST") } finally {
            // Drafts remain isolated by account and can be recovered only after signing in again.
            cookies.clear()
            setUser(null)
        }
        Unit
    }

    suspend fun home(): HomeBooks {
        // Pending reading conflicts/errors belong to the reader; they never block the catalog.
        return io {
            val value = api.json("/api/v1/home", userId = account())
            HomeBooks(parseBooks(value.getJSONArray("continueReading")), parseBooks(value.getJSONArray("recentlyAdded")))
        }
    }

    suspend fun books(query: String = "", page: Int = 1, favorites: Boolean = false): BookPage = io {
        val url = (origin.value + "/api/v1/books").toHttpUrl().newBuilder()
            .addQueryParameter("q", query).addQueryParameter("page", page.coerceAtLeast(1).toString())
            .addQueryParameter("favorite", favorites.toString()).build()
        val value = api.json(url.encodedPath + "?" + url.encodedQuery, userId = account())
        val pagination = value.getJSONObject("pagination")
        BookPage(parseBooks(value.getJSONArray("books")), pagination.getInt("page"), pagination.getInt("pages"), pagination.getInt("total"))
    }

    suspend fun book(id: Int): NativeBook = io { parseBook(api.json("/api/v1/books/${validId(id)}", userId = account()).getJSONObject("book")) }
    suspend fun cover(id: Int): ByteArray = coverSlots.withPermit {
        io {
            val owner = account()
            covers.get(validId(id))?.let { return@io it }
            val bytes = api.response("/api/v1/books/${validId(id)}/cover",userId = owner).use { response ->
                val body = response.body ?: throw IOException("Capa vazia")
                if(body.contentLength() > 8_000_000) throw IOException("Capa excede o limite")
                body.byteStream().use { it.readBytesLimited(8_000_000) }
            }
            if(user?.id != owner) throw ApiFailure(409,"SESSION_USER_MISMATCH","A conta mudou. Entre novamente.")
            covers.put(id,bytes)
            bytes
        }
    }

    suspend fun chapters(bookId: Int): List<NativeChapter> = io {
        val chapters = api.json("/api/v1/books/${validId(bookId)}/epub/manifest", userId = account()).getJSONArray("chapters")
        (0 until chapters.length()).map { index -> chapters.getJSONObject(index).let { NativeChapter(it.getString("href"), it.getString("label")) } }
    }

    fun lastReadFileRevision(bookId: Int): String? = preferences.getString("read-file-${account()}-${validId(bookId)}",null)
    fun rememberReadFile(book: NativeBook) {
        check(preferences.edit().putString("read-file-${account()}-${validId(book.id)}",book.fileRevision).commit()) { "Estado de leitura indisponível" }
    }

    suspend fun content(book: NativeBook): File = io {
        val owner = account()
        require(book.format in listOf("epub", "pdf"))
        val folder = File(root, owner.toString()).apply { check(exists() || mkdirs()) }
        val revision = MessageDigest.getInstance("SHA-256").digest(book.fileRevision.toByteArray()).joinToString("") { "%02x".format(it) }
        val target = File(folder, "${validId(book.id)}-$revision.${book.format}")
        if (target.isFile && target.length() > 0) return@io target
        val temporary = File.createTempFile("download-", ".partial", folder)
        try {
            api.response("/api/v1/books/${book.id}/content", userId = owner).use { response ->
                val body = response.body ?: throw IOException("Arquivo vazio")
                val expected = body.contentLength()
                if (expected > MAX_BOOK_BYTES) throw IOException("Livro excede o limite")
                temporary.outputStream().use { output ->
                    body.byteStream().use { input ->
                        val buffer = ByteArray(64 * 1024)
                        var total = 0L
                        while (true) {
                            currentCoroutineContext().ensureActive()
                            val count = input.read(buffer)
                            if (count < 0) break
                            total += count
                            if (total > MAX_BOOK_BYTES) throw IOException("Livro excede o limite")
                            output.write(buffer, 0, count)
                        }
                        if (total == 0L || (expected >= 0 && total != expected)) throw IOException("Download incompleto")
                    }
                    output.fd.sync()
                }
            }
            val current = parseBook(api.json("/api/v1/books/${book.id}", userId = owner).getJSONObject("book"))
            currentCoroutineContext().ensureActive()
            if (current.fileRevision != book.fileRevision) throw ApiFailure(409, "FILE_CHANGED", "O arquivo mudou. Abra o livro novamente.")
            if (user?.id != owner) throw ApiFailure(401, "ACCOUNT_CHANGED", "Entre novamente")
            check(temporary.renameTo(target)) { "Não foi possível concluir o download" }
            target
        } finally { temporary.delete() }
    }

    suspend fun progress(id: Int): NativeProgress? = io {
        val owner = account()
        val key = progressKey(owner, id)
        try {
            val value = api.json("/api/v1/books/${validId(id)}/progress", userId = owner).optJSONObject("progress")
            value?.let { store(key, it) }
            value?.let(::parseProgress)
        } catch (error: IOException) {
            preferences.getString("draft-$key", null)?.let { JSONObject(it) }?.let { it.optJSONObject("next") ?: it }?.getJSONObject("body")?.let(::parseProgress)
                ?: preferences.getString(key, null)?.let { parseProgress(JSONObject(it)) }
                ?: throw error
        }
    }

    /** A small synchronous durable write used at the lifecycle boundary before the activity can die. */
    fun stageProgress(book: NativeBook, locator: JSONObject, ratio: Double, revision: Int?) {
        val owner = account()
        val body = JSONObject().put("format",book.format).put("locator",JSONObject(locator.toString()))
            .put("progressRatio",ratio.coerceIn(0.0,1.0)).put("revision",revision ?: 0)
        journal.stage(progressKey(owner,book.id),book.id,body)
    }

    suspend fun saveProgress(book: NativeBook, locator: JSONObject, ratio: Double, revision: Int?): NativeProgress {
        io { stageProgress(book,locator,ratio,revision) }
        return flushProgress(book.id) ?: throw IllegalStateException("Posição local indisponível")
    }

    suspend fun flushProgress(bookId: Int): NativeProgress? = progressMutex.withLock {
        io { val owner = account(); sendDraft(owner,progressKey(owner,bookId)) }
    }

    /** Explicit foreground retry; a conflict never selects a winning percentage. */
    suspend fun replayProgress() = progressMutex.withLock {
        io {
            val owner = account()
            val prefix = "draft-progress-$owner-"
            preferences.all.keys.filter { it.startsWith(prefix) }.sorted().forEach { sendDraft(owner,it.removePrefix("draft-")) }
        }
    }
    suspend fun pendingProgress(bookId: Int): NativeProgress? = io {
        journal.newest(progressKey(account(),bookId))?.getJSONObject("body")?.let(::parseProgress)
    }
    suspend fun keepLocalProgress(bookId: Int, serverRevision: Int): NativeProgress = progressMutex.withLock {
        io {
            val owner = account(); val key = progressKey(owner,bookId)
            journal.rebase(key,serverRevision)
            sendDraft(owner,key) ?: throw IllegalStateException("Posição local indisponível")
        }
    }
    suspend fun discardProgressDraft(bookId: Int) = progressMutex.withLock {
        io { journal.discard(progressKey(account(),bookId)) }
    }

    suspend fun preferences(): NativePreferences = io {
        val owner = account()
        try {
            val value = api.json("/api/v1/settings", userId = owner).getJSONObject("preferences")
            store("preferences-$owner", value)
            parsePreferences(value)
        } catch (error: IOException) {
            preferences.getString("preferences-$owner", null)?.let { parsePreferences(JSONObject(it)) } ?: throw error
        }
    }

    suspend fun savePreferences(pref: NativePreferences): NativePreferences = io {
        val owner = account()
        val value = api.json("/api/v1/settings", "PUT", preferencesJson(pref), owner).getJSONObject("preferences")
        store("preferences-$owner", value)
        parsePreferences(value)
    }

    suspend fun favorite(id: Int, enabled: Boolean) = io {
        api.json("/api/v1/books/${validId(id)}/favorite", if (enabled) "PUT" else "DELETE", userId = account())
        Unit
    }

    private fun sendDraft(owner: Int, key: String): NativeProgress? {
        var result: NativeProgress? = null
        while (true) {
            val draft = journal.current(key) ?: return result
            val operation = draft.getString("operation")
            val value = api.json("/api/v1/books/${draft.getInt("bookId")}/progress", "PUT", draft.getJSONObject("body"), owner, operation).getJSONObject("progress")
            store(key,value)
            journal.acknowledge(key,operation,value.getInt("revision"))
            result = parseProgress(value)
        }
    }

    private fun account(): Int = user?.id ?: throw ApiFailure(401, "UNAUTHENTICATED", "Entre para acessar sua biblioteca")
    @Synchronized private fun setUser(value: NativeUser?) {
        identityGeneration++
        if(user?.id != value?.id) covers.evictAll()
        user = value
        val data = value?.let { JSONObject().put("id", it.id).put("username", it.username).put("displayName", it.displayName).put("role", it.role).toString() }
        check(preferences.edit().putString("user", data).commit())
    }
    private fun store(key: String, value: JSONObject) { check(preferences.edit().putString(key, value.toString()).commit()) { "Armazenamento local indisponível" } }
    private suspend fun <T> io(action: suspend () -> T): T = withContext(Dispatchers.IO) {
        val generation = identityGeneration
        try { action() } catch (error: ApiFailure) {
            if (error.status == 401 && identityGeneration == generation) { cookies.clear(); setUser(null) }
            throw error
        }
    }
    private fun progressKey(owner: Int, id: Int) = "progress-$owner-${validId(id)}"
    private fun validId(id: Int): Int { require(id > 0); return id }

    companion object {
        private const val MAX_BOOK_BYTES = 512L * 1024 * 1024
        internal fun parseUser(value: JSONObject) = NativeUser(value.getInt("id"), value.getString("username"), value.getString("displayName"), value.getString("role"))
        internal fun parseBook(value: JSONObject) = NativeBook(value.getInt("id"), value.getString("title"), value.nullableString("author"), value.nullableString("description"), value.getString("format"), if (value.isNull("pageCount")) null else value.getInt("pageCount"), value.optBoolean("hasCover"), value.optBoolean("favorite"), if (value.isNull("progressRatio")) null else value.getDouble("progressRatio"), value.getString("fileRevision"), value.optBoolean("completed"))
        internal fun parseProgress(value: JSONObject) = NativeProgress(value.getJSONObject("locator"), value.getDouble("progressRatio"), value.getInt("revision"), value.optBoolean("completed"), value.optString("format"))
        internal fun parsePreferences(value: JSONObject) = NativePreferences(value.optString("theme", "light"), value.optInt("fontScale", 100), value.optString("lineHeight", "normal"), value.optString("margins", "normal"), value.optString("appTheme", "system"), value.optBoolean("reducedMotion"), value.optBoolean("pdfInvert"))
        private fun preferencesJson(value: NativePreferences) = JSONObject().put("theme", value.theme).put("fontScale", value.fontScale).put("lineHeight", value.lineHeight).put("margins", value.margins).put("appTheme", value.appTheme).put("reducedMotion", value.reducedMotion).put("pdfInvert", value.pdfInvert)
        private fun parseBooks(value: JSONArray) = (0 until value.length()).map { parseBook(value.getJSONObject(it)) }
        private fun JSONObject.nullableString(key: String): String? = if (isNull(key)) null else optString(key).takeIf { it.isNotBlank() }
        private fun java.io.InputStream.readBytesLimited(maximum: Int): ByteArray {
            val output = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(16 * 1024)
            while (true) { val count = read(buffer); if (count < 0) break; if (output.size() + count > maximum) throw IOException("Recurso excede o limite"); output.write(buffer, 0, count) }
            return output.toByteArray()
        }
    }
}
