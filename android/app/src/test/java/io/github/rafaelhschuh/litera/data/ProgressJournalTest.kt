package io.github.rafaelhschuh.litera.data

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ProgressJournalTest {
    private val disk = mutableMapOf<String,String>()
    private fun reopen() = ProgressJournal({ disk[it] }, { key,value -> if(value == null) disk.remove(key) else disk[key] = value })
    private fun body(page: Int, revision: Int = 4) = JSONObject().put("format","pdf").put("revision",revision)
        .put("progressRatio",page/10.0).put("locator",JSONObject().put("type","pdf-page").put("page",page))
    @Test fun restartRetainsUnknownOperationAndLatestUnsentSuccessor() {
        val journal = reopen()
        journal.stage("account-1-book-7",7,body(2))
        val operation = journal.current("account-1-book-7")!!.getString("operation")
        journal.stage("account-1-book-7",7,body(3))
        journal.stage("account-1-book-7",7,body(8))
        val restored = reopen()
        assertEquals(operation,restored.current("account-1-book-7")!!.getString("operation"))
        assertEquals(8,restored.newest("account-1-book-7")!!.getJSONObject("body").getJSONObject("locator").getInt("page"))
    }
    @Test fun pauseDuringNetworkAcknowledgesNewestDiskSuccessorWithReturnedRevision() {
        val journal = reopen()
        journal.stage("one",7,body(2))
        val inFlight = journal.current("one")!!
        // A lifecycle callback arrives after HTTP started; ack must re-read disk.
        journal.stage("one",7,body(6))
        journal.acknowledge("one",inFlight.getString("operation"),5)
        val next = reopen().current("one")!!
        assertEquals(5,next.getJSONObject("body").getInt("revision"))
        assertEquals(6,next.getJSONObject("body").getJSONObject("locator").getInt("page"))
        journal.acknowledge("one",next.getString("operation"),6)
        assertNull(reopen().current("one"))
    }
    @Test fun accountAndBookPartitionsAndExplicitConflictChoiceAreIndependent() {
        val journal = reopen()
        journal.stage("user1-book7",7,body(3))
        journal.stage("user2-book7",7,body(9))
        val before = journal.current("user1-book7")!!.getString("operation")
        journal.rebase("user1-book7",12)
        assertNotEquals(before,journal.current("user1-book7")!!.getString("operation"))
        assertEquals(12,journal.current("user1-book7")!!.getJSONObject("body").getInt("revision"))
        journal.discard("user1-book7")
        assertNull(journal.current("user1-book7"))
        assertEquals(9,journal.newest("user2-book7")!!.getJSONObject("body").getJSONObject("locator").getInt("page"))
    }
}
