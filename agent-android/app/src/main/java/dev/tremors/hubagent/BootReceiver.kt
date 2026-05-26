package dev.tremors.hubagent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            val prefs = ctx.getSharedPreferences(HubService.PREFS, Context.MODE_PRIVATE)
            val hubUrl = prefs.getString(HubService.PREF_HUB_URL, null)
            if (!hubUrl.isNullOrEmpty()) {
                HubService.start(ctx)
            }
        }
    }
}
