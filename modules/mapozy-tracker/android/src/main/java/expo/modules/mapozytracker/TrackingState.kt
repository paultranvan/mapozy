package expo.modules.mapozytracker

import android.content.Context
import android.content.SharedPreferences

/**
 * Per-install state for the tracker, persisted across JS reloads and OS kills.
 * Rule defaults come from TrackingRules.kt; values here are user/runtime
 * overrides on top of those (notification text, accuracy mode) plus
 * observation state used by individual rules (last GPS sample, active
 * LocationRequest profile).
 */
object TrackingState {
  private const val PREFS = "mapozy_tracking"
  private const val KEY_ENABLED = "enabled"
  private const val KEY_ACCURACY = "desired_accuracy"
  private const val KEY_ACTIVITY_INTERVAL = "activity_interval_ms"
  private const val KEY_NOTIF_TITLE = "notif_title"
  private const val KEY_NOTIF_BODY = "notif_body"
  private const val KEY_LAST_LOC_MS = "last_loc_ms"
  private const val KEY_LAST_LOC_SPEED = "last_loc_speed_mps"
  private const val KEY_LAST_ACT_TYPE = "last_act_type"
  // RULE_AR_SILENCE_DETECTION observation state — timestamps used to
  // diagnose whether the activity-recognition subscription is alive.
  private const val KEY_LAST_ACT_MS = "last_act_ms"
  private const val KEY_LAST_SILENCE_DETECTED_MS = "last_silence_detected_ms"
  // RULE_ADAPTIVE_LOCATION_REQUEST observation state
  private const val KEY_ACTIVE_PROFILE = "active_lr_profile"

  const val STATE_MOVING = "moving"
  const val STATE_STATIONARY = "stationary"
  private const val KEY_STATE = "motion_state"
  private const val KEY_GEOFENCE_LAT = "geofence_lat"
  private const val KEY_GEOFENCE_LNG = "geofence_lng"
  private const val KEY_LAST_LOC_LAT = "last_loc_lat"
  private const val KEY_LAST_LOC_LNG = "last_loc_lng"
  private const val KEY_STOP_DEADLINE_MS = "stop_deadline_ms"

  fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun isEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_ENABLED, false)

  fun setEnabled(context: Context, value: Boolean) {
    prefs(context).edit().putBoolean(KEY_ENABLED, value).apply()
  }

  data class Config(
    val desiredAccuracy: String,
    val activityIntervalMs: Long,
    val notificationTitle: String,
    val notificationBody: String
  )

  fun saveConfig(context: Context, cfg: Config) {
    prefs(context).edit()
      .putString(KEY_ACCURACY, cfg.desiredAccuracy)
      .putLong(KEY_ACTIVITY_INTERVAL, cfg.activityIntervalMs)
      .putString(KEY_NOTIF_TITLE, cfg.notificationTitle)
      .putString(KEY_NOTIF_BODY, cfg.notificationBody)
      .apply()
  }

  fun loadConfig(context: Context): Config {
    val p = prefs(context)
    return Config(
      desiredAccuracy = p.getString(KEY_ACCURACY, TrackingRules.DEFAULT_DESIRED_ACCURACY)
        ?: TrackingRules.DEFAULT_DESIRED_ACCURACY,
      activityIntervalMs = p.getLong(KEY_ACTIVITY_INTERVAL, TrackingRules.DEFAULT_ACTIVITY_INTERVAL_MS),
      notificationTitle = p.getString(KEY_NOTIF_TITLE, "Mapozy tracking") ?: "Mapozy tracking",
      notificationBody = p.getString(KEY_NOTIF_BODY, "Tracking active") ?: "Tracking active"
    )
  }

  fun setLastLocation(context: Context, ms: Long, speedMps: Float?) {
    val e = prefs(context).edit().putLong(KEY_LAST_LOC_MS, ms)
    if (speedMps != null) e.putFloat(KEY_LAST_LOC_SPEED, speedMps) else e.remove(KEY_LAST_LOC_SPEED)
    e.apply()
  }

  fun getLastLocation(context: Context): Long? {
    val v = prefs(context).getLong(KEY_LAST_LOC_MS, -1L)
    return if (v == -1L) null else v
  }

  fun getLastLocationSpeedMps(context: Context): Float? {
    val p = prefs(context)
    if (!p.contains(KEY_LAST_LOC_SPEED)) return null
    return p.getFloat(KEY_LAST_LOC_SPEED, Float.NaN).takeIf { !it.isNaN() }
  }

  fun setLastActivity(context: Context, type: String, timestampMs: Long) {
    prefs(context).edit()
      .putString(KEY_LAST_ACT_TYPE, type)
      .putLong(KEY_LAST_ACT_MS, timestampMs)
      .apply()
  }

  fun getLastActivity(context: Context): String? =
    prefs(context).getString(KEY_LAST_ACT_TYPE, null)

  fun getLastActivityMs(context: Context): Long? {
    val v = prefs(context).getLong(KEY_LAST_ACT_MS, -1L)
    return if (v == -1L) null else v
  }

  fun getLastSilenceDetectedMs(context: Context): Long? {
    val v = prefs(context).getLong(KEY_LAST_SILENCE_DETECTED_MS, -1L)
    return if (v == -1L) null else v
  }

  fun setLastSilenceDetectedMs(context: Context, ms: Long) {
    prefs(context).edit().putLong(KEY_LAST_SILENCE_DETECTED_MS, ms).apply()
  }

  fun clearLastSilenceDetectedMs(context: Context) {
    prefs(context).edit().remove(KEY_LAST_SILENCE_DETECTED_MS).apply()
  }

  fun getActiveProfileName(context: Context): String =
    prefs(context).getString(KEY_ACTIVE_PROFILE, TrackingRules.TIGHT_PROFILE.name)
      ?: TrackingRules.TIGHT_PROFILE.name

  fun setActiveProfileName(context: Context, name: String) {
    prefs(context).edit().putString(KEY_ACTIVE_PROFILE, name).apply()
  }

  // Default to MOVING on a never-before-set install so the first start turns GPS on.
  fun getState(context: Context): String =
    prefs(context).getString(KEY_STATE, STATE_MOVING) ?: STATE_MOVING

  fun setState(context: Context, state: String) {
    prefs(context).edit().putString(KEY_STATE, state).apply()
  }

  fun setLastLocationCoords(context: Context, lat: Double, lng: Double) {
    prefs(context).edit()
      .putLong(KEY_LAST_LOC_LAT, java.lang.Double.doubleToRawLongBits(lat))
      .putLong(KEY_LAST_LOC_LNG, java.lang.Double.doubleToRawLongBits(lng))
      .apply()
  }

  fun getLastLocationCoords(context: Context): Pair<Double, Double>? {
    val p = prefs(context)
    if (!p.contains(KEY_LAST_LOC_LAT) || !p.contains(KEY_LAST_LOC_LNG)) return null
    val lat = java.lang.Double.longBitsToDouble(p.getLong(KEY_LAST_LOC_LAT, 0))
    val lng = java.lang.Double.longBitsToDouble(p.getLong(KEY_LAST_LOC_LNG, 0))
    return Pair(lat, lng)
  }

  fun setGeofenceCenter(context: Context, lat: Double, lng: Double) {
    prefs(context).edit()
      .putLong(KEY_GEOFENCE_LAT, java.lang.Double.doubleToRawLongBits(lat))
      .putLong(KEY_GEOFENCE_LNG, java.lang.Double.doubleToRawLongBits(lng))
      .apply()
  }

  fun getGeofenceCenter(context: Context): Pair<Double, Double>? {
    val p = prefs(context)
    if (!p.contains(KEY_GEOFENCE_LAT) || !p.contains(KEY_GEOFENCE_LNG)) return null
    val lat = java.lang.Double.longBitsToDouble(p.getLong(KEY_GEOFENCE_LAT, 0))
    val lng = java.lang.Double.longBitsToDouble(p.getLong(KEY_GEOFENCE_LNG, 0))
    return Pair(lat, lng)
  }

  fun setStopDeadline(context: Context, ms: Long) {
    prefs(context).edit().putLong(KEY_STOP_DEADLINE_MS, ms).apply()
  }

  fun getStopDeadline(context: Context): Long? {
    val v = prefs(context).getLong(KEY_STOP_DEADLINE_MS, -1L)
    return if (v == -1L) null else v
  }

  fun clearStopDeadline(context: Context) {
    prefs(context).edit().remove(KEY_STOP_DEADLINE_MS).apply()
  }
}
