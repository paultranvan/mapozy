// Rules consumed here (see TrackingRules.kt):
//   RULE_LOCATION_REQUEST_DEFAULT  — startup priority/accuracy mode
//   RULE_ACTIVITY_TRANSITIONS      — set of activity types we subscribe transitions for
//   RULE_ADAPTIVE_LOCATION_REQUEST — apply the active LocationProfile when (re)subscribing
package expo.modules.mapozytracker

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.ActivityRecognition
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionRequest
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.LocationServices as GmsLocationServices
import com.google.android.gms.location.Priority
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONObject as JsonObj

class TrackingService : Service() {

  companion object {
    const val NOTIF_CHANNEL = "mapozy_tracking"
    const val NOTIF_ID = 4242
    const val ACTION_START = "mapozy.tracker.START"
    const val ACTION_STOP = "mapozy.tracker.STOP"
    const val ACTION_RESTART = "mapozy.tracker.RESTART"
    const val ACTION_RECONFIGURE_LR = "mapozy.tracker.RECONFIGURE_LR"
    const val ACTION_ENTER_MOVING = "mapozy.tracker.ENTER_MOVING"
    const val ACTION_STILL_PENDING = "mapozy.tracker.STILL_PENDING"
    const val ACTION_WATCHDOG_TICK = "mapozy.tracker.WATCHDOG_TICK"
    const val ACTION_GPS_STATIONARY = "mapozy.tracker.GPS_STATIONARY"

    @Volatile var isRunning: Boolean = false
      private set

    fun enterMoving(context: Context, trigger: String) {
      if (!TrackingState.isEnabled(context)) return
      val i = Intent(context, TrackingService::class.java).apply {
        action = ACTION_ENTER_MOVING
        putExtra("trigger", trigger)
      }
      startCompat(context, i)
    }

    fun enterStillPending(context: Context) {
      if (!TrackingState.isEnabled(context)) return
      startCompat(context, Intent(context, TrackingService::class.java).apply {
        action = ACTION_STILL_PENDING
      })
    }

    fun watchdogTick(context: Context) {
      if (!TrackingState.isEnabled(context)) return
      startCompat(context, Intent(context, TrackingService::class.java).apply {
        action = ACTION_WATCHDOG_TICK
      })
    }

    /**
     * RULE_GPS_STATIONARY_DETECTION — independent of AR. Fires when recent GPS
     * samples confirm the device hasn't moved beyond STATIONARY_RADIUS_M for
     * STOP_TIMEOUT_MS, regardless of what the activity recogniser reports.
     */
    fun gpsStationaryDetected(
      context: Context,
      lat: Double,
      lng: Double,
      stoppedAtMs: Long
    ) {
      if (!TrackingState.isEnabled(context)) return
      if (TrackingState.getState(context) != TrackingState.STATE_MOVING) return
      startCompat(context, Intent(context, TrackingService::class.java).apply {
        action = ACTION_GPS_STATIONARY
        putExtra("lat", lat)
        putExtra("lng", lng)
        putExtra("stoppedAtMs", stoppedAtMs)
      })
    }

    private fun startCompat(context: Context, intent: Intent) {
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
      } catch (e: Exception) {
        Log.w("mapozy", "startCompat failed: $e")
      }
    }

    fun start(context: Context) {
      sendIntent(context, ACTION_START, foreground = true)
    }

    fun stop(context: Context) {
      sendIntent(context, ACTION_STOP, foreground = false)
    }

    /**
     * Atomic re-subscribe: unsubscribe + subscribe in a single onStartCommand,
     * without stopSelf. Avoids the lifecycle race where stop+start from JS lets
     * onDestroy fire AFTER the new subscription is established, killing it.
     */
    fun restart(context: Context) {
      sendIntent(context, ACTION_RESTART, foreground = true)
    }

    /**
     * Switches the active LocationRequest profile and re-subscribes
     * FusedLocation with the new params. Implements RULE_ADAPTIVE_LOCATION_REQUEST.
     */
    fun reconfigureLocationRequest(context: Context, profile: TrackingRules.LocationProfile) {
      if (!TrackingState.isEnabled(context)) return
      TrackingState.setActiveProfileName(context, profile.name)
      sendIntent(context, ACTION_RECONFIGURE_LR, foreground = true)
    }

