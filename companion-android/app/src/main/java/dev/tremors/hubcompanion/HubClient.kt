package dev.tremors.hubcompanion

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

// Client reseau de l'app. Toutes les methodes sont SYNCHRONES (bloquantes) et
// doivent etre appelees depuis un thread de fond, jamais le main thread.
// On encapsule chaque appel dans un Result pour ne jamais planter sur une erreur
// reseau : un partage qui echoue doit afficher un message, pas crasher l'app.
class HubClient(private val baseUrl: String) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .build()

    private val jsonType = "application/json; charset=utf-8".toMediaType()

    sealed class Resp<out T> {
        data class Ok<T>(val value: T) : Resp<T>()
        data class Err(val message: String) : Resp<Nothing>()
    }

    private fun url(path: String): String = baseUrl.trimEnd('/') + path

    // GET {hub}/health -> true si le Hub repond ok.
    fun ping(): Resp<Boolean> {
        return try {
            val req = Request.Builder().url(url("/health")).get().build()
            client.newCall(req).execute().use { r ->
                if (!r.isSuccessful) return Resp.Err("HTTP ${r.code}")
                val body = r.body?.string().orEmpty()
                val ok = try { JSONObject(body).optBoolean("ok", false) } catch (_: Exception) { false }
                if (ok) Resp.Ok(true) else Resp.Err("Reponse inattendue du Hub")
            }
        } catch (e: IOException) {
            Resp.Err(e.message ?: "Hub injoignable")
        }
    }

    // GET {hub}/api/users -> liste des profils (id, name, avatar_color).
    fun users(): Resp<List<UserProfile>> {
        return try {
            val req = Request.Builder().url(url("/api/users")).get().build()
            client.newCall(req).execute().use { r ->
                if (!r.isSuccessful) return Resp.Err("HTTP ${r.code}")
                val arr = JSONArray(r.body?.string().orEmpty())
                val list = ArrayList<UserProfile>(arr.length())
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    list.add(
                        UserProfile(
                            id = o.getInt("id"),
                            name = o.optString("name", "Profil ${o.getInt("id")}"),
                            avatarColor = o.optString("avatar_color", null),
                            defaultPlaylistId = if (o.isNull("default_playlist_id")) null
                                else o.optInt("default_playlist_id"),
                        )
                    )
                }
                Resp.Ok(list)
            }
        } catch (e: Exception) {
            Resp.Err(e.message ?: "Erreur reseau")
        }
    }

    // POST {hub}/api/devices/register -> enregistre/maj cet appareil.
    fun registerDevice(id: String, name: String, ip: String?): Resp<Boolean> {
        return try {
            val body = JSONObject()
                .put("id", id)
                .put("name", name)
                .put("platform", "companion")
                .apply { if (!ip.isNullOrBlank()) put("ip", ip) }
                .put("capabilities", JSONArray())
                .toString()
            val req = Request.Builder()
                .url(url("/api/devices/register"))
                .post(body.toRequestBody(jsonType))
                .build()
            client.newCall(req).execute().use { r ->
                if (r.isSuccessful) Resp.Ok(true) else Resp.Err("HTTP ${r.code}")
            }
        } catch (e: Exception) {
            Resp.Err(e.message ?: "Erreur reseau")
        }
    }

    // POST {hub}/api/companion/ingest avec header X-User-Id.
    fun ingest(userId: Int, sharedUrl: String?, sharedText: String?): Resp<IngestResult> {
        return try {
            val body = JSONObject()
                .apply {
                    if (!sharedUrl.isNullOrBlank()) put("url", sharedUrl)
                    if (!sharedText.isNullOrBlank()) put("sharedText", sharedText)
                }
                .toString()
            val req = Request.Builder()
                .url(url("/api/companion/ingest"))
                .header("X-User-Id", userId.toString())
                .post(body.toRequestBody(jsonType))
                .build()
            client.newCall(req).execute().use { r ->
                val raw = r.body?.string().orEmpty()
                if (!r.isSuccessful) {
                    val detail = try { JSONObject(raw).optString("detail", "") } catch (_: Exception) { "" }
                    return Resp.Err(if (detail.isNotBlank()) detail else "HTTP ${r.code}")
                }
                Resp.Ok(IngestResult.parse(JSONObject(raw)))
            }
        } catch (e: Exception) {
            Resp.Err(e.message ?: "Erreur reseau")
        }
    }

    // GET {hub}/api/playlists avec header X-User-Id -> playlists visibles.
    fun playlists(userId: Int): Resp<List<Playlist>> {
        return try {
            val req = Request.Builder()
                .url(url("/api/playlists"))
                .header("X-User-Id", userId.toString())
                .get()
                .build()
            client.newCall(req).execute().use { r ->
                if (!r.isSuccessful) return Resp.Err("HTTP ${r.code}")
                val arr = JSONArray(r.body?.string().orEmpty())
                val list = ArrayList<Playlist>(arr.length())
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    list.add(Playlist(id = o.getInt("id"), name = o.optString("name", "Sans nom")))
                }
                Resp.Ok(list)
            }
        } catch (e: Exception) {
            Resp.Err(e.message ?: "Erreur reseau")
        }
    }

    // POST {hub}/api/playlists/{id}/items avec header X-User-Id.
    // Le backend exige au minimum "app" ; on stocke l'item sous l'app "companion".
    fun addPlaylistItem(
        userId: Int,
        playlistId: Int,
        title: String?,
        year: Int?,
        thumb: String?,
        refId: String?,
        refType: String?,
    ): Resp<Boolean> {
        return try {
            val body = JSONObject()
                .put("app", "companion")
                .apply {
                    if (!title.isNullOrBlank()) put("title", title)
                    if (year != null) put("year", year)
                    if (!thumb.isNullOrBlank()) put("thumb", thumb)
                    if (!refId.isNullOrBlank()) put("ref_id", refId)
                    if (!refType.isNullOrBlank()) put("ref_type", refType)
                }
                .toString()
            val req = Request.Builder()
                .url(url("/api/playlists/$playlistId/items"))
                .header("X-User-Id", userId.toString())
                .post(body.toRequestBody(jsonType))
                .build()
            client.newCall(req).execute().use { r ->
                if (r.isSuccessful) Resp.Ok(true) else Resp.Err("HTTP ${r.code}")
            }
        } catch (e: Exception) {
            Resp.Err(e.message ?: "Erreur reseau")
        }
    }
}

