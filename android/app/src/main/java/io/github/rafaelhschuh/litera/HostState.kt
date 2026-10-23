package io.github.rafaelhschuh.litera

import org.json.JSONObject

/** Presentation only: no credentials, URLs or native capabilities come from this message. */
data class HostState(val color: Int, val dark: Boolean, val reader: Boolean) {
    companion object {
        fun parse(data: String): HostState? {
            if(data.length > 512) return null
            return runCatching {
                val value = JSONObject(data)
                require(value.optString("type") == "state")
                val color = value.getString("color")
                require(Regex("^#[0-9a-fA-F]{6}$").matches(color))
                val dark = value.get("dark"); val reader = value.get("reader")
                require(dark is Boolean && reader is Boolean)
                HostState(color.drop(1).toLong(16).toInt() or 0xff000000.toInt(),dark,reader)
            }.getOrNull()
        }
    }
}
