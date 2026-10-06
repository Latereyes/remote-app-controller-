package it.latereyes.remotecontroller.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import it.latereyes.remotecontroller.data.AgentClient
import it.latereyes.remotecontroller.data.AppStatus
import it.latereyes.remotecontroller.data.RelayClient
import it.latereyes.remotecontroller.data.Settings
import it.latereyes.remotecontroller.data.SettingsStore
import it.latereyes.remotecontroller.data.SystemInfo
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
    val pc: PcState = PcState.UNKNOWN,
    val mode: String = "",               // "server" | "xbox" | "" (countdown non ancora eseguito)
    val apps: List<AppStatus> = emptyList(),
    val system: SystemInfo? = null,
    val busy: Set<String> = emptySet(),   // id delle app (o "gpu", "wake", "power") con un comando in corso
    val message: String? = null,
    val logs: LogsView? = null,
    val lastUpdate: Long = 0,
)

class MainViewModel(app: Application) : AndroidViewModel(app) {
    private val store = SettingsStore(app)
    private val _state = MutableStateFlow(UiState(settings = store.load()))
    val state: StateFlow<UiState> = _state.asStateFlow()

    /** Fino a quando considerare il PC "in accensione" dopo aver mandato il Wake-on-LAN. */
    private var wakingUntil = 0L

    private val agent get() = _state.value.settings.let { AgentClient(it.agentUrl, it.agentToken) }

    fun saveSettings(s: Settings) {
        store.save(s)
        _state.update { it.copy(settings = store.load(), pc = PcState.UNKNOWN, apps = emptyList(), system = null) }
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
        try {
            val apps = client.apps()
            val system = runCatching { client.system() }.getOrNull()
            _state.update { it.copy(pc = PcState.ONLINE, mode = mode, apps = apps, system = system ?: it.system, lastUpdate = System.currentTimeMillis()) }
        } catch (e: Exception) {
            _state.update { it.copy(pc = PcState.ONLINE, message = e.message) }
        }
    }

    private fun command(key: String, okMessage: String?, block: suspend () -> Unit) {
        if (key in _state.value.busy) return
        _state.update { it.copy(busy = it.busy + key) }
        viewModelScope.launch {
            try {
                block()
                if (okMessage != null) _state.update { it.copy(message = okMessage) }
            } catch (e: Exception) {
                _state.update { it.copy(message = e.message ?: "Errore di rete") }
            } finally {
                _state.update { it.copy(busy = it.busy - key) }
                refresh()
            }
        }
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
}