data class UserProfile(
    val id: Int,
    val name: String,
    val avatarColor: String?,
    val defaultPlaylistId: Int? = null,
)

data class Playlist(val id: Int, val name: String)

// Un candidat de match renvoye par /ingest (Trakt/TMDb).
data class Candidate(
    val type: String,
    val title: String,
    val year: Int?,
    val imdb: String?,
    val tmdb: Int?,
    val trakt: Int?,
)

// Resultat synthetique du POST /ingest, parse depuis le JSON du Hub.
data class IngestResult(
    val id: Int,
    val status: String,
    val platform: String,
    val resolvedTitle: String?,
    val confidence: String,
    val thumbnail: String?,
    val author: String?,
    val candidates: List<Candidate>,
) {
    companion object {
        fun parse(o: JSONObject): IngestResult {
            val cands = ArrayList<Candidate>()
            val arr = o.optJSONArray("candidates")
            if (arr != null) {
                for (i in 0 until arr.length()) {
                    val c = arr.getJSONObject(i)
                    val ids = c.optJSONObject("ids")
                    cands.add(
                        Candidate(
                            type = c.optString("type", "movie"),
                            title = c.optString("title", ""),
                            year = if (c.isNull("year")) null else c.optInt("year"),
                            imdb = ids?.optString("imdb", null),
                            tmdb = ids?.let { if (it.has("tmdb")) it.optInt("tmdb") else null },
                            trakt = ids?.let { if (it.has("trakt")) it.optInt("trakt") else null },
                        )
                    )
                }
            }
            return IngestResult(
                id = o.optInt("id", -1),
                status = o.optString("status", "pending"),
                platform = o.optString("platform", "unknown"),
                resolvedTitle = if (o.isNull("resolved_title")) null else o.optString("resolved_title", null),
                confidence = o.optString("confidence", "low"),
                thumbnail = if (o.isNull("thumbnail")) null else o.optString("thumbnail", null),
                author = if (o.isNull("author")) null else o.optString("author", null),
                candidates = cands,
            )
        }
    }
}
