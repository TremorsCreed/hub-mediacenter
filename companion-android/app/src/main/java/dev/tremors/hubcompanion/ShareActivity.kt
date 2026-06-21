package dev.tremors.hubcompanion

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import kotlin.concurrent.thread

// Cible de partage. Recoit un ACTION_SEND (TikTok -> feuille de partage), envoie
// le lien au Hub via /api/companion/ingest, puis affiche une fiche de validation.
// Regle d'or : ne JAMAIS planter sur un partage. En cas d'echec on previent
// l'utilisateur (Toast + message) mais l'app reste stable.
class ShareActivity : AppCompatActivity() {

    private val bg = Color.parseColor("#0d0d14")
    private val card = Color.parseColor("#1e1e30")
    private val accent = Color.parseColor("#38BDF8")

    private lateinit var root: LinearLayout
    private var lastResult: IngestResult? = null
    private var sharedUrl: String? = null
    private var sharedText: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val scroll = ScrollView(this).apply { setBackgroundColor(bg) }
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(28), dp(24), dp(28))
        }
        scroll.addView(root)
        setContentView(scroll)

        // Pas encore configure : on guide vers l'ecran de reglages.
        if (!Prefs.isConfigured(this)) {
            renderNotConfigured()
            return
        }

        // Extraction du texte partage.
        val text = extractSharedText(intent)
        if (text.isNullOrBlank()) {
            renderMessage("Aucun contenu recu dans le partage.")
            toast("Rien a importer")
            return
        }
        sharedText = text
        sharedUrl = firstUrl(text)

        renderLoading()
        ingest()
    }

    private fun ingest() {
        val url = Prefs.hubUrl(this)
        val userId = Prefs.userId(this)
        if (url == null || userId == null) {
            renderNotConfigured()
            return
        }
        thread {
            val client = HubClient(url)
            val r = client.ingest(userId, sharedUrl, sharedText)
            runOnUiThread {
                when (r) {
                    is HubClient.Resp.Err -> {
                        // On a quand meme tente : message clair, pas de crash.
                        renderMessage("Envoye au Hub mais resolution incertaine.\n${r.message}")
                        toast("Ajoute a traiter")
                    }
                    is HubClient.Resp.Ok -> {
                        lastResult = r.value
                        renderResult(r.value)
                        toast("Ajoute a traiter")
                    }
                }
            }
        }
    }

    // ── Rendus ────────────────────────────────────────────────────────────────

    private fun renderLoading() {
        root.removeAllViews()
        root.addView(title("Envoi au Hub ..."))
        root.addView(ProgressBar(this), lp(topMargin = dp(24)))
    }

    private fun renderNotConfigured() {
        root.removeAllViews()
        root.addView(title("Configuration requise"))
        root.addView(body("Ouvre HMCompanion et renseigne l'URL du Hub + ton profil avant de partager."))
        root.addView(primaryButton("Ouvrir les reglages").apply {
            setOnClickListener {
                startActivity(Intent(this@ShareActivity, SetupActivity::class.java))
                finish()
            }
        }, lp(topMargin = dp(20)))
        root.addView(closeButton())
    }

    private fun renderMessage(msg: String) {
        root.removeAllViews()
        root.addView(title("HMCompanion"))
        root.addView(body(msg))
        root.addView(closeButton(), lp(topMargin = dp(20)))
    }

    private fun renderResult(res: IngestResult) {
        root.removeAllViews()

        val confLabel = when (res.confidence) {
            "high" -> "Confiance elevee"
            "medium" -> "Confiance moyenne"
            else -> "Confiance faible"
        }
        val confColor = when (res.confidence) {
            "high" -> Color.parseColor("#22c55e")
            "medium" -> Color.parseColor("#eab308")
            else -> Color.parseColor("#ef4444")
        }

        root.addView(title(res.resolvedTitle ?: "Titre non resolu"))

        root.addView(TextView(this).apply {
            text = confLabel
            setTextColor(Color.WHITE)
            setBackgroundColor(confColor)
            setPadding(dp(10), dp(4), dp(10), dp(4))
        }, lp(topMargin = dp(8)).apply { width = ViewGroup.LayoutParams.WRAP_CONTENT })

        if (!res.author.isNullOrBlank()) {
            root.addView(body("Source : ${res.platform} / ${res.author}"))
        } else {
            root.addView(body("Source : ${res.platform}"))
        }

        // Vignette : chargee en tache de fond.
        if (!res.thumbnail.isNullOrBlank()) {
            val img = ImageView(this).apply {
                adjustViewBounds = true
                scaleType = ImageView.ScaleType.FIT_START
            }
            root.addView(img, LinearLayout.LayoutParams(dp(220), dp(300)).apply { topMargin = dp(12) })
            loadThumb(res.thumbnail, img)
        }

        // Candidats.
        if (res.candidates.isNotEmpty()) {
            root.addView(label("CANDIDATS").apply { setPadding(0, dp(20), 0, dp(6)) })
            res.candidates.take(6).forEach { c ->
                val yearTxt = c.year?.let { " ($it)" } ?: ""
                val typeTxt = if (c.type == "show") "serie" else "film"
                root.addView(TextView(this).apply {
                    text = "• ${c.title}$yearTxt · $typeTxt"
                    setTextColor(Color.parseColor("#dddddd"))
                    setBackgroundColor(card)
                    setPadding(dp(12), dp(10), dp(12), dp(10))
                }, lp(topMargin = dp(6)))
            }
        } else {
            root.addView(body("Aucun candidat automatique. Le partage est dans la boite a traiter du Hub."))
        }

        // Actions.
        root.addView(primaryButton("Ajouter a une playlist").apply {
            setOnClickListener { onAddToPlaylist(res) }
        }, lp(topMargin = dp(20)))

        root.addView(secondaryButton("Ouvrir dans le Hub").apply {
            setOnClickListener { onOpenHub() }
        }, lp(topMargin = dp(10)))

        root.addView(closeButton(), lp(topMargin = dp(10)))
    }

    private fun loadThumb(url: String, into: ImageView) {
        thread {
            val bmp: Bitmap? = Net.loadBitmap(url)
            if (bmp != null) runOnUiThread { into.setImageBitmap(bmp) }
        }
    }

    // ── Actions ───────────────────────────────────────────────────────────────

    private fun onAddToPlaylist(res: IngestResult) {
        val url = Prefs.hubUrl(this) ?: return
        val userId = Prefs.userId(this) ?: return
        toast("Chargement des playlists ...")
        thread {
            when (val r = HubClient(url).playlists(userId)) {
                is HubClient.Resp.Err -> runOnUiThread { toast("Playlists indisponibles : ${r.message}") }
                is HubClient.Resp.Ok -> runOnUiThread {
                    if (r.value.isEmpty()) {
                        toast("Aucune playlist. Cree-en une dans le Hub.")
                    } else {
                        showPlaylistPicker(res, r.value)
                    }
                }
            }
        }
    }

    private fun showPlaylistPicker(res: IngestResult, playlists: List<Playlist>) {
        val names = playlists.map { it.name }.toTypedArray()
        AlertDialog.Builder(this)
            .setTitle("Ajouter a ...")
            .setItems(names) { _, which ->
                addItem(res, playlists[which])
            }
            .setNegativeButton("Annuler", null)
            .show()
    }

    private fun addItem(res: IngestResult, playlist: Playlist) {
        val url = Prefs.hubUrl(this) ?: return
        val userId = Prefs.userId(this) ?: return
        // On utilise le meilleur candidat s'il existe, sinon le titre resolu brut.
        val top = res.candidates.firstOrNull()
        val title = top?.title ?: res.resolvedTitle
        val year = top?.year
        val refType = top?.let { if (it.type == "show") "show" else "movie" }
        val refId = top?.imdb ?: top?.tmdb?.toString() ?: top?.trakt?.toString()

        toast("Ajout en cours ...")
        thread {
            val r = HubClient(url).addPlaylistItem(
                userId = userId,
                playlistId = playlist.id,
                title = title,
                year = year,
                thumb = res.thumbnail,
                refId = refId,
                refType = refType,
            )
            runOnUiThread {
                when (r) {
                    is HubClient.Resp.Err -> toast("Echec ajout : ${r.message}")
                    is HubClient.Resp.Ok -> toast("Ajoute a ${playlist.name}")
                }
            }
        }
    }

    private fun onOpenHub() {
        val url = Prefs.hubUrl(this) ?: return
        // Section Decouvertes du Hub (frontend). On ouvre le navigateur sur la racine
        // avec l'ancre #decouvertes ; le routeur du Hub gere l'ancre ou ignore.
        val target = "$url/#decouvertes"
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(target)))
        } catch (_: Exception) {
            toast("Impossible d'ouvrir le navigateur")
        }
    }

    // ── Extraction du partage ──────────────────────────────────────────────────

    private fun extractSharedText(intent: Intent?): String? {
        if (intent == null) return null
        if (intent.action != Intent.ACTION_SEND) return null
        return intent.getStringExtra(Intent.EXTRA_TEXT)
            ?: intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
    }

    private fun firstUrl(text: String): String? {
        val m = Regex("https?://\\S+", RegexOption.IGNORE_CASE).find(text)
        return m?.value
    }

    // ── Helpers UI ─────────────────────────────────────────────────────────────

    private fun toast(s: String) { Toast.makeText(this, s, Toast.LENGTH_SHORT).show() }
    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun lp(topMargin: Int = 0): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply { setMargins(0, topMargin, 0, 0) }

    private fun title(s: String) = TextView(this).apply {
        text = s
        setTextColor(Color.WHITE)
        textSize = 24f
        setTypeface(typeface, android.graphics.Typeface.BOLD)
    }

    private fun body(s: String) = TextView(this).apply {
        text = s
        setTextColor(Color.parseColor("#cccccc"))
        textSize = 15f
        setPadding(0, dp(10), 0, 0)
    }

    private fun label(s: String) = TextView(this).apply {
        text = s
        setTextColor(Color.parseColor("#aaaadd"))
        textSize = 12f
        letterSpacing = 0.12f
        setTypeface(typeface, android.graphics.Typeface.BOLD)
    }

    private fun primaryButton(s: String) = Button(this).apply {
        text = s
        setTextColor(Color.WHITE)
        setBackgroundColor(accent)
        setTypeface(typeface, android.graphics.Typeface.BOLD)
    }

    private fun secondaryButton(s: String) = Button(this).apply {
        text = s
        setTextColor(Color.WHITE)
        setBackgroundColor(Color.parseColor("#3a3a6e"))
    }

    private fun closeButton() = Button(this).apply {
        text = "Fermer"
        setTextColor(Color.WHITE)
        setBackgroundColor(Color.parseColor("#2a2a40"))
        layoutParams = lp(topMargin = dp(10))
        setOnClickListener { finish() }
    }
}
