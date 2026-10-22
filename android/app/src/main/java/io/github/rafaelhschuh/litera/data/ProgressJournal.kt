package io.github.rafaelhschuh.litera.data

import org.json.JSONObject
import java.util.UUID

/** Short atomic disk transitions; never hold this monitor across an HTTP request.
 * An operation with an unknown remote result keeps its idempotency key. Only its
 * unsent successor is coalesced, including when a pause arrives during a request.
 */
internal class ProgressJournal(private val read: (String) -> String?, private val write: (String, String?) -> Unit) {
    @Synchronized fun stage(key: String, bookId: Int, body: JSONObject) {
        val newest = JSONObject().put("bookId",bookId).put("body",JSONObject(body.toString())).put("operation",UUID.randomUUID().toString())
        val previous = read(key)?.let(::JSONObject)
        val result = if(previous == null) newest else previous.put("next",newest)
        write(key,result.toString())
    }
    @Synchronized fun current(key: String): JSONObject? = read(key)?.let(::JSONObject)
    @Synchronized fun newest(key: String): JSONObject? = current(key)?.let { it.optJSONObject("next") ?: it }
    @Synchronized fun acknowledge(key: String, operation: String, revision: Int) {
        val current = current(key) ?: return
        check(current.getString("operation") == operation) { "Progress operation changed while in flight" }
        val next = current.optJSONObject("next")
        next?.getJSONObject("body")?.put("revision",revision)
        write(key,next?.toString())
    }
    @Synchronized fun discard(key: String) { write(key,null) }
    @Synchronized fun rebase(key: String, revision: Int) {
        val newest = newest(key) ?: throw ApiFailure(404,"NO_LOCAL_DRAFT","Não há posição local pendente")
        newest.getJSONObject("body").put("revision",revision)
        newest.put("operation",UUID.randomUUID().toString())
        write(key,newest.toString())
    }
}
