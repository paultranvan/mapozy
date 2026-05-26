// Rules consumed here (see TrackingRules.kt):
//   RULE_LOCATION_REQUEST_DEFAULT     — startup priority/accuracy mode
//   RULE_ACTIVITY_RECOGNITION_INTERVAL — activity poll cadence
//   RULE_ADAPTIVE_LOCATION_REQUEST    — apply the active LocationProfile when (re)subscribing
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
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.ActivityRecognition
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

class TrackingService : Service() {

  companion object {
    const val NOTIF_CHANNEL = "mapozy_tracking"
    const val NOTIF_ID = 4242
    const val ACTION_START = "mapozy.tracker.START"
    const val ACTION_STOP = "mapozy.tracker.STOP"
    const val ACTION_PAUSE_LOCATION = "mapozy.tracker.PAUSE_LOCATION"
    const val ACTION_RESUME_LOCATION = "mapozy.tracker.RESUME_LOCATION"
    const val ACTION_RECONFIGURE_LR = "mapozy.tracker.RECONFIGURE_LR"

    fun start(context: Context) {
      sendIntent(context, ACTION_START, foreground = true)
    }

    fun stop(context: Context) {
      sendIntent(context, ACTION_STOP, foreground = false)
    }

    fun pauseLocation(context: Context) {
      if (!TrackingState.isEnabled(context)) return
      sendIntent(context, ACTION_PAUSE_LOCATION, foreground = true)
    }

    fun resumeLocation(context: Context) {
      if (!TrackingState.isEnabled(context)) return
      sendIntent(context, ACTION_RESUME_LOCATION, foreground = true)
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
      if (foreground && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }
  }

  private lateinit var locationListener: LocationListener
  private var activityPendingIntent: PendingIntent? = null
  private var locationSubscribed: Boolean = false

  override fun onCreate() {
    super.onCreate()
    createChannel()
    locationListener = LocationListener(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        Log.i("mapozy", "TrackingService stopping")
        unsubscribeLocation()
        unsubscribeActivity()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        TrackingState.setEnabled(this, false)
        return START_NOT_STICKY
      }
      ACTION_PAUSE_LOCATION -> {
        Log.i("mapozy", "TrackingService pausing location")
        val cfg = TrackingState.loadConfig(this)
        startForegroundCompat(cfg)
        unsubscribeLocation()
        return START_STICKY
      }
      ACTION_RESUME_LOCATION -> {
        val cfg = TrackingState.loadConfig(this)
        startForegroundCompat(cfg)
        if (hasLocationPermission()) subscribeLocation(cfg)
        return START_STICKY
      }
      ACTION_RECONFIGURE_LR -> {
        val cfg = TrackingState.loadConfig(this)
        Log.i(
          "mapozy",
          "TrackingService reconfiguring LR to profile=${TrackingState.getActiveProfileName(this)}"
        )
        startForegroundCompat(cfg)
        unsubscribeLocation()
        if (hasLocationPermission()) subscribeLocation(cfg)
        return START_STICKY
      }
      else -> {
        val cfg = TrackingState.loadConfig(this)
        Log.i("mapozy", "TrackingService starting with cfg=$cfg")
        startForegroundCompat(cfg)
        if (hasLocationPermission()) {
          subscribeLocation(cfg)
        } else {
          Log.w("mapozy", "Location permission missing, cannot subscribe")
        }
        if (hasActivityRecognitionPermission()) {
          subscribeActivity(cfg)
        } else {
          Log.w("mapozy", "Activity recognition permission missing, skipping")
        }
        TrackingState.setEnabled(this, true)
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
    val priority = if (cfg.desiredAccuracy == "high") {
      Priority.PRIORITY_HIGH_ACCURACY
    } else {
      Priority.PRIORITY_BALANCED_POWER_ACCURACY
    }
    // RULE_ADAPTIVE_LOCATION_REQUEST — the active profile decides interval +
    // distance filter. ActivityReceiver may flip the profile at any time;
    // when it does, it sends ACTION_RECONFIGURE_LR which routes through
    // here again.
    val profile = when (TrackingState.getActiveProfileName(this)) {
      TrackingRules.LOOSE_PROFILE.name -> TrackingRules.LOOSE_PROFILE
      else -> TrackingRules.TIGHT_PROFILE
    }
    val request = LocationRequest.Builder(priority, profile.minIntervalMs)
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

  private fun subscribeActivity(cfg: TrackingState.Config) {
    val ar = ActivityRecognition.getClient(this)
    val intent = Intent(this, ActivityReceiver::class.java)
    val pi = PendingIntent.getBroadcast(
      this, 0, intent,
      PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
    activityPendingIntent = pi
    try {
      ar.requestActivityUpdates(cfg.activityIntervalMs, pi)
    } catch (e: SecurityException) {
      Log.e("mapozy", "Cannot subscribe to activity: $e")
    }
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
    activityPendingIntent?.let {
      try {
        ActivityRecognition.getClient(this).removeActivityUpdates(it)
      } catch (e: Exception) {
        Log.w("mapozy", "removeActivityUpdates failed: $e")
      }
    }
    activityPendingIntent = null
  }

  override fun onDestroy() {
    unsubscribeLocation()
    unsubscribeActivity()
    super.onDestroy()
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
