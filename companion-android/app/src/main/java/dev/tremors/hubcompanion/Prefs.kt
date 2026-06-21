package dev.tremors.hubcompanion

import android.content.Context
import android.os.Build
import java.util.UUID

// Acces centralise aux SharedPreferences. Stocke l'URL du Hub, le profil actif,
// le nom de l'appareil et un id stable genere une seule fois.
object Prefs {
    const val NAME = "hmcompanion"

    const val KEY_HUB_URL = "hub_url"
    const val KEY_DEVICE_ID = "device_id"
    const val KEY_DEVICE_NAME = "device_name"
    const val KEY_USER_ID = "user_id"
    const val KEY_USER_NAME = "user_name"

    private fun prefs(ctx: Context) =
        ctx.getSharedPreferences(NAME, Context.MODE_PRIVATE)

    fun hubUrl(ctx: Context): String? =
        prefs(ctx).getString(KEY_HUB_URL, null)?.takeIf { it.isNotBlank() }

    fun setHubUrl(ctx: Context, url: String) {
        prefs(ctx).edit().putString(KEY_HUB_URL, normalizeUrl(url)).apply()
    }

    // Id stable de l'appareil : genere une fois puis conserve. Sert d'identifiant
    // unique cote Hub (POST /api/devices/register).
    fun deviceId(ctx: Context): String {
        val p = prefs(ctx)
        var id = p.getString(KEY_DEVICE_ID, null)
        if (id.isNullOrBlank()) {
            id = "companion-" + UUID.randomUUID().toString().take(8)
            p.edit().putString(KEY_DEVICE_ID, id).apply()
        }
        return id
    }

    fun deviceName(ctx: Context): String {
        val stored = prefs(ctx).getString(KEY_DEVICE_NAME, null)
        if (!stored.isNullOrBlank()) return stored
        return "${Build.MANUFACTURER} ${Build.MODEL}".trim()
    }

    fun setDeviceName(ctx: Context, name: String) {
        prefs(ctx).edit().putString(KEY_DEVICE_NAME, name).apply()
    }

    fun userId(ctx: Context): Int? {
        val v = prefs(ctx).getInt(KEY_USER_ID, -1)
        return if (v >= 0) v else null
    }

    fun userName(ctx: Context): String? =
        prefs(ctx).getString(KEY_USER_NAME, null)

    fun setUser(ctx: Context, id: Int, name: String) {
        prefs(ctx).edit()
            .putInt(KEY_USER_ID, id)
            .putString(KEY_USER_NAME, name)
            .apply()
    }

    // Onboarding complet = URL du Hub connue ET profil choisi.
    fun isConfigured(ctx: Context): Boolean =
        hubUrl(ctx) != null && userId(ctx) != null

    // Normalise l'URL : ajoute http:// si absent, retire le slash final.
    fun normalizeUrl(raw: String): String {
        var u = raw.trim()
        if (u.isEmpty()) return u
        if (!u.startsWith("http://") && !u.startsWith("https://")) {
            u = "http://$u"
        }
        return u.trimEnd('/')
    }
}
