// Rules consumed here (see TrackingRules.kt):
//   RULE_NATIVE_ACCURACY_FILTER     — drop low-accuracy fixes at the native edge
//   RULE_AR_SILENCE_DETECTION       — log when AR has been silent while user was moving
//   RULE_GPS_STATIONARY_DETECTION   — declare STATIONARY when GPS itself shows no motion
//   RULE_TRANSITION_FIX             — ingestLocation() is reused by the one-shot transition fix
package expo.modules.mapozytracker

import android.content.Context
import android.location.Location as AndroidLocation
import android.os.BatteryManager
import android.os.Bundle
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationResult
import org.json.JSONObject

class LocationListener(private val context: Context) : LocationCallback() {

  override fun onLocationResult(result: LocationResult) {
    for (loc in result.locations) {
      ingestLocation(loc, runMotionChecks = true)
    }
  }

  /**
   * Persist + emit a single fix and refresh last-known location state. Shared
   * by the continuous subscription (onLocationResult) and the one-shot
   * RULE_TRANSITION_FIX path in TrackingService.
   *
   * `runMotionChecks` gates the cadence-sensitive AR-silence and
   * GPS-stationary detectors: those reason about a *stream* of fixes at the
   * subscription's interval, so a sporadic one-shot transition fix must not
   * feed them (it would pollute the recent-samples window and could trip a
   * false stationary declaration).
   */
  fun ingestLocation(loc: AndroidLocation, runMotionChecks: Boolean) {
    val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
    val level = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)?.let { it / 100.0 } ?: 1.0
    val statusInt = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_STATUS) ?: 0
    val isCharging = statusInt == BatteryManager.BATTERY_STATUS_CHARGING ||
                     statusInt == BatteryManager.BATTERY_STATUS_FULL

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

    if (!runMotionChecks) return

    // RULE_AR_SILENCE_DETECTION — piggy-back on GPS callbacks (which the
    // OS keeps alive even when AR is throttled) to detect AR pipeline
    // death. If we have no record of any AR event yet, skip — there's
    // nothing to compare against until the subscription's first event
    // lands. Dedup so a single stuck subscription doesn't fill the
    // diagnostics table on every fix.
    checkActivityRecognitionSilence(loc.time, speed)

    // RULE_GPS_STATIONARY_DETECTION — independent of the AR-driven stop
    // timer, which can flicker indefinitely on noisy AR pipelines. If GPS
    // itself shows the device hasn't moved beyond STATIONARY_RADIUS_M for
    // STOP_TIMEOUT_MS, declare STATIONARY directly.
    checkGpsStationary(loc.time, loc.latitude, loc.longitude)
  }

  private fun checkGpsStationary(currentTs: Long, currentLat: Double, currentLng: Double) {
    if (TrackingState.getState(context) != TrackingState.STATE_MOVING) return
    TrackingState.addRecentGpsSample(
      context, currentTs, currentLat, currentLng, TrackingRules.STOP_TIMEOUT_MS
    )
    val samples = TrackingState.getRecentGpsSamples(context)
    // Require enough samples to be confident this isn't a coincidental
    // 2-fix cluster — and the window must actually span STOP_TIMEOUT_MS.
    if (samples.size < 3) return
    val oldest = samples.first()
    if (currentTs - oldest.ts < TrackingRules.STOP_TIMEOUT_MS) return
    // Pairwise check against the oldest sample catches a slow drift (where
    // the centroid would still look stationary) — if ANY sample is beyond
    // the radius from the oldest, the device has been moving.
    val out = FloatArray(1)
    for (s in samples) {
      AndroidLocation.distanceBetween(oldest.lat, oldest.lng, s.lat, s.lng, out)
      if (out[0] > TrackingRules.STATIONARY_RADIUS_M) return
    }
    TrackingService.gpsStationaryDetected(context, currentLat, currentLng, oldest.ts)
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
