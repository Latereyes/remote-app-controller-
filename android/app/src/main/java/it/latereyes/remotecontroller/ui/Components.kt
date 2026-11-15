package it.latereyes.remotecontroller.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Pannello della schermata principale: titolo con un pallino colorato e contenuto. */
@Composable
fun Panel(
    title: String,
    accent: Color = MaterialTheme.colorScheme.primary,
    modifier: Modifier = Modifier,
    trailing: @Composable (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(width = 4.dp, height = 18.dp).clip(RoundedCornerShape(2.dp)).background(accent))
                Spacer(Modifier.width(10.dp))
                Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                trailing?.invoke()
            }
            content()
        }
    }
}

/** Etichetta tonda colorata («IN STREAM», «PRINCIPALE»...). */
@Composable
fun Pill(text: String, color: Color) {
    Text(
        text.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        color = color,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(color.copy(alpha = 0.16f)).padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

/** Colore per un valore che sale: verde, poi giallo, poi rosso. */
fun levelColor(fraction: Float, warn: Float = 0.75f, hot: Float = 0.9f): Color = when {
    fraction >= hot -> Red
    fraction >= warn -> Amber
    else -> Green
}

/**
 * Indicatore ad arco (270°) con il valore al centro.
 * `fraction` da 0 a 1; null = dato non disponibile.
 */
@Composable
fun Gauge(label: String, value: String, fraction: Float?, color: Color, size: Dp = 96.dp, sub: String? = null) {
    val animated by animateFloatAsState((fraction ?: 0f).coerceIn(0f, 1f), tween(600), label = "gauge")
    val track = MaterialTheme.colorScheme.surfaceVariant
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(size), contentAlignment = Alignment.Center) {
            Canvas(Modifier.size(size)) {
                val stroke = this.size.minDimension * 0.09f
                val inset = stroke / 2
                val arcSize = Size(this.size.width - stroke, this.size.height - stroke)
                drawArc(track, 135f, 270f, false, Offset(inset, inset), arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
                if (fraction != null) {
                    drawArc(color, 135f, 270f * animated, false, Offset(inset, inset), arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
                }
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(value, fontSize = (size.value / 5).sp, fontWeight = FontWeight.Bold, maxLines = 1)
                if (sub != null) Text(sub, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
        }
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Riquadro con un numero grande e un'etichetta, per le griglie di dati. */
@Composable
fun StatTile(label: String, value: String, modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.onSurface) {
    Column(
        modifier.clip(MaterialTheme.shapes.medium).background(MaterialTheme.colorScheme.surfaceVariant).padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        Text(value, style = MaterialTheme.typography.titleMedium, color = color, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** Barra orizzontale sottile, più leggibile di LinearProgressIndicator dentro i riquadri. */
@Composable
fun Bar(fraction: Float, color: Color, modifier: Modifier = Modifier) {
    val animated by animateFloatAsState(fraction.coerceIn(0f, 1f), tween(600), label = "bar")
    Box(modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)).background(MaterialTheme.colorScheme.surfaceVariant)) {
        Box(Modifier.fillMaxWidth(animated).height(8.dp).clip(RoundedCornerShape(4.dp)).background(color))
    }
}

/** Quadratino con l'iniziale dell'app nel suo colore. */
@Composable
fun AppBadge(text: String, color: Color, size: Dp = 40.dp) {
    Box(Modifier.size(size).clip(MaterialTheme.shapes.medium).background(color.copy(alpha = 0.20f)), contentAlignment = Alignment.Center) {
        Text(text, color = color, fontWeight = FontWeight.Bold, fontSize = (size.value * 0.42f).sp, maxLines = 1)
    }
}

/** Sigla dell'app: un carattere giapponese per Japonika, altrimenti le prime due lettere del nome. */
fun appMonogram(id: String, name: String): String = when (id) {
    "japonika" -> "日"
    "comfy" -> "Cf"
    else -> name.filter { it.isLetterOrDigit() }.take(2).ifEmpty { "?" }
}

/** Titolo di una sezione della lista (Motori AI, App) con una riga di spiegazione. */
@Composable
fun SectionHeader(title: String, subtitle: String?, color: Color) {
    Row(Modifier.padding(top = 6.dp, start = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).clip(RoundedCornerShape(50)).background(color))
        Spacer(Modifier.width(8.dp))
        Column {
            Text(title.uppercase(), style = MaterialTheme.typography.labelSmall, color = color)
            if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
