package io.github.rafaelhschuh.litera.ui

import android.content.Context
import io.github.rafaelhschuh.litera.R
import io.github.rafaelhschuh.litera.data.ApiFailure
import java.io.IOException
import javax.net.ssl.SSLException

fun Exception.userMessage(context: Context): String = when {
    this is SSLException -> context.getString(R.string.native_tls_error)
    this is IOException -> context.getString(R.string.native_connection_error)
    this is ApiFailure && code == "INVALID_CREDENTIALS" -> context.getString(R.string.native_invalid_login)
    this is ApiFailure && status == 401 -> context.getString(R.string.native_session_expired)
    else -> message ?: context.getString(R.string.reader_error)
}
