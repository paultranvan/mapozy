package expo.modules.mapozytracker

/**
 * Native-side rule manifest. Mirror of `src/pipeline/rules.ts` for the
 * JS side — every threshold and policy that lives in native code is
 * registered here so it's easy to grep, audit, or remove.
 *
 * To remove a rule:
 *   1. Delete the consuming logic AND its header reference to the rule id.
 *   2. Delete the entry below.
 *
 * Rules are NOT runtime-toggleable on purpose.
 */
object TrackingRules {

  /**
   * RULE_NATIVE_ACCURACY_FILTER — drop locations whose reported accuracy is
   * worse than this threshold before writing to SQLite. Mirrors
   * RULE_ACCURACY_FILTER on the JS side, applied earlier to avoid wasted
   * writes from cold-start / network-triangulation samples.
   */
  const val MAX_INSERT_ACCURACY_M = 50f

  /**
   * RULE_LOCATION_REQUEST_DEFAULT — startup defaults for FusedLocation.
   * Used by TrackingState.Config when the JS bridge hasn't supplied an
   * override yet.
   */
  const val DEFAULT_DISTANCE_FILTER_M = 20f
  const val DEFAULT_MIN_INTERVAL_MS = 5_000L
  const val DEFAULT_DESIRED_ACCURACY = "high"

  /**
   * RULE_ACTIVITY_RECOGNITION_INTERVAL — legacy poll cadence for the snapshot
   * activity API. Kept only for the JS-bridge `activityIntervalMs` config
   * parameter (still accepted for backwards-compat); ignored by the
   * transition-based subscription path below, which is event-driven.
   */
  const val DEFAULT_ACTIVITY_INTERVAL_MS = 10_000L

  /**
   * RULE_ACTIVITY_TRANSITIONS — the set of activity types we subscribe to via
   * `ActivityRecognitionClient.requestActivityTransitionUpdates`. The
   * transition API only fires on edges (ENTER / EXIT), so the downstream
   * pipeline treats each ENTER as "the user is now doing X" and relies on
   * the next ENTER (or a long silence) to override.
   */
  val SUBSCRIBED_ACTIVITY_TYPES = listOf(
    com.google.android.gms.location.DetectedActivity.IN_VEHICLE,
    com.google.android.gms.location.DetectedActivity.ON_BICYCLE,
    com.google.android.gms.location.DetectedActivity.WALKING,
    com.google.android.gms.location.DetectedActivity.RUNNING,
    com.google.android.gms.location.DetectedActivity.STILL,
  )

  /**
   * RULE_AR_SILENCE_DETECTION — without a watchdog re-subscription, AR can
   * go silent on aggressive battery managers (e.g. OnePlus) for many hours.
   * When a fresh GPS sample shows the user actively moving but no AR event
   * has been seen for a while, log an `ar_silence_detected` diagnostic so
   * we can quantify the failure mode from the DB. Dedup window prevents
   * one stuck subscription from filling the table.
   */
  const val AR_SILENCE_GAP_MS = 5L * 60_000L
  const val AR_SILENCE_MIN_MOVING_SPEED_MPS = 0.5f
  const val AR_SILENCE_DEDUP_INTERVAL_MS = 5L * 60_000L

  /**
   * RULE_AUTO_RESUME_ON_MOVE — when activity transitions out of
   * still/unknown, wake LocationListener back up if it was paused.
   * (No parameters; identified by name so the consuming branch in
   * ActivityReceiver is grep-able.)
   */

  /**
   * RULE_MOVING_STILL_GUARD — when DetectedActivity.STILL arrives but
   * the most recent GPS sample is recent AND shows motion above the
   * threshold, reclassify the activity as "unknown" before persisting.
   *
   * Android emits confident STILL events on trains/buses where the user
   * is physically not moving relative to the vehicle; trusting them
   * poisons section segmentation by turning travel into stays.
   */
  const val MOVING_STILL_SPEED_MPS = 1.0f
  const val MOVING_STILL_LOOKBACK_MS = 30_000L

  /**
   * RULE_ADAPTIVE_LOCATION_REQUEST — on activity change, switch the
   * LocationRequest between a tight profile (walk/still/unknown) and a
   * loose profile (in_vehicle, etc). Loose saves battery on long drives
   * where 5s/20m sampling is overkill.
   */
  data class LocationProfile(
    val name: String,
    val distanceFilterM: Float,
    val minIntervalMs: Long,
  )

  val TIGHT_PROFILE = LocationProfile(
    name = "tight",
    distanceFilterM = 20f,
    minIntervalMs = 5_000L,
  )

  val LOOSE_PROFILE = LocationProfile(
    name = "loose",
    distanceFilterM = 50f,
    minIntervalMs = 15_000L,
  )

  // Activity types that map to the loose profile. Everything else uses tight.
  private val LOOSE_ACTIVITY_TYPES = setOf("in_vehicle")

  fun profileForActivity(activityType: String?): LocationProfile {
    return if (activityType != null && LOOSE_ACTIVITY_TYPES.contains(activityType)) {
      LOOSE_PROFILE
    } else {
      TIGHT_PROFILE
    }
  }

  /**
   * RULE_MOTION_STATE_MACHINE — stationary geofence radius + stop-detection
   * debounce. GPS is removed in STATIONARY; a geofence of this radius and an
   * AR ENTER(non-still) are the two redundant wake triggers. STOP_TIMEOUT_MS
   * debounces brief stops (red lights) before we drop GPS.
   */
  const val STATIONARY_RADIUS_M = 50f
  const val STOP_TIMEOUT_MS = 5L * 60_000L
  const val GEOFENCE_REQUEST_ID = "mapozy_stationary"

  /**
   * RULE_WATCHDOG — inexact allow-while-idle heartbeat that re-asserts the
   * service and re-arms AR/geofence. Inexact on purpose (exact alarms need the
   * Play-restricted SCHEDULE_EXACT_ALARM permission on API 31+).
   */
  const val WATCHDOG_INTERVAL_MS = 15L * 60_000L

  /**
   * RULE_DIAGNOSTICS_RETENTION — prune tracker_diagnostics rows older than this
   * so the on-device flight recorder can't grow unbounded.
   */
  const val DIAGNOSTICS_RETENTION_DAYS = 14L
}
