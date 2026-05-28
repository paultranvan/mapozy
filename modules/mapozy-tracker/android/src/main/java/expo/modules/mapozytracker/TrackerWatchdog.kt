package expo.modules.mapozytracker

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.util.Log

/**
 * RULE_WATCHDOG — schedules an inexact allow-while-idle alarm that fires even in
 * Doze. Self-rearming: WatchdogReceiver reschedules on each fire.
 */
object TrackerWatchdog {
  const val ACTION = "mapozy.tracker.WATCHDOG"
  private const val REQUEST_CODE = 7001

  private fun pendingIntent(context: Context): PendingIntent {
    val intent = Intent(context, WatchdogReceiver::class.java).apply { action = ACTION }
    return PendingIntent.getBroadcast(
      context, REQUEST_CODE, intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
  }

  fun schedule(context: Context) {
    val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val triggerAt = SystemClock.elapsedRealtime() + TrackingRules.WATCHDOG_INTERVAL_MS
    try {
      am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pendingIntent(context))
    } catch (e: Exception) {
      Log.w("mapozy", "TrackerWatchdog.schedule failed: $e")
    }
  }

  fun cancel(context: Context) {
    val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    am.cancel(pendingIntent(context))
  }
}
