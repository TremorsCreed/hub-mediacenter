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

    override fun launch(ctx: Context, cmd: PlayCommand): LaunchResult {
        val pm = ctx.packageManager
        if (pm.getLaunchIntentForPackage(PKG) == null) {
            return LaunchResult.AppNotInstalled(PKG)
        }

        val plexId = cmd.plexId
        if (plexId.isNullOrEmpty()) {
            // No specific media ID — just open Plex
            Log.w(TAG, "No plex_id in command, opening Plex home")
            return launchHome(ctx)
        }

        // Plex deep link: opens specific media in the Plex app
        // Format: plex://play?contentKey=/library/metadata/{id}
        return try {
            val uri = Uri.parse("plex://play?contentKey=/library/metadata/$plexId")
            val intent = Intent(Intent.ACTION_VIEW, uri).apply {
                setPackage(PKG)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            ctx.startActivity(intent)
            Log.i(TAG, "Launched Plex for contentKey /library/metadata/$plexId")
            LaunchResult.Success
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "Plex deep link failed, falling back to home: ${e.message}")
            launchHome(ctx)
        }
    }

    private fun launchHome(ctx: Context): LaunchResult {
        return try {
            val intent = ctx.packageManager.getLaunchIntentForPackage(PKG)!!.apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            ctx.startActivity(intent)
            LaunchResult.Success
        } catch (e: Exception) {
            LaunchResult.Error("Failed to launch Plex: ${e.message}")
        }
    }
}
