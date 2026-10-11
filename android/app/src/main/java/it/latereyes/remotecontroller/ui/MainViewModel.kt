package it.latereyes.remotecontroller.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import it.latereyes.remotecontroller.data.AgentClient
import it.latereyes.remotecontroller.data.ApiException
import it.latereyes.remotecontroller.data.AppStatus
import it.latereyes.remotecontroller.data.Login
import it.latereyes.remotecontroller.data.Me
import it.latereyes.remotecontroller.data.RelayClient
import it.latereyes.remotecontroller.data.Settings
import it.latereyes.remotecontroller.data.SettingsStore
import it.latereyes.remotecontroller.data.SystemInfo
import it.latereyes.remotecontroller.data.UserInfo
import it.latereyes.remotecontroller.data.normalizeUrl
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class PcState { UNKNOWN, OFFLINE, WAKING, ONLINE }

data class LogsView(val appId: String, val appName: String, val lines: List<String>)

data class UiState(
    val settings: Settings = Settings(),
    val user: Me? = null,                // chi ha fatto l'accesso (null finché l'agent non risponde)
    val needsSetup: Boolean = false,     // primo accesso: Andrea deve scegliere la password
    val pc: PcState = PcState.UNKNOWN,
    val mode: String = "",               // "server" | "xbox" | "" (countdown non ancora eseguito)
    val apps: List<AppStatus> = emptyList(),
    val system: SystemInfo? = null,
    val users: List<UserInfo> = emptyList(),
    val busy: Set<String> = emptySet(),   // id delle app (o "gpu", "wake", "power", "login", "users") con un comando in corso
    val message: String? = null,
    val logs: LogsView? = null,
    val lastUpdate: Long = 0,
) {
    val isAdmin get() = user?.isAdmin == true
}

class MainViewModel(app: Application) : AndroidViewModel(app) {
    private val store = SettingsStore(app)
    private val _state = MutableStateFlow(UiState(settings = store.load()))
    val state: StateFlow<UiState> = _state.asStateFlow()

    /** Fino a quando considerare il PC "in accensione" dopo aver mandato il Wake-on-LAN. */
    private var wakingUntil = 0L

    private val agent get() = _state.value.settings.let { AgentClient(it.agentUrl, it.sessionToken) }

    fun saveSettings(s: Settings) {
        val old = _state.value.settings
        // Con un PC diverso l'accesso fatto sul vecchio non vale
        val session = if (normalizeUrl(s.agentUrl) == old.agentUrl) old.sessionToken else ""
        store.save(s.copy(sessionToken = session))
        _state.update { it.copy(settings = store.load(), pc = PcState.UNKNOWN, apps = emptyList(), system = null, user = if (session.isEmpty()) null else it.user) }
        viewModelScope.launch { refresh() }
    }

    fun dismissMessage() = _state.update { it.copy(message = null) }
    fun closeLogs() = _state.update { it.copy(logs = null) }

    /** Aggiorna lo stato finché la schermata è visibile: ogni 3 s mentre il PC si accende, altrimenti ogni 5 s. */
    suspend fun pollWhileVisible() {
        while (true) {
            refresh()
            delay(if (_state.value.pc == PcState.WAKING) 3000 else 5000)
        }
    }

    suspend fun refresh() {
        val s = _state.value.settings
        if (!s.isConfigured) return
        val client = agent
        val mode = client.health()
        if (mode == null) {
            val pc = if (System.currentTimeMillis() < wakingUntil) PcState.WAKING else PcState.OFFLINE
            _state.update { it.copy(pc = pc, apps = emptyList(), system = null, lastUpdate = System.currentTimeMillis()) }
            return
        }
        wakingUntil = 0
        if (!s.isLoggedIn) {
            val setup = runCatching { client.needsSetup() }.getOrDefault(false)
            _state.update { it.copy(pc = PcState.ONLINE, mode = mode, needsSetup = setup, lastUpdate = System.currentTimeMillis()) }
            return
        }
        try {
            val me = client.me()
            val apps = client.apps()
            // Dati tecnici (GPU, RAM, modelli) solo per l'amministratore
            val system = if (me.isAdmin) runCatching { client.system() }.getOrNull() else null
            _state.update { it.copy(pc = PcState.ONLINE, mode = mode, user = me, apps = apps, system = system ?: it.system.takeIf { me.isAdmin }, lastUpdate = System.currentTimeMillis()) }
        } catch (e: Exception) {
            if (e is ApiException && e.status == 401) signedOut("Accesso scaduto, entra di nuovo")
            else _state.update { it.copy(pc = PcState.ONLINE, message = e.message) }
        }
    }

