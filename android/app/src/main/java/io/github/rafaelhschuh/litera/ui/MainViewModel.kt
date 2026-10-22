package io.github.rafaelhschuh.litera.ui

import android.app.Application
import androidx.core.content.edit
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.github.rafaelhschuh.litera.ServerOrigin
import io.github.rafaelhschuh.litera.data.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Native screen state survives rotation; only the repository owns HTTP/session state. */
class MainViewModel(application: Application) : AndroidViewModel(application) {
    data class State(
        val screen: String = "setup", val tab: Int = 0, val busy: Boolean = false,
        val error: String? = null, val books: List<NativeBook> = emptyList(),
        val continued: List<NativeBook> = emptyList(), val selected: NativeBook? = null,
        val page: Int = 1, val pages: Int = 1, val query: String = "",
        val prefs: NativePreferences = NativePreferences(), val user: NativeUser? = null,
    )
    private val mutable = MutableStateFlow(State())
    val state = mutable.asStateFlow()
    var repository: LiteraRepository? = null
        private set
    var origin: ServerOrigin? = null
        private set
    private var request: Job? = null
    private var generation = 0
    private val local = application.getSharedPreferences("litera-host", 0)
    init {
        val saved = local.getString("origin", null)
        if (saved != null) runCatching { ServerOrigin.parse(saved, local.getBoolean("allow-http", false)) }
            .getOrNull()?.let(::connect)
    }
    private fun launch(screen: String? = null, action: suspend (LiteraRepository) -> Unit) {
        request?.cancel()
        val currentGeneration = ++generation
        val repo = repository ?: return
        mutable.value = mutable.value.copy(screen = screen ?: mutable.value.screen, busy = true, error = null)
        request = viewModelScope.launch {
            try { action(repo) }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (error: Exception) {
                if(currentGeneration != generation) return@launch
                mutable.value = if (error is ApiFailure && error.status == 401)
                    State(screen = "login", error = error.userMessage(getApplication()))
                else mutable.value.copy(error = error.userMessage(getApplication()))
            } finally { if(currentGeneration == generation) mutable.value = mutable.value.copy(busy = false) }
        }
    }
    fun connect(value: ServerOrigin) {
        origin = value
        local.edit { putString("origin",value.value); putBoolean("allow-http",value.scheme == "http") }
        repository = LiteraRepository(getApplication(), value)
        launch("session") { repo ->
            val user = repo.session()
            val prefs = repo.preferences()
            mutable.value = State(screen = "content", user = user, prefs = prefs, busy = true)
            load(repo)
        }
    }
    fun setup() {
        request?.cancel()
        generation++
        mutable.value = mutable.value.copy(screen = "setup", error = null, busy = false)
    }
    fun login(username: String, password: String) = launch {
        val user = it.login(username, password)
        val prefs = it.preferences()
        mutable.value = State(screen = "content", user = user, prefs = prefs, busy = true)
        load(it)
    }
    private suspend fun load(repo: LiteraRepository) {
        val current = mutable.value
        if (current.tab == 0) {
            val home = repo.home()
            mutable.value = mutable.value.copy(books = home.recentlyAdded, continued = home.continueReading)
        } else if (current.tab in 1..2) {
            val result = repo.books(current.query, current.page, current.tab == 2)
            mutable.value = mutable.value.copy(books = result.books, page = result.page, pages = result.pages)
        }
    }
    fun tab(value: Int) {
        mutable.value = mutable.value.copy(screen = "content", tab = value, selected = null, page = 1, query = "", books = emptyList())
        launch { load(it) }
    }
    fun search(query: String) {
        mutable.value = mutable.value.copy(query = query, page = 1)
        launch { delay(300); load(it) }
    }
    fun page(value: Int) {
        mutable.value = mutable.value.copy(page = value)
        launch { load(it) }
    }
    fun detail(book: NativeBook) {
        mutable.value = mutable.value.copy(screen = "detail", selected = book)
        launch { repo -> mutable.value = mutable.value.copy(selected = repo.book(book.id)) }
    }
    fun back() {
        mutable.value = mutable.value.copy(screen = "content", selected = null)
        launch { load(it) }
    }
    fun refresh() = launch { repo ->
        mutable.value = mutable.value.copy(prefs = repo.preferences())
        if (mutable.value.screen == "detail") mutable.value.selected?.let { mutable.value = mutable.value.copy(selected = repo.book(it.id)) }
        else if (mutable.value.screen == "session") {
            val user = repo.session()
            mutable.value = mutable.value.copy(screen = "content", user = user, prefs = repo.preferences())
            load(repo)
        } else load(repo)
    }
    fun favorite() = launch { repo ->
        val book = mutable.value.selected ?: return@launch
        repo.favorite(book.id, !book.favorite)
        mutable.value = mutable.value.copy(selected = repo.book(book.id))
    }
    fun theme(value: String) = launch { repo ->
        val prefs = repo.preferences().copy(appTheme = value)
        repo.savePreferences(prefs)
        mutable.value = mutable.value.copy(prefs = prefs)
    }
    fun logout() = launch { repo -> try { repo.logout() } finally { mutable.value = State(screen = "login") } }
}
