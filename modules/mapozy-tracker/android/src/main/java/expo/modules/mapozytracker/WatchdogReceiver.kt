package expo.modules.mapozytracker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.PowerManager
import android.util.Log
import org.json.JSONObject

class WatchdogReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != TrackerWatchdog.ACTION) return
    if (!TrackingState.isEnabled(context)) {
      // Tracking was turned off; let the alarm die.
      return
    }

    val now = System.currentTimeMillis()
    val running = TrackingService.isRunning

    // Flight-recorder heartbeat + environment snapshot.
    NativeStore.insertDiagnostic(
      context, now, "watchdog_fire",
      JSONObject().apply {
        put("service_was_running", running)
      }.toString()
    )
    NativeStore.insertDiagnostic(
      context, now, "env_snapshot",
      JSONObject().apply {
        put("batteryExempt", isIgnoringBatteryOptimizations(context))
        put("state", TrackingState.getState(context))
      }.toString()
    )

    // Retention.
    val cutoff = now - TrackingRules.DIAGNOSTICS_RETENTION_DAYS * 24L * 60L * 60L * 1000L
    NativeStore.pruneDiagnostics(context, cutoff)

    if (!running) {
      Log.i("mapozy", "WatchdogReceiver: service down, re-asserting")
      NativeStore.insertDiagnostic(context, now, "watchdog_restart", null)
      TrackingService.start(context)
    } else {
      // Alive: re-assert AR + geofence in case they were silently dropped.
      TrackingService.watchdogTick(context)
    }

    // Re-arm the next alarm.
    TrackerWatchdog.schedule(context)
  }

  private fun isIgnoringBatteryOptimizations(context: Context): Boolean {
    val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
    return pm.isIgnoringBatteryOptimizations(context.packageName)
  }
}
