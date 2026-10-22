package io.github.rafaelhschuh.litera

import android.graphics.Bitmap
import android.os.SystemClock
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.scrollTo
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.action.ViewActions.closeSoftKeyboard
import androidx.test.espresso.action.ViewActions.replaceText
import androidx.test.espresso.matcher.ViewMatchers.withId
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

internal class WebViewHarness {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    fun clearHostSettings() {
        val context = instrumentation.targetContext
        check(context.getSharedPreferences("litera-host",0).edit().clear().commit())
    }
    fun connect(origin: String) {
        onView(withId(R.id.server_url)).perform(scrollTo(),replaceText(origin),closeSoftKeyboard())
        onView(withId(R.id.allow_http)).perform(scrollTo(),click())
        onView(withId(R.id.server_connect)).perform(scrollTo(),click())
    }
    fun js(scenario: ActivityScenario<MainActivity>,script: String): String {
        val result = AtomicReference<String>()
        val completed = CountDownLatch(1)
        scenario.onActivity { activity ->
            activity.findViewById<WebView>(R.id.host_webview)?.evaluateJavascript(script) { value -> result.set(value); completed.countDown() }
                ?: completed.countDown()
        }
        check(completed.await(5,TimeUnit.SECONDS)) { "JavaScript callback timed out: $script" }
        return result.get() ?: "null"
    }
    fun string(scenario: ActivityScenario<MainActivity>,script: String): String =
        JSONArray("[${js(scenario,script)}]").optString(0)
    fun await(message: String,timeout: Long = 20_000,condition: () -> Boolean) {
        val deadline = SystemClock.uptimeMillis() + timeout
        var failure: Throwable? = null
        while(SystemClock.uptimeMillis() < deadline) {
            try { if(condition()) return } catch(error: AssertionError) { failure = error }
            SystemClock.sleep(100)
        }
        throw AssertionError(message,failure)
    }
    fun screenshot(name: String) {
        val bitmap = instrumentation.uiAutomation.takeScreenshot() ?: error("Device screenshot unavailable")
        val output = InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")
            ?: File(instrumentation.targetContext.getExternalFilesDir(null),"test-screenshots").path
        val folder = File(output).apply { check(isDirectory || mkdirs()) }
        File(folder,"$name.png").outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG,100,it)) }
        bitmap.recycle()
    }
}
