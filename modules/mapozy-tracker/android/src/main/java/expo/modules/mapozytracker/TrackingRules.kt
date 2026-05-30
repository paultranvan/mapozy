package expo.modules.mapozytracker

import com.google.android.gms.location.Priority

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
   * writes from cold-start / network-triangulation samples. Keep the two
   * thresholds in lock-step.
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
   * RULE_ADAPTIVE_LOCATION_REQUEST — on activity change, switch the active
   * LocationRequest. Each profile carries its own GPS priority, sample
   * interval and distance filter, picked to balance trace quality against
   * battery cost for that mode of travel.
   *
   * IMPORTANT: all profiles use PRIORITY_HIGH_ACCURACY. PRIORITY_BALANCED
   * was tried (commit 0938f35) on the theory it would let the OS skip the
   * GPS chip when cell/Wi-Fi can localise. In practice, on real devices,
   * BALANCED + a non-zero distance filter simply doesn't fire the GPS chip
   * at all during car drives — verified on this device with a ~5 min drive
   * that produced ZERO raw_points (vs ~30 fixes on the previous HIGH config).
   * Battery savings now come from interval relaxation only, not priority.
   *
   * Profile selection (see profileForActivity):
   *  - on_bicycle               → TIGHT — ~5 m fixes for sharp turns
   *  - in_vehicle               → LOOSE — sparse fixes, vehicles move fast
   *  - walking / still / unknown / anything else → WALK (install default)
   */
  data class LocationProfile(
    val name: String,
    val distanceFilterM: Float,
    val minIntervalMs: Long,
    val priority: Int,
  )

  // Cycling: GPS-on, ~5 m precision. Bikes weave and corner tightly; a coarser
  // trace would visibly cut corners and misclassify the mode.
  val TIGHT_PROFILE = LocationProfile(
    name = "tight",
    distanceFilterM = 10f,
    minIntervalMs = 5_000L,
    priority = Priority.PRIORITY_HIGH_ACCURACY,
  )

  // Walking / still / unknown — the install default. 30 s interval lets the
  // GPS chip duty-cycle between fixes for a modest battery saving (vs the
  // 5 s TIGHT default that was used pre-split). HIGH priority is required for
  // the chip to actually fire — see file-level note above.
  val WALK_PROFILE = LocationProfile(
    name = "walk",
    distanceFilterM = 20f,
    minIntervalMs = 30_000L,
    priority = Priority.PRIORITY_HIGH_ACCURACY,
  )

  // Vehicle: 30 s + 50 m. At highway speeds 30 s is ~830 m between fixes —
  // sparse but enough for trip visualization, and the pipeline resamples
  // to 10 s anyway.
  val LOOSE_PROFILE = LocationProfile(
    name = "loose",
    distanceFilterM = 50f,
    minIntervalMs = 30_000L,
    priority = Priority.PRIORITY_HIGH_ACCURACY,
  )

  fun profileForActivity(activityType: String?): LocationProfile {
    return when (activityType) {
      "in_vehicle" -> LOOSE_PROFILE
      "on_bicycle" -> TIGHT_PROFILE
      else -> WALK_PROFILE
    }
  }

  /**
   * RULE_MOTION_STATE_MACHINE — stationary geofence radius + stop-detection
   * debounce. GPS is removed in STATIONARY; a geofence of this radius and an
   * AR ENTER(non-still) are the two redundant wake triggers. STOP_TIMEOUT_MS
   * debounces brief stops (red lights) before we drop GPS.
   *
   * STATIONARY has TWO independent triggers (both call enterStationaryNow):
   *  1. RULE_MOTION_STATE_MACHINE itself: AR ENTER(still) sustained for
   *     STOP_TIMEOUT_MS without a non-still ENTER cancelling it.
   *  2. RULE_GPS_STATIONARY_DETECTION (LocationListener): recent GPS samples
   *     have all stayed within STATIONARY_RADIUS_M of the oldest for
   *     STOP_TIMEOUT_MS, regardless of AR. Saves us when AR flickers
   *     indefinitely on noisy pipelines (observed on OnePlus, OPlus).
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