    private fun sendIntent(context: Context, action: String, foreground: Boolean) {
      val intent = Intent(context, TrackingService::class.java).apply { this.action = action }
      try {
        if (foreground && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
      } catch (e: Exception) {
        Log.w("mapozy", "sendIntent($action) failed: $e")
      }
    }
  }

  private lateinit var locationListener: LocationListener
  private var activityPendingIntent: PendingIntent? = null
  private var locationSubscribed: Boolean = false
  private val mainHandler = Handler(Looper.getMainLooper())
  private var stopRunnable: Runnable? = null
  private var geofencePendingIntent: PendingIntent? = null

  override fun onCreate() {
    super.onCreate()
    createChannel()
    locationListener = LocationListener(this)
    isRunning = true
    NativeStore.insertDiagnostic(this, System.currentTimeMillis(), "svc_create", null)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val action = intent?.action
    NativeStore.insertDiagnostic(
      this, System.currentTimeMillis(), "svc_start_command",
      JsonObj().apply { put("action", action ?: "null_redelivery") }.toString()
    )
    when (action) {
      ACTION_STOP -> {
        Log.i("mapozy", "TrackingService stopping")
        cancelStopTimer()
        unsubscribeLocation()
        unsubscribeActivity()
        removeGeofence()
        TrackerWatchdog.cancel(this)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        TrackingState.setEnabled(this, false)
        return START_NOT_STICKY
      }
      ACTION_ENTER_MOVING -> {
        val cfg = TrackingState.loadConfig(this)
        startForegroundCompat(cfg)
        applyMoving(cfg, intent.getStringExtra("trigger") ?: "unknown")
        return START_STICKY
      }
      ACTION_STILL_PENDING -> {
        val cfg = TrackingState.loadConfig(this)
        startForegroundCompat(cfg)
        scheduleStopTimer()
        return START_STICKY
      }
      ACTION_RECONFIGURE_LR -> {
        val cfg = TrackingState.loadConfig(this)
        startForegroundCompat(cfg)
        if (TrackingState.getState(this) == TrackingState.STATE_MOVING) {
          unsubscribeLocation()
          if (hasLocationPermission()) subscribeLocation(cfg)
        }
        return START_STICKY
      }
      ACTION_WATCHDOG_TICK -> {
        val cfg = TrackingState.loadConfig(this)
        startForegroundCompat(cfg)
        if (hasActivityRecognitionPermission()) subscribeActivity(cfg)
        if (TrackingState.getState(this) == TrackingState.STATE_STATIONARY) {
          armGeofence()
        }
        return START_STICKY
      }
      ACTION_GPS_STATIONARY -> {
        val cfg = TrackingState.loadConfig(this)
        startForegroundCompat(cfg)
        if (TrackingState.getState(this) == TrackingState.STATE_MOVING) {
          val lat = intent.getDoubleExtra("lat", Double.NaN)
          val lng = intent.getDoubleExtra("lng", Double.NaN)
          val stoppedAt = intent.getLongExtra("stoppedAtMs", System.currentTimeMillis())
          enterStationaryNow(
            trigger = "gps_no_movement",
            stoppedAtMs = stoppedAt,
            lat = if (lat.isNaN()) null else lat,
            lng = if (lng.isNaN()) null else lng
          )
        }
        return START_STICKY
      }
      ACTION_RESTART -> {
        val cfg = TrackingState.loadConfig(this)
        startForegroundCompat(cfg)
        unsubscribeActivity()
        if (hasActivityRecognitionPermission()) subscribeActivity(cfg)
        TrackingState.setEnabled(this, true)
        TrackerWatchdog.schedule(this)
        applyCurrentState(cfg)
        return START_STICKY
      }
      else -> {
        val cfg = TrackingState.loadConfig(this)
        startForegroundCompat(cfg)
        if (hasActivityRecognitionPermission()) subscribeActivity(cfg)
        TrackingState.setEnabled(this, true)
        TrackerWatchdog.schedule(this)
        applyCurrentState(cfg)
        return START_STICKY
      }
    }
  }

