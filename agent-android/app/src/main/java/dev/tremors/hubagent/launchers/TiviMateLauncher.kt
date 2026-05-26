package dev.tremors.hubagent.launchers

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import dev.tremors.hubagent.model.PlayCommand

class TiviMateLauncher : BaseLauncher {
    override val appId = "tivimate"

    companion object {
        const val PKG = "ar.tvplayer.tv"
        private const val TAG = "TiviMateLauncher"

        // TiviMate does not expose a public deep-link API for channel targeting.
        // These intent extras are reverse-engineered and may break on app updates.
        // Track: https://tivimate.com/forum for any official API announcement.
        const val EXTRA_CHANNEL_ID = "channel_id"
    }

    override fun canHandle(cmd: PlayCommand) = cmd.app == appId

    override fun launch(ctx: Context, cmd: PlayCommand): LaunchResult {
        val pm = ctx.packageManager
        if (pm.getLaunchIntentForPackage(PKG) == null) {
            return LaunchResult.AppNotInstalled(PKG)
        }

        val channelId = cmd.tiviMateChannel
        if (!channelId.isNullOrEmpty()) {
            // Attempt undocumented channel intent — works on TiviMate <= 4.x, may break
            try {
                val intent = Intent().apply {
                    action = Intent.ACTION_VIEW
                    data = Uri.parse("tivimate://channel/$channelId")
                    setPackage(PKG)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                ctx.startActivity(intent)
                Log.i(TAG, "Launched TiviMate channel $channelId via deep link")
                return LaunchResult.Success
            } catch (e: Exception) {
                Log.w(TAG, "TiviMate deep link failed: ${e.message}, falling back to app launch")
            }
        }

        // Fallback: open TiviMate without channel targeting
        return try {
            val intent = pm.getLaunchIntentForPackage(PKG)!!.apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            ctx.startActivity(intent)
            Log.i(TAG, "Launched TiviMate (no channel targeting)")
            LaunchResult.Success
        } catch (e: Exception) {
            LaunchResult.Error("Failed to launch TiviMate: ${e.message}")
        }
    }
}
