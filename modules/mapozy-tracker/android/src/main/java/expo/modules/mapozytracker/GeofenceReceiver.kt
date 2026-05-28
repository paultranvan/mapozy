package expo.modules.mapozytracker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent

/**
 * RULE_MOTION_STATE_MACHINE — geofence EXIT is the Doze-proof wake trigger.
 * When the device leaves the stationary geofence, transition to MOVING.
 */
class GeofenceReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    val event = GeofencingEvent.fromIntent(intent) ?: return
    if (event.hasError()) {
      NativeStore.insertDiagnostic(
        context, System.currentTimeMillis(), "geofence_error",
        "{\"code\":${event.errorCode}}"
      )
      return
    }
    if (event.geofenceTransition == Geofence.GEOFENCE_TRANSITION_EXIT) {
      Log.i("mapozy", "GeofenceReceiver: EXIT → moving")
      NativeStore.insertDiagnostic(context, System.currentTimeMillis(), "geofence_exit", null)
      TrackingService.enterMoving(context, "geofence")
    }
  }
}