  private fun hasLocationPermission(): Boolean {
    return ActivityCompat.checkSelfPermission(
      this, Manifest.permission.ACCESS_FINE_LOCATION
    ) == PackageManager.PERMISSION_GRANTED
  }

  private fun hasActivityRecognitionPermission(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
    return ActivityCompat.checkSelfPermission(
      this, Manifest.permission.ACTIVITY_RECOGNITION
    ) == PackageManager.PERMISSION_GRANTED
  }

  private fun startForegroundCompat(cfg: TrackingState.Config) {
    val pendingIntent = packageManager
      .getLaunchIntentForPackage(packageName)
      ?.let {
        PendingIntent.getActivity(
          this, 0, it,
          PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
      }
    val notif = NotificationCompat.Builder(this, NOTIF_CHANNEL)
      .setContentTitle(cfg.notificationTitle)
      .setContentText(cfg.notificationBody)
      .setSmallIcon(android.R.drawable.ic_menu_mylocation)
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setContentIntent(pendingIntent)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
    } else {
      startForeground(NOTIF_ID, notif)
    }
  }

  private fun subscribeLocation(cfg: TrackingState.Config) {
    if (locationSubscribed) return
    // RULE_ADAPTIVE_LOCATION_REQUEST — the active profile decides priority,
    // interval and distance filter. Priority is the dominant battery knob
    // (see TrackingRules.LocationProfile). ActivityReceiver flips the profile
    // on activity changes and routes back here via ACTION_RECONFIGURE_LR.
    //
    // cfg.desiredAccuracy is retained for backwards compatibility with
    // persisted configs but is no longer consulted — accuracy is per-profile.
    val profile = when (TrackingState.getActiveProfileName(this)) {
      TrackingRules.LOOSE_PROFILE.name -> TrackingRules.LOOSE_PROFILE
      TrackingRules.TIGHT_PROFILE.name -> TrackingRules.TIGHT_PROFILE
      else -> TrackingRules.WALK_PROFILE
    }
    val request = LocationRequest.Builder(profile.priority, profile.minIntervalMs)
      .setMinUpdateDistanceMeters(profile.distanceFilterM)
      .build()
    val client = LocationServices.getFusedLocationProviderClient(this)
    try {
      client.requestLocationUpdates(request, locationListener, Looper.getMainLooper())
      locationSubscribed = true
    } catch (e: SecurityException) {
      Log.e("mapozy", "Cannot subscribe to location: $e")
    }
  }

