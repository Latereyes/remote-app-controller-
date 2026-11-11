package it.latereyes.remotecontroller.data

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI

/** Stato di un'app sul PC, come lo restituisce l'agent (GET /api/apps). */
data class AppStatus(
    val id: String,
    val name: String,
    val state: String,          // stopped | starting | running | stopping
    val managed: Boolean,
    val port: Int?,
    val openUrl: String?,
    val requires: List<String>,
    val lastError: String?,
) {
    val isRunning get() = state == "running"
    val isBusy get() = state == "starting" || state == "stopping"

    companion object {
        fun fromJson(o: JSONObject) = AppStatus(
            id = o.getString("id"),
            name = o.optString("name", o.getString("id")),
            state = o.optString("state", "stopped"),
            managed = o.optBoolean("managed", false),
            port = if (o.isNull("port")) null else o.optInt("port"),
            openUrl = o.optStringOrNull("openUrl"),
            requires = o.optJSONArray("requires").strings(),
            lastError = o.optStringOrNull("lastError"),
        )

        fun listFromJson(text: String): List<AppStatus> {
            val arr = JSONArray(text)
            return (0 until arr.length()).map { fromJson(arr.getJSONObject(it)) }
        }
    }
}

/** Chi ha fatto l'accesso (GET /api/me). `apps` è null per l'amministratore, che può avviare tutto. */
data class Me(
    val name: String,
    val role: String,
    val apps: List<String>?,
    val relayUrl: String?,
    val relayToken: String?,
) {
    val isAdmin get() = role == "admin"

    companion object {
        fun fromJson(o: JSONObject): Me {
            val relay = o.optJSONObject("relay")
            return Me(
                name = o.getString("name"),
                role = o.optString("role", "user"),
                apps = if (o.isNull("apps")) null else o.optJSONArray("apps").strings(),
                relayUrl = relay?.optStringOrNull("url"),
                relayToken = relay?.optStringOrNull("token"),
            )
        }
    }
}

/** Risposta di login e primo accesso: token di sessione e utente. */
data class Login(val token: String, val user: Me) {
    companion object {
        fun fromJson(text: String): Login {
            val o = JSONObject(text)
            return Login(o.getString("token"), Me.fromJson(o.getJSONObject("user")))
        }
    }
}

/** Utente nell'elenco dell'amministratore (GET /api/users). */
data class UserInfo(val name: String, val role: String, val apps: List<String>) {
    val isAdmin get() = role == "admin"

    companion object {
        fun listFromJson(text: String): List<UserInfo> {
            val arr = JSONArray(text)
            return (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                UserInfo(o.getString("name"), o.optString("role", "user"), o.optJSONArray("apps").strings())
            }
        }
    }
}

data class Gpu(val name: String, val memUsedMiB: Int?, val memTotalMiB: Int?, val tempC: Int?, val utilPct: Int?)

data class OllamaModel(val name: String, val sizeVramMiB: Int)

/** Informazioni sul PC (GET /api/system). */
data class SystemInfo(
    val hostname: String,
    val uptimeSec: Long,
    val memTotalMiB: Int,
    val memFreeMiB: Int,
    val gpus: List<Gpu>?,
    val ollamaModels: List<OllamaModel>?,
) {
    companion object {
        fun fromJson(text: String): SystemInfo {
            val o = JSONObject(text)
            val mem = o.optJSONObject("memory")
            return SystemInfo(
                hostname = o.optString("hostname"),
                uptimeSec = o.optLong("uptimeSec"),
                memTotalMiB = mem?.optInt("totalMiB") ?: 0,
                memFreeMiB = mem?.optInt("freeMiB") ?: 0,
                gpus = o.optJSONArray("gpu")?.let { arr ->
                    (0 until arr.length()).map { i ->
                        val g = arr.getJSONObject(i)
                        Gpu(g.optString("name"), g.optIntOrNull("memUsedMiB"), g.optIntOrNull("memTotalMiB"), g.optIntOrNull("tempC"), g.optIntOrNull("utilPct"))
                    }
                },
                ollamaModels = o.optJSONArray("ollamaModels")?.let { arr ->
                    (0 until arr.length()).map { i ->
                        val m = arr.getJSONObject(i)
                        OllamaModel(m.optString("name"), m.optInt("sizeVramMiB"))
                    }
                },
            )
        }
    }
}

