package io.github.rafaelhschuh.litera.data

import io.github.rafaelhschuh.litera.ServerOrigin
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

class NativeTransportTest {
    private lateinit var server: MockWebServer
    private lateinit var transport: NativeTransport
    private val savedCookies = mutableListOf<Cookie>()
    @Before fun setup() {
        server = MockWebServer().apply { start() }
        transport = NativeTransport(ServerOrigin.parse(server.url("/").toString(), true), object : CookieJar {
            override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) { savedCookies.addAll(cookies) }
            override fun loadForRequest(url: HttpUrl): List<Cookie> = savedCookies.filter { it.matches(url) }
        })
    }
    @After fun teardown() { server.shutdown(); savedCookies.clear() }

    @Test fun loginUsesRealEndpointAndSubsequentRequestsCarrySession() {
        server.enqueue(MockResponse().setHeader("Set-Cookie", "litera_session=opaque; HttpOnly; Path=/").setBody("""{"user":{"id":1,"username":"reader","displayName":"Reader","role":"reader"}}"""))
        val response = transport.json("/api/v1/auth/login", "POST", JSONObject().put("username", "reader").put("password", "secret"))
        assertEquals("reader", LiteraRepository.parseUser(response.getJSONObject("user")).username)
        val login = server.takeRequest()
        assertEquals("POST", login.method)
        assertEquals("/api/v1/auth/login", login.path)
        assertEquals("secret", JSONObject(login.body.readUtf8()).getString("password"))
        server.enqueue(MockResponse().setBody("{}"))
        transport.json("/api/v1/home", userId = 1)
        val home = server.takeRequest()
        assertEquals("litera_session=opaque", home.getHeader("Cookie"))
        assertEquals("1", home.getHeader("X-Litera-User"))
    }

    @Test fun progressUsesRevisionAndStableOperationId() {
        server.enqueue(MockResponse().setBody("{}"))
        val payload = JSONObject().put("format", "pdf").put("revision", 4).put("progressRatio", 0.25)
            .put("locator", JSONObject().put("type", "pdf-page").put("page", 2))
        transport.json("/api/v1/books/3/progress", "PUT", payload, 7, "12345678-1234-1234")
        val request = server.takeRequest()
        assertEquals("PUT", request.method)
        assertEquals("12345678-1234-1234", request.getHeader("X-Litera-Operation"))
        assertEquals(4, JSONObject(request.body.readUtf8()).getInt("revision"))
    }

    @Test fun conflictsRemainExplicit() {
        server.enqueue(MockResponse().setResponseCode(409).setBody("""{"error":{"code":"STALE_PROGRESS","message":"Changed elsewhere"}}"""))
        try { transport.json("/api/v1/books/1/progress", "PUT", JSONObject()); fail("Expected conflict") }
        catch (error: ApiFailure) { assertEquals(409, error.status); assertEquals("STALE_PROGRESS", error.code) }
    }

    @Test fun unauthorizedResponseIsTyped() {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":{"code":"UNAUTHENTICATED","message":"Sign in"}}"""))
        try { transport.json("/api/v1/auth/me"); fail("Expected 401") }
        catch (error: ApiFailure) { assertEquals(401, error.status); assertEquals("UNAUTHENTICATED", error.code) }
    }

    @Test fun crossOriginRedirectIsNeverFollowed() {
        val external = MockWebServer().apply { start() }
        try {
            server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", external.url("/steal")))
            try { transport.json("/api/v1/home"); fail("Expected redirect refusal") }
            catch (error: ApiFailure) { assertEquals(302, error.status) }
            assertEquals(0, external.requestCount)
        } finally { external.shutdown() }
    }

    @Test fun paginationAndSearchReachTheExistingBooksContract() {
        server.enqueue(MockResponse().setBody("""{"books":[],"pagination":{"page":2,"pages":3,"total":55}}"""))
        val response = transport.json("/api/v1/books?q=Jane%20Austen&page=2&favorite=true", userId = 1)
        val request = server.takeRequest()
        assertEquals("Jane Austen", request.requestUrl?.queryParameter("q"))
        assertEquals("2", request.requestUrl?.queryParameter("page"))
        assertEquals("true", request.requestUrl?.queryParameter("favorite"))
        assertEquals(55, response.getJSONObject("pagination").getInt("total"))
    }

    @Test fun nullableBookFieldsAndFormatArePreserved() {
        val value = LiteraRepository.parseBook(JSONObject("""{"id":9,"title":"Book","author":null,"description":null,"format":"epub","pageCount":null,"hasCover":true,"favorite":false,"progressRatio":null,"fileRevision":"sha","completed":false}"""))
        assertNull(value.author); assertNull(value.pageCount); assertNull(value.progressRatio)
        assertEquals("epub", value.format); assertEquals("sha", value.fileRevision)
    }

    @Test fun favoriteUsesPutAndDeleteExistingApiRoutes() {
        server.enqueue(MockResponse().setBody("{\"favorite\":true}"))
        transport.json("/api/v1/books/1/favorite", "PUT", userId = 1)
        assertEquals("PUT", server.takeRequest().method)
        server.enqueue(MockResponse().setResponseCode(204))
        transport.json("/api/v1/books/1/favorite", "DELETE", userId = 1)
        assertEquals("DELETE", server.takeRequest().method)
    }
}
