package dev.tremors.hubagent.launchers

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import dev.tremors.hubagent.model.PlayCommand

class KodiLauncher : BaseLauncher {
    override val appId = "kodi"

    companion object {
        private val KODI_PACKAGES = listOf(
            "org.xbmc.kodi",
            "tv.kodi.kodi"
        )
        private const val TAG = "KodiLauncher"
    }

    override fun canHandle(cmd: PlayCommand) = cmd.app == appId

    override fun launch(ctx: Context, cmd: PlayCommand): LaunchResult {
        val pm = ctx.packageManager
        val pkg = KODI_PACKAGES.firstOrNull { pm.getLaunchIntentForPackage(it) != null }
            ?: return LaunchResult.AppNotInstalled(KODI_PACKAGES.first())

        return try {
            val intent = pm.getLaunchIntentForPackage(pkg)!!.apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            ctx.startActivity(intent)
            Log.i(TAG, "Launched Kodi ($pkg)")
            LaunchResult.Success
        } catch (e: Exception) {
            LaunchResult.Error("Failed to launch Kodi: ${e.message}")
        }
    }
}
