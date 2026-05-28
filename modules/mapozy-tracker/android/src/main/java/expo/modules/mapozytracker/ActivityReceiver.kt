// Rules implemented here (see TrackingRules.kt):
//   RULE_AUTO_RESUME_ON_MOVE       — wake LocationListener if it was paused
//   RULE_MOVING_STILL_GUARD        — reclassify STILL as unknown when GPS shows motion
//   RULE_ADAPTIVE_LOCATION_REQUEST — switch LR profile on activity change (consumer side)
//   RULE_ACTIVITY_TRANSITIONS      — handle ActivityTransitionResult (ENTER/EXIT edges) from
//                                    the transition API; only ENTER events are persisted as
//                                    raw_activities so downstream "most recent activity wins"
//                                    semantics map cleanly to "the user is now doing X".
package expo.modules.mapozytracker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionResult
import com.google.android.gms.location.DetectedActivity

class ActivityReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    if (!ActivityTransitionResult.hasResult(intent)) return
    val result = ActivityTransitionResult.extractResult(intent) ?: return

    for (event in result.transitionEvents) {
      val rawType = mapType(event.activityType)
      val transition = event.transitionType

      // Persist a raw_activities row only on ENTER. The pipeline's
      // sectionSegmentation.activityAt() uses "last activity ≤ t wins"
      // semantics, so an ENTER X event correctly classifies all points
      // after it as X until the next ENTER. EXIT events would be noise
      // there — we still emit them on the event bus for UI/debugging
      // but don't persist them.
      val isEnter = transition == ActivityTransition.ACTIVITY_TRANSITION_ENTER
      val ts = System.currentTimeMillis()

      val effectiveType = if (isEnter) {
        // RULE_MOVING_STILL_GUARD — STILL is the noisy edge that fires on
        // trains/buses; guard it the same way we did for snapshot events.
        applyMovingStillGuard(context, rawType)
      } else {
        rawType
      }

      if (isEnter) {
        // RULE_ACTIVITY_TRANSITIONS — transitions don't carry a confidence
        // value (the snapshot API's concept doesn't apply to edges). Store
        // confidence=100 so downstream RULE_SECTION_ACTIVITY_CONFIDENCE
        // never filters these out.
        TrackingState.setLastActivity(context, effectiveType, ts)
        NativeStore.insertActivity(context, ts, effectiveType, 100)

        // RULE_MOTION_STATE_MACHINE — drive MOVING/STATIONARY transitions.
        if (effectiveType != "still" && effectiveType != "unknown") {
          TrackingService.enterMoving(context, "ar:$effectiveType")
          // RULE_ADAPTIVE_LOCATION_REQUEST — pick tight/loose for the new activity.
          val newProfile = TrackingRules.profileForActivity(effectiveType)
          if (newProfile.name != TrackingState.getActiveProfileName(context)) {
            TrackingService.reconfigureLocationRequest(context, newProfile)
          }
        } else if (effectiveType == "still") {
          // Begin stop-detection debounce; service drops GPS after STOP_TIMEOUT_MS
          // unless motion arrives first.
          TrackingService.enterStillPending(context)
        }
      } else {
        // EXIT — bump the "last activity arrived" wall clock so silence
        // detection treats this as a live AR pipeline, even though we don't
        // persist a row.
        TrackingState.setLastActivity(
          context,
          TrackingState.getLastActivity(context) ?: "unknown",
          ts
        )
      }

      val payload = Bundle().apply {
        putString("type", effectiveType)
        putString("transition", if (isEnter) "enter" else "exit")
        putDouble("timestampMs", ts.toDouble())
      }
      MapozyTrackerEventBus.emitActivity(payload)
    }
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
