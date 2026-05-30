package expo.modules.mapozytracker

import android.os.Bundle
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * Decouples the Service/Receiver from the JS bridge. The module sets the
 * emitter when it is created; native components push events through this
 * bus and the module forwards them to JavaScript.
 *
 * Events emitted before the JS bridge is up (cold start from the BootReceiver
 * or when the app is closed when the service fires) are queued and flushed
 * when the emitter is registered.
 */
object MapozyTrackerEventBus {
  private const val MAX_QUEUE = 512

  @Volatile private var emitterRef: ((String, Bundle) -> Unit)? = null
  private val queue = ConcurrentLinkedQueue<Pair<String, Bundle>>()
  private val lock = Any()

  fun registerEmitter(fn: (String, Bundle) -> Unit) {
    synchronized(lock) {
      emitterRef = fn
      // Drain pending events to the new emitter.
      while (true) {
        val pending = queue.poll() ?: break
        try {
          fn(pending.first, pending.second)
        } catch (_: Throwable) {
          // ignore — JS side might still be initializing
        }
      }
    }
  }

  fun unregisterEmitter() {
    synchronized(lock) {
      emitterRef = null
    }
  }

  fun emitLocation(b: Bundle) {
    emit("onLocation", b)
  }

  fun emitActivity(b: Bundle) {
    emit("onActivity", b)
  }

  // Fires once per MOVING → STATIONARY transition (after STOP_TIMEOUT_MS of
  // confirmed stillness). Used by JS to drain the pipeline at trip end so
  // trips appear without waiting for the user to re-foreground the app.
  // Queued like the others if JS is dead, so a cold start still gets it.
  fun emitStationary(b: Bundle) {
    emit("onStationary", b)
  }

  private fun emit(name: String, payload: Bundle) {
    val fn = emitterRef
    if (fn != null) {
      try {
        fn(name, payload)
      } catch (_: Throwable) {
        // Safe-fail; do not crash the foreground service.
      }
    } else {
      // No JS bridge yet — queue for later. Drop oldest if we hit the cap.
      while (queue.size >= MAX_QUEUE) queue.poll()
      queue.offer(name to payload)
    }
  }
}
