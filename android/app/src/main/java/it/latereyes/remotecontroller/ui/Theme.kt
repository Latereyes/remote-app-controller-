package it.latereyes.remotecontroller.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Colori di stato: uguali nei due temi, così verde/giallo/grigio vogliono dire sempre la stessa cosa
val Green = Color(0xFF34C38F)
val Amber = Color(0xFFF2B33D)
val Grey = Color(0xFF8A8F98)
val Red = Color(0xFFEF5350)
// Accenti dei pannelli: gioco (viola), Claude (arancio), monitor (azzurro)
val GameAccent = Color(0xFF8B7CF6)
val ClaudeAccent = Color(0xFFD97757)
val ScreenAccent = Color(0xFF4FB3E8)
// Motori AI (Ollama, ComfyUI): blu, tutti uguali, perché si dividono la stessa GPU
val EngineAccent = Color(0xFF5B8DEF)
// Le app hanno ognuna il suo colore, così si riconoscono a colpo d'occhio
val AppColors = mapOf(
    "chatbz" to Color(0xFFEC6FA9),
    "localai" to Color(0xFF9ACD4C),
    "japonika" to Color(0xFFF2734B),
)
private val SpareColors = listOf(Color(0xFF4DB6AC), Color(0xFFFFB74D), Color(0xFF7986CB), Color(0xFFBA68C8))
fun appColor(id: String, engine: Boolean): Color =
    if (engine) EngineAccent else AppColors[id] ?: SpareColors[Math.floorMod(id.hashCode(), SpareColors.size)]

private val DarkColors = darkColorScheme(
    primary = Color(0xFF5EE0B0),
    onPrimary = Color(0xFF00382A),
    primaryContainer = Color(0xFF0E4D3B),
    onPrimaryContainer = Color(0xFFB8F5DD),
    secondary = Color(0xFF9DB4E0),
    background = Color(0xFF0D1117),
    onBackground = Color(0xFFE6EDF3),
    surface = Color(0xFF0D1117),
    onSurface = Color(0xFFE6EDF3),
    surfaceVariant = Color(0xFF1C2330),
    onSurfaceVariant = Color(0xFFA9B4C2),
    surfaceContainer = Color(0xFF161B22),
    surfaceContainerHigh = Color(0xFF1C2330),
    surfaceContainerHighest = Color(0xFF232B38),
    outline = Color(0xFF3A4454),
    outlineVariant = Color(0xFF283140),
    error = Red,
)

private val LightColors = lightColorScheme(
    primary = Color(0xFF12795A),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFC6F2E0),
    onPrimaryContainer = Color(0xFF00382A),
    secondary = Color(0xFF3A5A9A),
    background = Color(0xFFF5F7FA),
    surface = Color(0xFFF5F7FA),
    surfaceVariant = Color(0xFFE6EBF1),
    surfaceContainer = Color(0xFFFFFFFF),
    surfaceContainerHigh = Color(0xFFFFFFFF),
    surfaceContainerHighest = Color(0xFFEDF1F6),
    outlineVariant = Color(0xFFD5DCE5),
)

private val AppShapes = Shapes(
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(16.dp),
    large = RoundedCornerShape(22.dp),
)

private val AppTypography = Typography().let { t ->
    t.copy(
        titleLarge = t.titleLarge.copy(fontWeight = FontWeight.SemiBold),
        titleMedium = t.titleMedium.copy(fontWeight = FontWeight.SemiBold),
        labelSmall = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.6.sp),
    )
}

@Composable
fun AppTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
        shapes = AppShapes,
        typography = AppTypography,
        content = content,
    )
}
