package expo.modules.mapozytracker

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.webkit.CookieManager
import android.webkit.WebStorage
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MapozyTrackerModule : Module() {

  override fun definition() = ModuleDefinition {
    Name("MapozyTracker")
    Events("onLocation", "onActivity", "onStationary")

    OnCreate {
      MapozyTrackerEventBus.registerEmitter { name, payload ->
        try {
          sendEvent(name, payload)
        } catch (e: Throwable) {
          // The JS side might not be listening anymore; swallow.
        }
      }
    }

    OnDestroy {
      MapozyTrackerEventBus.unregisterEmitter()
    }

    // The distance/interval knobs that used to live on TrackingConfig moved
    // into TrackingRules' LocationProfile entries — they're rule parameters,
    // not user config. What remains here is per-install/UI: notification text,
    // accuracy priority, activity poll interval.
    AsyncFunction("start") { config: Map<String, Any?> ->
      val ctx = appContext.reactContext ?: error("No context")
      val cfg = TrackingState.Config(
        desiredAccuracy = (config["desiredAccuracy"] as? String)
          ?: TrackingRules.DEFAULT_DESIRED_ACCURACY,
        activityIntervalMs = (config["activityIntervalMs"] as? Number)?.toLong()
          ?: TrackingRules.DEFAULT_ACTIVITY_INTERVAL_MS,
        notificationTitle = (config["foregroundNotificationTitle"] as? String) ?: "Mapozy tracking",
        notificationBody = (config["foregroundNotificationBody"] as? String) ?: "Tracking active"
      )
      TrackingState.saveConfig(ctx, cfg)
      TrackingState.setEnabled(ctx, true)
      TrackingService.start(ctx)
    }

    AsyncFunction("stop") {
      val ctx = appContext.reactContext ?: error("No context")
      TrackingState.setEnabled(ctx, false)
      TrackingService.stop(ctx)
    }

    // Atomic re-subscribe (see TrackingService.restart). Use this instead of
    // stop()+start() — the latter races with onDestroy and leaves AR/location
    // unsubscribed.
    AsyncFunction("restart") {
      val ctx = appContext.reactContext ?: error("No context")
      TrackingState.setEnabled(ctx, true)
      TrackingService.restart(ctx)
    }

    AsyncFunction("isIgnoringBatteryOptimizations") {
      val ctx = appContext.reactContext ?: error("No context")
      val pm = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager
      pm?.isIgnoringBatteryOptimizations(ctx.packageName) ?: false
    }

    AsyncFunction("requestIgnoreBatteryOptimizations") {
      val ctx = appContext.reactContext ?: error("No context")
      val pm = ctx.getSystemService(Context.POWER_SERVICE) as? PowerManager
      if (pm?.isIgnoringBatteryOptimizations(ctx.packageName) != true) {
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
          data = Uri.parse("package:${ctx.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        ctx.startActivity(intent)
      }
    }

    // Wipe everything the app's WebViews persisted: cookies (incl. the Auth0
    // SSO session) and DOM storage (the SPA keeps its access token in
    // localStorage). Signing out of a connector only deletes OUR copy of the
    // token from the keystore; without this the web session survives on disk
    // and the next "connect" silently signs back into the same account. The
    // connector login is the only WebView in the app, so a global wipe is
    // exactly the right scope. Both APIs are process-wide and thread-safe.
    AsyncFunction("clearWebViewData") {
      CookieManager.getInstance().apply {
        removeAllCookies(null)
        flush()
      }
      WebStorage.getInstance().deleteAllData()
    }

    AsyncFunction("isTracking") {
      val ctx = appContext.reactContext ?: error("No context")
      TrackingState.isEnabled(ctx)
    }

    AsyncFunction("getStatus") {
      val ctx = appContext.reactContext ?: error("No context")
      val status = Bundle().apply {
        putBoolean("isTracking", TrackingState.isEnabled(ctx))
        putString("motionState", TrackingState.getState(ctx))
        val lastLoc = TrackingState.getLastLocation(ctx)
        if (lastLoc != null) putDouble("lastLocationAt", lastLoc.toDouble())
        val lastAct = TrackingState.getLastActivity(ctx)
        if (lastAct != null) putString("lastActivityType", lastAct)
        val lastActMs = TrackingState.getLastActivityMs(ctx)
        if (lastActMs != null) putDouble("lastActivityAt", lastActMs.toDouble())
        val lastSilenceMs = TrackingState.getLastSilenceDetectedMs(ctx)
        if (lastSilenceMs != null) putDouble("lastArSilenceDetectedAt", lastSilenceMs.toDouble())
      }
      status
    }
  }
}
