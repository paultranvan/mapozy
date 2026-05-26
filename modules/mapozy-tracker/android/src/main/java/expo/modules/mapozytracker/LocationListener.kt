package expo.modules.mapozytracker

import android.content.Context
import android.os.BatteryManager
import android.os.Bundle
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationResult

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
    }
  }
}
