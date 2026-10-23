package io.github.rafaelhschuh.litera

import org.junit.Assert.*
import org.junit.Test

class ServerOriginTest {
    @Test fun normalizesSchemeHostAndDefaultPort() {
        assertEquals("https://litera.example", ServerOrigin.parse(" HTTPS://Litera.Example:443/ ").value)
        assertEquals("http://192.168.1.20:3000", ServerOrigin.parse("http://192.168.1.20:3000/", true).value)
        assertEquals("https://[::1]:3443", ServerOrigin.parse("https://[::1]:3443/").value)
    }

    @Test fun httpIsExplicitlyOptedIn() {
        rejects("http://192.168.1.20:3000", OriginError.HTTPS_REQUIRED)
        assertFalse(ServerOrigin.parse("http://192.168.1.20:3000", true).isSecure)
        assertTrue(ServerOrigin.parse("https://litera.example").isSecure)
    }

    @Test fun rejectsAmbiguousOrPrivilegedAddresses() {
        listOf(
            "", "litera.example", "//litera.example", "file:///etc/passwd", "content://books/1", "javascript:alert(1)",
            "intent://litera.example", "https://user:password@litera.example", "https://litera.example@evil.example",
            "https://litera.example:0", "https://litera.example:65536", "https://litera.example:abc", "https://",
            "https://litera.example\\@evil.example", "https://li tera.example", "https://litera.example\n.evil.example",
            "https://litera%2eexample", "https://[fe80::1%25eth0]"
        ).forEach { rejects(it, OriginError.INVALID_URL) }
    }

    @Test fun requiresServerRootAndNoParameters() {
        listOf("https://litera.example/library", "https://litera.example/?token=secret", "https://litera.example/#library", "https://litera.example//").forEach {
            rejects(it, OriginError.ROOT_REQUIRED)
        }
    }

    @Test fun comparesOriginsRatherThanUrlPrefixes() {
        val server = ServerOrigin.parse("https://litera.example:3443")
        assertTrue(server.owns("https://litera.example:3443/read/4?mode=pdf#chapter"))
        listOf("https://litera.example", "http://litera.example:3443", "https://litera.example:3444", "https://litera.example.evil:3443", "https://evil.example/?next=https://litera.example:3443", "https://user@litera.example:3443").forEach {
            assertFalse(it, server.owns(it))
        }
        val standard = ServerOrigin.parse("https://litera.example")
        assertTrue(standard.owns("https://LITERA.EXAMPLE:443/api/v1/books/1"))
        assertFalse(standard.owns("https://litera.example./"))
    }

    @Test fun profileNamesAreStableAndSeparatePortsAndSchemes() {
        val secure = ServerOrigin.parse("https://litera.example")
        assertEquals(secure.profileName, ServerOrigin.parse("HTTPS://LITERA.EXAMPLE:443/").profileName)
        assertTrue(secure.profileName.matches(Regex("litera-[a-f0-9]{64}")))
        assertNotEquals(secure.profileName, ServerOrigin.parse("https://litera.example:444").profileName)
        assertNotEquals(secure.profileName, ServerOrigin.parse("http://litera.example", true).profileName)
    }

    private fun rejects(input: String, reason: OriginError) {
        val error = assertThrows("Expected rejection: $input", InvalidOrigin::class.java) { ServerOrigin.parse(input) }
        assertEquals(input, reason, error.reason)
    }
}
