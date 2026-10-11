package it.latereyes.remotecontroller.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import it.latereyes.remotecontroller.data.AppStatus
import it.latereyes.remotecontroller.data.UserInfo

/** Solo per l'amministratore: crea gli utenti e sceglie quali app può avviare ognuno. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UsersScreen(state: UiState, vm: MainViewModel, onBack: () -> Unit) {
    val snackbar = remember { SnackbarHostState() }
    var editing by remember { mutableStateOf<UserInfo?>(null) }
    var creating by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { vm.loadUsers() }
    LaunchedEffect(state.message) {
        state.message?.let { snackbar.showSnackbar(it); vm.dismissMessage() }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Utenti") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Indietro") } },
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { creating = true }) { Icon(Icons.Default.Add, "Nuovo utente") }
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Text("Gli utenti vedono solo il pulsante per accendere il PC e le app che abiliti qui, senza dati tecnici.",
                    style = MaterialTheme.typography.bodySmall)
            }
            items(state.users, key = { it.name }) { u ->
                Card(Modifier.fillMaxWidth().clickable(enabled = !u.isAdmin) { editing = u }) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(u.name, style = MaterialTheme.typography.titleMedium)
                        Text(
                            if (u.isAdmin) "Amministratore: vede e gestisce tutto"
                            else if (u.apps.isEmpty()) "Nessuna app: può solo accendere il PC"
                            else "Può avviare: " + u.apps.joinToString { id -> appName(state.apps, id) },
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            }
        }
    }

    if (creating) {
        UserDialog(user = null, apps = state.apps, onDismiss = { creating = false }, onSave = { name, password, apps ->
            vm.createUser(name, password, apps); creating = false
        })
    }
    editing?.let { u ->
        UserDialog(user = u, apps = state.apps, onDismiss = { editing = null }, onSave = { _, password, apps ->
            vm.updateUser(u.name, apps, password); editing = null
        }, onDelete = { vm.deleteUser(u.name); editing = null })
    }
}

private fun appName(apps: List<AppStatus>, id: String) = apps.firstOrNull { it.id == id }?.name ?: id

/** Nuovo utente (nome e password obbligatori) o modifica (password vuota = resta quella di prima). */
@Composable
private fun UserDialog(
    user: UserInfo?,
    apps: List<AppStatus>,
    onDismiss: () -> Unit,
    onSave: (name: String, password: String, apps: List<String>) -> Unit,
    onDelete: (() -> Unit)? = null,
) {
    var name by remember { mutableStateOf(user?.name ?: "") }
    var password by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf(user?.apps?.toSet() ?: emptySet()) }
    var confirmDelete by remember { mutableStateOf(false) }
    val passwordOk = if (user == null) password.length >= 8 else password.isEmpty() || password.length >= 8

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(user?.name ?: "Nuovo utente") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (user == null) {
                    OutlinedTextField(name, { name = it }, label = { Text("Nome") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                }
                OutlinedTextField(password, { password = it }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    label = { Text(if (user == null) "Password (almeno 8 caratteri)" else "Nuova password (vuota = non cambia)") },
                    visualTransformation = PasswordVisualTransformation())
                Text("App che può avviare", style = MaterialTheme.typography.titleSmall)
                apps.forEach { app ->
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().clickable {
                        selected = if (app.id in selected) selected - app.id else selected + app.id
                    }) {
                        Checkbox(checked = app.id in selected, onCheckedChange = null)
                        Text(app.name)
                    }
                }
                if (onDelete != null) {
                    TextButton(onClick = { if (confirmDelete) onDelete() else confirmDelete = true }) {
                        Text(if (confirmDelete) "Tocca di nuovo per eliminare ${user?.name}" else "Elimina utente",
                            color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onSave(name, password, apps.map { it.id }.filter { it in selected } + selected.filter { id -> apps.none { it.id == id } }) },
                enabled = name.isNotBlank() && passwordOk,
            ) { Text("Salva") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Annulla") } },
    )
}
