// Rule consumed here: RULE_NATIVE_ACCURACY_FILTER (see TrackingRules.kt).
package expo.modules.mapozytracker

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.util.Log
import java.io.File

/**
 * Writes raw GPS points and activity events directly to the app's SQLite DB
 * from native code, so we don't depend on the JS bridge being alive for
 * persistence. The JS side opens the same file via expo-sqlite, which is a
 * different SQLite library — two different SQLite implementations writing
 * the same file in WAL mode caused page/header drift and physical corruption
 * (file truncated 2 pages short of what the header claimed). Both sides now
 * use rollback-journal mode (TRUNCATE), whose plain file locking is honored
 * identically by both libraries.
 */
object NativeStore {

  private val lock = Any()
  @Volatile private var db: SQLiteDatabase? = null

  private fun open(context: Context): SQLiteDatabase? {
    synchronized(lock) {
      val cur = db
      if (cur != null && cur.isOpen) return cur
      return try {
        val path = File(context.filesDir, "SQLite/mapozy.db").absolutePath
        val opened = SQLiteDatabase.openDatabase(
          path, null,
          SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.NO_LOCALIZED_COLLATORS
        )
        opened.disableWriteAheadLogging()
        opened.execSQL("PRAGMA journal_mode = TRUNCATE")
        db = opened
        opened
      } catch (e: Exception) {
        Log.w("mapozy", "NativeStore.open failed (schema may not exist yet): $e")
        null
      }
    }
  }

  fun insertActivity(context: Context, timestampMs: Long, type: String, confidence: Int) {
    val d = open(context) ?: return
    val cv = ContentValues().apply {
      put("timestamp_ms", timestampMs)
      put("type", type)
      put("confidence", confidence)
      put("consumed", 0)
    }
    try {
      d.insertOrThrow("raw_activities", null, cv)
    } catch (e: Exception) {
      Log.w("mapozy", "NativeStore.insertActivity failed: $e")
    }
  }

  /**
   * Append a structured diagnostic event. Schema lives in
   * src/db/migrations.ts (MIGRATION_002) — JS owns the migration; native
   * just trusts the table exists by the time it writes. Failures are
   * swallowed; diagnostics must never break tracking.
   */
  fun insertDiagnostic(
    context: Context,
    timestampMs: Long,
    eventType: String,
    payloadJson: String?
  ) {
    val d = open(context) ?: return
    val cv = ContentValues().apply {
      put("timestamp_ms", timestampMs)
      put("event_type", eventType)
      if (payloadJson != null) put("payload", payloadJson) else putNull("payload")
    }
    try {
      d.insertOrThrow("tracker_diagnostics", null, cv)
    } catch (e: Exception) {
      Log.w("mapozy", "NativeStore.insertDiagnostic failed: $e")
    }
  }

  /**
   * RULE_DIAGNOSTICS_RETENTION — delete diagnostic rows older than the cutoff.
   * Called on service start and on each watchdog fire. Failures swallowed.
   */
  fun pruneDiagnostics(context: Context, olderThanMs: Long) {
    val d = open(context) ?: return
    try {
      d.delete("tracker_diagnostics", "timestamp_ms < ?", arrayOf(olderThanMs.toString()))
    } catch (e: Exception) {
      Log.w("mapozy", "NativeStore.pruneDiagnostics failed: $e")
    }
  }

  fun insertLocation(
    context: Context,
    timestampMs: Long,
    latitude: Double,
    longitude: Double,
    altitude: Double?,
    accuracyMeters: Float,
    speedMps: Float?,
    bearingDeg: Float?,
    batteryLevel: Double?,
    isCharging: Boolean
  ) {
    // RULE_NATIVE_ACCURACY_FILTER
    if (accuracyMeters > TrackingRules.MAX_INSERT_ACCURACY_M) return
    val d = open(context) ?: return
    val cv = ContentValues().apply {
      put("timestamp_ms", timestampMs)
      put("latitude", latitude)
      put("longitude", longitude)
      if (altitude != null) put("altitude", altitude) else putNull("altitude")
      put("accuracy_m", accuracyMeters.toDouble())
      if (speedMps != null) put("speed_mps", speedMps.toDouble()) else putNull("speed_mps")
      if (bearingDeg != null) put("bearing_deg", bearingDeg.toDouble()) else putNull("bearing_deg")
      if (batteryLevel != null) put("battery_level", batteryLevel) else putNull("battery_level")
      put("is_charging", if (isCharging) 1 else 0)
      put("consumed", 0)
    }
    try {
      d.insertOrThrow("raw_points", null, cv)
    } catch (e: Exception) {
      Log.w("mapozy", "NativeStore.insertLocation failed: $e")
    }
  }
}
