package dev.tremors.hubagent

import android.content.Context
import android.os.Build
import android.os.Bundle
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

    override fun onResume() {
        super.onResume()
        HubService.statusCallback = { status ->
            findViewById<TextView>(R.id.tvStatus).text = status
        }
    }

    override fun onPause() {
        super.onPause()
        HubService.statusCallback = null
    }
}
