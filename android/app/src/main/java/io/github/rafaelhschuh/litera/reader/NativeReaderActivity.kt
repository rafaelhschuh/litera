package io.github.rafaelhschuh.litera.reader

import android.os.Bundle
import android.content.res.Configuration
import android.content.res.ColorStateList
import androidx.appcompat.view.ContextThemeWrapper
import androidx.core.view.WindowInsetsControllerCompat
import android.view.View
import android.view.WindowManager
import android.widget.*
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.core.view.children
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.withResumed
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.progressindicator.LinearProgressIndicator
import io.github.rafaelhschuh.litera.R
import io.github.rafaelhschuh.litera.ServerOrigin
import io.github.rafaelhschuh.litera.data.*
import kotlinx.coroutines.*
import org.json.JSONObject
import java.io.IOException

/** Owns Android controls/lifecycle; engines receive private files, never API credentials. */
class NativeReaderActivity : AppCompatActivity() {
    private lateinit var repository: LiteraRepository
    private lateinit var root: LinearLayout
    private lateinit var container: FrameLayout
    private lateinit var toolbar: MaterialToolbar
    private lateinit var loading: LinearProgressIndicator
    private lateinit var status: TextView
    private lateinit var location: TextView
    private lateinit var previous: MaterialButton
    private lateinit var next: MaterialButton
    private var book: NativeBook? = null
    private var prefs = NativePreferences()
    private var remote: NativeProgress? = null
    private var engine: ReaderEngine? = null
    private var saveJob: Job? = null
    private var openJob: Job? = null
    private var conflict = false
    private var changingPosition = false
    private var ready = false
    private var awake = true
    private val padding get() = resources.getDimensionPixelSize(R.dimen.space_4)

