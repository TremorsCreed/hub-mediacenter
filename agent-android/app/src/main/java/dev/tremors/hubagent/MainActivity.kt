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

        val etHubUrl      = findViewById<EditText>(R.id.etHubUrl)
        val etDeviceName  = findViewById<EditText>(R.id.etDeviceName)
        val etXtreamSrv   = findViewById<EditText>(R.id.etXtreamServer)
        val etXtreamUser  = findViewById<EditText>(R.id.etXtreamUser)
        val etXtreamPass  = findViewById<EditText>(R.id.etXtreamPass)
        val etXtreamExt   = findViewById<EditText>(R.id.etXtreamExt)
        val tvStatus      = findViewById<TextView>(R.id.tvStatus)
        val btnSave       = findViewById<Button>(R.id.btnSave)
        val btnStart      = findViewById<Button>(R.id.btnStart)
        val btnStop       = findViewById<Button>(R.id.btnStop)

        // Load saved config
        etHubUrl.setText(prefs.getString(HubService.PREF_HUB_URL, "ws://192.168.1.15:${HubService.DEFAULT_HUB_PORT}"))
        etDeviceName.setText(prefs.getString(HubService.PREF_DEVICE_NAME, "${Build.MANUFACTURER} ${Build.MODEL}"))
        etXtreamSrv.setText(prefs.getString(HubService.PREF_XTREAM_SERVER, ""))
        etXtreamUser.setText(prefs.getString(HubService.PREF_XTREAM_USER, ""))
        etXtreamPass.setText(prefs.getString(HubService.PREF_XTREAM_PASS, ""))
        etXtreamExt.setText(prefs.getString(HubService.PREF_XTREAM_EXT, "ts"))

        btnSave.setOnClickListener {
            prefs.edit()
                .putString(HubService.PREF_HUB_URL,       etHubUrl.text.toString().trim())
                .putString(HubService.PREF_DEVICE_NAME,    etDeviceName.text.toString().trim())
                .putString(HubService.PREF_XTREAM_SERVER,  etXtreamSrv.text.toString().trim())
                .putString(HubService.PREF_XTREAM_USER,    etXtreamUser.text.toString().trim())
                .putString(HubService.PREF_XTREAM_PASS,    etXtreamPass.text.toString().trim())
                .putString(HubService.PREF_XTREAM_EXT,     etXtreamExt.text.toString().trim().ifEmpty { "ts" })
                .apply()
            tvStatus.text = "Settings saved"
        }

        btnStart.setOnClickListener {
            HubService.start(this)
            tvStatus.text = "Agent starting..."
        }

        btnStop.setOnClickListener {
            HubService.stop(this)
            tvStatus.text = "Agent stopped"
        }
    }
}
