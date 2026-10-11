package it.latereyes.remotecontroller.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

/** Accesso con nome e password. Al primo avvio dell'agent Andrea sceglie qui la sua password. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LoginScreen(state: UiState, vm: MainViewModel, onSettings: () -> Unit) {
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(state.message) {
        state.message?.let { snackbar.showSnackbar(it); vm.dismissMessage() }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("PC Remoto") },
                actions = { IconButton(onClick = onSettings) { Icon(Icons.Default.Settings, "Impostazioni") } },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).imePadding().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            val busy = "login" in state.busy
            when (state.pc) {
                PcState.ONLINE -> if (state.needsSetup) SetupForm(state, vm, busy) else LoginForm(vm, busy)
                PcState.UNKNOWN -> Text("Controllo il PC…")
                else -> {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Dot(if (state.pc == PcState.WAKING) Amber else Grey)
                        Spacer(Modifier.width(8.dp))
                        Text(if (state.pc == PcState.WAKING) "In accensione…" else "Il PC è spento", style = MaterialTheme.typography.titleMedium)
                    }
                    Text("Per entrare il PC deve essere acceso.", style = MaterialTheme.typography.bodySmall)
                    if (state.pc == PcState.WAKING) LinearProgressIndicator(Modifier.fillMaxWidth())
                    if (state.settings.canWake) {
                        Button(onClick = vm::wake, enabled = "wake" !in state.busy && state.pc != PcState.WAKING, modifier = Modifier.fillMaxWidth()) {
                            Text("Accendi il PC")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun LoginForm(vm: MainViewModel, busy: Boolean) {
    var name by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    Text("Accedi", style = MaterialTheme.typography.titleMedium)
    OutlinedTextField(name, { name = it }, label = { Text("Nome") }, singleLine = true, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(password, { password = it }, label = { Text("Password") }, singleLine = true,
        visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
    Button(onClick = { vm.login(name, password) }, enabled = !busy && name.isNotBlank() && password.isNotEmpty(), modifier = Modifier.fillMaxWidth()) {
        Text("Entra")
    }
}

@Composable
private fun SetupForm(state: UiState, vm: MainViewModel, busy: Boolean) {
    var token by remember { mutableStateOf(state.settings.agentToken) }
    var password by remember { mutableStateOf("") }
    var again by remember { mutableStateOf("") }
    Text("Primo accesso", style = MaterialTheme.typography.titleMedium)
    Text("Andrea è l'amministratore: scegli la sua password (almeno 8 caratteri). Poi da \"Utenti\" crei gli altri accessi.",
        style = MaterialTheme.typography.bodySmall)
    if (state.settings.agentToken.isBlank()) {
        OutlinedTextField(token, { token = it }, label = { Text("Token dell'agent (in config.json sul PC)") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
    }
    OutlinedTextField(password, { password = it }, label = { Text("Nuova password") }, singleLine = true,
        visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
    OutlinedTextField(again, { again = it }, label = { Text("Ripeti la password") }, singleLine = true,
        visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth(),
        isError = again.isNotEmpty() && again != password)
    Button(
        onClick = { vm.setup(token, password) },
        enabled = !busy && token.isNotBlank() && password.length >= 8 && password == again,
        modifier = Modifier.fillMaxWidth(),
    ) { Text("Salva e entra") }
}