    private fun signedOut(message: String?) {
        store.save(_state.value.settings.copy(sessionToken = ""))
        _state.update { it.copy(settings = store.load(), user = null, apps = emptyList(), system = null, users = emptyList(), message = message) }
    }

    private fun command(key: String, okMessage: String?, block: suspend () -> Unit) {
        if (key in _state.value.busy) return
        _state.update { it.copy(busy = it.busy + key) }
        viewModelScope.launch {
            try {
                block()
                if (okMessage != null) _state.update { it.copy(message = okMessage) }
            } catch (e: Exception) {
                if (e is ApiException && e.status == 401 && _state.value.settings.isLoggedIn) signedOut("Accesso scaduto, entra di nuovo")
                else _state.update { it.copy(message = e.message ?: "Errore di rete") }
            } finally {
                _state.update { it.copy(busy = it.busy - key) }
                refresh()
            }
        }
    }

    private fun signedIn(login: Login) {
        val s = _state.value.settings
        // Il relay del telefono di casa arriva dall'agent, se Andrea l'ha messo in config.json
        val relayUrl = login.user.relayUrl?.takeIf { s.relayUrl.isBlank() } ?: s.relayUrl
        val relayToken = login.user.relayToken?.takeIf { s.relayToken.isBlank() } ?: s.relayToken
        store.save(s.copy(sessionToken = login.token, relayUrl = relayUrl, relayToken = relayToken))
        _state.update { it.copy(settings = store.load(), user = login.user, needsSetup = false) }
    }

    fun login(name: String, password: String) = command("login", null) {
        signedIn(agent.login(name.trim(), password))
    }

    /** Primo accesso: Andrea sceglie la password (serve il token dell'agent, salvato per i prossimi primi accessi). */
    fun setup(agentToken: String, password: String) = command("login", "Password salvata") {
        val token = agentToken.trim()
        signedIn(agent.setup(token, password))
        store.save(_state.value.settings.copy(agentToken = token))
        _state.update { it.copy(settings = store.load()) }
    }

    fun logout() {
        val client = agent
        viewModelScope.launch { runCatching { client.logout() } }
        signedOut(null)
    }

    fun wake() = command("wake", "Richiesta di accensione inviata") {
        val s = _state.value.settings
        RelayClient(s.relayUrl, s.relayToken).wake()
        wakingUntil = System.currentTimeMillis() + 3 * 60 * 1000
        _state.update { it.copy(pc = PcState.WAKING) }
    }

    fun start(app: AppStatus) = command(app.id, null) { agent.start(app.id) }
    fun stop(app: AppStatus) = command(app.id, "${app.name} chiusa") { agent.stop(app.id) }
    fun freeGpu() = command("gpu", "VRAM liberata") { agent.freeGpu() }

    fun power(action: String) = command("power", when (action) {
        "shutdown" -> "Il PC si spegne"
        "restart" -> "Il PC si riavvia"
        else -> "Il PC va in sospensione"
    }) {
        agent.power(action)
        _state.update { it.copy(pc = PcState.OFFLINE) }
    }

    fun showLogs(app: AppStatus) = command("logs-${app.id}", null) {
        val lines = agent.logs(app.id)
        _state.update { it.copy(logs = LogsView(app.id, app.name, lines)) }
    }

    // ---- Utenti (solo amministratore) ----

    fun loadUsers() = command("users", null) {
        val list = agent.users()
        _state.update { it.copy(users = list) }
    }

    fun createUser(name: String, password: String, apps: List<String>) = command("users", "Utente $name creato") {
        agent.createUser(name.trim(), password, apps)
        _state.update { it.copy(users = agent.users()) }
    }

    fun updateUser(name: String, apps: List<String>, password: String) = command("users", "Utente $name aggiornato") {
        agent.updateUser(name, apps, password.ifEmpty { null })
        _state.update { it.copy(users = agent.users()) }
    }

    fun deleteUser(name: String) = command("users", "Utente $name eliminato") {
        agent.deleteUser(name)
        _state.update { it.copy(users = agent.users()) }
    }
}
