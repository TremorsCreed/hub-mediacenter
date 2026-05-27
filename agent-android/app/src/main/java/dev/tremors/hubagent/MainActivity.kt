package dev.tremors.hubagent

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.*
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val prefs = getSharedPreferences(HubService.PREFS, Context.MODE_PRIVATE)

        val etHubUrl     = findViewById<EditText>(R.id.etHubUrl)
        val etDeviceName = findViewById<EditText>(R.id.etDeviceName)
        val tvStatus     = findViewById<TextView>(R.id.tvStatus)
        val btnSave      = findViewById<Button>(R.id.btnSave)
        val btnStart     = findViewById<Button>(R.id.btnStart)
        val btnStop      = findViewById<Button>(R.id.btnStop)

        etHubUrl.setText(prefs.getString(HubService.PREF_HUB_URL, "ws://192.168.1.15:${HubService.DEFAULT_HUB_PORT}"))
        etDeviceName.setText(prefs.getString(HubService.PREF_DEVICE_NAME, "${Build.MANUFACTURER} ${Build.MODEL}"))

        btnSave.setOnClickListener {
            prefs.edit()
                .putString(HubService.PREF_HUB_URL,    etHubUrl.text.toString().trim())
                .putString(HubService.PREF_DEVICE_NAME, etDeviceName.text.toString().trim())
                .apply()
            tvStatus.text = "Settings saved"
        }

        btnStart.setOnClickListener {
            HubService.start(this)
            tvStatus.text = "Agent starting..."
        }

        btnStop.setOnClickListener {
            HubService.stop(this)
            tvStatus.text = "Agent arrêté"
        }
    }

    private fun isNotificationListenerGranted(): Boolean {
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: return false
        val component = ComponentName(this, HubNotificationListener::class.java).flattenToString()
        return flat.split(":").any { it == component }
    }

    private fun isOverlayGranted(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)

    override fun onResume() {
        super.onResume()
        HubService.statusCallback = { status ->
            findViewById<TextView>(R.id.tvStatus).text = status
        }

        // Bandeau d'alerte : notification listener (stop media autres apps)
        val warnNotif = findViewById<TextView>(R.id.tvNotifWarning)
        if (warnNotif != null) {
            if (isNotificationListenerGranted()) {
                warnNotif.visibility = android.view.View.GONE
            } else {
                warnNotif.visibility = android.view.View.VISIBLE
                warnNotif.text = "⚠ Activer 'Accès aux notifications' — touchez ici"
                warnNotif.setOnClickListener {
                    try { startActivity(Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS")) }
                    catch (_: Exception) { Toast.makeText(this, "Paramètres → Applications → Accès aux notifications", Toast.LENGTH_LONG).show() }
                }
            }
        }

        // Bandeau d'alerte : overlay permission (bypass background activity blocks)
        val warnOverlay = findViewById<TextView>(R.id.tvOverlayWarning)
        if (warnOverlay != null) {
            if (isOverlayGranted()) {
                warnOverlay.visibility = android.view.View.GONE
            } else {
                warnOverlay.visibility = android.view.View.VISIBLE
                warnOverlay.text = "⚠ Activer 'Afficher au-dessus d'autres apps' — touchez ici"
                warnOverlay.setOnClickListener {
                    try {
                        val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))
                        startActivity(intent)
                    } catch (_: Exception) {
                        Toast.makeText(this, "Paramètres → Applications → Hub Agent → Afficher au-dessus", Toast.LENGTH_LONG).show()
                    }
                }
            }
        }
    }

    override fun onPause() {
        super.onPause()
        HubService.statusCallback = null
    }
}
