package it.latereyes.remotecontroller.data

import android.content.Context

/** Indirizzi e token: restano nella memoria privata dell'app sul telefono. */
data class Settings(
    val agentUrl: String = "",
    val agentToken: String = "",
    val relayUrl: String = "",
    val relayToken: String = "",
) {
    val isConfigured get() = agentUrl.isNotBlank() && agentToken.isNotBlank()
    val canWake get() = relayUrl.isNotBlank()
}

class SettingsStore(context: Context) {
    private val prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE)

    fun load() = Settings(
        agentUrl = prefs.getString("agentUrl", "") ?: "",
        agentToken = prefs.getString("agentToken", "") ?: "",
        relayUrl = prefs.getString("relayUrl", "") ?: "",
        relayToken = prefs.getString("relayToken", "") ?: "",
    )

    fun save(s: Settings) {
        prefs.edit()
            .putString("agentUrl", normalizeUrl(s.agentUrl))
            .putString("agentToken", s.agentToken.trim())
            .putString("relayUrl", normalizeUrl(s.relayUrl))
            .putString("relayToken", s.relayToken.trim())
            .apply()
    }
}

/** "pc-casa:7070" → "http://pc-casa:7070", senza barra finale. */
fun normalizeUrl(raw: String): String {
    val s = raw.trim().trimEnd('/')
    if (s.isEmpty()) return s
    return if (s.startsWith("http://") || s.startsWith("https://")) s else "http://$s"
}
