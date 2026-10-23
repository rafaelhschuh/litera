package io.github.rafaelhschuh.litera

import org.junit.Assert.*
import org.junit.Test

class HostStateTest {
    @Test fun acceptsStrictPresentationState() {
        val state = HostState.parse("""{"type":"state","color":"#191d26","dark":true,"reader":false}""")!!
        assertEquals(0xFF191D26.toInt(),state.color)
        assertTrue(state.dark)
        assertFalse(state.reader)
    }
    @Test fun refusesMalformedAndNonPresentationMessages() {
        listOf("", "null", "[]", "{}", """{"type":"settings"}""", """{"type":"state","color":"red","dark":true,"reader":true}""", """{"type":"state","color":"#fff","dark":true,"reader":true}""", """{"type":"state","color":"#00191d26","dark":true,"reader":true}""", """{"type":"state","color":"#191d26","dark":"true","reader":true}""", """{"type":"state","color":"#191d26","dark":true,"reader":1}""", """{"type":"state","color":"#191d26","dark":true}""").forEach { assertNull(it,HostState.parse(it)) }
    }
    @Test fun refusesOversizedBridgePayload() {
        assertNull(HostState.parse("""{"type":"state","color":"#191d26","dark":true,"reader":true,"extra":"${"a".repeat(600)}"}"""))
    }
}
