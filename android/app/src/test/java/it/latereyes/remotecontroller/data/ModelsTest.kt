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
        assertFalse(Settings().isConfigured)
        assertTrue(Settings(agentUrl = "x").isConfigured)   // il token non serve più: si entra con nome e password
        assertFalse(Settings(agentUrl = "x").isLoggedIn)
    }

    @Test
    fun appsForNormalUserWithoutTechnicalData() {
        val apps = AppStatus.listFromJson("""[{"id":"chatbz","name":"ChatBz","state":"running","openUrl":"http://{host}:3100"}]""")
        assertTrue(apps[0].isRunning)
        assertFalse(apps[0].managed)
        assertNull(apps[0].port)
        assertTrue(apps[0].requires.isEmpty())
    }

    @Test
    fun loginAndUsers() {
        val login = Login.fromJson(
            """{"token":"abc","user":{"name":"Andrea","role":"admin","apps":null,"relay":{"url":"http://relay:8765","token":"r"}}}"""
        )
        assertEquals("abc", login.token)
        assertTrue(login.user.isAdmin)
        assertNull(login.user.apps)
        assertEquals("http://relay:8765", login.user.relayUrl)

        val user = Me.fromJson(org.json.JSONObject("""{"name":"Giulia","role":"user","apps":["chatbz"],"relay":null}"""))
        assertFalse(user.isAdmin)
        assertEquals(listOf("chatbz"), user.apps)
        assertNull(user.relayUrl)

        val users = UserInfo.listFromJson("""[{"name":"Andrea","role":"admin","apps":null,"hasPassword":true},{"name":"Giulia","role":"user","apps":["chatbz"]}]""")
        assertTrue(users[0].isAdmin)
        assertTrue(users[0].apps.isEmpty())
        assertEquals(listOf("chatbz"), users[1].apps)
    }

    @Test
    fun displaysAndGamingFromAgentJson() {
        val d = DisplaysInfo.fromJson(
            """{"available":true,"displays":[
                {"name":"\\\\.\\DISPLAY1","monitor":"LG TV","active":false,"primary":false,"disconnected":false,"resolution":null,"hz":null,"virtual":false,"moonlight":false},
                {"name":"\\\\.\\DISPLAY2","monitor":"VDD by MTT","active":true,"primary":true,"disconnected":false,"resolution":"1920 X 1080","hz":60,"virtual":true,"moonlight":true}],
               "stream":{"available":true,"streaming":true,"since":"2026-11-08T14:22:01","outputName":"VDD","onlyDisplay":true}}"""
        )
        assertEquals(1, d.activeCount)
        assertTrue(d.displays[1].moonlight)
        assertEquals(60, d.displays[1].hz)
        assertTrue(d.stream.streaming)

        val g = GamingInfo.fromJson(
            """{"active":true,"game":{"appId":313590,"name":"Cyberpunk 2077"},"stream":{"available":false,"streaming":false},
                "cpuPct":41,"cpuModel":"AMD","memory":{"totalMiB":32768,"freeMiB":16384},
                "gpu":[{"name":"RTX","utilPct":97,"tempC":70,"powerW":265.3,"powerLimitW":285,"clockMHz":2745,"clockMaxMHz":3105,
                        "memClockMHz":10501,"fanPct":55,"memUsedMiB":9000,"memTotalMiB":16376,"pstate":"P2","encoderPct":null,"throttle":["limite di potenza"]}]}"""
        )
        assertEquals("Cyberpunk 2077", g.game!!.name)
        assertEquals(265.3, g.gpus[0].powerW!!, 0.01)
        assertNull(g.gpus[0].encoderPct)
        assertEquals(listOf("limite di potenza"), g.gpus[0].throttle)
    }

    @Test
    fun claudeApprovalsTerminalFromAgentJson() {
        val c = ClaudeStatus.fromJson("""{"running":true,"pid":5,"startedAt":1700000000000,"name":"PC di casa","cwd":"C:\\AI","approvals":true,"pending":2}""")
        assertTrue(c.running)
        assertEquals(1700000000000L, c.startedAt)
        assertEquals(2, c.pending)
        assertNull(ClaudeStatus.fromJson("""{"running":false,"startedAt":null,"name":"x","cwd":"y"}""").startedAt)
        val a = Approval.listFromJson("""[{"id":"abc","source":"Claude","title":"Bash: ls","detail":"ls","tool":"Bash","state":"pending","expiresAt":5}]""")
        assertEquals("Bash: ls", a[0].title)
        val t = TerminalChunk.fromJson("""{"text":"ciao\n","next":5,"alive":false,"exitCode":0}""")
        assertEquals(5L, t.next)
        assertFalse(t.alive)
    }
}
