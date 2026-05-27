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
        // Flags pour ramener Plex au premier plan même si une autre app est focusée
        // (contourne le blocage Android 12+ des background activity starts).
        private const val FOCUS_FLAGS = Intent.FLAG_ACTIVITY_NEW_TASK or
            Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
            Intent.FLAG_ACTIVITY_CLEAR_TOP or
            Intent.FLAG_ACTIVITY_SINGLE_TOP
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

        // Priorité : watch URL résolu par le Hub via token Plex
        val watchUri = cmd.plexWatchUrl?.let { Uri.parse(it) }
            ?: Uri.parse("plex://play?contentKey=/library/metadata/$plexId").let { fallback ->
                if (!cmd.plexServerId.isNullOrEmpty())
                    Uri.parse("plex://play?contentKey=/library/metadata/$plexId&server=${cmd.plexServerId}")
                else fallback
            }

        return try {
            val intent = Intent(Intent.ACTION_VIEW, watchUri).apply {
                if (cmd.plexWatchUrl == null) setPackage(PKG)
                addFlags(FOCUS_FLAGS)
            }
            ctx.startActivity(intent)
            Log.i(TAG, "Launched Plex: $watchUri")
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
                addFlags(FOCUS_FLAGS)
            }
            ctx.startActivity(intent)
            LaunchResult.Success
        } catch (e: Exception) {
            LaunchResult.Error("Failed to launch Plex: ${e.message}")
        }
    }

}
