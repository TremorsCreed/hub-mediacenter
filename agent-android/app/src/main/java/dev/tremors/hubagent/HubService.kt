package dev.tremors.hubagent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import android.view.KeyEvent
import androidx.core.app.NotificationCompat
import dev.tremors.hubagent.launchers.*
import dev.tremors.hubagent.model.*
import java.util.concurrent.atomic.AtomicReference
import okhttp3.*
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class HubService : Service() {

    companion object {
        private const val TAG = "HubService"
        private const val CHANNEL_ID = "hub_agent"
        private const val NOTIF_ID = 1
        const val PREFS = "hub_agent"
        const val PREF_HUB_URL = "hub_url"
        const val PREF_DEVICE_NAME = "device_name"
        const val PREF_DEVICE_ID = "device_id"
        const val DEFAULT_HUB_PORT = "8020"

        var statusCallback: ((String) -> Unit)? = null

        fun start(ctx: Context) {
            val intent = Intent(ctx, HubService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent)
            else ctx.startService(intent)
        }

        fun stop(ctx: Context) = ctx.stopService(Intent(ctx, HubService::class.java))
    }

    // OkHttpClient recréé à chaque connect() : si l'executor a été shutdown par un
    // onDestroy précédent (sticky service relancé par Android), l'instance précédente
    // refuse toute tâche avec "executor rejected" et l'agent boucle sur 60s reconnect.
    private fun buildClient() = OkHttpClient.Builder()
        .pingInterval(30, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private var client: OkHttpClient = buildClient()
    private var webSocket: WebSocket? = null
    private var reconnectAttempts = 0
    private val maxReconnectDelay = 60_000L
    private val hubConfig = AtomicReference<HubConfig?>(null)

    private val deviceId by lazy {
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.getString(PREF_DEVICE_ID, null) ?: run {
            val id = java.util.UUID.randomUUID().toString().replace("-", "").take(16)
            prefs.edit().putString(PREF_DEVICE_ID, id).apply()
            id
        }
    }

    private fun prefs() = getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private val deviceName get() =
        prefs().getString(PREF_DEVICE_NAME, null) ?: "${Build.MANUFACTURER} ${Build.MODEL}"

    private val hubUrl get() =
        prefs().getString(PREF_HUB_URL, "ws://192.168.1.15:$DEFAULT_HUB_PORT")!!

    private fun buildLaunchers(): List<BaseLauncher> {
        val cfg = hubConfig.get()
        val xtreamConfig = if (cfg != null) XtreamConfig(
            serverUrl = cfg.xtreamServer,
            username = cfg.xtreamUser,
            password = cfg.xtreamPass,
            ext = cfg.xtreamExt
        ) else XtreamConfig("", "", "", "ts")
        return listOfNotNull(
            PlexLauncher(),
            if (xtreamConfig.isConfigured()) XtreamLauncher(xtreamConfig) else TiviMateLauncher(),
            KodiLauncher()
        )
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIF_ID, buildNotification("Connecting..."))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        connect()
        // Démarre le monitor des sessions media actives (toutes les 4s).
        // postDelayed plutôt que post : laisse le temps à la connexion WS de s'établir.
        cmdHandler.removeCallbacks(sessionMonitor)
        cmdHandler.postDelayed(sessionMonitor, 4000L)
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        webSocket?.close(1000, "Service stopped")
        client.dispatcher.executorService.shutdown()
        super.onDestroy()
    }

    private fun connect() {
        // Si le client a été shutdown par onDestroy, recréer une instance fraîche
        if (client.dispatcher.executorService.isShutdown) {
            Log.i(TAG, "OkHttpClient executor was shutdown — rebuilding")
            client = buildClient()
        }
        val wsUrl = "${hubUrl.trimEnd('/').let {
            if (it.startsWith("http://")) it.replace("http://", "ws://")
            else if (it.startsWith("https://")) it.replace("https://", "wss://")
            else it
        }}/ws?device_id=$deviceId"

        Log.i(TAG, "Connecting to $wsUrl")
        updateNotification("Connecting...")

        val request = Request.Builder().url(wsUrl).build()
        webSocket = client.newWebSocket(request, object : WebSocketListener() {

            override fun onOpen(ws: WebSocket, response: Response) {
                Log.i(TAG, "Connected")
                reconnectAttempts = 0
                updateNotification("Connected — ${deviceName}")
                ws.send(buildRegisterMessage(
                    deviceId = deviceId,
                    name = deviceName,
                    platform = detectPlatform(),
                    ip = getLocalIp(),
                    capabilities = buildCapabilities()
                ))
            }

            override fun onMessage(ws: WebSocket, text: String) {
                try {
                    val json = JSONObject(text)
                    if (json.optString("type") == "config") {
                        hubConfig.set(HubConfig.fromJson(json))
                        Log.i(TAG, "Config received from Hub")
                        updateNotification("Connected — $deviceName")
                    } else {
                        handleMessage(json)
                    }
                } catch (e: Exception) { Log.e(TAG, "Parse error: $text", e) }
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WS failure: ${t.message}")
                scheduleReconnect()
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                Log.i(TAG, "WS closed: $code $reason")
                if (code != 1000) scheduleReconnect()
            }
        })
    }

    private val handlerThread = android.os.HandlerThread("hub-cmd").apply { start() }
    private val cmdHandler = android.os.Handler(handlerThread.looper)
    private val overlay by lazy { OverlayManager(applicationContext) }

    private fun handleMessage(json: JSONObject) {
        when (json.optString("type")) {
            // handlePlay déclenche Intent + MediaSessionManager — peut bloquer plusieurs
            // centaines de ms. On l'exécute hors du thread WebSocket pour pas rater de PING.
            "play" -> cmdHandler.post { try { handlePlay(json) } catch (e: Exception) { Log.e(TAG, "handlePlay", e) } }
            "stop" -> { updateNotification("Connected — $deviceName"); sendState("stopped") }
            "notify" -> {
                val text = json.optString("text").ifEmpty { "Activité Hub" }
                Log.i(TAG, "Notify: $text")
                updateNotification(text)
            }
            "control" -> cmdHandler.post { try { handleControl(json.optString("action")) } catch (e: Exception) { Log.e(TAG, "handleControl", e) } }
            "overlay" -> {
                val action = json.optString("action")
                if (action == "hide") { overlay.hideAll(); return }
                val style = json.optString("style", "small")
                val title = json.optString("title").ifEmpty { "Hub MediaCenter" }
                val message = json.optString("message")
                val duration = json.optInt("duration", if (style == "player") 0 else 4)
                if (message.isEmpty()) return
                if (style == "player") {
                    val image = json.optString("image").ifEmpty { null }
                    val appLabel = json.optString("app_label").ifEmpty { null }
                    val imageKind = json.optString("image_kind").ifEmpty { "poster" }
                    overlay.showPlayer(title, message, appLabel, image, imageKind, duration)
                } else {
                    overlay.show(title, message, duration)
                }
            }
            "pong" -> Log.d(TAG, "pong")
            else -> Log.w(TAG, "Unknown: ${json.optString("type")}")
        }
    }

    private fun handleControl(action: String) {
        Log.i(TAG, "Control: $action")
        val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        when (action) {
            "play_pause" -> sendMediaKey(am, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
            "play" -> sendMediaKey(am, KeyEvent.KEYCODE_MEDIA_PLAY)
            "pause" -> sendMediaKey(am, KeyEvent.KEYCODE_MEDIA_PAUSE)
            "stop" -> {
                // KEYCODE_MEDIA_STOP est ignoré par YouTube/Netflix/etc. On force le stop
                // sur toutes les sessions actives via transportControls (déjà éprouvé
                // dans le pré-launcher Plex).
                stopAllActiveMediaSessions()
                sendMediaKey(am, KeyEvent.KEYCODE_MEDIA_STOP)
                updateNotification("Connected — $deviceName")
                overlay.hideAll()
                sendState("stopped")
            }
            "next" -> sendMediaKey(am, KeyEvent.KEYCODE_MEDIA_NEXT)
            "previous" -> sendMediaKey(am, KeyEvent.KEYCODE_MEDIA_PREVIOUS)
            // adjustVolume() sans stream cible le contexte audio actif (ce qui joue),
            // alors que adjustStreamVolume(MUSIC) est souvent ignoré quand l'app n'utilise
            // pas ce stream précis. FLAG_SHOW_UI affiche l'overlay volume Android.
            "volume_up" -> am.adjustVolume(AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI)
            "volume_down" -> am.adjustVolume(AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI)
            "mute" -> am.adjustVolume(AudioManager.ADJUST_TOGGLE_MUTE, AudioManager.FLAG_SHOW_UI)
            else -> Log.w(TAG, "Unknown control action: $action")
        }
    }

    private fun stopAllActiveMediaSessions() {
        try {
            val mgr = getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
            val component = ComponentName(this, HubNotificationListener::class.java)
            for (ctrl in mgr.getActiveSessions(component)) {
                if (ctrl.packageName == packageName) continue
                Log.i(TAG, "Force stop: ${ctrl.packageName}")
                try { ctrl.transportControls.stop() } catch (_: Exception) {}
                try { ctrl.transportControls.pause() } catch (_: Exception) {}
            }
        } catch (e: SecurityException) {
            Log.w(TAG, "stop: notification listener permission missing")
        } catch (e: Exception) {
            Log.w(TAG, "stopAllActiveMediaSessions: ${e.message}")
        }
    }

    private fun sendMediaKey(am: AudioManager, keyCode: Int) {
        val now = SystemClock.uptimeMillis()
        am.dispatchMediaKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_DOWN, keyCode, 0))
        am.dispatchMediaKeyEvent(KeyEvent(now, now, KeyEvent.ACTION_UP, keyCode, 0))
    }

    private fun stopOtherMediaSessions() {
        try {
            val mgr = getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
            val component = ComponentName(this, HubNotificationListener::class.java)
            val sessions = mgr.getActiveSessions(component)
            val myPkg = packageName
            for (ctrl in sessions) {
                if (ctrl.packageName == myPkg) continue
                val state = ctrl.playbackState?.state
                val isActive = state == PlaybackState.STATE_PLAYING
                    || state == PlaybackState.STATE_BUFFERING
                    || state == PlaybackState.STATE_FAST_FORWARDING
                    || state == PlaybackState.STATE_REWINDING
                if (!isActive) continue
                Log.i(TAG, "Stopping active media session: ${ctrl.packageName}")
                // stop() ne marche pas sur toutes les apps ; on tente plusieurs approches
                try { ctrl.transportControls.stop() } catch (_: Exception) {}
                try { ctrl.transportControls.pause() } catch (_: Exception) {}
                try {
                    ctrl.dispatchMediaButtonEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_STOP))
                    ctrl.dispatchMediaButtonEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_STOP))
                } catch (_: Exception) {}
            }
        } catch (e: SecurityException) {
            Log.w(TAG, "MediaSessionManager: permission \"Notification access\" not granted — Plex foreground may be blocked by other apps")
        } catch (e: Exception) {
            Log.w(TAG, "stopOtherMediaSessions: ${e.message}")
        }
    }

    private fun handlePlay(json: JSONObject) {
        val cmd = PlayCommand.fromJson(json, hubConfig.get())
        Log.i(TAG, "Play: ${cmd.title} via ${cmd.app}")
        updateNotification("Playing: ${cmd.title}")
        // Libère le focus media avant de lancer la nouvelle app — contourne le blocage
        // Android 12+ qui empêche le bring-to-foreground depuis un service en background.
        stopOtherMediaSessions()

        val launcher = buildLaunchers().firstOrNull { it.canHandle(cmd) }
        if (launcher == null) {
            Log.w(TAG, "No launcher for app: ${cmd.app}")
            sendState("error", cmd.catalogId, cmd.app)
            return
        }
        when (val r = launcher.launch(this, cmd)) {
            is LaunchResult.Success -> sendState("playing", cmd.catalogId, cmd.app)
            is LaunchResult.AppNotInstalled -> { Log.e(TAG, "Not installed: ${r.pkg}"); sendState("error", cmd.catalogId, cmd.app) }
            is LaunchResult.Error -> { Log.e(TAG, "Error: ${r.reason}"); sendState("error", cmd.catalogId, cmd.app) }
        }
    }

    private fun sendState(status: String, catalogId: String? = null, app: String? = null, title: String? = null) {
        webSocket?.send(buildStateUpdate(status, catalogId, app, title))
    }

    // Monitor périodique des MediaSession actives → permet au dashboard de voir ce qui
    // joue actuellement même si la lecture n'a pas été lancée depuis le Hub (YouTube,
    // Netflix, navigation directe dans Plex, etc.). Réutilise la permission Notification
    // access. Tourne sur cmdHandler pour pas bloquer le thread WS.
    @Volatile private var lastReportedSessionState: String? = null
    private val sessionMonitor = object : Runnable {
        override fun run() {
            try { reportActiveSession() } catch (e: Exception) { Log.w(TAG, "session monitor", e) }
            cmdHandler.postDelayed(this, 4000L)
        }
    }

    private fun reportActiveSession() {
        val mgr = getSystemService(Context.MEDIA_SESSION_SERVICE) as? MediaSessionManager ?: return
        val component = ComponentName(this, HubNotificationListener::class.java)
        val sessions = try { mgr.getActiveSessions(component) } catch (_: SecurityException) { return }
        val active = sessions.firstOrNull {
            val s = it.playbackState?.state
            s == PlaybackState.STATE_PLAYING || s == PlaybackState.STATE_PAUSED || s == PlaybackState.STATE_BUFFERING
        }
        val snapshot = if (active == null) "stopped" else {
            val pkg = active.packageName
            val title = active.metadata?.getString(android.media.MediaMetadata.METADATA_KEY_TITLE)
                ?: active.metadata?.getString(android.media.MediaMetadata.METADATA_KEY_DISPLAY_TITLE)
            val state = when (active.playbackState?.state) {
                PlaybackState.STATE_PAUSED -> "paused"
                PlaybackState.STATE_BUFFERING -> "playing"
                else -> "playing"
            }
            "$state|$pkg|$title"
        }
        // Ne report que si changement, pour pas spammer le serveur ni écraser un title
        // posé par /api/play avec un title vide vu en route.
        if (snapshot == lastReportedSessionState) return
        lastReportedSessionState = snapshot
        if (active == null) {
            // Plus aucune session active → on retire le player overlay
            overlay.hidePlayer()
            sendState("stopped")
        } else {
            val pkg = active.packageName
            val title = active.metadata?.getString(android.media.MediaMetadata.METADATA_KEY_TITLE)
                ?: active.metadata?.getString(android.media.MediaMetadata.METADATA_KEY_DISPLAY_TITLE)
            val state = when (active.playbackState?.state) {
                PlaybackState.STATE_PAUSED -> "paused"
                else -> "playing"
            }
            val appLabel = packageToAppLabel(pkg)
            Log.i(TAG, "Active session: $appLabel ($pkg) — $title — $state")
            sendState(state, null, appLabel, title)
        }
    }

    private fun packageToAppLabel(pkg: String): String = when {
        pkg.startsWith("com.plexapp") -> "plex"
        pkg.startsWith("com.google.android.youtube") -> "youtube"
        pkg == "com.netflix.ninja" || pkg.startsWith("com.netflix") -> "netflix"
        pkg.startsWith("ar.tvplayer") -> "tivimate"
        pkg.startsWith("org.videolan") -> "vlc"
        pkg.contains("kodi") -> "kodi"
        else -> pkg
    }

    private fun scheduleReconnect() {
        reconnectAttempts++
        val delay = minOf(1000L * reconnectAttempts * reconnectAttempts, maxReconnectDelay)
        updateNotification("Reconnecting in ${delay / 1000}s...")
        android.os.Handler(mainLooper).postDelayed({ connect() }, delay)
    }

    private fun detectPlatform(): String {
        val mfr = Build.MANUFACTURER.lowercase()
        val model = Build.MODEL.lowercase()
        return when {
            "amazon" in mfr || "fire" in model -> "fire_tv"
            "nvidia" in mfr || "shield" in model -> "shield"
            else -> "android_tv"
        }
    }

    private fun buildCapabilities(): List<DeviceCapability> {
        val pm = packageManager
        val caps = mutableListOf<DeviceCapability>()

        if (pm.getLaunchIntentForPackage(PlexLauncher.PKG) != null
            || pm.getLeanbackLaunchIntentForPackage(PlexLauncher.PKG) != null)
            caps.add(DeviceCapability("plex", PlexLauncher.PKG, listOf("movie", "episode", "music"), "intent_deep_link"))

        val cfg = hubConfig.get()
        if (cfg != null && cfg.xtreamServer.isNotEmpty() && cfg.xtreamUser.isNotEmpty()) {
            caps.add(DeviceCapability("iptv", "xtream", listOf("live_channel", "vod"), "xtream_direct"))
        } else if (pm.getLaunchIntentForPackage(TiviMateLauncher.PKG) != null) {
            caps.add(DeviceCapability("iptv", TiviMateLauncher.PKG, listOf("live_channel", "vod"), "intent_custom"))
        }

        for (pkg in listOf("org.xbmc.kodi", "tv.kodi.kodi"))
            if (pm.getLaunchIntentForPackage(pkg) != null) {
                caps.add(DeviceCapability("kodi", pkg, listOf("movie", "episode", "music", "vod"), "intent_launch"))
                break
            }

        return caps
    }

    private fun getLocalIp(): String? {
        return try {
            val cm = applicationContext.getSystemService(CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
            val network = cm.activeNetwork ?: return null
            val props = cm.getLinkProperties(network) ?: return null
            props.linkAddresses
                .map { it.address }
                .filterIsInstance<java.net.Inet4Address>()
                .firstOrNull { !it.isLoopbackAddress }
                ?.hostAddress
        } catch (e: Exception) { null }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL_ID, "Hub Agent", NotificationManager.IMPORTANCE_LOW)
                .apply { description = "Hub MediaCenter agent" }
            getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
        }
    }

    private fun buildNotification(status: String): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Hub Agent")
            .setContentText(status)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(true)
            .build()

    private fun updateNotification(status: String) {
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify(NOTIF_ID, buildNotification(status))
        android.os.Handler(mainLooper).post { statusCallback?.invoke(status) }
    }
}
