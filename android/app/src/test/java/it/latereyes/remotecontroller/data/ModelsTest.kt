package it.latereyes.remotecontroller.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelsTest {

    @Test
    fun appsFromAgentJson() {
        val apps = AppStatus.listFromJson(
            """[{"id":"chatbz","name":"ChatBz","state":"running","managed":true,"pid":10,"port":3100,
                 "openUrl":"http://{host}:3100","requires":["ollama","comfy"],"startedAt":1,"exitCode":null,"lastError":null},
                {"id":"ollama","name":"Ollama","state":"starting","managed":false,"pid":null,"port":null,
                 "openUrl":null,"requires":[],"startedAt":null,"exitCode":null,"lastError":"non risponde"}]"""
        )
        assertEquals(2, apps.size)
        assertTrue(apps[0].isRunning)
        assertEquals(listOf("ollama", "comfy"), apps[0].requires)
        assertEquals(3100, apps[0].port)
        assertNull(apps[0].lastError)
        assertTrue(apps[1].isBusy)
        assertNull(apps[1].openUrl)
        assertNull(apps[1].port)
        assertEquals("non risponde", apps[1].lastError)
    }

    @Test
    fun systemFromAgentJson() {
        val s = SystemInfo.fromJson(
            """{"hostname":"PC","platform":"win32","uptimeSec":3700,"memory":{"totalMiB":65536,"freeMiB":40000},
                "gpu":[{"name":"RTX 4070 Ti SUPER","memUsedMiB":10240,"memTotalMiB":16376,"tempC":null,"utilPct":97}],
                "ollamaModels":[{"name":"gemma","sizeVramMiB":9000,"expiresAt":"x"}]}"""
        )
        assertEquals("PC", s.hostname)
        assertEquals(16376, s.gpus!![0].memTotalMiB)
        assertNull(s.gpus!![0].tempC)
        assertEquals("gemma", s.ollamaModels!![0].name)

        val off = SystemInfo.fromJson("""{"hostname":"PC","gpu":null,"ollamaModels":null}""")
        assertNull(off.gpus)
        assertNull(off.ollamaModels)
    }

    @Test
    fun openUrlUsesAgentHost() {
        assertEquals("http://pc-casa:3100", resolveOpenUrl("http://{host}:3100", "http://pc-casa:7070"))
        assertEquals("http://100.64.0.5:3000", resolveOpenUrl("http://{host}:3000", "http://100.64.0.5:7070"))
    }

    @Test
    fun urlNormalization() {
        assertEquals("http://pc-casa:7070", normalizeUrl(" pc-casa:7070/ "))
        assertEquals("https://x.ts.net", normalizeUrl("https://x.ts.net"))
        assertEquals("", normalizeUrl("  "))
    }

    @Test
    fun agentErrorMessage() {
        assertEquals("app sconosciuta: x", errorMessage("""{"error":"app sconosciuta: x"}"""))
        assertNull(errorMessage("<html>"))
        assertFalse(Settings(agentUrl = "x").isConfigured)
    }
}
