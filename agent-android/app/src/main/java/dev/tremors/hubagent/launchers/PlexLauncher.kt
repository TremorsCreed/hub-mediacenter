package dev.tremors.hubagent.launchers

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import dev.tremors.hubagent.model.PlayCommand

class PlexLauncher : BaseLauncher {
    override val appId = "plex"

    companion object {
        const val PKG = "com.plexapp.android"
        private const val TAG = "PlexLauncher"
    }

    override fun canHandle(cmd: PlayCommand) = cmd.app == appId

    private fun isInstalled(ctx: Context): Boolean {
        val pm = ctx.packageManager
        return pm.getLaunchIntentForPackage(PKG) != null
            || pm.getLeanbackLaunchIntentForPackage(PKG) != null
    }

    override fun launch(ctx: Context, cmd: PlayCommand): LaunchResult {
        if (!isInstalled(ctx)) {
            return LaunchResult.AppNotInstalled(PKG)
        }

        val plexId = cmd.plexId
        if (plexId.isNullOrEmpty()) {
            // No specific media ID — just open Plex
            Log.w(TAG, "No plex_id in command, opening Plex home")
            return launchHome(ctx)
        }

        return try {
            val uri = if (cmd.plexServerId.isNullOrEmpty()) {
                Uri.parse("plex://play?contentKey=/library/metadata/$plexId")
            } else {
                Uri.parse("plex://play?contentKey=/library/metadata/$plexId&server=${cmd.plexServerId}")
            }
            val intent = Intent(Intent.ACTION_VIEW, uri).apply {
                setPackage(PKG)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            ctx.startActivity(intent)
            Log.i(TAG, "Launched Plex: $uri")
            LaunchResult.Success
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "Plex deep link failed, falling back to home: ${e.message}")
            launchHome(ctx)
        }
    }

    private fun launchHome(ctx: Context): LaunchResult {
        return try {
            val pm = ctx.packageManager
            val intent = (pm.getLeanbackLaunchIntentForPackage(PKG)
                ?: pm.getLaunchIntentForPackage(PKG))!!.apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            ctx.startActivity(intent)
            LaunchResult.Success
        } catch (e: Exception) {
            LaunchResult.Error("Failed to launch Plex: ${e.message}")
        }
    }
}
