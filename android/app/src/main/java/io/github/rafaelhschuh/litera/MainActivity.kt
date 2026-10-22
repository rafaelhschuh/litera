package io.github.rafaelhschuh.litera

import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.*
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.appcompat.widget.SearchView
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.bottomnavigation.BottomNavigationView
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.progressindicator.LinearProgressIndicator
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import io.github.rafaelhschuh.litera.data.NativeBook
import io.github.rafaelhschuh.litera.reader.NativeReaderActivity
import io.github.rafaelhschuh.litera.ui.MainViewModel
import io.github.rafaelhschuh.litera.ui.NativeBookAdapter
import kotlinx.coroutines.launch
import kotlinx.coroutines.Job
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.CancellationException

/** API client with Android screens. Publication rendering lives in the reader adapters. */
class MainActivity : AppCompatActivity() {
    private val model: MainViewModel by viewModels()
    private lateinit var root: LinearLayout
    private lateinit var toolbar: MaterialToolbar
    private lateinit var progress: LinearProgressIndicator
    private lateinit var body: FrameLayout
    private lateinit var bottom: BottomNavigationView
    private var favoriteButton: MaterialButton? = null
    private var retryButton: MaterialButton? = null
    private var returningFromReader = false
    private var detailCoverJob: Job? = null
    private var rendered: String? = null
    private var booksRendered: List<NativeBook>? = null
    private var detailRendered: NativeBook? = null
    private var list: RecyclerView? = null
    private var errorLabel: TextView? = null
    private var continueLabel: TextView? = null
    private var next: MaterialButton? = null
    private var previous: MaterialButton? = null
    private var pageLabel: TextView? = null
    private val spacing get() = resources.getDimensionPixelSize(R.dimen.space_4)
    override fun onCreate(savedInstanceState: Bundle?) {
        val cached = getSharedPreferences("litera-host", MODE_PRIVATE).getString("app-theme", "system")
        applyTheme(cached ?: "system")
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(SystemBarStyle.auto(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT))
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(color(R.color.litera_background)) }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            // Root owns system/cutout/IME padding; Material bottom navigation
            // must not apply those insets a second time.
            WindowInsetsCompat.CONSUMED
        }
        toolbar = MaterialToolbar(this).apply { title = getString(R.string.app_name); setBackgroundColor(color(R.color.litera_surface)) }
        progress = LinearProgressIndicator(this).apply { isIndeterminate = true; visibility = View.INVISIBLE }
        body = FrameLayout(this)
        bottom = BottomNavigationView(this).apply {
            setBackgroundColor(color(R.color.litera_surface))
            val labels = intArrayOf(R.string.native_home,R.string.native_library,R.string.native_favorites,R.string.native_settings)
            val icons = intArrayOf(R.drawable.ic_native_home,R.drawable.ic_native_library,R.drawable.ic_native_favorite,R.drawable.ic_native_settings)
            labels.forEachIndexed { index, label -> menu.add(0, index + 1, index, label).setIcon(icons[index]) }
            setOnItemSelectedListener { item -> if (model.state.value.tab != item.itemId - 1 || model.state.value.screen == "detail") model.tab(item.itemId - 1); true }
        }
        root.addView(toolbar, LinearLayout.LayoutParams(-1, -2))
        root.addView(progress, LinearLayout.LayoutParams(-1, -2))
        root.addView(body, LinearLayout.LayoutParams(-1, 0, 1f))
        root.addView(bottom, LinearLayout.LayoutParams(-1, -2))
        setContentView(root)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    model.state.value.screen == "detail" -> model.back()
                    model.state.value.screen == "content" && model.state.value.tab != 0 -> model.tab(0)
                    else -> { isEnabled = false; onBackPressedDispatcher.onBackPressed(); isEnabled = true }
                }
            }
        })
        lifecycleScope.launch { repeatOnLifecycle(Lifecycle.State.STARTED) { model.state.collect(::render) } }
    }
    override fun onResume() {
        super.onResume()
        if(returningFromReader) { returningFromReader = false; model.refresh() }
    }
    private fun color(id: Int) = ContextCompat.getColor(this, id)
    private fun applyTheme(value: String) {
        val mode = when(value) { "dark" -> AppCompatDelegate.MODE_NIGHT_YES; "light" -> AppCompatDelegate.MODE_NIGHT_NO; else -> AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM }
        if (AppCompatDelegate.getDefaultNightMode() != mode) AppCompatDelegate.setDefaultNightMode(mode)
    }
    private fun column(padded: Boolean = true) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        if(padded) setPadding(spacing, spacing, spacing, spacing)
    }
    private fun label(text: CharSequence, title: Boolean = false) = TextView(this).apply {
        this.text = text; setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX,resources.getDimension(if(title) R.dimen.text_section else R.dimen.text_body))
        setTextColor(color(R.color.litera_text)); setPadding(0, spacing / 2, 0, spacing / 2)
        if(title) setTypeface(typeface, android.graphics.Typeface.BOLD)
    }
    private fun button(text: Int, action: () -> Unit) = MaterialButton(this).apply {
        setText(text); minimumHeight = resources.getDimensionPixelSize(R.dimen.touch_target); setOnClickListener { action() }
    }
    private fun scroll(content: View) { body.addView(ScrollView(this).apply { isFillViewport = true; addView(content) }, FrameLayout.LayoutParams(-1,-1)) }
    private fun error(parent: LinearLayout) { errorLabel = label("").apply { accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }; parent.addView(errorLabel) }
    private fun render(state: MainViewModel.State) {
        progress.visibility = if(state.busy) View.VISIBLE else View.INVISIBLE
        bottom.visibility = if(state.screen in listOf("content", "detail")) View.VISIBLE else View.GONE
        if(state.user != null) {
            getSharedPreferences("litera-host", MODE_PRIVATE).edit { putString("app-theme",state.prefs.appTheme) }
            applyTheme(state.prefs.appTheme)
        }
        val key = state.screen + ":" + state.tab
        if (rendered != key) {
            detailCoverJob?.cancel()
            rendered = key; booksRendered = null; detailRendered = null; list = null; errorLabel = null; retryButton = null
            body.removeAllViews(); toolbar.menu.clear(); toolbar.navigationIcon = null
            toolbar.title = getString(R.string.app_name)
            if(state.screen == "detail") {
                toolbar.setNavigationIcon(R.drawable.ic_native_back); toolbar.navigationContentDescription = getString(R.string.native_back)
                toolbar.setNavigationOnClickListener { model.back() }
            }
            when(state.screen) {
                "setup" -> setup()
                "login" -> login()
                "session" -> {
                    val content = column(); content.addView(label(getString(R.string.native_loading),true)); error(content)
                    content.addView(button(R.string.retry) { model.origin?.let(model::connect) })
                    content.addView(button(R.string.menu_server) { model.setup() }); scroll(content)
                }
                "content" -> {
                    val titles = intArrayOf(R.string.native_home,R.string.native_library,R.string.native_favorites,R.string.native_settings)
                    toolbar.setTitle(titles[state.tab])
                    bottom.selectedItemId = state.tab + 1
                    if(state.tab == 3) settings(state) else catalog(state)
                }
            }
        }
        if(state.screen == "detail" && state.selected != detailRendered) {
            detailRendered = state.selected; body.removeAllViews(); detail(state.selected)
            errorLabel?.text = state.error.orEmpty()
        }
        errorLabel?.text = state.error.orEmpty()
        errorLabel?.visibility = if(state.error == null) View.GONE else View.VISIBLE
        retryButton?.visibility = if(state.error == null) View.GONE else View.VISIBLE
        retryButton?.isEnabled = !state.busy
        if(state.screen == "content" && state.tab != 3) {
            val combined = if(state.tab == 0) (state.continued + state.books).distinctBy { it.id } else state.books
            if(combined != booksRendered) {
                booksRendered = combined
                val repo = model.repository
                if(repo != null) {
                    val headings = mutableMapOf<Int,String>()
                    if(state.tab == 0) {
                        state.continued.firstOrNull()?.let { headings[it.id] = getString(R.string.native_continue) }
                        state.books.firstOrNull { recent -> state.continued.none { it.id == recent.id } }?.let { headings[it.id] = getString(R.string.native_recent) }
                    }
                    list?.adapter = NativeBookAdapter(combined, repo, lifecycleScope, model::detail, headings)
                }
            }
            continueLabel?.text = when { !state.busy && combined.isEmpty() -> getString(R.string.native_empty);  else -> "" }
            pageLabel?.text = getString(R.string.native_page, state.page, state.pages)
            next?.isEnabled = !state.busy && state.page < state.pages
            previous?.isEnabled = !state.busy && state.page > 1
        }
        favoriteButton?.isEnabled = !state.busy
        findViewById<View>(R.id.server_connect)?.isEnabled = !state.busy
        findViewById<View>(R.id.login_submit)?.isEnabled = !state.busy
    }
    private fun input(parent: LinearLayout, hint: Int, id: Int, kind: Int): TextInputEditText {
        val wrapper = TextInputLayout(this).apply { this.hint = getString(hint); boxBackgroundMode = TextInputLayout.BOX_BACKGROUND_OUTLINE }
        val field = TextInputEditText(wrapper.context).apply { this.id = id; inputType = kind; maxLines = 1; setSingleLine(true) }
        wrapper.addView(field, LinearLayout.LayoutParams(-1,-2)); parent.addView(wrapper, LinearLayout.LayoutParams(-1,-2).apply { bottomMargin = spacing })
        return field
    }
    private fun setup() {
        val content = column()
        content.addView(label(getString(R.string.server_title), true)); content.addView(label(getString(R.string.native_server_note)))
        val address = input(content,R.string.server_url,R.id.server_url,InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI)
        address.setText(model.origin?.value.orEmpty()); address.hint = getString(R.string.server_hint)
        val http = CheckBox(this).apply { id = R.id.allow_http; setText(R.string.http_opt_in); isChecked = model.origin?.scheme == "http" }
        content.addView(http); content.addView(label(getString(R.string.native_http_note)))
        content.addView(button(R.string.server_connect) {
            try { model.connect(ServerOrigin.parse(address.text.toString().trim(),http.isChecked)) }
            catch (_: IllegalArgumentException) { address.error = getString(R.string.invalid_url) }
        }.apply { id = R.id.server_connect })
        if(model.repository != null) content.addView(button(R.string.cancel) { model.origin?.let(model::connect) })
        error(content); scroll(content)
    }
    private fun login() {
        val content = column(); content.addView(label(getString(R.string.native_login),true)); content.addView(label(model.origin?.value.orEmpty()))
        val username = input(content,R.string.native_username,R.id.username,InputType.TYPE_CLASS_TEXT)
        username.setAutofillHints(View.AUTOFILL_HINT_USERNAME)
        val password = input(content,R.string.native_password,R.id.password,InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        password.setAutofillHints(View.AUTOFILL_HINT_PASSWORD)
        password.imeOptions = EditorInfo.IME_ACTION_DONE
        val submit = { if(!model.state.value.busy && !username.text.isNullOrBlank() && !password.text.isNullOrEmpty()) model.login(username.text.toString().trim(),password.text.toString()) }
        password.setOnEditorActionListener { _, action, _ -> if(action == EditorInfo.IME_ACTION_DONE) { submit(); true } else false }
        content.addView(button(R.string.native_login, submit).apply { id = R.id.login_submit })
        content.addView(button(R.string.menu_server) { model.setup() }); error(content); scroll(content)
    }
    private fun catalog(state: MainViewModel.State) {
        val content = column(false)
        if(state.tab != 0) {
            val search = SearchView(this).apply {
                queryHint = getString(R.string.native_search); setIconifiedByDefault(false)
                setQuery(state.query,false)
                setOnQueryTextListener(object : SearchView.OnQueryTextListener {
                    override fun onQueryTextSubmit(query: String?): Boolean { clearFocus(); return true }
                    override fun onQueryTextChange(newText: String?): Boolean { model.search(newText.orEmpty()); return true }
                })
            }
            content.addView(search)
        }
        continueLabel = label("").apply { setPadding(spacing,0,spacing,0) }; content.addView(continueLabel)
        error(content)
        toolbar.menu.add(R.string.menu_reload).setIcon(R.drawable.ic_native_refresh).apply {
            setShowAsAction(android.view.MenuItem.SHOW_AS_ACTION_IF_ROOM)
            setOnMenuItemClickListener { model.refresh(); true }
        }
        retryButton = button(R.string.retry) { model.refresh() }.apply { visibility = View.GONE }
        content.addView(retryButton)
        list = RecyclerView(this).apply { id = R.id.book_list; layoutManager = LinearLayoutManager(this@MainActivity); clipToPadding = false }
        content.addView(list, LinearLayout.LayoutParams(-1,0,1f))
        if(state.tab != 0) {
            val pages = LinearLayout(this).apply { gravity = android.view.Gravity.CENTER_VERTICAL }
            previous = button(R.string.native_previous) { model.page(model.state.value.page - 1) }
            next = button(R.string.native_next) { model.page(model.state.value.page + 1) }
            pageLabel = label("").apply { gravity = android.view.Gravity.CENTER }
            pages.addView(previous); pages.addView(pageLabel,LinearLayout.LayoutParams(0,-2,1f)); pages.addView(next)
            content.addView(pages)
        }
        body.addView(content,FrameLayout.LayoutParams(-1,-1))
    }
    private fun detail(book: NativeBook?) {
        if(book == null) return
        val content = column()
        val cover = ImageView(this).apply {
            scaleType = ImageView.ScaleType.FIT_CENTER
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            setBackgroundColor(color(R.color.litera_dark))
            setImageResource(R.drawable.ic_litera)
        }
        content.addView(cover,LinearLayout.LayoutParams(-1,spacing * 15))
        detailCoverJob?.cancel()
        if(book.hasCover) detailCoverJob = lifecycleScope.launch {
            try {
                val bytes = model.repository?.cover(book.id) ?: return@launch
                val bitmap = withContext(Dispatchers.Default) {
                    val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.size,bounds)
                    val options = android.graphics.BitmapFactory.Options().apply { inSampleSize = maxOf(1,bounds.outWidth / 480,bounds.outHeight / 720) }
                    android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.size,options)
                }
                if(bitmap != null) { cover.setBackgroundColor(color(R.color.litera_surface)); cover.setImageBitmap(bitmap) }
            } catch(cancelled: CancellationException) { throw cancelled }
            catch(_: Exception) { /* A cover failure does not block reading. */ }
        }
        content.addView(label(book.title,true)); content.addView(label(book.author ?: getString(R.string.native_unknown_author)))
        content.addView(label(book.format.uppercase()))
        book.progressRatio?.let { content.addView(label(getString(R.string.native_progress,(it*100).toInt()))) }
        content.addView(button(R.string.native_read) {
            returningFromReader = true
            startActivity(Intent(this, NativeReaderActivity::class.java).putExtra("book-id",book.id).putExtra("server-origin",model.origin?.value))
        })
        favoriteButton = button(if(book.favorite) R.string.native_remove_favorite else R.string.native_add_favorite) { model.favorite() }
        content.addView(favoriteButton)
        if(!book.description.isNullOrBlank()) content.addView(label(book.description))
        error(content); retryButton = button(R.string.retry) { model.refresh() }.apply { visibility = View.GONE }; content.addView(retryButton); scroll(content)
    }
    private fun settings(state: MainViewModel.State) {
        val content = column(); content.addView(label(getString(R.string.native_settings),true))
        content.addView(label(getString(R.string.native_account,state.user?.displayName.orEmpty())))
        content.addView(label(model.origin?.value.orEmpty()))
        content.addView(button(R.string.native_theme) {
            val values = arrayOf("system","light","dark")
            val labels = arrayOf(getString(R.string.native_theme_system),getString(R.string.native_theme_light),getString(R.string.native_theme_dark))
            MaterialAlertDialogBuilder(this).setTitle(R.string.native_theme).setSingleChoiceItems(labels,values.indexOf(model.state.value.prefs.appTheme)) { dialog, which -> model.theme(values[which]); dialog.dismiss() }.setNegativeButton(R.string.cancel,null).show()
        })
        content.addView(button(R.string.menu_server) {
            MaterialAlertDialogBuilder(this).setMessage(R.string.change_server_note).setPositiveButton(R.string.menu_server) { _,_ -> model.setup() }.setNegativeButton(R.string.cancel,null).show()
        })
        content.addView(button(R.string.native_logout) {
            MaterialAlertDialogBuilder(this).setMessage(R.string.native_logout_note).setPositiveButton(R.string.native_logout) { _,_ -> model.logout() }.setNegativeButton(R.string.cancel,null).show()
        })
        content.addView(label(getString(R.string.native_storage_note)))
        content.addView(label(getString(R.string.native_version,BuildConfig.VERSION_NAME)))
        error(content); scroll(content)
    }
}
