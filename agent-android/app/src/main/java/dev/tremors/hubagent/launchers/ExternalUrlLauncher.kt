package dev.tremors.hubagent.launchers

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import dev.tremors.hubagent.model.PlayCommand

/**
 * Lance une URL externe (Netflix, Disney+, Prime Video, ...) via Intent ACTION_VIEW.
 *
 * Pour chaque plateforme connue on cible explicitement le package Android TV de l'app
 * (Shield/Fire TV). Si l'app n'est pas installée, on retombe sur le browser via universal link.
 *
 * Netflix gère ses propres reprises côté serveur — lancer un title via deep link suffit,
 * l'app affiche soit la fiche soit le bouton "Reprendre" selon l'historique utilisateur.
 */
class ExternalUrlLauncher : BaseLauncher {
    override val appId = "external"

    companion object {
        private const val TAG = "ExternalUrlLauncher"

        // Packages connus des apps streaming sur Android TV (Shield/Fire TV).
        // Tester en priorité ; fallback browser si rien installé.
        private val PLATFORM_PACKAGES = mapOf(
            "netflix"      to listOf("com.netflix.ninja", "com.netflix.mediaclient"),
            "disney+"      to listOf("com.disney.disneyplus"),
            "disneyplus"   to listOf("com.disney.disneyplus"),
            "primevideo"   to listOf("com.amazon.amazonvideo.livingroom", "com.amazon.avod.thirdpartyclient"),
            "amazon"       to listOf("com.amazon.amazonvideo.livingroom"),
            "appletvplus"  to listOf("com.apple.atve.androidtv.appletv", "com.apple.atve.amazon.appletv"),
            "apple"        to listOf("com.apple.atve.androidtv.appletv"),
            "youtube"      to listOf("com.google.android.youtube.tv"),
            "spotify"      to listOf("com.spotify.tv.android"),
            "max"          to listOf("com.wbd.stream"),
            "hbo"          to listOf("com.wbd.stream", "com.hbo.hbonow"),
            "paramount+"   to listOf("com.cbs.ott"),
            "paramountplus" to listOf("com.cbs.ott"),
        )
    }

    override fun canHandle(cmd: PlayCommand) = cmd.app == appId && !cmd.externalUrl.isNullOrEmpty()

    override fun launch(ctx: Context, cmd: PlayCommand): LaunchResult {
        val url = cmd.externalUrl
            ?: return LaunchResult.Error("no external_url in command")
        val pm = ctx.packageManager
        val platform = (cmd.externalPlatform ?: "").lowercase().trim()
        val candidates = PLATFORM_PACKAGES[platform] ?: emptyList()
        val installedPkg = candidates.firstOrNull { pm.getLaunchIntentForPackage(it) != null }
        Log.i(TAG, "External launch: platform=$platform pkg=${installedPkg ?: "(browser)"} url=$url")

        return try {
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP
                )
                installedPkg?.let { setPackage(it) }
            }
            ctx.startActivity(intent)
            LaunchResult.Success
        } catch (e: ActivityNotFoundException) {
            // Si on a forcé le package et qu'il refuse, retenter sans package (browser)
            if (installedPkg != null) {
                try {
                    val fallback = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    ctx.startActivity(fallback)
                    LaunchResult.Success
                } catch (e2: Exception) {
                    LaunchResult.Error("no handler for $url: ${e2.message}")
                }
            } else {
                LaunchResult.Error("no handler for $url")
            }
        } catch (e: Exception) {
            LaunchResult.Error("launch failed: ${e.message}")
        }
    }
}
