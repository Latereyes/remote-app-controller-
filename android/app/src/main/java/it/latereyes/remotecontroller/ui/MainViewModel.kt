package it.latereyes.remotecontroller.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import it.latereyes.remotecontroller.ApprovalService
import it.latereyes.remotecontroller.data.AgentClient
import it.latereyes.remotecontroller.data.ApiException
import it.latereyes.remotecontroller.data.AppStatus
import it.latereyes.remotecontroller.data.Approval
import it.latereyes.remotecontroller.data.ClaudeStatus
import it.latereyes.remotecontroller.data.DisplaysInfo
import it.latereyes.remotecontroller.data.GamingInfo
import it.latereyes.remotecontroller.data.SshInfo
import it.latereyes.remotecontroller.data.Login
import it.latereyes.remotecontroller.data.Me
import it.latereyes.remotecontroller.data.RelayClient
import it.latereyes.remotecontroller.data.Settings
import it.latereyes.remotecontroller.data.SettingsStore
import it.latereyes.remotecontroller.data.SystemInfo
import it.latereyes.remotecontroller.data.UserInfo
import it.latereyes.remotecontroller.data.normalizeUrl
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class PcState { UNKNOWN, OFFLINE, WAKING, ONLINE }

data class LogsView(val appId: String, val appName: String, val lines: List<String>)

/** Terminale aperto sul PC: output accumulato (ultimi 200 000 caratteri) e se la shell è ancora viva. */
data class TerminalView(val id: String?, val text: String = "", val alive: Boolean = true, val error: String? = null)

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
    // Agent 0.2: con un agent vecchio restano null e i pannelli non compaiono
    val displays: DisplaysInfo? = null,
    val gaming: GamingInfo? = null,
    val claude: ClaudeStatus? = null,
    val ssh: SshInfo? = null,
    val approvals: List<Approval> = emptyList(),
    val terminal: TerminalView? = null,
) {
    /** Pannello gioco: in modalità Xbox, o quando c'è un gioco aperto o Moonlight collegato. */
    val showGaming get() = gaming != null && (gaming.active || mode == "xbox")

    val isAdmin get() = user?.isAdmin == true
    /** Amministratore anche col PC spento (ruolo dell'ultimo accesso). */
    val wasAdmin get() = user?.isAdmin ?: (settings.isLoggedIn && settings.role == "admin")
}

class MainViewModel(app: Application) : AndroidViewModel(app) {
    private val store = SettingsStore(app)
    private val _state = MutableStateFlow(UiState(settings = store.load()))
    val state: StateFlow<UiState> = _state.asStateFlow()

    /** Fino a quando considerare il PC "in accensione" dopo aver mandato il Wake-on-LAN. */
    private var wakingUntil = 0L

    /** «Accendi per giocare»: appena l'agent risponde gli si dice di restare in modalità Xbox. */
    private var gameRequested = false

    private val agent get() = _state.value.settings.let { AgentClient(it.agentUrl, it.sessionToken) }

    fun saveSettings(s: Settings) {
        val old = _state.value.settings
        // Con un PC diverso l'accesso fatto sul vecchio non vale
        val session = if (normalizeUrl(s.agentUrl) == old.agentUrl) old.sessionToken else ""
        store.save(s.copy(sessionToken = session))
        _state.update { it.copy(settings = store.load(), pc = PcState.UNKNOWN, apps = emptyList(), system = null, user = if (session.isEmpty()) null else it.user) }
        viewModelScope.launch { refresh() }
    }

    fun showMessage(text: String) = _state.update { it.copy(message = text) }
    fun dismissMessage() = _state.update { it.copy(message = null) }
    fun closeLogs() = _state.update { it.copy(logs = null) }

    /** Aggiorna lo stato finché la schermata è visibile: ogni 3 s mentre il PC si accende, altrimenti ogni 5 s. */
    suspend fun pollWhileVisible() {
        while (true) {
            refresh()
            // Mentre si gioca i dati della GPU cambiano in fretta: ogni 2 s
            delay(when {
                _state.value.pc == PcState.WAKING -> 3000
                _state.value.showGaming && _state.value.gaming?.active == true -> 2000
                else -> 5000
            })
        }
    }

