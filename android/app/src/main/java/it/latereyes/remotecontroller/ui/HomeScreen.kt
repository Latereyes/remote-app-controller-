package it.latereyes.remotecontroller.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import it.latereyes.remotecontroller.data.AppStatus
import it.latereyes.remotecontroller.data.SystemInfo
import it.latereyes.remotecontroller.data.resolveOpenUrl
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(state: UiState, vm: MainViewModel, onSettings: () -> Unit) {
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var confirmPower by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(state.message) {
        state.message?.let { snackbar.showSnackbar(it); vm.dismissMessage() }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("PC Remoto") },
                actions = {
                    IconButton(onClick = { scope.launch { vm.refresh() } }) { Icon(Icons.Default.Refresh, "Aggiorna") }
                    IconButton(onClick = onSettings) { Icon(Icons.Default.Settings, "Impostazioni") }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item { PcCard(state, vm, onPower = { confirmPower = it }) }
            if (state.pc == PcState.ONLINE) {
                state.system?.let { sys -> item { GpuCard(sys, busy = "gpu" in state.busy, onFree = vm::freeGpu) } }
                item { Text("App", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 4.dp)) }
                items(state.apps, key = { it.id }) { app ->
                    AppCard(app, agentUrl = state.settings.agentUrl, busy = app.id in state.busy, vm = vm)
                }
            }
        }
    }

    confirmPower?.let { action ->
        val label = powerLabel(action)
        AlertDialog(
            onDismissRequest = { confirmPower = null },
            title = { Text("$label il PC?") },
            text = { Text("Le app aperte verranno chiuse.") },
            confirmButton = { TextButton(onClick = { vm.power(action); confirmPower = null }) { Text(label) } },
            dismissButton = { TextButton(onClick = { confirmPower = null }) { Text("Annulla") } },
        )
    }

    state.logs?.let { logs -> LogsDialog(logs, onClose = vm::closeLogs) }
}

private fun powerLabel(action: String) = when (action) {
    "shutdown" -> "Spegni"
    "restart" -> "Riavvia"
    else -> "Sospendi"
}

@Composable
private fun Dot(color: Color) {
    Box(Modifier.size(10.dp).clip(CircleShape).background(color))
}

@Composable
private fun PcCard(state: UiState, vm: MainViewModel, onPower: (String) -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            val (color, text) = when (state.pc) {
                PcState.ONLINE -> Green to "Acceso, modalità server"
                PcState.WAKING -> Amber to "In accensione…"
                PcState.OFFLINE -> Grey to "Spento o non raggiungibile"
                PcState.UNKNOWN -> Grey to "Controllo…"
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Dot(color)
                Spacer(Modifier.width(8.dp))
                Text(text, style = MaterialTheme.typography.titleMedium)
            }
            state.system?.takeIf { state.pc == PcState.ONLINE }?.let { sys ->
                Text("${sys.hostname} · acceso da ${formatUptime(sys.uptimeSec)} · RAM libera ${sys.memFreeMiB / 1024} di ${sys.memTotalMiB / 1024} GB",
                    style = MaterialTheme.typography.bodySmall)
            }
            if (state.pc == PcState.WAKING) LinearProgressIndicator(Modifier.fillMaxWidth())

            when (state.pc) {
                PcState.OFFLINE, PcState.WAKING, PcState.UNKNOWN -> {
                    if (state.settings.canWake) {
                        Button(onClick = vm::wake, enabled = "wake" !in state.busy && state.pc != PcState.WAKING, modifier = Modifier.fillMaxWidth()) {
                            Text("Accendi il PC")
                        }
                    } else {
                        Text("Per accendere il PC da qui imposta il relay del telefono di casa nelle impostazioni.",
                            style = MaterialTheme.typography.bodySmall)
                    }
                }
                PcState.ONLINE -> {
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        val off = "power" in state.busy
                        OutlinedButton(onClick = { onPower("shutdown") }, enabled = !off) { Text("Spegni") }
                        OutlinedButton(onClick = { onPower("restart") }, enabled = !off) { Text("Riavvia") }
                        OutlinedButton(onClick = { onPower("sleep") }, enabled = !off) { Text("Sospendi") }
                    }
                }
            }
        }
    }
}

