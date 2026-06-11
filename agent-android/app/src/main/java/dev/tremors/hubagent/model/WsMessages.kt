package dev.tremors.hubagent.model

import org.json.JSONArray
import org.json.JSONObject

data class DeviceCapability(
    val app: String,
    val pkg: String,
    val canReceive: List<String>,
    val launchMethod: String
) {
    fun toJson() = JSONObject().apply {
        put("app", app)
        put("package", pkg)
        put("can_receive", JSONArray(canReceive))
        put("launch_method", launchMethod)
    }
}

data class PlayCommand(
    val catalogId: String,
    val app: String,
    val title: String,
    val plexId: String?,
    val plexServerId: String?,
    val plexWatchUrl: String?,
    val tiviMateChannel: String?,
    val iptvType: String?,
    val streamUrl: String?,
    val iptvContainer: String?,      // conteneur réel (mkv/mp4/ts...) → MIME précis
    val externalUrl: String?,        // Netflix/Disney+/... deep link
    val externalPlatform: String?,   // "netflix" | "disney+" | ...
    val player: String? = null,      // lecteur IPTV préféré : auto/mxplayer/vlc/tivimate
    val requester: String
) {
    companion object {
        fun fromJson(json: JSONObject, config: HubConfig? = null) = PlayCommand(
            catalogId = json.optString("catalog_id"),
            app = json.optString("app"),
            title = json.optString("title"),
            plexId = json.optString("plex_id").ifEmpty { null },
            plexServerId = config?.plexServerId?.ifEmpty { null },
            plexWatchUrl = json.optString("plex_watch_url").ifEmpty { null },
            tiviMateChannel = json.optString("tivimate_channel").ifEmpty { null },
            iptvType = json.optString("iptv_type").ifEmpty { null },
            streamUrl = json.optString("stream_url").ifEmpty { null },
            iptvContainer = json.optString("iptv_container").ifEmpty { null },
            externalUrl = json.optString("external_url").ifEmpty { null },
            externalPlatform = json.optString("external_platform").ifEmpty { null },
            player = json.optString("player").ifEmpty { null } ?: config?.iptvPlayer?.ifEmpty { null },
            requester = json.optString("requester", "unknown")
        )
    }
}

fun buildRegisterMessage(
    deviceId: String,
    name: String,
    platform: String,
    ip: String?,
    capabilities: List<DeviceCapability>
): String = JSONObject().apply {
    put("type", "register")
    put("device_id", deviceId)
    put("name", name)
    put("platform", platform)
    ip?.let { put("ip", it) }
    put("capabilities", JSONArray(capabilities.map { it.toJson() }))
}.toString()

fun buildStateUpdate(status: String, catalogId: String? = null, app: String? = null, title: String? = null): String =
    JSONObject().apply {
        put("type", "state_update")
        put("status", status)
        catalogId?.let { put("catalog_id", it) }
        app?.let { put("app", it) }
        title?.let { put("title", it) }
    }.toString()

data class HubConfig(
    val xtreamServer: String,
    val xtreamUser: String,
    val xtreamPass: String,
    val xtreamExt: String,
    val plexServerId: String,
    val appMappings: Map<String, String>,
    val iptvPlayer: String = "auto"   // lecteur IPTV préféré du device
) {
    companion object {
        fun fromJson(json: JSONObject) = HubConfig(
            xtreamServer = json.optString("xtream_server"),
            xtreamUser = json.optString("xtream_user"),
            xtreamPass = json.optString("xtream_pass"),
            xtreamExt = json.optString("xtream_ext", "ts"),
            plexServerId = json.optString("plex_server_id"),
            appMappings = json.optJSONObject("app_mappings")?.let { obj ->
                obj.keys().asSequence().associateWith { obj.getString(it) }
            } ?: emptyMap(),
            iptvPlayer = json.optString("iptv_player", "auto").ifEmpty { "auto" }
        )
    }
}

fun buildPing(): String = JSONObject().apply { put("type", "ping") }.toString()
