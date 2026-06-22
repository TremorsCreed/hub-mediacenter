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

    // URL de l'UI du Hub (frontend), derivee de hubUrl.
    // hubUrl sert aux appels API : marche sur :8020 (backend direct) comme sur
    // :3050 (proxy nginx). Mais l'UI n'est servie que par :3050. On ne touche
    // donc qu'au port, en gardant schema + hote :
    //  - port :8020 -> remplace par :3050 (cas du backend direct).
    //  - autre port explicite (dont :3050) -> conserve tel quel.
    //  - pas de port -> force :3050 sur l'hote.
    fun uiUrl(ctx: Context): String? {
        val raw = hubUrl(ctx) ?: return null
        return toUiUrl(raw)
    }

    fun toUiUrl(raw: String): String {
        val u = normalizeUrl(raw)
        val scheme = if (u.startsWith("https://")) "https://" else "http://"
        // Reste de l'URL apres le schema : hote[:port][/chemin...].
        val rest = u.substring(scheme.length)
        val slash = rest.indexOf('/')
        val authority = if (slash >= 0) rest.substring(0, slash) else rest
        val path = if (slash >= 0) rest.substring(slash) else ""

        val colon = authority.indexOf(':')
        val host = if (colon >= 0) authority.substring(0, colon) else authority
        val port = if (colon >= 0) authority.substring(colon + 1) else null

        val uiPort = when (port) {
            null -> "3050"   // pas de port explicite : on force l'UI.
            "8020" -> "3050" // backend direct : on bascule vers l'UI.
            else -> port     // :3050 ou autre : on garde.
        }
        return "$scheme$host:$uiPort$path"
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
