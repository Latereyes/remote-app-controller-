package it.latereyes.remotecontroller.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

class ApiException(val status: Int, message: String) : IOException(message)

/** Richiesta HTTP con token; restituisce il corpo della risposta o lancia ApiException / IOException. */
internal suspend fun request(
    baseUrl: String,
    path: String,
    token: String?,
    method: String = "GET",
    timeoutMs: Int = 8000,
): String = withContext(Dispatchers.IO) {
    val conn = URL(baseUrl + path).openConnection() as HttpURLConnection
    try {
        conn.requestMethod = method
        conn.connectTimeout = minOf(timeoutMs, 5000)
        conn.readTimeout = timeoutMs
        if (!token.isNullOrBlank()) conn.setRequestProperty("Authorization", "Bearer $token")
        if (method == "POST") {
            conn.doOutput = true
            conn.setFixedLengthStreamingMode(0)
        }
        val code = conn.responseCode
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val body = stream?.bufferedReader()?.use { it.readText() } ?: ""
        if (code !in 200..299) {
            val msg = errorMessage(body) ?: when (code) {
                401 -> "Token sbagliato"
                429 -> "Troppi tentativi, riprova tra un minuto"
                else -> "Errore HTTP $code"
            }
            throw ApiException(code, msg)
        }
        body
    } finally {
        conn.disconnect()
    }
}

/** Client dell'agent sul PC (vedi agent/README nella repository). */
class AgentClient(private val baseUrl: String, private val token: String) {

    /** null se l'agent non risponde, altrimenti la modalità scelta all'accensione ("server", "xbox" o ""). */
    suspend fun health(): String? = runCatching {
        val o = JSONObject(request(baseUrl, "/api/health", null, timeoutMs = 3000))
        if (o.optBoolean("ok")) (if (o.isNull("mode")) "" else o.optString("mode")) else null
    }.getOrNull()

    suspend fun apps(): List<AppStatus> = AppStatus.listFromJson(request(baseUrl, "/api/apps", token))

    suspend fun start(id: String): AppStatus =
        AppStatus.fromJson(JSONObject(request(baseUrl, "/api/apps/$id/start", token, "POST")))

    suspend fun stop(id: String): AppStatus =
        AppStatus.fromJson(JSONObject(request(baseUrl, "/api/apps/$id/stop", token, "POST", timeoutMs = 60000)))

    suspend fun logs(id: String, lines: Int = 200): List<String> {
        val arr: JSONArray = JSONObject(request(baseUrl, "/api/apps/$id/logs?lines=$lines", token)).getJSONArray("lines")
        return (0 until arr.length()).map { arr.getString(it) }
    }

    suspend fun system(): SystemInfo = SystemInfo.fromJson(request(baseUrl, "/api/system", token, timeoutMs = 10000))

    suspend fun freeGpu() { request(baseUrl, "/api/gpu/free", token, "POST", timeoutMs = 60000) }

    /** action: shutdown | restart | sleep */
    suspend fun power(action: String) { request(baseUrl, "/api/system/$action", token, "POST") }
}

/** Relay Wake-on-LAN sul telefono vecchio: POST /wake manda il magic packet al PC. */
class RelayClient(private val baseUrl: String, private val token: String) {
    suspend fun wake() { request(baseUrl, "/wake", token, "POST", timeoutMs = 8000) }
}