@Composable
private fun GpuCard(sys: SystemInfo, busy: Boolean, onFree: () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("GPU", style = MaterialTheme.typography.titleMedium)
            val gpus = sys.gpus
            if (gpus.isNullOrEmpty()) {
                Text("Dati non disponibili (nvidia-smi non risponde)", style = MaterialTheme.typography.bodySmall)
            }
            gpus?.forEach { g ->
                val used = g.memUsedMiB ?: 0
                val total = g.memTotalMiB ?: 0
                Text(g.name, style = MaterialTheme.typography.bodyMedium)
                if (total > 0) LinearProgressIndicator(progress = { used.toFloat() / total }, modifier = Modifier.fillMaxWidth())
                Text(listOfNotNull(
                    if (total > 0) "VRAM %.1f / %.1f GB".format(used / 1024f, total / 1024f) else null,
                    g.utilPct?.let { "carico $it%" },
                    g.tempC?.let { "$it °C" },
                ).joinToString(" · "), style = MaterialTheme.typography.bodySmall)
            }
            val models = sys.ollamaModels
            Text(
                when {
                    models == null -> "Ollama spento"
                    models.isEmpty() -> "Nessun modello Ollama in memoria"
                    else -> "In memoria: " + models.joinToString { "${it.name} (%.1f GB)".format(it.sizeVramMiB / 1024f) }
                },
                style = MaterialTheme.typography.bodySmall,
            )
            OutlinedButton(onClick = onFree, enabled = !busy) {
                if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Text("Libera VRAM")
            }
        }
    }
}

@Composable
private fun AppCard(app: AppStatus, agentUrl: String, busy: Boolean, vm: MainViewModel) {
    val context = LocalContext.current
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Dot(when { app.isRunning -> Green; app.isBusy -> Amber; else -> Grey })
                Spacer(Modifier.width(8.dp))
                Text(app.name, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                Text(stateLabel(app), style = MaterialTheme.typography.bodySmall)
            }
            app.lastError?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            if (app.requires.isNotEmpty() && !app.isRunning) {
                Text("Avvia anche: ${app.requires.joinToString()}", style = MaterialTheme.typography.bodySmall)
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                when {
                    busy || app.isBusy -> Row(verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    }
                    app.isRunning -> OutlinedButton(onClick = { vm.stop(app) }) { Text("Ferma") }
                    else -> Button(onClick = { vm.start(app) }) { Text("Avvia") }
                }
                if (app.isRunning && app.openUrl != null) {
                    OutlinedButton(onClick = {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(resolveOpenUrl(app.openUrl, agentUrl))))
                    }) { Text("Apri") }
                }
                if (app.managed) TextButton(onClick = { vm.showLogs(app) }) { Text("Log") }
            }
        }
    }
}

private fun stateLabel(app: AppStatus) = when (app.state) {
    "running" -> if (app.managed) "attiva" else "attiva (avviata fuori dall'agent)"
    "starting" -> "in avvio…"
    "stopping" -> "in chiusura…"
    else -> "ferma"
}

private fun formatUptime(sec: Long): String {
    val h = sec / 3600
    val m = (sec % 3600) / 60
    return if (h > 0) "${h} h ${m} min" else "$m min"
}

@Composable
private fun LogsDialog(logs: LogsView, onClose: () -> Unit) {
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Log di ${logs.appName}") },
        text = {
            Box(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState(Int.MAX_VALUE))) {
                SelectionContainer {
                    Text(
                        if (logs.lines.isEmpty()) "Nessuna riga" else logs.lines.joinToString("\n"),
                        fontFamily = FontFamily.Monospace, fontSize = 11.sp, fontWeight = FontWeight.Normal,
                    )
                }
            }
        },
        confirmButton = { TextButton(onClick = onClose) { Text("Chiudi") } },
    )
}
