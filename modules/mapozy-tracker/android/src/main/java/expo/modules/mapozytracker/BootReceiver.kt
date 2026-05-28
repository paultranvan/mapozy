package expo.modules.mapozytracker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class BootReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    val a = intent.action ?: return
    if (a != Intent.ACTION_BOOT_COMPLETED &&
        a != "android.intent.action.LOCKED_BOOT_COMPLETED" &&
        a != "android.intent.action.QUICKBOOT_POWERON") {
      return
    }
    NativeStore.insertDiagnostic(context, System.currentTimeMillis(), "boot", null)
    if (TrackingState.isEnabled(context)) {
      Log.i("mapozy", "BootReceiver: tracking was enabled, restarting service")
      TrackingService.start(context)
    } else {
      Log.i("mapozy", "BootReceiver: tracking disabled, doing nothing")
    }
  }
}
