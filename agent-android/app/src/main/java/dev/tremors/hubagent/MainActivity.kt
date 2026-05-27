package dev.tremors.hubagent

import android.content.ComponentName
import android.content.Context
import android.content.Intent
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

    override fun onResume() {
        super.onResume()
        HubService.statusCallback = { status ->
            findViewById<TextView>(R.id.tvStatus).text = status
        }
        // Si la permission Notification access n'est pas accordée, signaler et proposer
        // d'ouvrir les paramètres. Sans elle, on ne peut pas stopper YouTube/etc avant Plex.
        if (!isNotificationListenerGranted()) {
            val status = findViewById<TextView>(R.id.tvStatus)
            status.text = "⚠ Active \"Accès aux notifications\" pour permettre la prise en main des autres apps"
            status.setOnClickListener {
                try {
                    startActivity(Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"))
                } catch (_: Exception) {
                    Toast.makeText(this, "Va dans Paramètres → Applications → Accès aux notifications", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    override fun onPause() {
        super.onPause()
        HubService.statusCallback = null
    }
}
