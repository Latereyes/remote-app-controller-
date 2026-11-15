package it.latereyes.remotecontroller

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import it.latereyes.remotecontroller.data.AgentClient
import it.latereyes.remotecontroller.data.SettingsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Finché Claude è acceso sul PC, controlla ogni 3 s se ci sono richieste di permesso e le mostra
 * come notifiche con «Consenti» e «Rifiuta», anche con l'app chiusa.
 * Si ferma da sola quando Claude si chiude (o il PC non risponde per 10 minuti).
 */
class ApprovalService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var running = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { stopSelf(); return START_NOT_STICKY }
        ensureChannels(this)
        val stopIntent = PendingIntent.getService(this, 1, Intent(this, ApprovalService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, CHANNEL_WATCH)
            .setSmallIcon(R.drawable.ic_stat_pc)
            .setContentTitle("Claude sul PC")
            .setContentText("Aspetto le richieste di permesso")
            .setOngoing(true)
            .setContentIntent(openApp(this))
            .addAction(0, "Smetti", stopIntent)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(ID_WATCH, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(ID_WATCH, notification)
        }
        if (!running) { running = true; scope.launch { loop() } }
        return START_NOT_STICKY
    }

    private suspend fun loop() {
        val shown = mutableSetOf<String>()
        var lastOk = System.currentTimeMillis()
        var tick = 0
        while (scope.isActive) {
            val s = SettingsStore(this).load()
            if (!s.isLoggedIn) break
            val client = AgentClient(s.agentUrl, s.sessionToken)
            try {
                val pending = client.approvals()
                lastOk = System.currentTimeMillis()
                val ids = pending.map { it.id }.toSet()
                for (a in pending) if (a.id !in shown) { notifyApproval(this, a.id, a.source, a.title, a.detail); shown += a.id }
                for (gone in shown - ids) cancelNotification(this, gone)
                shown.retainAll(ids)
                // Ogni 15 s: se Claude è chiuso e non c'è niente in attesa, il servizio non serve più
                if (tick++ % 5 == 0 && pending.isEmpty() && !client.claude().running) break
            } catch (e: Exception) {
                if (System.currentTimeMillis() - lastOk > 10 * 60_000) break
            }
            delay(3000)
        }
        stopSelf()
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL_WATCH = "claude-watch"
        private const val CHANNEL_ASK = "permessi"
        private const val ID_WATCH = 1
        private const val ACTION_STOP = "it.latereyes.remotecontroller.STOP_WATCH"
        const val ACTION_DECIDE = "it.latereyes.remotecontroller.DECIDE"
        const val EXTRA_ID = "id"
        const val EXTRA_ALLOW = "allow"

        fun start(context: Context) {
            runCatching { ContextCompat.startForegroundService(context, Intent(context, ApprovalService::class.java)) }
        }

        private fun ensureChannels(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val nm = context.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL_WATCH, "Claude acceso", NotificationManager.IMPORTANCE_MIN))
            nm.createNotificationChannel(NotificationChannel(CHANNEL_ASK, "Richieste di permesso", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Claude o uno script sul PC chiede un permesso"
            })
        }

        private fun openApp(context: Context) = PendingIntent.getActivity(
            context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE,
        )

        private fun notifyId(id: String) = 1000 + (id.hashCode() and 0x7fffff)

        fun notifyApproval(context: Context, id: String, source: String, title: String, detail: String) {
            if (Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
            ensureChannels(context)
            fun action(allow: Boolean) = PendingIntent.getBroadcast(
                context, notifyId(id) * 2 + if (allow) 1 else 0,
                Intent(context, ApprovalReceiver::class.java).setAction(ACTION_DECIDE).putExtra(EXTRA_ID, id).putExtra(EXTRA_ALLOW, allow),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val n = NotificationCompat.Builder(context, CHANNEL_ASK)
                .setSmallIcon(R.drawable.ic_stat_pc)
                .setContentTitle("$source chiede il permesso")
                .setContentText(title)
                .setStyle(NotificationCompat.BigTextStyle().bigText(if (detail.isNotBlank() && detail != title) "$title\n\n${detail.take(600)}" else title))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setContentIntent(openApp(context))
                .setAutoCancel(true)
                .addAction(0, "Consenti", action(true))
                .addAction(0, "Rifiuta", action(false))
                .build()
            NotificationManagerCompat.from(context).notify(notifyId(id), n)
        }

        fun cancelNotification(context: Context, id: String) {
            NotificationManagerCompat.from(context).cancel(notifyId(id))
        }
    }
}

/** «Consenti» / «Rifiuta» dalla notifica: manda la risposta all'agent senza aprire l'app. */
class ApprovalReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ApprovalService.ACTION_DECIDE) return
        val id = intent.getStringExtra(ApprovalService.EXTRA_ID) ?: return
        val allow = intent.getBooleanExtra(ApprovalService.EXTRA_ALLOW, false)
        val pending = goAsync()
        val app = context.applicationContext
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val s = SettingsStore(app).load()
                AgentClient(s.agentUrl, s.sessionToken).decide(id, allow)
            } catch (_: Exception) {
                // Già decisa dal PC o scaduta: la notifica sparisce comunque
            } finally {
                ApprovalService.cancelNotification(app, id)
                pending.finish()
            }
        }
    }
}
