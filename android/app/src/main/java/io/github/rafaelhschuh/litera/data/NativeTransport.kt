package io.github.rafaelhschuh.litera.data

import io.github.rafaelhschuh.litera.ServerOrigin
import okhttp3.CookieJar
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Only repository-relative API paths enter this transport. Redirects never carry credentials elsewhere. */
internal class NativeTransport(private val origin: ServerOrigin, cookies: CookieJar) {
    private val client = OkHttpClient.Builder().cookieJar(cookies)
        .followRedirects(false).followSslRedirects(false)
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS)
        .addInterceptor { chain ->
            if (!origin.owns(chain.request().url.toString())) throw IOException("Untrusted server origin")
            chain.proceed(chain.request())
        }.build()

    fun response(path: String, method: String = "GET", body: JSONObject? = null, userId: Int? = null, operation: String? = null): Response {
        require(path.startsWith("/api/v1/") && !path.contains('\\'))
        val builder = Request.Builder().url(origin.value + path).header("Accept", "application/json")
        if (userId != null) builder.header("X-Litera-User", userId.toString())
        if (operation != null) builder.header("X-Litera-Operation", operation)
        val data = if (method in listOf("GET", "HEAD")) null else (body?.toString() ?: "{}").toRequestBody("application/json; charset=utf-8".toMediaType())
        return client.newCall(builder.method(method, data).build()).execute().also { response ->
            if (!response.isSuccessful) {
                val failure = try {
                    val error = JSONObject(response.body?.string().orEmpty()).optJSONObject("error")
                    ApiFailure(response.code, error?.optString("code") ?: "HTTP_ERROR", error?.optString("message") ?: "Servidor retornou HTTP ${response.code}")
                } catch (_: Exception) { ApiFailure(response.code, "HTTP_ERROR", "Servidor retornou HTTP ${response.code}") }
                response.close()
                throw failure
            }
        }
    }

    fun json(path: String, method: String = "GET", body: JSONObject? = null, userId: Int? = null, operation: String? = null): JSONObject =
        response(path, method, body, userId, operation).use { response ->
            val raw = response.body?.string().orEmpty()
            if (raw.isBlank()) JSONObject() else JSONObject(raw)
        }
}
