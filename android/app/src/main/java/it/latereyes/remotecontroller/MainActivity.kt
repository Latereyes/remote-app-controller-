package it.latereyes.remotecontroller

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import it.latereyes.remotecontroller.ui.AppTheme
import it.latereyes.remotecontroller.ui.HomeScreen
import it.latereyes.remotecontroller.ui.MainViewModel
import it.latereyes.remotecontroller.ui.SettingsScreen
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val vm: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // Aggiorna lo stato solo mentre l'app è in primo piano
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) { vm.pollWhileVisible() }
        }

        setContent {
            AppTheme {
                val state by vm.state.collectAsStateWithLifecycle()
                var showSettings by rememberSaveable { mutableStateOf(!state.settings.isConfigured) }
                if (showSettings) {
                    BackHandler(enabled = state.settings.isConfigured) { showSettings = false }
                    SettingsScreen(state.settings, onSave = vm::saveSettings, onBack = { showSettings = false })
                } else {
                    HomeScreen(state, vm, onSettings = { showSettings = true })
                }
            }
        }
    }
}