  /**
   * RULE_ACTIVITY_TRANSITIONS — subscribe to ENTER + EXIT transitions for the
   * configured activity types. Replaces the polling snapshot API; event-
   * driven so Doze can't simply throttle scheduled deliveries to zero, and
   * Google's docs recommend it for background activity monitoring. We log
   * an `ar_subscribed` diagnostic on each call so silence periods can be
   * traced back to when the subscription was last (re)registered.
   */
  @Suppress("UNUSED_PARAMETER")
  private fun subscribeActivity(cfg: TrackingState.Config) {
    val ar = ActivityRecognition.getClient(this)
    val intent = Intent(this, ActivityReceiver::class.java)
    val pi = PendingIntent.getBroadcast(
      this, 0, intent,
      PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
    activityPendingIntent = pi

    val transitions = mutableListOf<ActivityTransition>()
    for (type in TrackingRules.SUBSCRIBED_ACTIVITY_TYPES) {
      transitions.add(
        ActivityTransition.Builder()
          .setActivityType(type)
          .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER)
          .build()
      )
      transitions.add(
        ActivityTransition.Builder()
          .setActivityType(type)
          .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_EXIT)
          .build()
      )
    }
    val request = ActivityTransitionRequest(transitions)
    try {
      ar.requestActivityTransitionUpdates(request, pi)
      logArSubscribed(transitions.size)
      TrackingState.clearLastSilenceDetectedMs(this)
    } catch (e: SecurityException) {
      Log.e("mapozy", "Cannot subscribe to activity transitions: $e")
    }
  }

  private fun logArSubscribed(transitionCount: Int) {
    val typeNames = TrackingRules.SUBSCRIBED_ACTIVITY_TYPES.map { activityTypeName(it) }
    val payload = JSONObject().apply {
      put("api", "transition")
      put("transitionCount", transitionCount)
      put("types", JSONArray(typeNames))
    }
    NativeStore.insertDiagnostic(
      this,
      System.currentTimeMillis(),
      "ar_subscribed",
      payload.toString()
    )
  }

  private fun activityTypeName(t: Int): String = when (t) {
    com.google.android.gms.location.DetectedActivity.IN_VEHICLE -> "in_vehicle"
    com.google.android.gms.location.DetectedActivity.ON_BICYCLE -> "on_bicycle"
    com.google.android.gms.location.DetectedActivity.WALKING -> "walking"
    com.google.android.gms.location.DetectedActivity.RUNNING -> "running"
    com.google.android.gms.location.DetectedActivity.STILL -> "still"
    else -> "unknown_$t"
  }

  private fun unsubscribeLocation() {
    if (!locationSubscribed) return
    try {
      LocationServices.getFusedLocationProviderClient(this)
        .removeLocationUpdates(locationListener)
    } catch (e: Exception) {
      Log.w("mapozy", "removeLocationUpdates failed: $e")
    }
    locationSubscribed = false
  }

  private fun unsubscribeActivity() {
    val pi = activityPendingIntent ?: return
    try {
      ActivityRecognition.getClient(this).removeActivityTransitionUpdates(pi)
    } catch (e: Exception) {
      Log.w("mapozy", "removeActivityTransitionUpdates failed: $e")
    }
    activityPendingIntent = null
    NativeStore.insertDiagnostic(
      this,
      System.currentTimeMillis(),
      "ar_unsubscribed",
      null
    )
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    NativeStore.insertDiagnostic(this, System.currentTimeMillis(), "svc_task_removed", null)
    if (TrackingState.isEnabled(this)) {
      val restart = Intent(applicationContext, TrackingService::class.java)
      restart.action = ACTION_RESTART
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          startForegroundService(restart)
        } else {
          startService(restart)
        }
      } catch (e: Exception) {
        Log.w("mapozy", "onTaskRemoved restart failed: $e")
      }
    }
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    isRunning = false
    NativeStore.insertDiagnostic(this, System.currentTimeMillis(), "svc_destroy", null)
    cancelStopTimer()
    unsubscribeLocation()
    unsubscribeActivity()
    super.onDestroy()
  }

  /** Re-establish whatever the persisted state says (used on (re)start). */
  private fun applyCurrentState(cfg: TrackingState.Config) {
    if (TrackingState.getState(this) == TrackingState.STATE_STATIONARY) {
      unsubscribeLocation()
      armGeofence()
    } else {
      applyMoving(cfg, "restart")
    }
  }

  private fun applyMoving(cfg: TrackingState.Config, trigger: String) {
    cancelStopTimer()
    removeGeofence()
    TrackingState.clearRecentGpsSamples(this)
    if (TrackingState.getState(this) != TrackingState.STATE_MOVING) {
      TrackingState.setState(this, TrackingState.STATE_MOVING)
      val now = System.currentTimeMillis()
      val coords = TrackingState.getLastLocationCoords(this)
      val payload = JsonObj().apply {
        put("trigger", trigger)
        put("startedAtMs", now)
        if (coords != null) {
          put("lat", coords.first); put("lng", coords.second)
        }
      }
      NativeStore.insertDiagnostic(this, now, "state_moving", payload.toString())
    }
    if (hasLocationPermission()) subscribeLocation(cfg)
  }

  private fun enterStationaryNow(
    trigger: String,
    stoppedAtMs: Long,
    lat: Double?,
    lng: Double?,
  ) {
    TrackingState.setState(this, TrackingState.STATE_STATIONARY)
    unsubscribeLocation()
    TrackingState.clearRecentGpsSamples(this)
    armGeofence()
    val payload = JsonObj().apply {
      put("trigger", trigger)
      put("stoppedAtMs", stoppedAtMs)
      if (lat != null) put("lat", lat)
      if (lng != null) put("lng", lng)
    }
    NativeStore.insertDiagnostic(
      this, System.currentTimeMillis(), "state_stationary", payload.toString()
    )
    // Tell JS the trip just ended — drains the pipeline. STOP_TIMEOUT_MS
    // matches the pipeline's DWELL_STAY threshold, so by the time this fires
    // the segmentation will see a terminating stay at this location.
    val event = Bundle().apply {
      putString("trigger", trigger)
      putDouble("stoppedAtMs", stoppedAtMs.toDouble())
      if (lat != null) putDouble("lat", lat)
      if (lng != null) putDouble("lng", lng)
    }
    MapozyTrackerEventBus.emitStationary(event)
  }

  private fun scheduleStopTimer() {
    cancelStopTimer()
    TrackingState.setStopDeadline(this, System.currentTimeMillis() + TrackingRules.STOP_TIMEOUT_MS)
    val r = Runnable {
      if (TrackingState.getState(this) == TrackingState.STATE_MOVING) {
        val stoppedAt = System.currentTimeMillis() - TrackingRules.STOP_TIMEOUT_MS
        val coords = TrackingState.getLastLocationCoords(this)
        enterStationaryNow(
          trigger = "stop_timeout",
          stoppedAtMs = stoppedAt,
          lat = coords?.first,
          lng = coords?.second,
        )
      }
      stopRunnable = null
    }
    stopRunnable = r
    mainHandler.postDelayed(r, TrackingRules.STOP_TIMEOUT_MS)
  }

  private fun cancelStopTimer() {
    stopRunnable?.let { mainHandler.removeCallbacks(it) }
    stopRunnable = null
    TrackingState.clearStopDeadline(this)
  }

  private fun armGeofence() {
    val center = TrackingState.getGeofenceCenter(this)
      ?: TrackingState.getLastLocationCoords(this)
      ?: run {
        Log.w("mapozy", "armGeofence: no known location yet; skipping")
        return
      }
    TrackingState.setGeofenceCenter(this, center.first, center.second)
    val geofence = Geofence.Builder()
      .setRequestId(TrackingRules.GEOFENCE_REQUEST_ID)
      .setCircularRegion(center.first, center.second, TrackingRules.STATIONARY_RADIUS_M)
      .setExpirationDuration(Geofence.NEVER_EXPIRE)
      .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_EXIT)
      .build()
    val request = GeofencingRequest.Builder()
      .setInitialTrigger(0)
      .addGeofence(geofence)
      .build()
    val pi = geofencePendingIntent ?: PendingIntent.getBroadcast(
      this, 0, Intent(this, GeofenceReceiver::class.java),
      PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    ).also { geofencePendingIntent = it }
    try {
      GmsLocationServices.getGeofencingClient(this).addGeofences(request, pi)
      NativeStore.insertDiagnostic(
        this, System.currentTimeMillis(), "geofence_armed",
        JsonObj().apply {
          put("lat", center.first); put("lng", center.second)
          put("radius", TrackingRules.STATIONARY_RADIUS_M.toDouble())
        }.toString()
      )
    } catch (e: SecurityException) {
      Log.e("mapozy", "armGeofence: missing permission: $e")
    }
  }

  private fun removeGeofence() {
    try {
      GmsLocationServices.getGeofencingClient(this)
        .removeGeofences(listOf(TrackingRules.GEOFENCE_REQUEST_ID))
    } catch (e: Exception) {
      Log.w("mapozy", "removeGeofence failed: $e")
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun createChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        NOTIF_CHANNEL,
        "Mapozy tracking",
        NotificationManager.IMPORTANCE_LOW
      )
      channel.setShowBadge(false)
      val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
      nm.createNotificationChannel(channel)
    }
  }
}