    suspend fun refresh() {
        val s = _state.value.settings
        if (!s.isConfigured) return
        val client = agent
        val mode = client.health()
        if (mode == null) {
            val pc = if (System.currentTimeMillis() < wakingUntil) PcState.WAKING else PcState.OFFLINE
            if (pc == PcState.OFFLINE) gameRequested = false
            _state.update { it.copy(pc = pc, apps = emptyList(), system = null, lastUpdate = System.currentTimeMillis()) }
            return
        }
        wakingUntil = 0
        if (!s.isLoggedIn) {
            val setup = runCatching { client.needsSetup() }.getOrDefault(false)
            _state.update { it.copy(pc = PcState.ONLINE, mode = mode, needsSetup = setup, lastUpdate = System.currentTimeMillis()) }
            return
        }
        if (gameRequested) {
            gameRequested = false
            runCatching { client.gameMode() }
                .onSuccess { _state.update { it.copy(message = "Il PC resta in modalità gioco: collegati con Moonlight") } }
                .onFailure { e -> _state.update { it.copy(message = "Modalità gioco non riuscita: ${e.message}") } }
        }
        try {
            val me = client.me()
            if (me.role != s.role) store.save(s.copy(role = me.role))
            val apps = client.apps()
            // Dati tecnici (GPU, RAM, modelli) solo per l'amministratore
            val extra = if (me.isAdmin) adminData(client) else AdminData()
            _state.update {
                it.copy(
                    settings = store.load(), pc = PcState.ONLINE, mode = mode, user = me, apps = apps,
                    system = extra.system ?: it.system.takeIf { me.isAdmin },
                    displays = extra.displays, gaming = extra.gaming, claude = extra.claude, ssh = extra.ssh, approvals = extra.approvals,
                    lastUpdate = System.currentTimeMillis(),
                )
            }
            // Claude acceso con i permessi dall'app: le richieste arrivano anche come notifiche ad app chiusa
            if (extra.claude?.running == true && extra.claude.approvals) ApprovalService.start(getApplication<Application>())
        } catch (e: Exception) {
            if (e is ApiException && e.status == 401) signedOut("Accesso scaduto, entra di nuovo")
            else _state.update { it.copy(pc = PcState.ONLINE, message = e.message) }
        }
    }

    private data class AdminData(
        val system: SystemInfo? = null,
        val displays: DisplaysInfo? = null,
        val gaming: GamingInfo? = null,
        val claude: ClaudeStatus? = null,
        val ssh: SshInfo? = null,
        val approvals: List<Approval> = emptyList(),
    )

