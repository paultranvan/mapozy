// Rules consumed here (see TrackingRules.kt):
//   RULE_NATIVE_ACCURACY_FILTER  — drop low-accuracy fixes at the native edge
//   RULE_AR_SILENCE_DETECTION    — log when AR has been silent while user was moving
package expo.modules.mapozytracker

import android.content.Context
import android.os.BatteryManager
import android.os.Bundle
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationResult
import org.json.JSONObject

class LocationListener(private val context: Context) : LocationCallback() {

  override fun onLocationResult(result: LocationResult) {
    val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
    val level = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)?.let { it / 100.0 } ?: 1.0
    val statusInt = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_STATUS) ?: 0
    val isCharging = statusInt == BatteryManager.BATTERY_STATUS_CHARGING ||
                     statusInt == BatteryManager.BATTERY_STATUS_FULL

    for (loc in result.locations) {
      val speed = if (loc.hasSpeed()) loc.speed else null
      NativeStore.insertLocation(
        context,
        loc.time,
        loc.latitude,
        loc.longitude,
        if (loc.hasAltitude()) loc.altitude else null,
        loc.accuracy,
        speed,
        if (loc.hasBearing()) loc.bearing else null,
        level,
        isCharging
      )
      val payload = Bundle().apply {
        putDouble("latitude", loc.latitude)
        putDouble("longitude", loc.longitude)
        if (loc.hasAltitude()) putDouble("altitude", loc.altitude)
        putDouble("accuracyMeters", loc.accuracy.toDouble())
        if (speed != null) putDouble("speedMps", speed.toDouble())
        if (loc.hasBearing()) putDouble("bearingDeg", loc.bearing.toDouble())
        putDouble("timestampMs", loc.time.toDouble())
        putDouble("batteryLevel", level)
        putBoolean("isCharging", isCharging)
      }
      MapozyTrackerEventBus.emitLocation(payload)
      // Speed is persisted alongside the timestamp so RULE_MOVING_STILL_GUARD
      // (in ActivityReceiver) can cheaply check "are we actually still?"
      // without a DB read.
      TrackingState.setLastLocation(context, loc.time, speed)
      TrackingState.setLastLocationCoords(context, loc.latitude, loc.longitude)

      // RULE_AR_SILENCE_DETECTION — piggy-back on GPS callbacks (which the
      // OS keeps alive even when AR is throttled) to detect AR pipeline
      // death. If we have no record of any AR event yet, skip — there's
      // nothing to compare against until the subscription's first event
      // lands. Dedup so a single stuck subscription doesn't fill the
      // diagnostics table on every fix.
      checkActivityRecognitionSilence(loc.time, speed)
    }
  }

  private fun checkActivityRecognitionSilence(nowMs: Long, speedMps: Float?) {
    if (speedMps == null) return
    if (speedMps < TrackingRules.AR_SILENCE_MIN_MOVING_SPEED_MPS) return
    val lastActMs = TrackingState.getLastActivityMs(context) ?: return
    val gap = nowMs - lastActMs
    if (gap < TrackingRules.AR_SILENCE_GAP_MS) return

    val lastDedup = TrackingState.getLastSilenceDetectedMs(context)
    if (lastDedup != null && nowMs - lastDedup < TrackingRules.AR_SILENCE_DEDUP_INTERVAL_MS) {
      return
    }

    val payload = JSONObject().apply {
      put("gapMs", gap)
      put("lastActivityMs", lastActMs)
      put("speedMps", speedMps.toDouble())
    }
    NativeStore.insertDiagnostic(
      context,
      nowMs,
      "ar_silence_detected",
      payload.toString()
    )
    TrackingState.setLastSilenceDetectedMs(context, nowMs)
  }
}
