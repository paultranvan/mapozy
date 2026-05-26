// Rules implemented here (see TrackingRules.kt):
//   RULE_AUTO_RESUME_ON_MOVE       — wake LocationListener if it was paused
//   RULE_MOVING_STILL_GUARD        — reclassify STILL as unknown when GPS shows motion
//   RULE_ADAPTIVE_LOCATION_REQUEST — switch LR profile on activity change (consumer side)
package expo.modules.mapozytracker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle
import com.google.android.gms.location.ActivityRecognitionResult
import com.google.android.gms.location.DetectedActivity

class ActivityReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    if (!ActivityRecognitionResult.hasResult(intent)) return
    val result = ActivityRecognitionResult.extractResult(intent) ?: return
    val mostProbable = result.mostProbableActivity
    val rawType = mapType(mostProbable.type)
    val confidence = mostProbable.confidence

    // RULE_MOVING_STILL_GUARD — Android reports confident STILL on trains and
    // buses. If our most recent GPS sample is recent AND shows real motion,
    // demote STILL to "unknown" so segmentation doesn't carve the trip up
    // into stays. We don't override other activities; STILL is the noisy one.
    val effectiveType = applyMovingStillGuard(context, rawType)

    val ts = System.currentTimeMillis()
    TrackingState.setLastActivity(context, effectiveType)
    NativeStore.insertActivity(context, ts, effectiveType, confidence)

    // RULE_AUTO_RESUME_ON_MOVE
    if (effectiveType != "still" && effectiveType != "unknown") {
      TrackingService.resumeLocation(context)
    }

    // RULE_ADAPTIVE_LOCATION_REQUEST — when the activity flips into / out of a
    // profile-changing category, ask TrackingService to rebuild its
    // LocationRequest. Computed from the *effective* (post-guard) type.
    val newProfile = TrackingRules.profileForActivity(effectiveType)
    val activeProfileName = TrackingState.getActiveProfileName(context)
    if (newProfile.name != activeProfileName) {
      TrackingService.reconfigureLocationRequest(context, newProfile)
    }

    val payload = Bundle().apply {
      putString("type", effectiveType)
      putInt("confidence", confidence)
      putDouble("timestampMs", ts.toDouble())
    }
    MapozyTrackerEventBus.emitActivity(payload)
  }

  private fun applyMovingStillGuard(context: Context, type: String): String {
    if (type != "still") return type
    val lastLocMs = TrackingState.getLastLocation(context) ?: return type
    val speed = TrackingState.getLastLocationSpeedMps(context) ?: return type
    val now = System.currentTimeMillis()
    if (now - lastLocMs > TrackingRules.MOVING_STILL_LOOKBACK_MS) return type
    if (speed <= TrackingRules.MOVING_STILL_SPEED_MPS) return type
    return "unknown"
  }

  private fun mapType(t: Int): String = when (t) {
    DetectedActivity.IN_VEHICLE -> "in_vehicle"
    DetectedActivity.ON_BICYCLE -> "on_bicycle"
    DetectedActivity.ON_FOOT, DetectedActivity.WALKING -> "walking"
    DetectedActivity.RUNNING -> "running"
    DetectedActivity.STILL -> "still"
    else -> "unknown"
  }
}
