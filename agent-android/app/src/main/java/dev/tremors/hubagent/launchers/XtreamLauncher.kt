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

        // Prefer these players if installed — ordered by quality for IPTV
        private val PREFERRED_PLAYERS = listOf(
            "org.videolan.vlc",              // VLC
            "com.mxtech.videoplayer.ad",     // MX Player (free)
            "com.mxtech.videoplayer.pro",    // MX Player Pro
            "ar.tvplayer.tv",                // TiviMate (fallback)
            "com.amazon.firetv.tvplayer",    // Fire TV built-in
        )
    }

    override fun canHandle(cmd: PlayCommand) =
        cmd.app == "iptv" && config.isConfigured()

    override fun launch(ctx: Context, cmd: PlayCommand): LaunchResult {
        val streamId = cmd.tiviMateChannel
        if (streamId.isNullOrEmpty()) {
            Log.w(TAG, "No tivimate_channel (stream_id) in command")
            return LaunchResult.Error("No stream_id provided")
        }

        // Type par défaut = live (rétrocompat) si non précisé par le hub
        val type = cmd.iptvType ?: "live"
        val streamUrl = config.buildStreamUrl(streamId, type)
        Log.i(TAG, "Xtream stream URL ($type): $streamUrl")

        val pm = ctx.packageManager
        val playerPkg = PREFERRED_PLAYERS.firstOrNull {
            pm.getLaunchIntentForPackage(it) != null
        }
        Log.i(TAG, "Selected player: ${playerPkg ?: "(system chooser)"}")

        return try {
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(Uri.parse(streamUrl), "video/*")
                addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
                )
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
