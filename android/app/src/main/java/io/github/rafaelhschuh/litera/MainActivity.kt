package io.github.rafaelhschuh.litera

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.Icon
import android.net.Uri
import android.net.http.SslError
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.*
import android.widget.*
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.view.ContextThemeWrapper
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.core.net.toUri
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.widget.doAfterTextChanged
import androidx.webkit.*
import com.google.android.material.button.MaterialButton
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.progressindicator.LinearProgressIndicator
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import org.json.JSONObject
import java.io.ByteArrayInputStream

/** Android owns the window/lifecycle; the existing PWA owns all library and reading behavior. */
class MainActivity : AppCompatActivity() {
    private lateinit var root: FrameLayout
    private lateinit var progress: LinearProgressIndicator
    private val local by lazy { getSharedPreferences("litera-host",MODE_PRIVATE) }
    private var web: WebView? = null
    private var origin: ServerOrigin? = null
    private var cookies: CookieManager? = null
    private var appearance: HostState? = null
    private var errorPanel: View? = null
    private var foreground = false
    private var failed = false
    private var fullscreen: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var awake = true
    private val space get() = resources.getDimensionPixelSize(R.dimen.space_4)
    private val picker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val values = if(result.resultCode == RESULT_OK) {
            val data = result.data
            (data?.clipData?.let { clip -> (0 until clip.itemCount).map { clip.getItemAt(it).uri } }
                ?: listOfNotNull(data?.data)).filter { it.scheme == "content" }.toTypedArray().takeIf { it.isNotEmpty() }
        } else null
        fileCallback?.onReceiveValue(values); fileCallback = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(SystemBarStyle.auto(Color.TRANSPARENT,Color.TRANSPARENT))
        root = FrameLayout(this).apply { id = R.id.host_root; setBackgroundColor(color(R.color.litera_background)) }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view,insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left,bars.top,bars.right,bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        setContentView(root)
        awake = local.getBoolean("host-awake",true)
        installShortcut()
        onBackPressedDispatcher.addCallback(this,object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = back()
        })
        val saved = local.getString("origin",null)?.let { runCatching { ServerOrigin.parse(it,local.getBoolean("allow-http",false)) }.getOrNull() }
        if(saved == null) setup() else connect(saved,savedInstanceState)
        if(intent.getBooleanExtra("host-settings",false)) root.post { settings() }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent); setIntent(intent)
        if(intent.getBooleanExtra("host-settings",false)) settings()
    }
    private fun installShortcut() {
        val shortcut = ShortcutInfo.Builder(this,"server")
            .setShortLabel(getString(R.string.host_settings)).setIcon(Icon.createWithResource(this,R.mipmap.ic_launcher))
            .setIntent(Intent(this,MainActivity::class.java).setAction(Intent.ACTION_MAIN).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("host-settings",true)).build()
        runCatching { getSystemService(ShortcutManager::class.java).dynamicShortcuts = listOf(shortcut) }
    }
    private fun color(id: Int) = ContextCompat.getColor(this,id)
    private fun button(label: Int, context: android.content.Context = this, action: () -> Unit) = MaterialButton(context).apply {
        setText(label); minimumHeight = resources.getDimensionPixelSize(R.dimen.touch_target); setOnClickListener { action() }
    }
    private fun text(label: Int) = TextView(this).apply { setText(label); setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX,resources.getDimension(R.dimen.text_body)); setTextColor(color(R.color.litera_text)); setPadding(0,space/2,0,space/2) }
    private fun setup() {
        closeWeb()
        root.removeAllViews(); root.setBackgroundColor(color(R.color.litera_background))
        val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(space,space,space,space) }
        content.addView(ImageView(this).apply { setImageResource(R.mipmap.ic_launcher); importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO },LinearLayout.LayoutParams(space*5,space*5))
        content.addView(text(R.string.server_title).apply { setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX,resources.getDimension(R.dimen.text_section)) })
        content.addView(text(R.string.server_note))
        val wrapper = TextInputLayout(this).apply { hint = getString(R.string.server_url); boxBackgroundMode = TextInputLayout.BOX_BACKGROUND_OUTLINE }
        val address = TextInputEditText(wrapper.context).apply {
            id = R.id.server_url; inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI; setSingleLine(true)
            setText(origin?.value ?: local.getString("origin","")); hint = getString(R.string.server_hint)
        }
        wrapper.addView(address,LinearLayout.LayoutParams(-1,-2)); content.addView(wrapper,LinearLayout.LayoutParams(-1,-2))
        val http = CheckBox(this).apply { id = R.id.allow_http; setText(R.string.http_opt_in); isChecked = local.getBoolean("allow-http",false) }
        address.doAfterTextChanged { http.isChecked = false }
        content.addView(http); content.addView(text(R.string.http_note))
        content.addView(button(R.string.server_connect) {
            try { connect(ServerOrigin.parse(address.text.toString(),http.isChecked)) }
            catch(_: IllegalArgumentException) { address.error = getString(R.string.invalid_url) }
        }.apply { id = R.id.server_connect })
        root.addView(ScrollView(this).apply { isFillViewport = true; addView(content) },FrameLayout.LayoutParams(-1,-1))
    }

    @SuppressLint("SetJavaScriptEnabled") // The user-selected Litera PWA needs JavaScript; there is no privileged JS interface.
    private fun connect(value: ServerOrigin, saved: Bundle? = null) {
        closeWeb(); root.removeAllViews(); origin = value; failed = false
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE) || !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            showError(R.string.host_upgrade,update = true); return
        }
        local.edit { putString("origin",value.value); putBoolean("allow-http",value.scheme == "http") }
        val view = WebView(this)
        // Profile must precede every setting, script, cookie operation or navigation.
        if(WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
            WebViewCompat.setProfile(view,value.profileName)
            web = view; val profile = WebViewCompat.getProfile(view)
            cookies = profile.cookieManager
            view.id = R.id.host_webview
            view.settings.apply {
                javaScriptEnabled = true; domStorageEnabled = true
                allowFileAccess = false; allowContentAccess = false
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                javaScriptCanOpenWindowsAutomatically = false
                setSupportMultipleWindows(false)
                mediaPlaybackRequiresUserGesture = true
                cacheMode = WebSettings.LOAD_DEFAULT
                userAgentString += " LiteraAndroid/${BuildConfig.VERSION_NAME}"
        }
        cookies?.setAcceptThirdPartyCookies(view,false)
        profile.serviceWorkerController.setServiceWorkerClient(object : ServiceWorkerClient() {
            override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? = if(value.owns(request.url.toString())) null else blockedResource()
        })
        }
        if(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(view,"LiteraAndroid",setOf(value.value)) { source,message,sourceOrigin,isMainFrame,_ ->
                if(!isMainFrame || source !== web || !value.owns(sourceOrigin.toString()) || !trustedTop()) return@addWebMessageListener
                if(message.type != WebMessageCompat.TYPE_STRING) return@addWebMessageListener
                val data = message.data ?: return@addWebMessageListener
                if(data.length > 512) return@addWebMessageListener
                HostState.parse(data)?.let { applyAppearance(it); return@addWebMessageListener }
                if(runCatching { JSONObject(data).optString("type") }.getOrNull() == "settings") settings()
        }
        }
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                if(value.owns(url)) return false
                if(request.isForMainFrame && request.hasGesture()) external(request.url)
                return true
            }
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val scheme = request.url.scheme
                return if(scheme in listOf("data","blob","about") || value.owns(request.url.toString())) null else blockedResource()
            }
            override fun onPageStarted(view: WebView,url: String?,icon: Bitmap?) { failed = false; hideError(); progress.visibility = View.VISIBLE }
            override fun onPageCommitVisible(view: WebView,url: String?) { observe() }
            override fun onPageFinished(view: WebView,url: String?) {
                progress.visibility = View.GONE
                if(!failed && trustedTop()) { observe(); rememberPage() }
            }
            override fun onReceivedError(view: WebView,request: WebResourceRequest,error: WebResourceError) {
                if(request.isForMainFrame) { failed = true; showError(R.string.host_unavailable) }
            }
            override fun onReceivedHttpError(view: WebView,request: WebResourceRequest,response: WebResourceResponse) {
                if(request.isForMainFrame) { failed = true; showError(R.string.host_http_error) }
            }
            override fun onReceivedSslError(view: WebView,handler: SslErrorHandler,error: SslError) {
                handler.cancel(); failed = true; showError(R.string.host_tls_error)
            }
            override fun onRenderProcessGone(view: WebView,detail: RenderProcessGoneDetail): Boolean {
                rememberPage(); closeWeb(); root.removeAllViews(); showError(R.string.host_renderer_error); return true
            }
        }
        view.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView,value: Int) { if(value == 100 && ::progress.isInitialized) progress.visibility = View.GONE }
            override fun onPermissionRequest(request: PermissionRequest) = request.deny()
            override fun onGeolocationPermissionsShowPrompt(origin: String,callback: GeolocationPermissions.Callback) = callback.invoke(origin,false,false)
            override fun onShowCustomView(view: View,callback: CustomViewCallback) {
                if(fullscreen != null || !trustedTop()) { callback.onCustomViewHidden(); return }
                fullscreen = view; fullscreenCallback = callback; web?.visibility = View.GONE
                root.addView(view,FrameLayout.LayoutParams(-1,-1)); hideBars(true)
            }
            override fun onHideCustomView() = closeFullscreen()
            override fun onShowFileChooser(view: WebView,callback: ValueCallback<Array<Uri>>,params: FileChooserParams): Boolean {
                if(!trustedTop()) { callback.onReceiveValue(null); return true }
                fileCallback?.onReceiveValue(null); fileCallback = callback
                val types = params.acceptTypes.filter { Regex("^[a-zA-Z0-9.+-]+/(?:[a-zA-Z0-9.+-]+|\\*)$").matches(it) }
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(types.singleOrNull() ?: "*/*")
                    .putExtra(Intent.EXTRA_ALLOW_MULTIPLE,params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                if(types.size > 1) intent.putExtra(Intent.EXTRA_MIME_TYPES,types.toTypedArray())
                try { picker.launch(intent) } catch(_: ActivityNotFoundException) { callback.onReceiveValue(null); fileCallback = null }
                return true
            }
        }
        view.setDownloadListener { _,_,_,_,_ -> Toast.makeText(this,R.string.host_download,Toast.LENGTH_LONG).show() }
        root.addView(view,FrameLayout.LayoutParams(-1,-1))
        progress = LinearProgressIndicator(this).apply { isIndeterminate = true }
        root.addView(progress,FrameLayout.LayoutParams(-1,-2,android.view.Gravity.TOP))
        val initial = HostState(local.getInt("color-${value.profileName}",color(R.color.litera_background)),local.getBoolean("dark-${value.profileName}",resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES),false)
        applyAppearance(initial)
        if(saved?.getString("web-origin") == value.value && saved.getBundle("web-state")?.let { view.restoreState(it) } != null) return
        val previous = local.getString("page-${value.profileName}",null)?.takeIf { value.owns(it) } ?: value.value + "/"
        view.loadUrl(previous)
    }
    private fun trustedTop() = origin?.owns(web?.url.orEmpty()) == true
    private fun observe() { if(trustedTop()) web?.evaluateJavascript(HostScripts.observe,null) }
    private fun rememberPage() {
        val current = web?.url ?: return; val value = origin ?: return
        if(value.owns(current) && !failed) local.edit { putString("page-${value.profileName}",current) }
    }
    private fun applyAppearance(state: HostState) {
        appearance = state; root.setBackgroundColor(state.color); web?.setBackgroundColor(state.color)
        WindowInsetsControllerCompat(window,root).apply { isAppearanceLightStatusBars = !state.dark; isAppearanceLightNavigationBars = !state.dark }
        origin?.let { value -> local.edit { putInt("color-${value.profileName}",state.color); putBoolean("dark-${value.profileName}",state.dark) } }
        rememberPage(); updateAwake()
    }
    private fun dialogContext(): android.content.Context {
        val configuration = Configuration(resources.configuration)
        configuration.uiMode = (configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or if(appearance?.dark ?: (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES)) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO
        return ContextThemeWrapper(createConfigurationContext(configuration),R.style.Theme_Litera)
    }
    private fun settings() {
        val context = dialogContext()
        val panel = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setPadding(space,space,space,space) }
        panel.addView(TextView(context).apply { text = origin?.value.orEmpty() })
        val keep = CheckBox(context).apply { setText(R.string.host_awake); isChecked = awake; setOnCheckedChangeListener { _,checked -> awake = checked; local.edit { putBoolean("host-awake",checked) }; updateAwake() } }
        panel.addView(keep)
        panel.addView(TextView(context).apply { setText(R.string.host_settings_note) })
        val version = WebViewCompat.getCurrentWebViewPackage(this)?.versionName ?: "?"
        panel.addView(TextView(context).apply { text = getString(R.string.host_about,BuildConfig.VERSION_NAME,version) })
        val dialog = MaterialAlertDialogBuilder(context).setTitle(R.string.host_settings).setView(panel).setNegativeButton(R.string.cancel,null).create()
        panel.addView(button(R.string.host_change_server,context) {
            dialog.dismiss()
            MaterialAlertDialogBuilder(dialogContext()).setMessage(R.string.change_server_note).setPositiveButton(R.string.host_change_server) { _,_ -> pausePage(); setup() }.setNegativeButton(R.string.cancel,null).show()
        })
        panel.addView(button(R.string.menu_reload,context) { dialog.dismiss(); pausePage(); web?.reload() ?: origin?.let { connect(it) } })
        panel.addView(button(R.string.host_open_browser,context) { dialog.dismiss(); origin?.let { external((web?.url ?: it.value).toUri()) } })
        dialog.show()
    }
    private fun showError(message: Int, update: Boolean = false) {
        hideError(); if(::progress.isInitialized) progress.visibility = View.GONE
        val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(space,space,space,space); setBackgroundColor(color(R.color.litera_surface)) }
        content.addView(text(message))
        content.addView(button(if(update) R.string.host_update_webview else R.string.retry) {
            if(update) external("https://play.google.com/store/apps/details?id=com.google.android.webview".toUri())
            else { hideError(); if(web != null) web?.reload() else origin?.let { connect(it) } }
        })
        content.addView(button(R.string.menu_server) { settings() })
        errorPanel = content; root.addView(content,FrameLayout.LayoutParams(-1,-2,android.view.Gravity.BOTTOM))
        content.accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
    }
    private fun hideError() { errorPanel?.let(root::removeView); errorPanel = null }
    private fun external(uri: Uri) {
        if(!runCatching { ServerOrigin.parse("${uri.scheme}://${uri.encodedAuthority}",true) }.isSuccess || uri.scheme !in listOf("http","https")) return
        try { startActivity(Intent(Intent.ACTION_VIEW,uri).addCategory(Intent.CATEGORY_BROWSABLE)) } catch(_: ActivityNotFoundException) { Toast.makeText(this,R.string.host_unavailable,Toast.LENGTH_LONG).show() }
    }
    private fun back() {
        if(fullscreen != null) { closeFullscreen(); return }
        val current = web
        if(current == null) { finish(); return }
        if(!trustedTop()) { if(current.canGoBack()) current.goBack() else finish(); return }
        current.evaluateJavascript(HostScripts.back) { result ->
            if(current !== web || isFinishing || isDestroyed || result == "\"handled\"") return@evaluateJavascript
            pausePage()
            if(current.canGoBack()) current.goBack()
            else if(appearance?.reader == true) current.loadUrl(origin!!.value + "/library")
            else finish()
        }
    }
    private fun hideBars(hidden: Boolean) {
        WindowInsetsControllerCompat(window,root).apply {
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            if(hidden) hide(WindowInsetsCompat.Type.systemBars()) else show(WindowInsetsCompat.Type.systemBars())
        }
    }
    private fun closeFullscreen() {
        fullscreen?.let(root::removeView); fullscreen = null
        val callback = fullscreenCallback; fullscreenCallback = null; callback?.onCustomViewHidden()
        web?.visibility = View.VISIBLE; hideBars(false)
    }
    private fun pausePage() { if(trustedTop()) web?.evaluateJavascript(HostScripts.pause,null); rememberPage(); cookies?.flush() }
    private fun updateAwake() {
        if(foreground && awake && appearance?.reader == true && web != null) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
    override fun onResume() { super.onResume(); foreground = true; web?.onResume(); if(trustedTop()) web?.evaluateJavascript(HostScripts.resume,null); updateAwake() }
    override fun onPause() { foreground = false; pausePage(); updateAwake(); web?.onPause(); super.onPause() }
    override fun onSaveInstanceState(outState: Bundle) {
        pausePage(); val state = Bundle(); web?.saveState(state)
        outState.putString("web-origin",origin?.value); outState.putBundle("web-state",state)
        super.onSaveInstanceState(outState)
    }
    override fun onConfigurationChanged(newConfig: Configuration) { super.onConfigurationChanged(newConfig); if(web == null) setup() else { observe(); ViewCompat.requestApplyInsets(root) } }
    private fun closeWeb() {
        fileCallback?.onReceiveValue(null); fileCallback = null
        closeFullscreen()
        val current = web; web = null; cookies?.flush(); cookies = null
        current?.let { (it.parent as? ViewGroup)?.removeView(it); it.stopLoading(); it.destroy() }
        appearance = null; updateAwake()
    }
    override fun onDestroy() { closeWeb(); super.onDestroy() }
}

// The profile retains its SW client: this helper must not capture an Activity.
private fun blockedResource() = WebResourceResponse("text/plain","UTF-8",403,"Blocked",emptyMap(),ByteArrayInputStream(ByteArray(0)))
