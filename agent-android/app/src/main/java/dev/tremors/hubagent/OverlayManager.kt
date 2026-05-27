package dev.tremors.hubagent

import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Outline
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewOutlineProvider
import android.view.WindowManager
import android.widget.ImageView
import android.widget.TextView
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/**
 * Gère les notifications overlay (style TvOverlay).
 *
 * Deux styles :
 * - "small"  : card compacte en haut-droite, auto-hide (préparation, contrôles)
 * - "player" : card pleine largeur en bas avec miniature, persistante par défaut
 *              (utilisée pendant tout un play media)
 *
 * Une seule notif par style à la fois. WindowManager exige le main thread.
 */
class OverlayManager(private val ctx: Context) {
    private val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val handler = Handler(Looper.getMainLooper())
    private var smallView: View? = null
    private var playerView: View? = null
    private val hideSmallRunnable = Runnable { hideSmall(true) }
    private val hidePlayerRunnable = Runnable { hidePlayer(true) }
    private val httpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(4, TimeUnit.SECONDS)
            .readTimeout(8, TimeUnit.SECONDS)
            .build()
    }

    fun show(title: String, message: String, durationSec: Int = 4) = handler.post {
        if (!hasPermission()) { Log.w(TAG, "no overlay perm"); return@post }
        hideSmall(false)
        val view = try { LayoutInflater.from(ctx).inflate(R.layout.overlay_notification, null) }
                   catch (e: Exception) { Log.e(TAG, "inflate small", e); return@post }
        view.findViewById<TextView>(R.id.overlayTitle).text = title
        view.findViewById<TextView>(R.id.overlayMessage).text = message

        val params = baseParams().apply {
            gravity = Gravity.TOP or Gravity.END
            x = 48; y = 48
            width = WindowManager.LayoutParams.WRAP_CONTENT
        }
        try {
            wm.addView(view, params)
            smallView = view
            view.alpha = 0f; view.translationY = -30f
            view.animate().alpha(1f).translationY(0f).setDuration(250).start()
            if (durationSec > 0) handler.postDelayed(hideSmallRunnable, (durationSec * 1000L).coerceAtLeast(1000L))
        } catch (e: Exception) { Log.e(TAG, "addView small", e) }
    }

    fun showPlayer(title: String, message: String, appLabel: String?, imageUrl: String?, durationSec: Int = 0) = handler.post {
        if (!hasPermission()) { Log.w(TAG, "no overlay perm"); return@post }
        hidePlayer(false)
        val view = try { LayoutInflater.from(ctx).inflate(R.layout.overlay_player, null) }
                   catch (e: Exception) { Log.e(TAG, "inflate player", e); return@post }
        view.findViewById<TextView>(R.id.overlayPlayerTitle).text = title
        view.findViewById<TextView>(R.id.overlayPlayerMessage).text = message
        view.findViewById<TextView>(R.id.overlayPlayerApp).text = (appLabel ?: "HUB MEDIACENTER").uppercase()

        val img = view.findViewById<ImageView>(R.id.overlayPlayerImage)
        clipRounded(img, dp(6f))
        if (!imageUrl.isNullOrEmpty()) {
            Log.i(TAG, "loading image: $imageUrl")
            loadImageAsync(imageUrl) { bmp ->
                if (bmp != null && playerView === view) {
                    Log.i(TAG, "image loaded ${bmp.width}x${bmp.height}, applying")
                    img.setImageBitmap(bmp)
                } else {
                    Log.w(TAG, "image not set (bmp=${bmp != null}, viewMatches=${playerView === view})")
                }
            }
        }

        val params = baseParams().apply {
            gravity = Gravity.BOTTOM or Gravity.START
            width = WindowManager.LayoutParams.MATCH_PARENT
        }
        try {
            wm.addView(view, params)
            playerView = view
            view.alpha = 0f; view.translationY = 60f
            view.animate().alpha(1f).translationY(0f).setDuration(350).start()
            if (durationSec > 0) handler.postDelayed(hidePlayerRunnable, (durationSec * 1000L))
        } catch (e: Exception) { Log.e(TAG, "addView player", e) }
    }

    fun hidePlayer() = handler.post { hidePlayer(true) }
    fun hideAll() = handler.post { hideSmall(false); hidePlayer(true) }

    private fun hideSmall(animate: Boolean) {
        handler.removeCallbacks(hideSmallRunnable)
        val v = smallView ?: return
        smallView = null
        removeView(v, animate, -30f)
    }
    private fun hidePlayer(animate: Boolean) {
        handler.removeCallbacks(hidePlayerRunnable)
        val v = playerView ?: return
        playerView = null
        removeView(v, animate, 60f)
    }
    private fun removeView(v: View, animate: Boolean, translateY: Float) {
        if (animate) {
            v.animate().alpha(0f).translationY(translateY).setDuration(200).withEndAction {
                runCatching { wm.removeView(v) }
            }.start()
        } else runCatching { wm.removeView(v) }
    }

    private fun baseParams() = WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_SYSTEM_ALERT,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT
    )

    private fun clipRounded(view: View, radius: Float) {
        view.outlineProvider = object : ViewOutlineProvider() {
            override fun getOutline(v: View, outline: Outline) {
                outline.setRoundRect(0, 0, v.width, v.height, radius)
            }
        }
        view.clipToOutline = true
    }

    private fun dp(value: Float): Float =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, ctx.resources.displayMetrics)

    private fun loadImageAsync(url: String, onLoaded: (android.graphics.Bitmap?) -> Unit) {
        Thread {
            var bmp: android.graphics.Bitmap? = null
            try {
                val resp = httpClient.newCall(Request.Builder().url(url).build()).execute()
                resp.use { r -> r.body?.byteStream()?.use { bmp = BitmapFactory.decodeStream(it) } }
            } catch (e: Exception) { Log.w(TAG, "image load: ${e.message}") }
            handler.post { onLoaded(bmp) }
        }.start()
    }

    private fun hasPermission(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx)

    fun destroy() = handler.post { hideSmall(false); hidePlayer(false) }

    companion object {
        private const val TAG = "OverlayManager"
    }
}
