package dev.tremors.hubcompanion

import android.graphics.Color
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import kotlin.concurrent.thread

// Ecran de reglages / onboarding. Trois etapes lineaires :
//   1) saisie de l'URL du Hub + ping /health
//   2) enregistrement de l'appareil (POST /api/devices/register)
//   3) choix du profil (GET /api/users) -> stocke en SharedPreferences
// Une fois configure, on peut revenir ici depuis le lanceur pour changer de profil
// ou d'URL.
class SetupActivity : AppCompatActivity() {

    private val bg = Color.parseColor("#0d0d14")
    private val card = Color.parseColor("#1e1e30")
    private val accent = Color.parseColor("#38BDF8")

    private lateinit var etHubUrl: EditText
    private lateinit var tvStatus: TextView
    private lateinit var profilesGroup: RadioGroup
    private lateinit var btnSaveProfile: Button

    private var loadedUsers: List<UserProfile> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val scroll = ScrollView(this).apply { setBackgroundColor(bg) }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(28), dp(36), dp(28), dp(36))
        }
        scroll.addView(root)
        setContentView(scroll)

        root.addView(title("HMCompanion"))
        root.addView(hint("Recoit un partage TikTok et l'ajoute au Hub. Saisis l'adresse du Hub, la meme que dans ton navigateur (port 3050)."))

        root.addView(label("URL DU HUB"))
        etHubUrl = EditText(this).apply {
            setHint("http://192.168.1.15:3050")
            setHintTextColor(Color.parseColor("#666688"))
            setTextColor(Color.WHITE)
            setBackgroundColor(card)
            setPadding(dp(14), dp(14), dp(14), dp(14))
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setText(Prefs.hubUrl(this@SetupActivity) ?: "http://192.168.1.15:3050")
        }
        root.addView(etHubUrl, lp(topMargin = dp(4)))

        val btnConnect = primaryButton("Valider et connecter").apply {
            setOnClickListener { onConnect() }
        }
        root.addView(btnConnect, lp(topMargin = dp(16)))

        tvStatus = TextView(this).apply {
            setTextColor(Color.parseColor("#dddddd"))
            setBackgroundColor(card)
            setPadding(dp(14), dp(14), dp(14), dp(14))
            text = if (Prefs.isConfigured(this@SetupActivity))
                "Profil actif : ${Prefs.userName(this@SetupActivity) ?: "?"}"
            else
                "Saisis l'URL du Hub puis valide."
        }
        root.addView(tvStatus, lp(topMargin = dp(16)))

        root.addView(label("PROFIL PAR DEFAUT").apply { setPadding(0, dp(24), 0, 0) })
        profilesGroup = RadioGroup(this)
        root.addView(profilesGroup, lp(topMargin = dp(4)))

        btnSaveProfile = primaryButton("Enregistrer le profil").apply {
            visibility = View.GONE
            setOnClickListener { onSaveProfile() }
        }
        root.addView(btnSaveProfile, lp(topMargin = dp(12)))

        // Si deja configure, on recharge la liste des profils pour pouvoir en changer.
        if (Prefs.isConfigured(this)) loadProfiles()
    }

    private fun onConnect() {
        val urlRaw = etHubUrl.text.toString()
        if (urlRaw.isBlank()) {
            toast("Saisis l'URL du Hub")
            return
        }
        val url = Prefs.normalizeUrl(urlRaw)
        Prefs.setHubUrl(this, url)
        status("Connexion a $url ...")

        thread {
            val client = HubClient(url)
            when (val ping = client.ping()) {
                is HubClient.Resp.Err -> runOnUiThread { status("Echec : ${ping.message}") }
                is HubClient.Resp.Ok -> {
                    // Enregistrement de l'appareil (best effort, on continue meme si echec).
                    val id = Prefs.deviceId(this)
                    val name = Prefs.deviceName(this)
                    val reg = client.registerDevice(id, name, Net.localIp())
                    val regMsg = if (reg is HubClient.Resp.Err) " (enregistrement appareil : ${reg.message})" else ""
                    runOnUiThread { status("Hub connecte$regMsg. Chargement des profils ...") }
                    loadProfiles()
                }
            }
        }
    }

    private fun loadProfiles() {
        val url = Prefs.hubUrl(this) ?: return
        thread {
            when (val r = HubClient(url).users()) {
                is HubClient.Resp.Err -> runOnUiThread { status("Profils indisponibles : ${r.message}") }
                is HubClient.Resp.Ok -> runOnUiThread {
                    loadedUsers = r.value
                    renderProfiles(r.value)
                }
            }
        }
    }

    private fun renderProfiles(users: List<UserProfile>) {
        profilesGroup.removeAllViews()
        if (users.isEmpty()) {
            status("Aucun profil sur le Hub.")
            btnSaveProfile.visibility = View.GONE
            return
        }
        val current = Prefs.userId(this)
        users.forEach { u ->
            val rb = RadioButton(this).apply {
                id = View.generateViewId()
                text = u.name
                setTextColor(Color.WHITE)
                tag = u.id
                textSize = 16f
                setPadding(dp(8), dp(12), dp(8), dp(12))
                isChecked = (u.id == current)
            }
            profilesGroup.addView(rb)
        }
        btnSaveProfile.visibility = View.VISIBLE
        status("Choisis ton profil par defaut.")
    }

    private fun onSaveProfile() {
        val checkedId = profilesGroup.checkedRadioButtonId
        if (checkedId == -1) {
            toast("Choisis un profil")
            return
        }
        val rb = findViewById<RadioButton>(checkedId)
        val userId = rb.tag as Int
        val userName = rb.text.toString()
        Prefs.setUser(this, userId, userName)
        status("Profil enregistre : $userName. L'app est prete a recevoir des partages.")
        toast("Configuration terminee")
    }

    // ── Helpers UI ────────────────────────────────────────────────────────────

    private fun status(s: String) { tvStatus.text = s }
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
        textSize = 26f
        setTypeface(typeface, android.graphics.Typeface.BOLD)
    }

    private fun hint(s: String) = TextView(this).apply {
        text = s
        setTextColor(Color.parseColor("#9aa0c0"))
        textSize = 14f
        setPadding(0, dp(8), 0, dp(20))
    }

    private fun label(s: String) = TextView(this).apply {
        text = s
        setTextColor(Color.parseColor("#aaaadd"))
        textSize = 12f
        letterSpacing = 0.12f
        setTypeface(typeface, android.graphics.Typeface.BOLD)
        setPadding(0, dp(8), 0, dp(6))
    }

    private fun primaryButton(s: String) = Button(this).apply {
        text = s
        setTextColor(Color.WHITE)
        setBackgroundColor(accent)
        gravity = Gravity.CENTER
        setTypeface(typeface, android.graphics.Typeface.BOLD)
    }
}
