package io.github.rafaelhschuh.litera.data

import android.content.Context
import android.annotation.SuppressLint
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import io.github.rafaelhschuh.litera.ServerOrigin
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import org.json.JSONArray
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Sessions are encrypted at rest by a non-exportable Android Keystore key. No credentials are logged. */
// KTX edit returns Unit; session durability must check the actual commit result.
@SuppressLint("UseKtx")
internal class EncryptedCookieJar(context: Context, private val origin: ServerOrigin) : CookieJar {
    private val preferences = context.getSharedPreferences("litera-cookies-${origin.profileName}", Context.MODE_PRIVATE)
    private val alias = "litera-session-${origin.profileName}"
    private val key: SecretKey by lazy {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    private var loaded = false
    private val cookies = mutableListOf<Cookie>()

    @Synchronized override fun loadForRequest(url: HttpUrl): List<Cookie> {
        if (!origin.owns(url.toString())) return emptyList()
        load(url)
        cookies.removeAll { it.expiresAt <= System.currentTimeMillis() }
        return cookies.filter { it.matches(url) }
    }

    @Synchronized override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        if (!origin.owns(url.toString())) return
        load(url)
        cookies.filter { it.matches(url) }.forEach { cookie ->
            this.cookies.removeAll { it.name == cookie.name && it.domain == cookie.domain && it.path == cookie.path }
            if (cookie.expiresAt > System.currentTimeMillis()) this.cookies.add(cookie)
        }
        persist()
    }

    @Synchronized fun clear() { cookies.clear(); loaded = true; check(preferences.edit().clear().commit()) { "Session storage unavailable" } }

    private fun load(url: HttpUrl) {
        if (loaded) return
        loaded = true
        val stored = preferences.getString("session", null) ?: return
        try {
            val pieces = stored.split(':', limit = 2)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, Base64.decode(pieces[0], Base64.NO_WRAP)))
            cipher.updateAAD(origin.value.toByteArray())
            val array = JSONArray(String(cipher.doFinal(Base64.decode(pieces[1], Base64.NO_WRAP)), Charsets.UTF_8))
            for (index in 0 until array.length()) Cookie.parse(url, array.getString(index))?.let { if (it.expiresAt > System.currentTimeMillis()) cookies.add(it) }
        } catch (_: Exception) {
            // Keystore invalidation/corruption requires sign-in again, never plaintext fallback.
            check(preferences.edit().clear().commit()) { "Session storage unavailable" }
        }
    }

    private fun persist() {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        cipher.updateAAD(origin.value.toByteArray())
        val payload = JSONArray(cookies.map { it.toString() }).toString().toByteArray()
        val encoded = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(payload), Base64.NO_WRAP)
        check(preferences.edit().putString("session", encoded).commit()) { "Session storage unavailable" }
    }
}
