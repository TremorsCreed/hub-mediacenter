package dev.tremors.hubagent.launchers

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import dev.tremors.hubagent.model.PlayCommand

/**
 * Plays live channels and VOD directly from the Xtream Codes API stream URL,
 * bypassing TiviMate entirely. Works with any IPTV provider (Elon IPTV, etc.)
 * that exposes the standard Xtream Codes protocol.
 *
 * Stream URL format: http://{server}/{username}/{password}/{stream_id}[.ext]
 */
class XtreamLauncher(private val config: XtreamConfig) : BaseLauncher {

    override val appId = "iptv"

    companion object {
        private const val TAG = "XtreamLauncher"

        // Packages par lecteur (plusieurs variantes possibles)
        private val PKGS_BY_PLAYER = mapOf(
            "mxplayer" to listOf("com.mxtech.videoplayer.pro", "com.mxtech.videoplayer.ad"),
            "vlc" to listOf("org.videolan.vlc"),
            "tivimate" to listOf("ar.tvplayer.tv"),
        )

        // Ordre "auto" : MX Player préféré (plus robuste sur le TS IPTV), puis VLC, etc.
        private val AUTO_ORDER = listOf(
            "com.mxtech.videoplayer.pro",
            "com.mxtech.videoplayer.ad",
            "org.videolan.vlc",
            "ar.tvplayer.tv",
            "com.amazon.firetv.tvplayer",
        )
    }

    // MIME précis selon le conteneur réel. Indispensable pour MX Player qui, sur une
    // URL réseau SANS extension (cas des redirections Xtream), n'arrive pas à deviner
    // le format → "Impossible de jouer ce lien". VLC s'en sort avec "video/*".
    private fun mimeFor(container: String?, type: String?): String {
        if (type == "live") return "video/*"
        return when (container?.lowercase()?.removePrefix(".")) {
            "mkv" -> "video/x-matroska"
            "mp4", "m4v", "mov" -> "video/mp4"
            "avi" -> "video/x-msvideo"
            "ts" -> "video/mp2t"
            "webm" -> "video/webm"
            "flv" -> "video/x-flv"
            "wmv" -> "video/x-ms-wmv"
            else -> "video/*"
        }
    }

    // Choisit le package du lecteur selon la préférence (cmd.player), avec repli.
    private fun pickPlayer(pm: android.content.pm.PackageManager, pref: String?): String? {
        fun installed(pkg: String) = pm.getLaunchIntentForPackage(pkg) != null
        val choice = (pref ?: "auto").lowercase()
        if (choice != "auto" && PKGS_BY_PLAYER.containsKey(choice)) {
            // Lecteur explicite : si installé on l'utilise, sinon on retombe sur l'auto
            PKGS_BY_PLAYER[choice]!!.firstOrNull { installed(it) }?.let { return it }
            Log.w(TAG, "lecteur '$choice' non installé, repli sur auto")
        }
        return AUTO_ORDER.firstOrNull { installed(it) }
    }

    override fun canHandle(cmd: PlayCommand) =
        cmd.app == "iptv" && config.isConfigured()

    override fun launch(ctx: Context, cmd: PlayCommand): LaunchResult {
        // Priorité 1 : URL fournie par le hub (contient l'extension résolue via get_vod_info).
        // Priorité 2 : on construit nous-mêmes (rétrocompat hub plus ancien).
        val streamUrl: String = cmd.streamUrl ?: run {
            val streamId = cmd.tiviMateChannel
            if (streamId.isNullOrEmpty()) {
                Log.w(TAG, "No tivimate_channel (stream_id) and no stream_url in command")
                return LaunchResult.Error("No stream URL provided")
            }
            val type = cmd.iptvType ?: "live"
            val url = config.buildStreamUrl(streamId, type)
            Log.i(TAG, "Built stream URL locally ($type): $url")
            url
        }
        Log.i(TAG, "Launching stream: $streamUrl")

        val pm = ctx.packageManager
        val playerPkg = pickPlayer(pm, cmd.player)
        Log.i(TAG, "Préférence='${cmd.player ?: "auto"}' → lecteur: ${playerPkg ?: "(system chooser)"}")

        return try {
            val mime = mimeFor(cmd.iptvContainer, cmd.iptvType)
            Log.i(TAG, "MIME='$mime' (container=${cmd.iptvContainer}, type=${cmd.iptvType})")
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(Uri.parse(streamUrl), mime)
                addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
                )
                // Titre affiché par le lecteur (MX Player / VLC le lisent)
                putExtra("title", cmd.title)
                playerPkg?.let { setPackage(it) }
            }
            ctx.startActivity(intent)
            Log.i(TAG, "Launched stream in ${playerPkg ?: "system player"}")
            LaunchResult.Success
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch stream: ${e.message}", e)
            LaunchResult.Error("No video player found: ${e.message}")
        }
    }
}

data class XtreamConfig(
    val serverUrl: String,    // e.g. http://elon-iptv.com:8080
    val username: String,
    val password: String,
    val ext: String = "ts"    // ts ou m3u8 — utilisé pour les live channels
) {
    fun isConfigured() = serverUrl.isNotEmpty() && username.isNotEmpty() && password.isNotEmpty()

    /**
     * Construit l'URL stream selon le format Xtream Codes :
     * - live   : http://{server}/{user}/{pass}/{streamId}.{ext}      (ext = ts ou m3u8)
     * - vod    : http://{server}/movie/{user}/{pass}/{streamId}.mp4  (ou mkv/avi selon source)
     * - series : http://{server}/series/{user}/{pass}/{streamId}.mp4
     *
     * Pour VOD on tente mp4 par défaut (format le plus courant). L'extension réelle
     * peut varier — un appel get_vod_info au préalable serait plus fiable mais
     * la majorité des sources Xtream servent en mp4.
     */
    fun buildStreamUrl(streamId: String, type: String = "live"): String {
        val base = serverUrl.trimEnd('/')
        return when (type) {
            "vod" -> "$base/movie/$username/$password/$streamId.mp4"
            "series" -> "$base/series/$username/$password/$streamId.mp4"
            else -> "$base/$username/$password/$streamId.$ext"
        }
    }
}
