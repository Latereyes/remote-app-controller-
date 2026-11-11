package it.latereyes.remotecontroller.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import it.latereyes.remotecontroller.data.Approval
import it.latereyes.remotecontroller.data.ClaudeStatus
import it.latereyes.remotecontroller.data.DisplaysInfo
import it.latereyes.remotecontroller.data.GamingInfo

/** Pannello «Modalità gioco»: gioco aperto, stream di Moonlight, GPU con indicatori, CPU e RAM. */
@Composable
fun GamingPanel(g: GamingInfo) {
    Panel("Modalità gioco", accent = GameAccent, trailing = {
        when {
            g.stream.streaming -> Pill("in stream", GameAccent)
            g.game != null -> Pill("in gioco", GameAccent)
            else -> Pill("in attesa", Grey)
        }
    }) {
        Text(
            when {
                g.game != null -> g.game.name
                g.stream.streaming -> "Moonlight collegato (desktop o gioco fuori da Steam)"
                else -> "Nessun gioco aperto"
            },
            style = MaterialTheme.typography.titleLarge,
        )
        if (g.stream.streaming && g.stream.since != null) {
            Text("Stream dalle ${g.stream.since.substringAfter('T').take(5)}", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        g.gpus.forEach { gpu ->
            Text(gpu.name.removePrefix("NVIDIA ").removePrefix("GeForce "), style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                val util = gpu.utilPct
                Gauge("CARICO GPU", util?.let { "$it%" } ?: "–", util?.div(100f), levelColor((util ?: 0) / 100f, 0.95f, 1.01f))
                val temp = gpu.tempC
                Gauge("TEMPERATURA", temp?.let { "$it°" } ?: "–", temp?.div(90f), levelColor((temp ?: 0) / 90f, 0.8f, 0.92f))
                val p = gpu.powerW
                val lim = gpu.powerLimitW
                Gauge("POTENZA", p?.let { "%.0f W".format(it) } ?: "–", if (p != null && lim != null && lim > 0) (p / lim).toFloat() else null,
                    levelColor(if (p != null && lim != null && lim > 0) (p / lim).toFloat() else 0f, 0.9f, 0.98f),
                    sub = lim?.let { "di %.0f".format(it) })
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatTile("FREQUENZA", gpu.clockMHz?.let { "$it MHz" } ?: "–", Modifier.weight(1f))
                StatTile("MEMORIA", gpu.memClockMHz?.let { "$it MHz" } ?: "–", Modifier.weight(1f))
                StatTile("VENTOLE", gpu.fanPct?.let { "$it%" } ?: "–", Modifier.weight(1f))
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val used = gpu.memUsedMiB
                val total = gpu.memTotalMiB
                StatTile("VRAM", if (used != null && total != null) "%.1f/%.0f GB".format(used / 1024f, total / 1024f) else "–", Modifier.weight(1.4f),
                    color = levelColor(if (used != null && total != null && total > 0) used.toFloat() / total else 0f, 0.85f, 0.95f))
                // Encoder NVENC: lo usa Sunshine per lo stream; se è al massimo lo stream scatta
                StatTile("ENCODER", gpu.encoderPct?.let { "$it%" } ?: "–", Modifier.weight(1f),
                    color = levelColor((gpu.encoderPct ?: 0) / 100f, 0.8f, 0.95f))
                StatTile("STATO", gpu.pstate ?: "–", Modifier.weight(0.8f))
            }
            val limits = gpu.throttle.filter { it != "a riposo" }
            if (limits.isNotEmpty()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Warning, null, tint = Amber, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Frenata da: ${limits.joinToString()}", style = MaterialTheme.typography.bodySmall, color = Amber)
                }
            }
        }
        if (g.gpus.isEmpty()) Text("Dati della GPU non disponibili (nvidia-smi non risponde)", style = MaterialTheme.typography.bodySmall)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            StatTile("CPU", g.cpuPct?.let { "$it%" } ?: "–", Modifier.weight(1f), color = levelColor((g.cpuPct ?: 0) / 100f, 0.85f, 0.95f))
            val usedGb = (g.memTotalMiB - g.memFreeMiB) / 1024f
            StatTile("RAM", "%.1f/%.0f GB".format(usedGb, g.memTotalMiB / 1024f), Modifier.weight(1.4f),
                color = levelColor(if (g.memTotalMiB > 0) (g.memTotalMiB - g.memFreeMiB).toFloat() / g.memTotalMiB else 0f, 0.85f, 0.95f))
        }
        Text("Gli FPS non si leggono senza un programma in più sul PC (PresentMon): qui ci sono i dati della scheda.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Pannello «Monitor»: quali schermi sono accesi e quale sta guardando Moonlight. */
@Composable
fun DisplaysPanel(d: DisplaysInfo) {
    Panel("Monitor", accent = ScreenAccent, trailing = {
        Text("${d.activeCount} acces${if (d.activeCount == 1) "o" else "i"}", style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }) {
        if (!d.available) {
            Text(d.reason ?: "Elenco degli schermi non disponibile", style = MaterialTheme.typography.bodySmall)
        }
        d.displays.filter { !it.disconnected || it.active }.forEach { s ->
            Row(
                Modifier.fillMaxWidth().clip(MaterialTheme.shapes.medium).background(MaterialTheme.colorScheme.surfaceVariant).padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Dot(if (s.active) Green else Grey)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(s.monitor + if (s.virtual) " (virtuale)" else "", style = MaterialTheme.typography.bodyLarge)
                    Text(
                        listOfNotNull(
                            if (s.active) "acceso" else "spento",
                            s.resolution?.takeIf { s.active }?.replace(" X ", "×"),
                            s.hz?.takeIf { s.active }?.let { "$it Hz" },
                            s.name.removePrefix("\\\\.\\").ifEmpty { null },
                        ).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (s.moonlight) Pill("moonlight", GameAccent)
                    if (s.primary && s.active) Pill("principale", ScreenAccent)
                }
            }
        }
        Text(
            when {
                !d.stream.available -> "Sunshine non trovato: non so se Moonlight è collegato"
                d.stream.streaming -> "Moonlight è collegato" + (d.stream.outputName?.let { " (Sunshine trasmette: $it)" } ?: "")
                else -> "Moonlight non è collegato"
            },
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** Pannello «Claude sul PC»: avvio con il controllo remoto e richieste in attesa. */
@Composable
fun ClaudePanel(c: ClaudeStatus, busy: Boolean, onStart: () -> Unit, onStop: () -> Unit, onOpenClaude: () -> Unit) {
    Panel("Claude sul PC", accent = ClaudeAccent, trailing = {
        if (c.running) Pill("attivo", Green) else Pill("spento", Grey)
    }) {
        Text(
            if (c.running) "Controllo remoto acceso in ${c.cwd}. Scrivigli dall'app Claude (sessione «${c.name}»)."
            else "Apre Claude in una finestra sul PC con il controllo remoto acceso, nella cartella ${c.cwd}.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (c.approvals) {
            Text("Le richieste di permesso arrivano anche qui e nelle notifiche.", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            when {
                busy -> CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                c.running -> {
                    Button(onClick = onOpenClaude, colors = ButtonDefaults.buttonColors(containerColor = ClaudeAccent)) { Text("Apri Claude") }
                    OutlinedButton(onClick = onStop) { Text("Chiudi") }
                }
                else -> Button(onClick = onStart, colors = ButtonDefaults.buttonColors(containerColor = ClaudeAccent)) {
                    Icon(Icons.Default.PlayArrow, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Avvia Claude")
                }
            }
        }
    }
}

/** Richieste di permesso in attesa (Claude o script PowerShell sul PC). */
@Composable
fun ApprovalsPanel(list: List<Approval>, busy: Set<String>, onDecide: (Approval, Boolean) -> Unit) {
    Panel("Permessi richiesti", accent = Amber, trailing = { Pill("${list.size}", Amber) }) {
        list.forEach { a ->
            Column(
                Modifier.fillMaxWidth().clip(MaterialTheme.shapes.medium).background(MaterialTheme.colorScheme.surfaceVariant).padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(a.source.uppercase(), style = MaterialTheme.typography.labelSmall, color = Amber)
                Text(a.title, style = MaterialTheme.typography.bodyLarge)
                if (a.detail.isNotBlank() && a.detail != a.title) {
                    Column(Modifier.heightIn(max = 160.dp).verticalScroll(rememberScrollState())) {
                        SelectionContainer {
                            Text(a.detail, fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                val minutes = ((a.expiresAt - System.currentTimeMillis()) / 60000).coerceAtLeast(0)
                Text("Scade tra $minutes min: poi la domanda resta solo sul PC", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    val off = "approval-${a.id}" in busy
                    Button(onClick = { onDecide(a, true) }, enabled = !off, colors = ButtonDefaults.buttonColors(containerColor = Green)) { Text("Consenti") }
                    OutlinedButton(onClick = { onDecide(a, false) }, enabled = !off) { Text("Rifiuta", color = Red) }
                }
            }
        }
    }
}