    override fun onCreate(savedInstanceState: Bundle?) {
        // Readium's factory needs an asynchronously opened publication. Rebuild only
        // this engine tree from our durable locator instead of restoring its fragments
        // before that factory exists. Rotation is handled without recreating the engine.
        super.onCreate(null)
        enableEdgeToEdge(SystemBarStyle.auto(android.graphics.Color.TRANSPARENT,android.graphics.Color.TRANSPARENT))
        val origin = runCatching { ServerOrigin.parse(intent.getStringExtra("server-origin").orEmpty(),true) }.getOrNull()
        val id = intent.getIntExtra("book-id",0)
        if(origin == null || id <= 0) { Toast.makeText(this,R.string.reader_invalid,Toast.LENGTH_LONG).show(); finish(); return }
        repository = LiteraRepository(applicationContext,origin)
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(ContextCompat.getColor(this@NativeReaderActivity,R.color.litera_background)) }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view,insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(bars.left,bars.top,bars.right,bars.bottom); insets
        }
        toolbar = MaterialToolbar(this).apply {
            setTitle(R.string.app_name); setNavigationIcon(R.drawable.ic_native_back)
            navigationContentDescription = getString(R.string.native_back)
            setNavigationOnClickListener { finish() }
            menu.add(R.string.reader_contents).setIcon(R.drawable.ic_native_library).apply { setShowAsAction(android.view.MenuItem.SHOW_AS_ACTION_IF_ROOM); setOnMenuItemClickListener { contents(); true } }
            menu.add(R.string.reader_appearance).setIcon(R.drawable.ic_native_settings).apply { setShowAsAction(android.view.MenuItem.SHOW_AS_ACTION_IF_ROOM); setOnMenuItemClickListener { appearance(); true } }
        }
        loading = LinearProgressIndicator(this).apply { isIndeterminate = true }
        status = TextView(this).apply { setText(R.string.reader_loading); setPadding(padding,padding/2,padding,padding/2); accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE; setTextColor(ContextCompat.getColor(context,R.color.litera_text)) }
        container = FrameLayout(this).apply { this.id = R.id.reader_container }
        location = TextView(this).apply { this.id = R.id.reader_location; gravity = android.view.Gravity.CENTER; setPadding(padding,0,padding,0); setTextColor(ContextCompat.getColor(context,R.color.litera_text)) }
        val navigation = LinearLayout(this).apply { gravity = android.view.Gravity.CENTER_VERTICAL }
        previous = MaterialButton(this).apply { setText(R.string.native_previous); setOnClickListener { engine?.previous() } }
        next = MaterialButton(this).apply { this.id = R.id.reader_next; setText(R.string.native_next); setOnClickListener { engine?.next() } }
        navigation.addView(previous); navigation.addView(location,LinearLayout.LayoutParams(0,-2,1f)); navigation.addView(next)
        root.addView(toolbar,LinearLayout.LayoutParams(-1,-2)); root.addView(loading,LinearLayout.LayoutParams(-1,-2))
        root.addView(status,LinearLayout.LayoutParams(-1,-2)); root.addView(container,LinearLayout.LayoutParams(-1,0,1f)); root.addView(navigation,LinearLayout.LayoutParams(-1,-2))
        setContentView(root)
        awake = getSharedPreferences("litera-host",MODE_PRIVATE).getBoolean("reader-awake",true)
        controls(false)
        open(id)
    }
    private fun controls(enabled: Boolean) { previous.isEnabled = enabled; next.isEnabled = enabled; toolbar.menu.children.forEach { it.isEnabled = enabled } }
    private fun open(id: Int) {
        openJob?.cancel()
        openJob = lifecycleScope.launch {
            try {
                repository.session()
                book = repository.book(id)
                prefs = repository.preferences()
                palette(prefs)
                remote = repository.progress(id)
                val current = book ?: return@launch
                val previousFile = repository.lastReadFileRevision(id)
                if((previousFile != null && previousFile != current.fileRevision) || (remote != null && remote!!.format.isNotBlank() && remote!!.format != current.format)) {
                    fileChanged(id)
                } else continueOpening(id)

            } catch(cancelled: CancellationException) { throw cancelled }
            catch(error: Exception) { showFailure(error.message ?: getString(R.string.reader_error)) }
        }
    }
    private fun fileChanged(id: Int) {
        MaterialAlertDialogBuilder(dialogContext()).setTitle(R.string.reader_file_changed).setMessage(R.string.reader_file_changed_note).setCancelable(false)
            .setPositiveButton(R.string.reader_restart) { _,_ ->
                lifecycleScope.launch {
                    try { repository.discardProgressDraft(id); openEngine(null) }
                    catch(error: Exception) { showFailure(error.message ?: getString(R.string.reader_error)) }
                }
            }.setNeutralButton(R.string.reader_restore) { _,_ -> lifecycleScope.launch {
                try { continueOpening(id) } catch(error: Exception) { showFailure(error.message ?: getString(R.string.reader_error)) }
            } }.setNegativeButton(R.string.reader_return) { _,_ -> finish() } .also(::showDialog)
    }
    private suspend fun continueOpening(id: Int) {
        val pending = repository.pendingProgress(id)
        if(pending != null) {
            try { remote = repository.flushProgress(id) ?: remote }
            catch(error: ApiFailure) { if(error.status == 409) { resolveConflict(starting = true); return } else throw error }
            catch(_: IOException) { remote = pending; status.setText(R.string.reader_pending) }
        }
        openEngine(remote)
    }

    private suspend fun openEngine(position: NativeProgress?) {
        lifecycle.withResumed {
            ready = false; changingPosition = true
            engine?.close(); engine = null
            supportFragmentManager.findFragmentById(container.id)?.let { supportFragmentManager.beginTransaction().remove(it).commitNow() }
            container.removeAllViews()
        }
        val current = book ?: return
        val file = repository.content(current)
        toolbar.title = current.title
        engine = if(current.format == "epub") {
            EpubReaderEngine.open(this,container.id,file,repository.chapters(current.id),position,prefs,::positionChanged,::readerError)
        } else {
            PdfReaderEngine(this,container,file,position,prefs,::positionChanged,::readerError)
        }
        repository.rememberReadFile(current)
        changingPosition = false; ready = true
        controls(true); loading.visibility = View.GONE
        if(!conflict) status.visibility = View.GONE
        engine?.position()?.let(::positionChanged)
        updateAwake()
    }
    private fun positionChanged(position: ReaderPosition) {
        location.text = position.label
        if(!ready || changingPosition) return
        val current = book ?: return
        try { repository.stageProgress(current,position.locator,position.ratio,remote?.revision) }
        catch(error: Exception) { readerError(error.message ?: getString(R.string.reader_error)); return }
        if(conflict) return
        saveJob?.cancel()
        saveJob = lifecycleScope.launch { delay(800); flush() }
    }
    private suspend fun flush() {
        val current = book ?: return
        try {
            repository.flushProgress(current.id)?.let { remote = it }
            if(!conflict) status.visibility = View.GONE
        } catch(cancelled: CancellationException) { throw cancelled }
        catch(error: ApiFailure) {
            if(error.status == 409) {
                conflict = true; status.setText(R.string.reader_sync_conflict); status.visibility = View.VISIBLE
                status.setOnClickListener { resolveConflict(false) }
            } else readerError(error.message)
        } catch(_: IOException) { status.setText(R.string.reader_pending); status.visibility = View.VISIBLE }
        catch(error: Exception) { readerError(error.message ?: getString(R.string.reader_error)) }
    }
    private fun resolveConflict(starting: Boolean) {
        saveJob?.cancel(); conflict = true; controls(false)
        lifecycleScope.launch {
            try {
                val current = book ?: return@launch
                val server = repository.progress(current.id)
                MaterialAlertDialogBuilder(dialogContext())
                    .setTitle(R.string.reader_conflict).setMessage(R.string.reader_conflict_note).setCancelable(false)
                    .setPositiveButton(R.string.reader_local) { _,_ ->
                        lifecycleScope.launch {
                            try {
                                val chosen = repository.keepLocalProgress(current.id,server?.revision ?: 0)
                                remote = chosen; conflict = false; status.setOnClickListener(null); status.visibility = View.GONE
                                if(starting) openEngine(chosen) else controls(true)
                            } catch(error: Exception) { showFailure(error.message ?: getString(R.string.reader_pending)) }
                        }
                    }
                    .setNeutralButton(R.string.reader_remote) { _,_ ->
                        lifecycleScope.launch {
                            try {
                                changingPosition = true
                                repository.discardProgressDraft(current.id)
                                remote = server; conflict = false; status.setOnClickListener(null); status.visibility = View.GONE
                                openEngine(server)
                            } catch(error: Exception) { showFailure(error.message ?: getString(R.string.reader_error)) }
                        }
                    }.setNegativeButton(R.string.reader_return) { _,_ -> finish() } .also(::showDialog)
            } catch(error: Exception) { showFailure(error.message ?: getString(R.string.reader_error)) }
        }
    }
    private fun effectiveTheme(value: NativePreferences) = if(book?.format == "pdf" && value.pdfInvert) "dark" else value.theme
    private fun palette(value: NativePreferences) {
        val theme = effectiveTheme(value)
        val dark = theme == "dark"
        val paper = ContextCompat.getColor(this,when(theme) { "dark" -> R.color.reader_paper_dark; "sepia" -> R.color.reader_paper_sepia; else -> R.color.reader_paper_light })
        val ink = ContextCompat.getColor(this,when(theme) { "dark" -> R.color.reader_ink_dark; "sepia" -> R.color.reader_ink_sepia; else -> R.color.reader_ink_light })
        root.setBackgroundColor(paper); toolbar.setBackgroundColor(paper)
        toolbar.setTitleTextColor(ink); toolbar.navigationIcon?.mutate()?.setTint(ink); toolbar.overflowIcon?.mutate()?.setTint(ink)
        toolbar.menu.children.forEach { it.icon?.mutate()?.setTint(ink) }
        status.setTextColor(ink); location.setTextColor(ink)
        val colors = dialogContext(value)
        val accent = ContextCompat.getColor(colors,R.color.litera_accent)
        val onAccent = ContextCompat.getColor(colors,R.color.litera_on_accent)
        listOf(previous,next).forEach { it.backgroundTintList = ColorStateList.valueOf(accent); it.setTextColor(onAccent) }
        enableEdgeToEdge(SystemBarStyle.auto(android.graphics.Color.TRANSPARENT,android.graphics.Color.TRANSPARENT) { dark },SystemBarStyle.auto(android.graphics.Color.TRANSPARENT,android.graphics.Color.TRANSPARENT) { dark })
        WindowInsetsControllerCompat(window,root).apply { isAppearanceLightStatusBars = !dark; isAppearanceLightNavigationBars = !dark }
    }
    private fun dialogContext(value: NativePreferences = prefs): ContextThemeWrapper {
        val configuration = Configuration(resources.configuration)
        configuration.uiMode = (configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or
            if(effectiveTheme(value) == "dark") Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO
        return ContextThemeWrapper(this,R.style.Theme_Litera).apply { applyOverrideConfiguration(configuration) }
    }

    private fun contents() {
        val chapters = engine?.chapters ?: return
        MaterialAlertDialogBuilder(dialogContext()).setTitle(R.string.reader_contents).setItems(chapters.map { it.title }.toTypedArray()) { _,index -> engine?.go(chapters[index].index) }.setNegativeButton(R.string.cancel,null) .also(::showDialog)
    }
    private fun appearance() {
        val current = book ?: return
        val context = dialogContext()
        val panel = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setPadding(padding,padding,padding,padding) }
        val themes = RadioGroup(context).apply { orientation = RadioGroup.HORIZONTAL }
        val values = arrayOf("light","sepia","dark")
        val labels = intArrayOf(R.string.reader_light,R.string.reader_sepia,R.string.reader_dark)
        values.forEachIndexed { index,value -> themes.addView(RadioButton(context).apply { id = index + 100; setText(labels[index]); isChecked = prefs.theme == value }) }
        val sizeLabel = TextView(context).apply { text = getString(R.string.reader_font,prefs.fontScale) }
        val scale = SeekBar(context).apply { min = 80; max = 140; progress = prefs.fontScale.coerceIn(80,140); setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?,progress: Int,fromUser: Boolean) { sizeLabel.text = getString(R.string.reader_font,progress) }
            override fun onStartTrackingTouch(seekBar: SeekBar?) {}
            override fun onStopTrackingTouch(seekBar: SeekBar?) {}
        }) }
        val invert = CheckBox(context).apply { setText(R.string.reader_invert); isChecked = prefs.pdfInvert }
        val keep = CheckBox(context).apply { setText(R.string.reader_awake); isChecked = awake }
        if(current.format == "epub") { panel.addView(themes); panel.addView(sizeLabel); panel.addView(scale) } else panel.addView(invert)
        panel.addView(keep)
        MaterialAlertDialogBuilder(dialogContext()).setTitle(R.string.reader_appearance).setView(panel)
            .setPositiveButton(R.string.reader_save) { _,_ ->
                awake = keep.isChecked; getSharedPreferences("litera-host",MODE_PRIVATE).edit { putBoolean("reader-awake",awake) }; updateAwake()
                val updated = prefs.copy(theme = values[(themes.checkedRadioButtonId - 100).coerceIn(0,2)],fontScale = scale.progress,pdfInvert = invert.isChecked)
                engine?.preferences(updated)
                palette(updated)
                lifecycleScope.launch {
                    try { prefs = repository.savePreferences(updated) }
                    catch(error: Exception) { engine?.preferences(prefs); palette(prefs); readerError(error.message ?: getString(R.string.reader_error)) }
                }
            }.setNegativeButton(R.string.cancel,null) .also(::showDialog)
    }
    private fun showDialog(builder: MaterialAlertDialogBuilder) {
        lifecycleScope.launch { lifecycle.withResumed { builder.show() } }
    }
    private fun readerError(message: String) { status.text = message; status.visibility = View.VISIBLE }
    private fun showFailure(message: String) {
        ready = false; loading.visibility = View.GONE; controls(false); readerError(message)
        MaterialAlertDialogBuilder(dialogContext()).setTitle(R.string.reader_error).setMessage(message).setPositiveButton(R.string.retry) { _,_ -> open(intent.getIntExtra("book-id",0)) }.setNegativeButton(R.string.reader_return) { _,_ -> finish() } .also(::showDialog)
    }
    private fun updateAwake() {
        if(awake && ready && lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
    override fun onResume() { super.onResume(); if(::root.isInitialized) updateAwake() }
    override fun onPause() {
        if(ready && !changingPosition && ::repository.isInitialized) engine?.position()?.let { position ->
            try {
                book?.let { repository.stageProgress(it,position.locator,position.ratio,remote?.revision) }
                if(!conflict) {
                    val repo = repository; val id = book?.id
                    if(id != null) PauseWriter.scope.launch { runCatching { repo.flushProgress(id) } }
                }
            } catch(_: Exception) { /* Normal foreground writes already expose storage failures. */ }
        }
        saveJob?.cancel(); window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        super.onPause()
    }
    override fun onDestroy() { ready = false; engine?.close(); engine = null; super.onDestroy() }
    private object PauseWriter { val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO) }
}
