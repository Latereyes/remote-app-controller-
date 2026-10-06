package it.latereyes.remotecontroller.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import it.latereyes.remotecontroller.data.Settings

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(initial: Settings, onSave: (Settings) -> Unit, onBack: () -> Unit) {
    var agentUrl by remember { mutableStateOf(initial.agentUrl) }
    var agentToken by remember { mutableStateOf(initial.agentToken) }
    var relayUrl by remember { mutableStateOf(initial.relayUrl) }
    var relayToken by remember { mutableStateOf(initial.relayToken) }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text("Impostazioni") },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Indietro") } },
        )
    }) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).imePadding().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("PC (agent)", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(agentUrl, { agentUrl = it }, label = { Text("Indirizzo, es. pc-casa:7070") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(agentToken, { agentToken = it }, label = { Text("Token (lo stampa l'agent al primo avvio)") }, singleLine = true,
                visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())

            Text("Telefono di casa (relay Wake-on-LAN)", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(relayUrl, { relayUrl = it }, label = { Text("Indirizzo, es. telefono-casa:8765") }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(relayToken, { relayToken = it }, label = { Text("Token del relay") }, singleLine = true,
                visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())

            Text("Con Tailscale puoi usare il nome della macchina (es. pc-casa) oppure l'indirizzo 100.x.y.z.",
                style = MaterialTheme.typography.bodySmall)

            Button(onClick = { onSave(Settings(agentUrl, agentToken, relayUrl, relayToken)); onBack() }, modifier = Modifier.fillMaxWidth()) {
                Text("Salva")
            }
        }
    }
}