    /** Dati dell'amministratore, in parallelo; ognuno può mancare (agent vecchio, Tailscale spento...). */
    private suspend fun adminData(client: AgentClient): AdminData = coroutineScope {
        val system = async { runCatching { client.system() }.getOrNull() }
        val displays = async { runCatching { client.displays() }.getOrNull() }
        val gaming = async { runCatching { client.gaming() }.getOrNull() }
        val claude = async { runCatching { client.claude() }.getOrNull() }
        val ssh = async { runCatching { client.ssh() }.getOrNull() }
        val approvals = async { runCatching { client.approvals() }.getOrDefault(emptyList()) }
        AdminData(system.await(), displays.await(), gaming.await(), claude.await(), ssh.await(), approvals.await())
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
        store.save(s.copy(sessionToken = login.token, relayUrl = relayUrl, relayToken = relayToken, role = login.user.role))
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

    /** Accende il PC per giocare (Steam Deck): niente modalità server, Ollama e ComfyUI restano spenti. */
    fun wakeForGame() = command("wake", "Accensione per giocare inviata") {
        val s = _state.value.settings
        RelayClient(s.relayUrl, s.relayToken).wake()
        gameRequested = true
        wakingUntil = System.currentTimeMillis() + 3 * 60 * 1000
        _state.update { it.copy(pc = PcState.WAKING) }
    }

    /** PC già acceso in modalità server: chiude Ollama e ComfyUI e torna in modalità Xbox per giocare. */
    fun gameMode() = command("game", "Modalità gioco: collegati con Moonlight") {
        val mode = agent.gameMode()
        _state.update { it.copy(mode = mode) }
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

    // ---- Claude e permessi ----

    fun startClaude() = command("claude", "Claude si apre sul PC: lo trovi nell'app Claude tra le sessioni") {
        val st = agent.startClaude()
        _state.update { it.copy(claude = st) }
        if (st.approvals) ApprovalService.start(getApplication<Application>())
    }

    fun stopClaude() = command("claude", "Claude chiuso") {
        _state.update { it.copy(claude = agent.stopClaude()) }
    }

    fun decide(a: Approval, allow: Boolean) = command("approval-${a.id}", if (allow) "Consentito" else "Rifiutato") {
        agent.decide(a.id, allow)
        _state.update { it.copy(approvals = it.approvals.filter { x -> x.id != a.id }) }
        ApprovalService.cancelNotification(getApplication<Application>(), a.id)
    }

    // ---- Terminale ----

    private var terminalJob: Job? = null

    /** Apre un terminale (PowerShell) sul PC e ne legge l'output finché resta aperto. */
    fun openTerminal() {
        if (_state.value.terminal?.id != null && _state.value.terminal?.alive == true) return
        _state.update { it.copy(terminal = TerminalView(id = null, text = "Apro il terminale sul PC…\n")) }
        terminalJob?.cancel()
        terminalJob = viewModelScope.launch {
            val client = agent
            val id = try {
                client.openTerminal()
            } catch (e: Exception) {
                _state.update { it.copy(terminal = TerminalView(id = null, alive = false, error = e.message ?: "Errore di rete")) }
                return@launch
            }
            _state.update { it.copy(terminal = TerminalView(id = id, text = "")) }
            var since = 0L
            var errors = 0
            while (isActive) {
                try {
                    val chunk = client.readTerminal(id, since)
                    errors = 0
                    since = chunk.next
                    _state.update { s ->
                        val t = s.terminal ?: return@update s
                        if (t.id != id) return@update s
                        s.copy(terminal = t.copy(text = (t.text + chunk.text).takeLast(200_000), alive = chunk.alive))
                    }
                    if (!chunk.alive) break
                } catch (e: Exception) {
                    if (e is ApiException && e.status in setOf(403, 404)) {
                        _state.update { s -> s.copy(terminal = s.terminal?.copy(alive = false, error = e.message)) }
                        break
                    }
                    // Rete che va e viene (telefono che cambia rete): riprova con calma
                    if (++errors > 20) {
                        _state.update { s -> s.copy(terminal = s.terminal?.copy(alive = false, error = "Collegamento perso: ${e.message}")) }
                        break
                    }
                    delay(1500)
                }
            }
        }
    }

    fun sendTerminal(line: String) {
        val id = _state.value.terminal?.id ?: return
        val client = agent
        viewModelScope.launch {
            runCatching { client.sendTerminal(id, line) }
                .onFailure { e -> _state.update { it.copy(message = "Comando non inviato: ${e.message}") } }
        }
    }

    /** Chiude la shell sul PC (anche per fermare un comando bloccato) e lascia la schermata. */
    fun closeTerminal() {
        val id = _state.value.terminal?.id
        terminalJob?.cancel()
        terminalJob = null
        _state.update { it.copy(terminal = null) }
        if (id != null) {
            val client = agent
            viewModelScope.launch { runCatching { client.closeTerminal(id) } }
        }
    }

    /** Termina la shell e ne apre una nuova (equivale a Ctrl+C, che senza console vera non si può mandare). */
    fun restartTerminal() {
        closeTerminal()
        openTerminal()
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