/** Stream di Moonlight secondo il log di Sunshine. */
data class StreamInfo(val available: Boolean, val streaming: Boolean, val since: String?, val outputName: String?) {
    companion object {
        fun fromJson(o: JSONObject?) = StreamInfo(
            available = o?.optBoolean("available") ?: false,
            streaming = o?.optBoolean("streaming") ?: false,
            since = o?.optStringOrNull("since"),
            outputName = o?.optStringOrNull("outputName"),
        )
    }
}

/** Uno schermo del PC (GET /api/displays). */
data class Display(
    val name: String,
    val monitor: String,
    val active: Boolean,
    val primary: Boolean,
    val disconnected: Boolean,
    val resolution: String?,
    val hz: Int?,
    val virtual: Boolean,
    val moonlight: Boolean,
)

data class DisplaysInfo(val available: Boolean, val reason: String?, val displays: List<Display>, val stream: StreamInfo) {
    val activeCount get() = displays.count { it.active }

    companion object {
        fun fromJson(text: String): DisplaysInfo {
            val o = JSONObject(text)
            val arr = o.optJSONArray("displays")
            return DisplaysInfo(
                available = o.optBoolean("available"),
                reason = o.optStringOrNull("reason"),
                displays = if (arr == null) emptyList() else (0 until arr.length()).map { i ->
                    val d = arr.getJSONObject(i)
                    Display(
                        name = d.optString("name"),
                        monitor = d.optString("monitor", d.optString("name")),
                        active = d.optBoolean("active"),
                        primary = d.optBoolean("primary"),
                        disconnected = d.optBoolean("disconnected"),
                        resolution = d.optStringOrNull("resolution"),
                        hz = d.optIntOrNull("hz"),
                        virtual = d.optBoolean("virtual"),
                        moonlight = d.optBoolean("moonlight"),
                    )
                },
                stream = StreamInfo.fromJson(o.optJSONObject("stream")),
            )
        }
    }
}

/** Scheda video con i dati per giocare (GET /api/gaming). */
data class GpuDetail(
    val name: String,
    val utilPct: Int?,
    val tempC: Int?,
    val powerW: Double?,
    val powerLimitW: Double?,
    val clockMHz: Int?,
    val clockMaxMHz: Int?,
    val memClockMHz: Int?,
    val fanPct: Int?,
    val memUsedMiB: Int?,
    val memTotalMiB: Int?,
    val pstate: String?,
    val encoderPct: Int?,
    val throttle: List<String>,
)

data class GameInfo(val appId: Long, val name: String)

data class GamingInfo(
    val active: Boolean,
    val game: GameInfo?,
    val stream: StreamInfo,
    val cpuPct: Int?,
    val cpuModel: String?,
    val memTotalMiB: Int,
    val memFreeMiB: Int,
    val gpus: List<GpuDetail>,
) {
    companion object {
        fun fromJson(text: String): GamingInfo {
            val o = JSONObject(text)
            val mem = o.optJSONObject("memory")
            val game = o.optJSONObject("game")
            val arr = o.optJSONArray("gpu")
            return GamingInfo(
                active = o.optBoolean("active"),
                game = game?.let { GameInfo(it.optLong("appId"), it.optString("name")) },
                stream = StreamInfo.fromJson(o.optJSONObject("stream")),
                cpuPct = o.optIntOrNull("cpuPct"),
                cpuModel = o.optStringOrNull("cpuModel"),
                memTotalMiB = mem?.optInt("totalMiB") ?: 0,
                memFreeMiB = mem?.optInt("freeMiB") ?: 0,
                gpus = if (arr == null) emptyList() else (0 until arr.length()).map { i ->
                    val g = arr.getJSONObject(i)
                    GpuDetail(
                        name = g.optString("name"),
                        utilPct = g.optIntOrNull("utilPct"),
                        tempC = g.optIntOrNull("tempC"),
                        powerW = g.optDoubleOrNull("powerW"),
                        powerLimitW = g.optDoubleOrNull("powerLimitW"),
                        clockMHz = g.optIntOrNull("clockMHz"),
                        clockMaxMHz = g.optIntOrNull("clockMaxMHz"),
                        memClockMHz = g.optIntOrNull("memClockMHz"),
                        fanPct = g.optIntOrNull("fanPct"),
                        memUsedMiB = g.optIntOrNull("memUsedMiB"),
                        memTotalMiB = g.optIntOrNull("memTotalMiB"),
                        pstate = g.optStringOrNull("pstate"),
                        encoderPct = g.optIntOrNull("encoderPct"),
                        throttle = g.optJSONArray("throttle").strings(),
                    )
                },
            )
        }
    }
}

