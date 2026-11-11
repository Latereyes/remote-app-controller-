package it.latereyes.remotecontroller.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AssistChip
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Comandi rapidi: i più utili da fuori casa, senza doverli scrivere sulla tastiera del telefono
private val QUICK = listOf(
    "nvidia-smi" to "nvidia-smi",
    "Processi" to "Get-Process | Sort-Object CPU -Descending | Select-Object -First 12 Name, Id, CPU, WS | Format-Table -AutoSize",
    "Rete" to "ipconfig | Select-String IPv4",
    "Tailscale" to "tailscale status",
    "Disco" to "Get-PSDrive -PSProvider FileSystem | Format-Table Name, @{n='Liberi GB';e={[math]::Round(\$_.Free/1GB,1)}}, @{n='Usati GB';e={[math]::Round(\$_.Used/1GB,1)}} -AutoSize",
    "Log agent" to "Get-Content C:\\AI\\remote-app-controller\\agent\\agent.log -Tail 30",
)

/** Terminale PowerShell sul PC: output a scorrimento, riga di comando e comandi rapidi. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TerminalScreen(state: UiState, vm: MainViewModel, onBack: () -> Unit) {
    val term = state.terminal
    var line by remember { mutableStateOf("") }
    val scroll = rememberScrollState()
    LaunchedEffect(Unit) { vm.openTerminal() }
    LaunchedEffect(term?.text?.length) { scroll.animateScrollTo(scroll.maxValue) }

    fun send() {
        vm.sendTerminal(line)
        line = ""
    }

    Scaffold(topBar = {
        TopAppBar(
            title = {
                Column {
                    Text("Terminale del PC")
                    Text(
                        when {
                            term?.error != null -> "Chiuso"
                            term?.id == null -> "Collegamento…"
                            term?.alive == true -> "PowerShell · ogni comando resta nel log dell'agent"
                            else -> "Chiuso"
                        },
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Chiudi il terminale") } },
            actions = {
                // Senza una console vera Ctrl+C non arriva: per fermare un comando si riapre la shell
                IconButton(onClick = vm::restartTerminal) { Icon(Icons.Default.Refresh, "Ferma e riapri") }
            },
        )
    }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).imePadding()) {
            Box(
                Modifier.weight(1f).fillMaxWidth().padding(horizontal = 12.dp)
                    .background(Color(0xFF05080C), MaterialTheme.shapes.medium).padding(10.dp),
            ) {
                SelectionContainer(Modifier.fillMaxSize().verticalScroll(scroll)) {
                    Text(
                        (term?.text ?: "") + (term?.error?.let { "\n[$it]" } ?: ""),
                        fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 16.sp, color = Color(0xFFD7E3EE),
                    )
                }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                QUICK.forEach { (label, cmd) -> AssistChip(onClick = { vm.sendTerminal(cmd) }, label = { Text(label) }, enabled = term?.alive == true && term.id != null) }
            }
            Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 4.dp, bottom = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    line, { line = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("Comando PowerShell") },
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false, imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = { send() }),
                    enabled = term?.alive == true && term.id != null,
                )
                IconButton(onClick = { send() }, enabled = term?.alive == true && term.id != null) {
                    Icon(Icons.AutoMirrored.Filled.Send, "Invia", tint = MaterialTheme.colorScheme.primary)
                }
            }
        }
    }
}
