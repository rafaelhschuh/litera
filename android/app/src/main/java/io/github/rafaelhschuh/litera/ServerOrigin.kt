package io.github.rafaelhschuh.litera

import java.net.URI
import java.security.MessageDigest
import java.util.Locale

enum class OriginError { INVALID_URL, HTTPS_REQUIRED, ROOT_REQUIRED }
class InvalidOrigin(val reason: OriginError) : IllegalArgumentException(reason.name)

/** Canonical origin boundary for API requests and private per-server storage. */
@ConsistentCopyVisibility
data class ServerOrigin private constructor(val value: String, val scheme: String, val host: String, val port: Int) {
    val profileName: String get() = "litera-" + MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    val isSecure: Boolean get() = scheme == "https"

    fun owns(url: String): Boolean {
        val parsed = networkUri(url) ?: return false
        return parsed.scheme.lowercase(Locale.ROOT) == scheme &&
            parsed.host.lowercase(Locale.ROOT) == host && effectivePort(parsed) == port
    }

    companion object {
        fun parse(input: String, allowHttp: Boolean = false): ServerOrigin {
            val uri = networkUri(input.trim()) ?: throw InvalidOrigin(OriginError.INVALID_URL)
            val scheme = uri.scheme.lowercase(Locale.ROOT)
            if (scheme == "http" && !allowHttp) throw InvalidOrigin(OriginError.HTTPS_REQUIRED)
            if (uri.rawPath !in listOf(null, "", "/") || uri.rawQuery != null || uri.rawFragment != null) {
                throw InvalidOrigin(OriginError.ROOT_REQUIRED)
            }
            val host = uri.host.lowercase(Locale.ROOT)
            val port = effectivePort(uri)
            val explicitPort = if (port == if (scheme == "https") 443 else 80) -1 else port
            val origin = URI(scheme, null, host, explicitPort, null, null, null).toASCIIString()
            return ServerOrigin(origin, scheme, host, port)
        }

        private fun networkUri(input: String): URI? {
            if (input.length > 4096 || input.any { it.isWhitespace() || it.isISOControl() || it == '\\' }) return null
            val uri = try { URI(input) } catch (_: Exception) { return null }
            if (uri.scheme?.lowercase(Locale.ROOT) !in listOf("http", "https") || uri.host.isNullOrBlank()) return null
            if (uri.rawUserInfo != null || uri.port !in -1..65535 || uri.port == 0) return null
            if (uri.rawAuthority?.contains('%') == true) return null
            return uri
        }

        private fun effectivePort(uri: URI): Int = if (uri.port == -1) {
            if (uri.scheme.equals("https", ignoreCase = true)) 443 else 80
        } else uri.port
    }
}
