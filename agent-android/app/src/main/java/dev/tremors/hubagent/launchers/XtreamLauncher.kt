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

    override val appId = "tivimate" // handles commands targeting tivimate

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
        cmd.app == "tivimate" && config.isConfigured()

    override fun launch(ctx: Context, cmd: PlayCommand): LaunchResult {
        val streamId = cmd.tiviMateChannel
        if (streamId.isNullOrEmpty()) {
            Log.w(TAG, "No tivimate_channel (stream_id) in command")
            return LaunchResult.Error("No stream_id provided")
        }

        val streamUrl = config.buildStreamUrl(streamId)
        Log.i(TAG, "Xtream stream URL: $streamUrl")

        // Find the best available player
        val pm = ctx.packageManager
        val playerPkg = PREFERRED_PLAYERS.firstOrNull {
            pm.getLaunchIntentForPackage(it) != null
        }

        return try {
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(Uri.parse(streamUrl), "video/*")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                playerPkg?.let { setPackage(it) }
            }
            ctx.startActivity(intent)
            Log.i(TAG, "Launched stream in ${playerPkg ?: "system player"}")
            LaunchResult.Success
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch stream: ${e.message}")
            LaunchResult.Error("No video player found: ${e.message}")
        }
    }
}

data class XtreamConfig(
    val serverUrl: String,    // e.g. http://elon-iptv.com:8080
    val username: String,
    val password: String,
    val ext: String = "ts"    // ts or m3u8
) {
    fun isConfigured() = serverUrl.isNotEmpty() && username.isNotEmpty() && password.isNotEmpty()

    fun buildStreamUrl(streamId: String): String {
        val base = serverUrl.trimEnd('/')
        return "$base/$username/$password/$streamId.$ext"
    }
}
