package it.latereyes.remotecontroller.data

import android.content.Context

/** Indirizzi, token e accesso: restano nella memoria privata dell'app sul telefono. */
data class Settings(
    val agentUrl: String = "",
    val relayUrl: String = "",
    val relayToken: String = "",
    /** Token dell'agent (config.json): serve solo ad Andrea per scegliere la password al primo accesso. */
    val agentToken: String = "",
    /** Token di sessione dopo l'accesso con nome e password. */
    val sessionToken: String = "",
) {
    val isConfigured get() = agentUrl.isNotBlank()
    val isLoggedIn get() = sessionToken.isNotBlank()
    val canWake get() = relayUrl.isNotBlank()
}

class SettingsStore(context: Context) {
    private val prefs = context.getSharedPreferences("settings", Context.MODE_PRIVATE)

    fun load() = Settings(
        agentUrl = prefs.getString("agentUrl", "") ?: "",
        relayUrl = prefs.getString("relayUrl", "") ?: "",
        relayToken = prefs.getString("relayToken", "") ?: "",
        agentToken = prefs.getString("agentToken", "") ?: "",
        sessionToken = prefs.getString("sessionToken", "") ?: "",
    )

    fun save(s: Settings) {
        prefs.edit()
            .putString("agentUrl", normalizeUrl(s.agentUrl))
            .putString("relayUrl", normalizeUrl(s.relayUrl))
            .putString("relayToken", s.relayToken.trim())
            .putString("agentToken", s.agentToken.trim())
            .putString("sessionToken", s.sessionToken)
            .apply()
    }
}

/** "pc-casa:7070" → "http://pc-casa:7070", senza barra finale. */
fun normalizeUrl(raw: String): String {
    val s = raw.trim().trimEnd('/')
    if (s.isEmpty()) return s
    return if (s.startsWith("http://") || s.startsWith("https://")) s else "http://$s"
}
