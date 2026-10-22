package io.github.rafaelhschuh.litera

import io.github.rafaelhschuh.litera.data.LiteraRepository
import kotlinx.coroutines.runBlocking
import android.os.SystemClock
import android.widget.EditText
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry
import androidx.test.runner.lifecycle.Stage
import io.github.rafaelhschuh.litera.reader.NativeReaderActivity
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.atomic.AtomicInteger
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import java.util.zip.CRC32
import androidx.recyclerview.widget.RecyclerView
import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.action.ViewActions.closeSoftKeyboard
import androidx.test.espresso.action.ViewActions.replaceText
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.isAssignableFrom
import androidx.test.espresso.matcher.ViewMatchers.isDisplayed
import androidx.test.espresso.matcher.ViewMatchers.withId
import androidx.test.espresso.matcher.ViewMatchers.withContentDescription
import androidx.test.espresso.matcher.ViewMatchers.withText
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertSame
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.net.ServerSocket
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/** Native Views + loopback API integration. Real publication/device gates are separate. */
@RunWith(AndroidJUnit4::class)
class NativeHostTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private lateinit var server: ServerSocket
    private lateinit var serverThread: Thread
    private val stopped = AtomicBoolean(false)
    private val rejectLogin = AtomicBoolean(false)
    private val format = AtomicReference("epub")
    private val progressBody = AtomicReference<JSONObject?>(null)
    private val settings = AtomicReference(JSONObject("""{"theme":"light","fontScale":100,"lineHeight":"normal","margins":"normal","appTheme":"system","reducedMotion":false,"pdfInvert":false}"""))
    private val revision = AtomicInteger(0)
    private val fixtureBook get() = BOOK.replace("\"format\":\"epub\"", "\"format\":\"${format.get()}\"")
    private val requests = ConcurrentLinkedQueue<Request>()
    private val origin get() = "http://127.0.0.1:${server.localPort}"

    @Before fun setup() {
        val context = instrumentation.targetContext
        // Only this app's instrumentation sandbox is reset; no shared browser profile exists.
        context.dataDir.resolve("shared_prefs").listFiles()?.forEach { file ->
            context.getSharedPreferences(file.nameWithoutExtension, 0).edit().clear().commit()
        }
        server = ServerSocket(0)
        serverThread = thread(name = "litera-native-api-fixture", isDaemon = true) {
            while (!stopped.get()) {
                val socket = try { server.accept() } catch (_: Exception) { break }
                socket.use { connection ->
                    connection.soTimeout = 5000
                    val reader = connection.getInputStream().bufferedReader(Charsets.UTF_8)
                    val requestLine = reader.readLine() ?: return@use
                    val fields = requestLine.split(' ')
                    val headers = mutableMapOf<String, String>()
                    while (true) {
                        val header = reader.readLine() ?: break
                        if (header.isEmpty()) break
                        val colon = header.indexOf(':')
                        if (colon > 0) headers[header.substring(0, colon).lowercase()] = header.substring(colon + 1).trim()
                    }
                    val chars = CharArray(headers["content-length"]?.toIntOrNull() ?: 0)
                    var read = 0
                    while (read < chars.size) {
                        val count = reader.read(chars, read, chars.size - read)
                        if (count < 0) break
                        read += count
                    }
                    val request = Request(fields[0], fields[1], headers, String(chars, 0, read))
                    requests.add(request)
                    val response = respond(request)
                    val bytes = response.binary ?: response.body.toByteArray(Charsets.UTF_8)
                    connection.getOutputStream().apply {
                        write(("HTTP/1.1 ${response.status} ${if (response.status == 200) "OK" else "Error"}\r\n" +
                            "Content-Type: ${response.mime}\r\nContent-Length: ${bytes.size}\r\n" +
                            response.headers + "Connection: close\r\n\r\n").toByteArray(Charsets.UTF_8))
                        write(bytes)
                        flush()
                    }
                }
            }
        }
    }

    @After fun teardown() {
        instrumentation.runOnMainSync {
            Stage.entries.flatMap { ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(it) }.distinct().filterIsInstance<NativeReaderActivity>().forEach { it.finish() }
        }
        stopped.set(true)
        server.close()
        serverThread.join(2000)
    }

    @Test fun explicitHttpConsentNativeLoginAndCatalogSurviveActivityRecreation() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            onView(withId(R.id.server_url)).perform(replaceText(origin), closeSoftKeyboard())
            onView(withId(R.id.server_connect)).perform(click())
            scenario.onActivity { assertNotNull(it.findViewById<EditText>(R.id.server_url).error) }
            assertTrue("HTTP must not connect without consent", requests.isEmpty())
            onView(withId(R.id.allow_http)).perform(click())
            onView(withId(R.id.server_connect)).perform(click())
            awaitView(R.id.username)
            assertTrue(requests.any { it.path == "/api/v1/auth/me" && !it.authenticated })
            onView(withId(R.id.username)).perform(replaceText("fixture-reader"), closeSoftKeyboard())
            onView(withId(R.id.password)).perform(replaceText("fixture-password"), closeSoftKeyboard())
            onView(withId(R.id.login_submit)).perform(click())
            awaitCatalog()
            screenshot("catalog")
            val login = requests.first { it.path == "/api/v1/auth/login" }
            assertEquals("POST", login.method)
            assertEquals("fixture-reader", JSONObject(login.body).getString("username"))
            assertTrue(requests.any { it.path.substringBefore('?') in setOf("/api/v1/books", "/api/v1/home") && it.authenticated })
            scenario.recreate()
            awaitCatalog()
        }
        // A separate client proves encrypted disk hydration, independent of the
        // process-wide repository shared by production screens.
        val canonical = ServerOrigin.parse(origin,true)
        val shared = LiteraRepository.forOrigin(instrumentation.targetContext,canonical)
        assertSame(shared,LiteraRepository.forOrigin(instrumentation.targetContext,ServerOrigin.parse(origin + "/",true)))
        val fresh = LiteraRepository(instrumentation.targetContext,canonical)
        assertEquals(shared.user?.id,runBlocking { fresh.session() }.id)
        val previousSessionChecks = requests.count { it.path == "/api/v1/auth/me" }
        ActivityScenario.launch(MainActivity::class.java).use {
            awaitCatalog()
            await { requests.count { it.path == "/api/v1/auth/me" } > previousSessionChecks }
            assertTrue(requests.last { it.path == "/api/v1/auth/me" }.authenticated)
            assertFalse("Native application must not request the website", requests.any { it.path == "/" })
        }
    }

    @Test fun rejectedLoginKeepsNativeFormAndDoesNotRequestPrivateCatalog() {
        rejectLogin.set(true)
        ActivityScenario.launch(MainActivity::class.java).use {
            onView(withId(R.id.server_url)).perform(replaceText(origin), closeSoftKeyboard())
            onView(withId(R.id.allow_http)).perform(click())
            onView(withId(R.id.server_connect)).perform(click())
            awaitView(R.id.username)
            onView(withId(R.id.username)).perform(replaceText("fixture-reader"), closeSoftKeyboard())
            onView(withId(R.id.password)).perform(replaceText("incorrect"), closeSoftKeyboard())
            onView(withId(R.id.login_submit)).perform(click())
            await { requests.any { request -> request.path == "/api/v1/auth/login" } }
            await {
                try { onView(withText(R.string.native_invalid_login)).check(matches(isDisplayed())); true }
                catch (_: AssertionError) { false }
                catch (_: androidx.test.espresso.NoMatchingViewException) { false }
            }
            onView(withId(R.id.username)).check(matches(isDisplayed()))
            assertFalse(requests.any { request -> request.path.substringBefore('?') in setOf("/api/v1/books", "/api/v1/home") })
        }
    }

    @Test fun realEpubEngineRendersSanitizedPublicationAndSavesSecondChapterLocator() {
        ActivityScenario.launch(MainActivity::class.java).use {
            signInAndOpen()
            awaitView(R.id.reader_next)
            val text = AtomicReference("")
            await {
                instrumentation.runOnMainSync {
                    val activity = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).filterIsInstance<NativeReaderActivity>().firstOrNull()
                    val web = activity?.findViewById<View>(R.id.reader_container)?.let(::webView)
                    web?.evaluateJavascript("document.body.innerText") { value -> text.set(value) }
                }
                text.get().contains("Native EPUB chapter one")
            }
            assertFalse(text.get().contains("COMPROMISED"))
            val publicationFragment = AtomicReference<Any?>()
            instrumentation.runOnMainSync {
                val reader = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).filterIsInstance<NativeReaderActivity>().single()
                publicationFragment.set(reader.supportFragmentManager.findFragmentById(R.id.reader_container))
            }
            onView(withContentDescription(R.string.reader_appearance)).perform(click())
            onView(withText(R.string.reader_dark)).perform(click())
            onView(withText(R.string.reader_save)).perform(click())
            await { settings.get().optString("theme") == "dark" }
            instrumentation.runOnMainSync {
                val reader = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).filterIsInstance<NativeReaderActivity>().single()
                assertSame(publicationFragment.get(),reader.supportFragmentManager.findFragmentById(R.id.reader_container))
                val nativeRoot = reader.findViewById<View>(R.id.reader_container).parent as View
                assertEquals(androidx.core.content.ContextCompat.getColor(reader,R.color.reader_paper_dark),(nativeRoot.background as android.graphics.drawable.ColorDrawable).color)
                assertFalse(androidx.core.view.WindowInsetsControllerCompat(reader.window,nativeRoot).isAppearanceLightStatusBars)
            }
            onView(withId(R.id.reader_next)).perform(click())
            await { requests.any { request -> request.method == "PUT" && request.path.endsWith("/progress") && JSONObject(request.body).getJSONObject("locator").optString("chapterHref") == "chapter-2.xhtml" } }
            screenshot("epub-dark")
            val saved = JSONObject(requests.last { request -> request.method == "PUT" && request.path.endsWith("/progress") }.body).getJSONObject("locator")
            assertEquals("epub-cfi",saved.getString("type"))
            assertTrue(saved.getDouble("chapterProgression").isFinite())
            recreateReader()
            val restored = AtomicReference("")
            await {
                instrumentation.runOnMainSync {
                    val activity = ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).filterIsInstance<NativeReaderActivity>().firstOrNull()
                    activity?.findViewById<View>(R.id.reader_container)?.let(::webView)?.evaluateJavascript("document.body.innerText") { value -> restored.set(value) }
                }
                restored.get().contains("Native EPUB chapter two")
            }
        }
    }

    @Test fun realPdfRendererMovesPagesAndSavesPageLocator() {
        format.set("pdf")
        ActivityScenario.launch(MainActivity::class.java).use {
            signInAndOpen()
            awaitView(R.id.reader_next)
            await { try { onView(withId(R.id.reader_location)).check(matches(withText("Página 1 de 2"))); true } catch(_: AssertionError) { false } }
            onView(withId(R.id.reader_next)).perform(click())
            await { try { onView(withId(R.id.reader_location)).check(matches(withText("Página 2 de 2"))); true } catch(_: AssertionError) { false } }
            await { requests.any { request -> request.method == "PUT" && request.path.endsWith("/progress") && JSONObject(request.body).getJSONObject("locator").optInt("page") == 2 } }
            screenshot("pdf-page-2")
            recreateReader()
            await { try { onView(withId(R.id.reader_location)).check(matches(withText("Página 2 de 2"))); true } catch(_: AssertionError) { false } }

        }
    }

    private fun screenshot(name: String) {
        val bitmap = instrumentation.uiAutomation.takeScreenshot() ?: return
        val folder = java.io.File(instrumentation.targetContext.getExternalFilesDir(null),"test-screenshots").apply { mkdirs() }
        java.io.File(folder,"$name.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it) }
        bitmap.recycle()
    }

    private fun recreateReader() {
        instrumentation.runOnMainSync {
            ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED).filterIsInstance<NativeReaderActivity>().single().recreate()
        }
    }
    private fun signInAndOpen() {
        onView(withId(R.id.server_url)).perform(replaceText(origin),closeSoftKeyboard())
        onView(withId(R.id.allow_http)).perform(click())
        onView(withId(R.id.server_connect)).perform(click())
        awaitView(R.id.username)
        onView(withId(R.id.username)).perform(replaceText("fixture-reader"),closeSoftKeyboard())
        onView(withId(R.id.password)).perform(replaceText("fixture-password"),closeSoftKeyboard())
        onView(withId(R.id.login_submit)).perform(click())
        awaitCatalog()
        onView(withText(BOOK_TITLE)).perform(click())
        onView(withText(R.string.native_read)).perform(click())
    }
    private fun webView(view: View): WebView? {
        if(view is WebView) return view
        if(view is ViewGroup) for(index in 0 until view.childCount) webView(view.getChildAt(index))?.let { return it }
        return null
    }

    private fun awaitView(id: Int) = await {
        try { onView(withId(id)).check(matches(isDisplayed())); true } catch (_: AssertionError) { false }
        catch (_: androidx.test.espresso.NoMatchingViewException) { false }
    }

    private fun awaitCatalog() = await {
        try {
            onView(withText(BOOK_TITLE)).check(matches(isDisplayed()))
            onView(isAssignableFrom(RecyclerView::class.java)).check(matches(isDisplayed()))
            true
        } catch (_: AssertionError) { false }
        catch (_: androidx.test.espresso.NoMatchingViewException) { false }
    }

    private fun await(condition: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + 15_000
        while (SystemClock.uptimeMillis() < deadline) {
            if (condition()) return
            SystemClock.sleep(75)
        }
        throw AssertionError("Native UI/API condition not reached within 15 seconds")
    }

    private fun respond(request: Request): Response {
        val path = request.path.substringBefore('?')
        if (path == "/api/v1/auth/login") {
            if (rejectLogin.get()) return Response(401, """{"error":{"code":"INVALID_CREDENTIALS","message":"Username or password is incorrect"}}""")
            return Response(200, USER, "Set-Cookie: litera_session=native-fixture-session; Path=/; HttpOnly; SameSite=Lax\r\n")
        }
        if (!request.authenticated) return Response(401, """{"error":{"code":"UNAUTHENTICATED","message":"Authentication required"}}""")
        return when (path) {
            "/api/v1/auth/me" -> Response(200, USER)
            "/api/v1/settings" -> {
                if(request.method == "PUT") settings.set(JSONObject(request.body))
                Response(200,JSONObject().put("preferences",settings.get()).toString())
            }
            "/api/v1/home" -> Response(200, """{"continueReading":[],"recentlyAdded":[$fixtureBook]}""")
            "/api/v1/books" -> Response(200, """{"books":[$fixtureBook],"query":"","pagination":{"page":1,"pageSize":24,"total":1,"pages":1}}""")
            "/api/v1/books/1" -> Response(200, """{"book":$fixtureBook}""")
            "/api/v1/books/1/progress" -> {
                if(request.method == "PUT") {
                    val value = JSONObject(request.body).put("revision",revision.incrementAndGet())
                    progressBody.set(value)
                }
                Response(200,JSONObject().put("progress",progressBody.get() ?: JSONObject.NULL).toString())
            }
            "/api/v1/books/1/epub/manifest" -> Response(200,"""{"chapters":[{"href":"chapter-1.xhtml","label":"Chapter one"},{"href":"chapter-2.xhtml","label":"Chapter two"}]}""")
            "/api/v1/books/1/content" -> Response(200,"",binary = if(format.get() == "epub") epubFixture() else pdfFixture(),mime = if(format.get() == "epub") "application/epub+zip" else "application/pdf")
            "/api/v1/books/1/cover" -> Response(404, """{"error":{"code":"COVER_NOT_FOUND","message":"No cover"}}""")
            else -> Response(404, """{"error":{"code":"NOT_FOUND","message":"Fixture endpoint not found"}}""")
        }
    }

    private data class Request(val method: String, val path: String, val headers: Map<String, String>, val body: String) {
        val authenticated get() = headers["cookie"]?.split(';')?.any { it.trim() == "litera_session=native-fixture-session" } == true
    }
    private data class Response(val status: Int, val body: String, val headers: String = "", val binary: ByteArray? = null, val mime: String = "application/json; charset=utf-8")

    private fun epubFixture(): ByteArray {
        val bytes = ByteArrayOutputStream()
        ZipOutputStream(bytes).use { zip ->
            fun entry(path: String,body: String,stored: Boolean = false) {
                val data = body.toByteArray()
                val item = ZipEntry(path)
                if(stored) { item.method = ZipEntry.STORED; item.size = data.size.toLong(); item.compressedSize = item.size; item.crc = CRC32().apply { update(data) }.value }
                zip.putNextEntry(item); zip.write(data); zip.closeEntry()
            }
            entry("mimetype","application/epub+zip",true)
            entry("META-INF/container.xml","""<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>""")
            entry("OEBPS/package.opf","""<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">native-fixture</dc:identifier><dc:title>Native fixture</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-10-21T00:00:00Z</meta></metadata><manifest><item id="one" href="chapter-1.xhtml" media-type="application/xhtml+xml"/><item id="two" href="chapter-2.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>""")
            entry("OEBPS/nav.xhtml","""<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="chapter-1.xhtml">One</a></li><li><a href="chapter-2.xhtml">Two</a></li></ol></nav></body></html>""")
            for(number in 1..2) entry("OEBPS/chapter-$number.xhtml","""<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter $number</title><script>document.body.innerText='COMPROMISED';</script></head><body><h1>Native EPUB chapter ${if(number == 1) "one" else "two"}</h1><p>Publication rendered by Readium.</p></body></html>""")
        }
        return bytes.toByteArray()
    }
    private fun pdfFixture(): ByteArray {
        val output = ByteArrayOutputStream()
        fun write(value: String) { output.write(value.toByteArray(Charsets.US_ASCII)) }
        write("%PDF-1.4\n")
        val offsets = mutableListOf<Int>()
        val objects = listOf("<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>","BT /F1 16 Tf 30 330 Td (Native PDF page one) Tj ET","BT /F1 16 Tf 30 330 Td (Native PDF page two) Tj ET","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
        objects.forEachIndexed { index,value -> offsets.add(output.size()); write("${index+1} 0 obj\n"); if(index in 4..5) write("<< /Length ${value.length} >>\nstream\n$value\nendstream") else write(value); write("\nendobj\n") }
        val xref = output.size(); write("xref\n0 8\n0000000000 65535 f \n")
        offsets.forEach { write("%010d 00000 n \n".format(java.util.Locale.ROOT,it)) }
        write("trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n$xref\n%%EOF\n")
        return output.toByteArray()
    }

    companion object {
        private const val BOOK_TITLE = "Biblioteca nativa de teste"
        private const val USER = """{"user":{"id":1,"username":"fixture-reader","displayName":"Leitor de teste","role":"reader"}}"""
        private const val BOOK = """{"id":1,"title":"Biblioteca nativa de teste","author":"Autora de teste","description":"Livro de integração nativa","format":"epub","hasCover":false,"fileSize":1024,"fileRevision":"fixture-revision-1","genres":[],"favorite":false,"completed":false,"progressRatio":null,"locator":null}"""
    }
}
