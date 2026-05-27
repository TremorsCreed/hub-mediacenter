package dev.tremors.hubagent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.util.Log
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

    private val client = OkHttpClient.Builder()
        .pingInterval(30, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

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
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        webSocket?.close(1000, "Service stopped")
        client.dispatcher.executorService.shutdown()
        super.onDestroy()
    }

    private fun connect() {
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

    private fun handleMessage(json: JSONObject) {
        when (json.optString("type")) {
            "play" -> handlePlay(json)
            "stop" -> { updateNotification("Connected — $deviceName"); sendState("stopped") }
            "pong" -> Log.d(TAG, "pong")
            else -> Log.w(TAG, "Unknown: ${json.optString("type")}")
        }
    }

    private fun handlePlay(json: JSONObject) {
        val cmd = PlayCommand.fromJson(json, hubConfig.get())
        Log.i(TAG, "Play: ${cmd.title} via ${cmd.app}")
        updateNotification("Playing: ${cmd.title}")

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

    private fun sendState(status: String, catalogId: String? = null, app: String? = null) {
        webSocket?.send(buildStateUpdate(status, catalogId, app))
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

    private fun getLocalIp(): String? = try {
        val cm = applicationContext.getSystemService(CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
        val network = cm.activeNetwork ?: return null
        val props = cm.getLinkProperties(network) ?: return null
        props.linkAddresses
            .map { it.address }
            .filterIsInstance<java.net.Inet4Address>()
            .firstOrNull { !it.isLoopbackAddress }
            ?.hostAddress
    } catch (e: Exception) { null }

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
