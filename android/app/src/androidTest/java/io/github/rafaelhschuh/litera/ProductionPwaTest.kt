package io.github.rafaelhschuh.litera

import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Runs the built Vue/PDF.js/EPUB PWA against the real server and SQLite API. */
@RunWith(AndroidJUnit4::class)
class ProductionPwaTest {
    @Test fun realLoginCatalogEpubAndPdfSaveFormatAwareProgressInWebView() {
        val origin = InstrumentationRegistry.getArguments().getString("literaServer")
        assumeTrue("Pass literaServer and adb reverse the real e2e server to enable this gate",origin != null)
        val host = WebViewHarness()
        host.clearHostSettings()
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            host.connect(origin!!)
            host.await("Production login did not render",30_000) { host.js(scenario,"Boolean(document.querySelector('#username'))") == "true" }
            host.js(scenario,"""for (const [id,value] of [['username','admin'],['password','test-password-strong-123']]) { const field=document.getElementById(id);field.value=value;field.dispatchEvent(new Event('input',{bubbles:true})); } document.querySelector('form').requestSubmit();""")
            host.await("Real authentication did not reach the catalog",30_000) { host.string(scenario,"location.pathname") == "/" && host.js(scenario,"Boolean(document.querySelector('a[href=\"/library\"]'))") == "true" }
            host.js(scenario,"document.querySelector('a[href=\"/library\"]').click()")
            host.await("Real library fixtures did not render") { host.string(scenario,"location.pathname") == "/library" && host.string(scenario,"document.querySelector('h1')?.textContent") == "Biblioteca" && host.string(scenario,"document.body.innerText").contains("A Ilha de Teste") }
            host.screenshot("pwa-webview-library")
            host.js(scenario,"Array.from(document.querySelectorAll('a')).find(a=>a.textContent.includes('A Ilha de Teste')).click()")
            host.await("EPUB details did not open") { host.js(scenario,"Boolean(document.querySelector('a[href^=\"/read/\"]'))") == "true" }
            val epubId = host.string(scenario,"location.pathname.split('/').pop()")
            host.js(scenario,"document.querySelector('a[href^=\"/read/\"]').click()")
            host.await("Production EPUB did not render its real chapter",40_000) {
                host.string(scenario,"document.querySelector('.epub-stage:not(.epub-stage--preparing)')?.contentDocument?.body?.innerText || ''").contains("Conteúdo real") &&
                    host.string(scenario,"document.querySelector('.reader-stage')?.getAttribute('aria-busy')") == "false"
            }
            host.screenshot("pwa-webview-epub")
            host.js(scenario,"document.querySelector('[aria-label=\"Avançar na leitura\"]').click()")
            val epubProgress = awaitProgress(host,scenario,epubId,"epub-cfi",true)
            assertTrue(epubProgress.getJSONObject("locator").has("chapterHref"))
            assertTrue(epubProgress.getJSONObject("locator").has("elementIndex"))
            val readerUrl = host.string(scenario,"location.href")
            scenario.recreate()
            host.await("Recreated WebView lost the EPUB route",40_000) { host.string(scenario,"location.href") == readerUrl && host.string(scenario,"document.querySelector('.epub-stage:not(.epub-stage--preparing)')?.contentDocument?.body?.innerText || ''").contains("Conteúdo real") }
            scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
            host.await("Android Back did not return to book details") { host.string(scenario,"location.pathname") == "/books/$epubId" }
            // Use the application's own router links again; no native API client
            // or fabricated successful book response participates in this gate.
            host.js(scenario,"document.querySelector('a[href=\"/library\"]').click()")
            host.await("Library did not return") { host.string(scenario,"location.pathname") == "/library" && host.string(scenario,"document.body.innerText").contains("Fidelidade PDF") }
            host.js(scenario,"Array.from(document.querySelectorAll('a')).find(a=>a.textContent.includes('Fidelidade PDF')).click()")
            host.await("PDF details did not open") { host.js(scenario,"Boolean(document.querySelector('a[href^=\"/read/\"]'))") == "true" }
            val pdfId = host.string(scenario,"location.pathname.split('/').pop()")
            host.js(scenario,"document.querySelector('a[href^=\"/read/\"]').click()")
            host.await("Real PDF.js canvas did not render",60_000) { host.js(scenario,"Boolean(document.querySelector('.pdf-canvas')?.width > 0)") == "true" && host.string(scenario,"document.querySelector('.reader-stage')?.getAttribute('aria-busy')") == "false" }
            host.js(scenario,"document.querySelector('[aria-label=\"Avançar na leitura\"]').click()")
            val pdfProgress = awaitProgress(host,scenario,pdfId,"pdf-page",false)
            assertEquals(2,pdfProgress.getJSONObject("locator").getInt("page"))
            host.await("PDF second page did not render") { host.js(scenario,"Boolean(document.querySelector('.pdf-page[data-page=\"2\"] canvas')?.width > 0)") == "true" }
            host.screenshot("pwa-webview-pdf-page-2")
            scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
            host.await("PDF detail did not return") { host.string(scenario,"location.pathname") == "/books/$pdfId" }
            host.js(scenario,"document.querySelector('a[href=\"/settings\"]').click()")
            host.await("Android integration settings did not render") { host.string(scenario,"document.body.innerText").contains("Ajustes do Android") }
            host.js(scenario,"Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('Ajustes do Android')).click()")
            androidx.test.espresso.Espresso.onView(androidx.test.espresso.matcher.ViewMatchers.withText(R.string.host_awake))
                .inRoot(androidx.test.espresso.matcher.RootMatchers.isDialog())
                .check(androidx.test.espresso.assertion.ViewAssertions.matches(androidx.test.espresso.matcher.ViewMatchers.isDisplayed()))
            host.screenshot("pwa-webview-android-settings")
            androidx.test.espresso.Espresso.pressBack()
            for(bookId in listOf(epubId,pdfId)) {
                host.js(scenario,"location.href='/books/$bookId'")
                host.await("Offline download action did not appear",30_000) { host.js(scenario,"Array.from(document.querySelectorAll('button')).some(button=>button.textContent.includes('Salvar para offline') && !button.disabled)") == "true" }
                host.js(scenario,"Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('Salvar para offline')).click()")
                host.await("Real offline package was not completed",90_000) { host.string(scenario,"document.body.innerText").contains("Disponível offline.") }
            }
            // Block HTTP in both render and worker networks, not just navigator.onLine.
            // Deep reloads must now come from the actual PWA shell and IndexedDB packages.
            blockNetwork(scenario,true)
            try {
                host.js(scenario,"location.href='/read/$epubId'")
                host.await("Downloaded EPUB did not survive offline deep reload",45_000) { host.string(scenario,"document.querySelector('.epub-stage:not(.epub-stage--preparing)')?.contentDocument?.body?.innerText || ''").contains("Conteúdo real") }
                host.screenshot("pwa-webview-epub-offline")
                host.js(scenario,"location.href='/read/$pdfId'")
                host.await("Downloaded PDF did not survive offline deep reload",60_000) { host.js(scenario,"Boolean(document.querySelector('.pdf-canvas')?.width > 0)") == "true" && host.string(scenario,"document.querySelector('.reader-stage')?.getAttribute('aria-busy')") == "false" }
                host.screenshot("pwa-webview-pdf-offline")
            } finally { blockNetwork(scenario,false) }
            scenario.onActivity { assertNotNull(it.findViewById<WebView>(R.id.host_webview)) }
        }
    }

    private fun blockNetwork(scenario: ActivityScenario<MainActivity>,blocked: Boolean) {
        scenario.onActivity { activity ->
            val view = activity.findViewById<WebView>(R.id.host_webview)
            view.settings.blockNetworkLoads = blocked
            if(androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.MULTI_PROFILE)) {
                androidx.webkit.WebViewCompat.getProfile(view).serviceWorkerController.serviceWorkerWebSettings.blockNetworkLoads = blocked
            }
        }
    }

    private fun awaitProgress(host: WebViewHarness,scenario: ActivityScenario<MainActivity>,id: String,type: String,requirePosition: Boolean): JSONObject {
        host.js(scenario,"""window.__testProgress=null;(async function poll(){try{const p=(await(await fetch('/api/v1/books/$id/progress')).json()).progress;if(p?.locator?.type==='$type' && ${if(requirePosition) "(p.locator.elementIndex>0 || p.locator.offset>0)" else "p.locator.page===2"}){window.__testProgress=p;return;}}catch{}setTimeout(poll,200);})();""")
        host.await("Real API did not persist $type position",30_000) { host.js(scenario,"Boolean(window.__testProgress)") == "true" }
        return JSONObject(host.js(scenario,"window.__testProgress"))
    }
}
