package dev.tremors.hubagent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            // Même défaut que HubService.hubUrl : ne jamais dépendre d'un clic "Save"
            // que personne n'a de raison de faire (le champ affiche déjà ce défaut).
            val prefs = ctx.getSharedPreferences(HubService.PREFS, Context.MODE_PRIVATE)
            val hubUrl = prefs.getString(HubService.PREF_HUB_URL, "ws://192.168.1.15:${HubService.DEFAULT_HUB_PORT}")
            if (!hubUrl.isNullOrEmpty()) {
                HubService.start(ctx)
            }
        }
    }
}
