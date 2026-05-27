package dev.tremors.hubagent

import android.content.Context
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.widget.TextView

/**
 * Affiche des notifications overlay (style TvOverlay) par-dessus toute app.
 * Utilise SYSTEM_ALERT_WINDOW (déjà accordée pour le bypass BAL).
 *
 * Une seule notif visible à la fois : si une nouvelle arrive, l'ancienne
 * est remplacée. Géré sur le main thread (WindowManager l'exige).
 */
class OverlayManager(private val ctx: Context) {
    private val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val handler = Handler(Looper.getMainLooper())
    private var currentView: View? = null
    private val hideRunnable = Runnable { hide(true) }

    fun show(title: String, message: String, durationSec: Int = 4) {
        if (!hasPermission()) {
            Log.w(TAG, "SYSTEM_ALERT_WINDOW not granted — skip overlay")
            return
        }
        handler.post {
            hide(false)  // retire l'ancienne sans animation pour pas overlap

            val view = try {
                LayoutInflater.from(ctx).inflate(R.layout.overlay_notification, null)
            } catch (e: Exception) {
                Log.e(TAG, "inflate failed", e); return@post
            }
            view.findViewById<TextView>(R.id.overlayTitle).text = title
            view.findViewById<TextView>(R.id.overlayMessage).text = message

            val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            else
                @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_SYSTEM_ALERT

            val params = WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT
            ).apply {
                gravity = Gravity.TOP or Gravity.END
                x = 48
                y = 48
            }

            try {
                wm.addView(view, params)
                currentView = view
                view.alpha = 0f
                view.translationY = -30f
                view.animate().alpha(1f).translationY(0f).setDuration(250).start()
                handler.postDelayed(hideRunnable, (durationSec * 1000L).coerceAtLeast(1000L))
            } catch (e: Exception) {
                Log.e(TAG, "addView failed", e)
            }
        }
    }

    private fun hide(animate: Boolean) {
        handler.removeCallbacks(hideRunnable)
        val v = currentView ?: return
        currentView = null
        if (animate) {
            v.animate().alpha(0f).translationY(-30f).setDuration(200).withEndAction {
                runCatching { wm.removeView(v) }
            }.start()
        } else {
            runCatching { wm.removeView(v) }
        }
    }

    private fun hasPermission(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx)

    fun destroy() {
        handler.post { hide(false) }
    }

    companion object {
        private const val TAG = "OverlayManager"
    }
}
