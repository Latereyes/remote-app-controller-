package it.latereyes.remotecontroller.ui

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import it.latereyes.remotecontroller.data.SshInfo
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.graphics.Brush
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.core.content.ContextCompat
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
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
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
fun HomeScreen(state: UiState, vm: MainViewModel, onSettings: () -> Unit, onUsers: () -> Unit, onTerminal: () -> Unit) {
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var confirmPower by remember { mutableStateOf<String?>(null) }
    var menu by remember { mutableStateOf(false) }
    val admin = state.isAdmin
    val context = LocalContext.current
    // Android 13+: le richieste di permesso di Claude arrivano come notifiche solo se l'app può mandarle
    val notifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    fun askNotifications() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    LaunchedEffect(state.message) {
        state.message?.let { snackbar.showSnackbar(it); vm.dismissMessage() }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("PC Remoto", fontWeight = FontWeight.Bold) },
                actions = {
                    IconButton(onClick = { scope.launch { vm.refresh() } }) { Icon(Icons.Default.Refresh, "Aggiorna") }
                    if (admin) IconButton(onClick = onUsers) { Icon(Icons.Default.Person, "Utenti") }
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, "Altro") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text("Impostazioni") }, leadingIcon = { Icon(Icons.Default.Settings, null) },
                                onClick = { menu = false; onSettings() })
                            DropdownMenuItem(text = { Text("Esci (${state.user?.name ?: ""})") }, onClick = { menu = false; vm.logout() })
                        }
                    }
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
                // GPU, RAM, log e alimentazione solo per l'amministratore: gli altri vedono le loro app e basta
                if (admin) {
                    // Prima le domande che aspettano una risposta, poi il gioco se si sta giocando
                    if (state.approvals.isNotEmpty()) item { ApprovalsPanel(state.approvals, state.busy, onDecide = vm::decide) }
                    if (state.showGaming) state.gaming?.let { g -> item { GamingPanel(g) } }
                    if (state.ssh != null || state.claude != null) item {
                        TerminalPanel(state.ssh, onSsh = { ssh -> openSsh(context, ssh, state.settings.agentUrl, vm) }, onQuick = onTerminal)
                    }
                    state.claude?.let { c ->
                        item {
                            ClaudePanel(c, busy = "claude" in state.busy, onStart = {
                                askNotifications()
                                vm.startClaude()
                            }, onStop = vm::stopClaude, onOpenClaude = { openClaudeApp(context) })
                        }
                    }
                    state.displays?.let { d -> item { DisplaysPanel(d) } }
                    state.system?.let { sys -> item { GpuCard(sys, busy = "gpu" in state.busy, onFree = vm::freeGpu) } }
                }
                // Due gruppi distinti: i motori AI che usano la GPU (blu) e le app che ci girano sopra (ognuna col suo colore)
                val engines = state.apps.filter { it.isEngine }
                val others = state.apps.filter { !it.isEngine }
                if (engines.isNotEmpty()) {
                    item { SectionHeader("Motori AI", "Si dividono la GPU: uno alla volta in memoria", EngineAccent) }
                    items(engines, key = { it.id }) { app ->
                        if (admin) AppCard(app, agentUrl = state.settings.agentUrl, busy = app.id in state.busy, vm = vm)
                        else UserAppCard(app, agentUrl = state.settings.agentUrl, busy = app.id in state.busy, vm = vm)
                    }
                }
                item { SectionHeader(if (admin) "App" else "Le tue app", if (admin) "Usano i motori qui sopra quando servono" else null, MaterialTheme.colorScheme.primary) }
                if (!admin && state.apps.isEmpty()) {
                    item { Text("Nessuna app abilitata: chiedi ad Andrea.", style = MaterialTheme.typography.bodySmall) }
                }
                items(others, key = { it.id }) { app ->
                    if (admin) AppCard(app, agentUrl = state.settings.agentUrl, busy = app.id in state.busy, vm = vm)
                    else UserAppCard(app, agentUrl = state.settings.agentUrl, busy = app.id in state.busy, vm = vm)
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
internal fun Dot(color: Color) {
    Box(Modifier.size(10.dp).clip(CircleShape).background(color))
}

@Composable
private fun PcCard(state: UiState, vm: MainViewModel, onPower: (String) -> Unit) {
    val admin = state.isAdmin
    val (color, text) = when (state.pc) {
        PcState.ONLINE -> Green to when {
            !admin -> "Acceso"
            state.gaming?.stream?.streaming == true -> "Acceso, in stream con Moonlight"
            state.mode == "server" -> "Acceso, modalità server"
            state.mode == "xbox" -> "Acceso, modalità Xbox"
            else -> "Acceso"
        }
        PcState.WAKING -> Amber to "In accensione…"
        PcState.OFFLINE -> Grey to "Spento o non raggiungibile"
        PcState.UNKNOWN -> Grey to "Controllo…"
    }
    // Testata con una sfumatura del colore di stato: si capisce a colpo d'occhio se il PC è acceso
    Card(
        Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Column(
            Modifier.background(Brush.verticalGradient(listOf(color.copy(alpha = 0.22f), Color.Transparent))).padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(14.dp).clip(CircleShape).background(color))
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(text, style = MaterialTheme.typography.titleLarge)
                    state.system?.takeIf { admin && state.pc == PcState.ONLINE }?.let { sys ->
                        Text("${sys.hostname} · acceso da ${formatUptime(sys.uptimeSec)}",
                            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            state.system?.takeIf { admin && state.pc == PcState.ONLINE }?.let { sys ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    val g = sys.gpus?.firstOrNull()
                    val usedRam = (sys.memTotalMiB - sys.memFreeMiB) / 1024f
                    StatTile("RAM", "%.0f/%.0f GB".format(usedRam, sys.memTotalMiB / 1024f), Modifier.weight(1f))
                    StatTile("GPU", g?.utilPct?.let { "$it%" } ?: "–", Modifier.weight(1f))
                    StatTile("TEMP GPU", g?.tempC?.let { "$it °C" } ?: "–", Modifier.weight(1f),
                        color = levelColor((g?.tempC ?: 0) / 90f, 0.8f, 0.92f))
                }
            }
            if (state.pc == PcState.WAKING) LinearProgressIndicator(Modifier.fillMaxWidth())

            when (state.pc) {
                PcState.OFFLINE, PcState.WAKING, PcState.UNKNOWN -> {
                    if (state.settings.canWake) {
                        Button(onClick = vm::wake, enabled = "wake" !in state.busy && state.pc != PcState.WAKING, modifier = Modifier.fillMaxWidth()) {
                            Text("Accendi il PC")
                        }
                        // Solo l'amministratore: per giocare il countdown non avvia Ollama e ComfyUI
                        if (state.wasAdmin) OutlinedButton(onClick = vm::wakeForGame, enabled = "wake" !in state.busy && state.pc != PcState.WAKING, modifier = Modifier.fillMaxWidth()) {
                            Text("Accendi per giocare (Steam Deck)")
                        }
                    } else {
                        Text("Per accendere il PC da qui imposta il relay del telefono di casa nelle impostazioni.",
                            style = MaterialTheme.typography.bodySmall)
                    }
                }
                PcState.ONLINE -> if (admin) {
                    if (state.mode != "xbox") {
                        FilledTonalButton(onClick = vm::gameMode, enabled = "game" !in state.busy, modifier = Modifier.fillMaxWidth()) {
                            Text("Passa a modalità gioco")
                        }
                    }
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

/**
 * Terminale del PC: quello vero è SSH (client del telefono con la chiave, solo via Tailscale);
 * «Comandi rapidi» è la shell dentro l'app, comoda per un comando al volo senza client SSH.
 */
@Composable
private fun TerminalPanel(ssh: SshInfo?, onSsh: (SshInfo) -> Unit, onQuick: () -> Unit) {
    Panel("Terminale del PC", trailing = {
        when {
            ssh?.running == true -> Pill("ssh attivo", Green)
            ssh?.installed == true -> Pill("ssh spento", Amber)
            else -> Pill("ssh da attivare", Grey)
        }
    }) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(40.dp).clip(MaterialTheme.shapes.medium).background(MaterialTheme.colorScheme.primaryContainer), contentAlignment = Alignment.Center) {
                Text(">_", fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onPrimaryContainer)
            }
            Spacer(Modifier.width(12.dp))
            Text(
                when {
                    ssh?.running == true -> "PowerShell del PC via SSH come ${ssh.user}, con la chiave del telefono e solo attraverso Tailscale."
                    ssh?.installed == true -> "Il server SSH è installato ma spento: avvialo dal terminale qui sotto con «Start-Service sshd»."
                    else -> "Per il terminale vero lancia una volta boot\\installa-ssh.ps1 sul PC con la chiave pubblica del telefono."
                },
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (ssh?.running == true) Button(onClick = { onSsh(ssh) }) { Text("Apri SSH") }
            OutlinedButton(onClick = onQuick) { Text("Comandi rapidi") }
        }
    }
}

/**
 * Apre il client SSH del telefono (Termius, JuiceSSH, ConnectBot...) con ssh://utente@pc:porta.
 * Se nessuna app sa aprirlo, copia il comando, da incollare per esempio in Termux.
 */
private fun openSsh(context: Context, ssh: SshInfo, agentUrl: String, vm: MainViewModel) {
    val host = resolveOpenUrl("{host}", agentUrl)
    val uri = Uri.parse("ssh://${Uri.encode(ssh.user)}@$host:${ssh.port}")
    val intent = Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val ok = runCatching { context.startActivity(intent) }.isSuccess
    if (!ok) {
        val cmd = "ssh ${ssh.user}@$host" + if (ssh.port != 22) " -p ${ssh.port}" else ""
        val clip = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clip.setPrimaryClip(ClipData.newPlainText("ssh", cmd))
        vm.showMessage("Nessuna app SSH trovata: ho copiato «$cmd» (incollalo in Termux o installa Termius)")
    }
}

/** Apre l'app Claude (dove si vede la sessione col controllo remoto) o, se manca, claude.ai/code. */
private fun openClaudeApp(context: Context) {
    val app = context.packageManager.getLaunchIntentForPackage("com.anthropic.claude")
    val intent = app ?: Intent(Intent.ACTION_VIEW, Uri.parse("https://claude.ai/code"))
    runCatching { context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

@Composable
private fun GpuCard(sys: SystemInfo, busy: Boolean, onFree: () -> Unit) {
    Panel("GPU e modelli") {
        val gpus = sys.gpus
        if (gpus.isNullOrEmpty()) {
            Text("Dati non disponibili (nvidia-smi non risponde)", style = MaterialTheme.typography.bodySmall)
        }
        gpus?.forEach { g ->
            val used = g.memUsedMiB ?: 0
            val total = g.memTotalMiB ?: 0
            Text(g.name, style = MaterialTheme.typography.bodyMedium)
            if (total > 0) Bar(used.toFloat() / total, levelColor(used.toFloat() / total, 0.85f, 0.95f))
            Text(listOfNotNull(
                if (total > 0) "VRAM %.1f / %.1f GB".format(used / 1024f, total / 1024f) else null,
                g.utilPct?.let { "carico $it%" },
                g.tempC?.let { "$it °C" },
            ).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
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

@Composable
private fun AppCard(app: AppStatus, agentUrl: String, busy: Boolean, vm: MainViewModel) {
    val context = LocalContext.current
    AppShell(app) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            AppBadge(appMonogram(app.id, app.name), appColor(app.id, app.isEngine))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(app.name, style = MaterialTheme.typography.titleMedium)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Dot(when { app.isRunning -> Green; app.isBusy -> Amber; else -> Grey })
                    Spacer(Modifier.width(6.dp))
                    Text(stateLabel(app), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (app.isEngine) Pill("motore gpu", EngineAccent)
            else app.port?.let { Text(":$it", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
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

/** App per chi non è amministratore: solo se è pronta, il pulsante per avviarla e quello per aprirla. */
@Composable
private fun UserAppCard(app: AppStatus, agentUrl: String, busy: Boolean, vm: MainViewModel) {
    val context = LocalContext.current
    AppShell(app) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            AppBadge(appMonogram(app.id, app.name), appColor(app.id, app.isEngine))
            Spacer(Modifier.width(12.dp))
            Text(app.name, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            Dot(when { app.isRunning -> Green; app.isBusy || busy -> Amber; else -> Grey })
            Spacer(Modifier.width(6.dp))
            Text(when { app.isRunning -> "pronta"; app.isBusy || busy -> "si sta avviando…"; else -> "spenta" },
                style = MaterialTheme.typography.bodySmall)
        }
        when {
            busy || app.isBusy -> CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            app.isRunning -> if (app.openUrl != null) Button(onClick = {
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(resolveOpenUrl(app.openUrl, agentUrl))))
            }) { Text("Apri") }
            else -> Button(onClick = { vm.start(app) }) { Text("Avvia") }
        }
    }
}

/**
 * Cornice delle schede delle app. I motori AI hanno il fondo sfumato di blu e il bordo blu;
 * le app il fondo normale con una sottile striscia del loro colore a sinistra.
 */
@Composable
private fun AppShell(app: AppStatus, content: @Composable () -> Unit) {
    val color = appColor(app.id, app.isEngine)
    Card(
        Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        border = if (app.isEngine) BorderStroke(1.dp, color.copy(alpha = 0.45f)) else null,
    ) {
        val bg = if (app.isEngine) Brush.horizontalGradient(listOf(color.copy(alpha = 0.16f), Color.Transparent))
        else Brush.horizontalGradient(listOf(color.copy(alpha = 0.07f), Color.Transparent))
        Row(Modifier.background(bg).height(IntrinsicSize.Min)) {
            if (!app.isEngine) Box(Modifier.width(4.dp).fillMaxHeight().background(color))
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
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