/** Server SSH del PC (GET /api/ssh): il terminale vero si apre col client SSH del telefono. */
data class SshInfo(val installed: Boolean, val running: Boolean, val user: String, val port: Int) {
    companion object {
        fun fromJson(text: String): SshInfo {
            val o = JSONObject(text)
            return SshInfo(o.optBoolean("installed"), o.optBoolean("running"), o.optString("user"), o.optInt("port", 22))
        }
    }
}

/** Claude sul PC (GET /api/claude). */
data class ClaudeStatus(val running: Boolean, val startedAt: Long?, val name: String, val cwd: String, val approvals: Boolean, val pending: Int) {
    companion object {
        fun fromJson(text: String): ClaudeStatus {
            val o = JSONObject(text)
            return ClaudeStatus(
                running = o.optBoolean("running"),
                startedAt = if (o.isNull("startedAt") || !o.has("startedAt")) null else o.optLong("startedAt"),
                name = o.optString("name"),
                cwd = o.optString("cwd"),
                approvals = o.optBoolean("approvals"),
                pending = o.optInt("pending"),
            )
        }
    }
}

/** Richiesta di permesso arrivata dal PC (GET /api/approvals). */
data class Approval(val id: String, val source: String, val title: String, val detail: String, val tool: String?, val expiresAt: Long) {
    companion object {
        fun listFromJson(text: String): List<Approval> {
            val arr = JSONArray(text)
            return (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                Approval(o.getString("id"), o.optString("source", "PC"), o.optString("title"), o.optString("detail"),
                    o.optStringOrNull("tool"), o.optLong("expiresAt"))
            }
        }
    }
}

/** Pezzo di output del terminale (GET /api/terminal/:id?since=N). */
data class TerminalChunk(val text: String, val next: Long, val alive: Boolean) {
    companion object {
        fun fromJson(text: String): TerminalChunk {
            val o = JSONObject(text)
            return TerminalChunk(o.optString("text"), o.optLong("next"), o.optBoolean("alive", true))
        }
    }
}

/** "http://{host}:3100" → indirizzo del PC preso dall'URL dell'agent. */
fun resolveOpenUrl(template: String, agentUrl: String): String {
    val host = runCatching { URI(agentUrl.trim()).host }.getOrNull() ?: return template
    return template.replace("{host}", host)
}

/** Messaggio d'errore dell'agent ({"error": "..."}) oppure null. */
fun errorMessage(text: String): String? =
    runCatching { JSONObject(text).optStringOrNull("error") }.getOrNull()

private fun JSONObject.optStringOrNull(key: String): String? =
    if (!has(key) || isNull(key)) null else optString(key).ifEmpty { null }

private fun JSONObject.optIntOrNull(key: String): Int? =
    if (!has(key) || isNull(key)) null else optInt(key)

private fun JSONObject.optDoubleOrNull(key: String): Double? =
    if (!has(key) || isNull(key)) null else optDouble(key).takeIf { !it.isNaN() }

private fun JSONArray?.strings(): List<String> =
    if (this == null) emptyList() else (0 until length()).map { getString(it) }
