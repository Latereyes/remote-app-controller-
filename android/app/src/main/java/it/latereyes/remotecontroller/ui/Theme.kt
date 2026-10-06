package it.latereyes.remotecontroller.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Green = Color(0xFF2E9E6E)
val Amber = Color(0xFFD99A1E)
val Grey = Color(0xFF8A8F98)

@Composable
fun AppTheme(content: @Composable () -> Unit) {
    val colors = if (isSystemInDarkTheme()) {
        darkColorScheme(primary = Color(0xFF7FD1AE), secondary = Color(0xFF9DB4E0))
    } else {
        lightColorScheme(primary = Color(0xFF1F6E52), secondary = Color(0xFF3A5A9A))
    }
    MaterialTheme(colorScheme = colors, content = content)
}
