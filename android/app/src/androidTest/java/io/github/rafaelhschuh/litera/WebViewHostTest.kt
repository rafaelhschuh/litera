package io.github.rafaelhschuh.litera

import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.view.WindowManager
import android.webkit.WebView
import android.widget.EditText
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.scrollTo
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.action.ViewActions.closeSoftKeyboard
import androidx.test.espresso.action.ViewActions.replaceText
import androidx.test.espresso.matcher.ViewMatchers.withId
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.net.ServerSocket
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/** The real platform WebView and host boundary, independent of the PWA fixtures. */
@RunWith(AndroidJUnit4::class)
class WebViewHostTest {
    private val host = WebViewHarness()
    private val servers = mutableListOf<FixtureServer>()
    @Before fun setup() = host.clearHostSettings()
    @After fun cleanup() { servers.forEach { it.close() } }
    private fun server() = FixtureServer().also { servers.add(it) }

    @Test fun httpRequiresConsentAndSpaNavigationBackAndThemeStayIntegrated() {
        val server = server()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            onView(withId(R.id.server_url)).perform(replaceText(server.origin),closeSoftKeyboard())
            onView(withId(R.id.server_connect)).perform(scrollTo(),click())
            scenario.onActivity { assertNotNull(it.findViewById<EditText>(R.id.server_url).error) }
            assertTrue("HTTP must not connect before explicit consent",server.requests.isEmpty())
            onView(withId(R.id.allow_http)).perform(scrollTo(),click())
            onView(withId(R.id.server_connect)).perform(scrollTo(),click())
            host.await("Fixture website did not load") { host.string(scenario,"document.title") == "Litera host fixture" }
            assertTrue(server.requests.contains("/"))
            host.js(scenario,"document.querySelector('#read').click()")
            host.await("SPA reader route did not load") { host.string(scenario,"location.pathname") == "/read/1" }
            host.await("Reader chrome did not follow page theme") {
                var matched = false
                scenario.onActivity {
                    val web = it.findViewById<WebView>(R.id.host_webview)
                    val parent = web.parent as android.view.View
                    matched = (parent.background as? ColorDrawable)?.color == Color.parseColor("#191D26") &&
                        !WindowInsetsControllerCompat(it.window,web).isAppearanceLightStatusBars
                }
                matched
            }
            var statusHeight = 0
            scenario.onActivity { activity ->
                statusHeight = androidx.core.view.ViewCompat.getRootWindowInsets(activity.window.decorView)
                    ?.getInsets(androidx.core.view.WindowInsetsCompat.Type.statusBars())?.top ?: 0
            }
            assertTrue("Status bar must be visible for its appearance check",statusHeight > 0)
            val screenshot = host.instrumentation.uiAutomation.takeScreenshot()!!
            assertEquals("The camera/status area must match the reading surface",Color.parseColor("#191D26"),screenshot.getPixel(screenshot.width/2,statusHeight/2))
            screenshot.recycle()
            host.screenshot("webview-host-reader-dark")
            host.js(scenario,"const dialog=document.createElement('div');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.id='fixture-dialog';document.body.append(dialog);document.addEventListener('keydown',event=>{if(event.key==='Escape')dialog.remove();},{once:true})")
            scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
            host.await("Android Back did not close the web dialog first") { host.js(scenario,"Boolean(document.querySelector('#fixture-dialog'))") == "false" }
            assertEquals("/read/1",host.string(scenario,"location.pathname"))
            scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
            host.await("Android Back did not navigate SPA history") { host.string(scenario,"location.pathname") == "/" }
            host.await("Theme contrast was not restored after Back") {
                var light = false
                scenario.onActivity { light = WindowInsetsControllerCompat(it.window,it.window.decorView).isAppearanceLightStatusBars }
                light
            }
        }
    }

    @Test fun profilePersistsSessionAndRouteAcrossActivityRecreationAndFreshHost() {
        val server = server()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            host.connect(server.origin)
            host.await("Fixture did not open") { host.string(scenario,"document.title") == "Litera host fixture" }
            host.js(scenario,"document.cookie='fixture_session=opaque-test-cookie; path=/; SameSite=Lax'; localStorage.setItem('fixture-position','chapter-2'); document.querySelector('#read').click()")
            host.await("Reader did not open") { host.string(scenario,"location.pathname") == "/read/1" }
            scenario.recreate()
            host.await("Recreation lost SPA route") { host.string(scenario,"location.pathname") == "/read/1" }
            assertEquals("chapter-2",host.string(scenario,"localStorage.getItem('fixture-position')"))
        }
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            host.await("Saved host did not reopen") { host.string(scenario,"document.title") == "Litera host fixture" }
            assertTrue(host.string(scenario,"document.cookie").contains("fixture_session=opaque-test-cookie"))
            assertEquals("chapter-2",host.string(scenario,"localStorage.getItem('fixture-position')"))
        }
    }

    @Test fun sameHostDifferentPortsHaveIndependentCookieAndLocalStorageProfiles() {
        val first = server(); val second = server()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            host.connect(first.origin)
            host.await("First origin did not load") { host.string(scenario,"document.title") == "Litera host fixture" }
            host.js(scenario,"document.cookie='fixture_session=first-origin; path=/'; localStorage.setItem('fixture-position','first-origin')")
        }
        host.clearHostSettings()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            host.connect(second.origin)
            host.await("Second origin did not load") { host.string(scenario,"document.title") == "Litera host fixture" }
            assertFalse("Cookies must be isolated even though cookie host matches",host.string(scenario,"document.cookie").contains("fixture_session"))
            assertEquals("null",host.js(scenario,"localStorage.getItem('fixture-position')"))
            host.js(scenario,"document.cookie='fixture_session=second-origin; path=/'")
        }
        host.clearHostSettings()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            host.connect(first.origin)
            host.await("First profile did not reopen") { host.string(scenario,"document.title") == "Litera host fixture" }
            assertTrue(host.string(scenario,"document.cookie").contains("fixture_session=first-origin"))
            assertEquals("first-origin",host.string(scenario,"localStorage.getItem('fixture-position')"))
        }
    }

    @Test fun iframeCannotCallHostBridgeAndPrivilegedNavigationIsBlocked() {
        val server = server()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            host.connect(server.origin)
            host.await("Fixture did not load") { host.string(scenario,"document.title") == "Litera host fixture" }
            host.js(scenario,"const f=document.createElement('iframe'); f.src='/attack'; document.body.append(f)")
            host.await("Attack frame did not load") { server.requests.contains("/attack") }
            host.await("Attack frame did not attempt its bridge call") { host.js(scenario,"Boolean(document.querySelector('iframe').contentWindow.attackFinished)") == "true" }
            // Same-origin frames can access the JavaScript object; the native
            // listener must additionally enforce isMainFrame and current URL.
            scenario.onActivity {
                assertTrue("An iframe opened privileged host settings",it.findViewById<WebView>(R.id.host_webview).hasWindowFocus())
                assertTrue(WindowInsetsControllerCompat(it.window,it.window.decorView).isAppearanceLightStatusBars)
            }
            host.js(scenario,"location.href='file:///etc/passwd'")
            android.os.SystemClock.sleep(400)
            assertEquals(server.origin + "/",host.string(scenario,"location.href"))
            scenario.onActivity {
                val settings = it.findViewById<WebView>(R.id.host_webview).settings
                assertFalse(settings.allowFileAccess)
                assertFalse(settings.allowContentAccess)
                assertFalse(settings.javaScriptCanOpenWindowsAutomatically)
            }
        }
    }

    @Test fun readerWakeLockFollowsForegroundLifecycleOnly() {
        val server = server()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            host.connect(server.origin)
            host.await("Fixture did not load") { host.string(scenario,"document.title") == "Litera host fixture" }
            host.js(scenario,"document.querySelector('#read').click()")
            host.await("Reader did not request wake flag") { awake(scenario) }
            scenario.moveToState(Lifecycle.State.CREATED)
            assertFalse("Paused reader must not keep screen awake",awake(scenario))
            scenario.moveToState(Lifecycle.State.RESUMED)
            host.await("Resumed reader did not restore awake preference") { awake(scenario) }
            assertTrue("Pause lifecycle must reach the PWA",host.js(scenario,"window.fixturePauses > 0") == "true")
            host.js(scenario,"history.back()")
            host.await("Catalog must not keep screen awake") { !awake(scenario) }
        }
    }

    @Test fun changingServerRestoresNativeSetupThemeAfterDarkReader() {
        val server = server()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            host.connect(server.origin)
            host.await("Fixture did not load") { host.string(scenario,"document.title") == "Litera host fixture" }
            host.js(scenario,"document.querySelector('#read').click()")
            host.await("Dark reader did not activate") { awake(scenario) }
            host.js(scenario,"window.LiteraAndroid.postMessage(JSON.stringify({type:'settings'}))")
            val dialog = androidx.test.espresso.matcher.RootMatchers.isDialog()
            val text = androidx.test.espresso.matcher.ViewMatchers.withText(R.string.host_change_server)
            onView(text).inRoot(dialog).perform(scrollTo(),click())
            onView(text).inRoot(dialog).perform(click())
            onView(withId(R.id.server_url)).check(androidx.test.espresso.assertion.ViewAssertions.matches(androidx.test.espresso.matcher.ViewMatchers.isDisplayed()))
            scenario.onActivity { activity ->
                assertNull(activity.findViewById<WebView>(R.id.host_webview))
                val dark = activity.resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK == android.content.res.Configuration.UI_MODE_NIGHT_YES
                assertEquals(!dark,WindowInsetsControllerCompat(activity.window,activity.window.decorView).isAppearanceLightStatusBars)
                assertEquals(androidx.core.content.ContextCompat.getColor(activity,R.color.litera_background),(activity.window.decorView.background as ColorDrawable).color)
            }
            assertFalse(awake(scenario))
        }
    }

    private fun awake(scenario: ActivityScenario<MainActivity>): Boolean {
        var awake = false
        scenario.onActivity { awake = it.window.attributes.flags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON != 0 }
        return awake
    }

    private class FixtureServer : AutoCloseable {
        private val socket = ServerSocket(0)
        private val stopped = AtomicBoolean(false)
        val requests = ConcurrentLinkedQueue<String>()
        val origin get() = "http://127.0.0.1:${socket.localPort}"
        private val worker = thread(name="litera-webview-fixture",isDaemon=true) {
            while(!stopped.get()) {
                val client = try { socket.accept() } catch(_: Exception) { break }
                client.use { connection ->
                    connection.soTimeout = 5000
                    val reader = connection.getInputStream().bufferedReader()
                    val request = reader.readLine() ?: return@use
                    val path = request.split(' ').getOrNull(1) ?: "/"
                    while(!reader.readLine().isNullOrEmpty()) { /* consume headers */ }
                    requests.add(path)
                    val body = if(path == "/attack") """<!doctype html><script>try { LiteraAndroid.postMessage(JSON.stringify({type:'settings'})); LiteraAndroid.postMessage(JSON.stringify({type:'state',color:'#FF0000',dark:true,reader:true})); } finally { window.attackFinished=true; }</script>""" else PAGE
                    val bytes = body.toByteArray()
                    connection.getOutputStream().apply {
                        write("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n".toByteArray())
                        write(bytes); flush()
                    }
                }
            }
        }
        override fun close() { stopped.set(true); socket.close(); worker.join(2000) }
        companion object {
            val PAGE = """<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#F7F3ED"><title>Litera host fixture</title><style>body{font:18px sans-serif;margin:24px}button{padding:16px}body.dark{background:#191D26;color:#F7F3ED}</style></head><body><h1 id="title">Biblioteca WebView</h1><button id="read">Ler livro</button><script>
window.fixturePauses=0;addEventListener('litera-host-pause',()=>window.fixturePauses++);function paint(){const dark=location.pathname.startsWith('/read/'); document.body.classList.toggle('dark',dark); document.documentElement.style.colorScheme=dark?'dark':'light';document.documentElement.dataset.theme=dark?'dark':'light';document.querySelector('meta[name=theme-color]').content=dark?'#191D26':'#F7F3ED'; document.querySelector('#title').textContent=dark?'Leitura WebView':'Biblioteca WebView';}
document.querySelector('#read').onclick=()=>{history.pushState({},'', '/read/1');paint();};addEventListener('popstate',paint);paint();</script></body></html>"""
        }
    }
}
