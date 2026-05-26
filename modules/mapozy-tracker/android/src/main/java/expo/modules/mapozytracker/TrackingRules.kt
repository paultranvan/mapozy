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
   * RULE_ACTIVITY_RECOGNITION_INTERVAL — how often we poll the OS
   * ActivityRecognition client.
   */
  const val DEFAULT_ACTIVITY_INTERVAL_MS = 10_000L

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
}
