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

private fun JSONArray?.strings(): List<String> =
    if (this == null) emptyList() else (0 until length()).map { getString(it) }
