package expo.modules.mapozytracker

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.ReactHost
import com.facebook.react.bridge.Arguments
import com.facebook.react.config.ReactFeatureFlags
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * Boots the React Native runtime (if the OS killed the app process) and runs
 * the JS `MapozyPipeline` headless task — trip segmentation right at trip end,
 * without any UI. Started by TrackingService at each MOVING→STATIONARY
 * transition.
 *
 * allowedInForeground = true: when the app IS visible, the event-bus
 * onStationary listener also fires the pipeline; the two runs share one Db
 * instance and are serialized into a chain (second run consumes nothing), so a
 * double fire is a no-op rather than a duplicate-trip race — while `false`
 * here would hard-crash with IllegalStateException whenever the transition
 * happens with the app open.
 */
class PipelineHeadlessTaskService : HeadlessJsTaskService() {
  // HeadlessJsTaskService picks the BRIDGELESS boot path whenever
  // getReactHost() is non-null — and Expo's generated MainApplication
  // provides a ReactHost even with newArchEnabled=false. Booting bridgeless
  // against our old-arch bundle dies with "PlatformConstants could not be
  // found" (emulator-verified 2026-07-19). Only hand the host out when
  // bridgeless is genuinely on, mirroring the flag RN itself checks.
  override fun getReactHost(): ReactHost? =
    if (ReactFeatureFlags.enableBridgelessArchitecture) super.getReactHost() else null

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    HeadlessJsTaskConfig(
      TASK_KEY,
      Arguments.createMap(),
      TASK_TIMEOUT_MS,
      true,
    )

  companion object {
    // Must match HEADLESS_PIPELINE_TASK in src/tracking/headlessPipelineTask.ts.
    const val TASK_KEY = "MapozyPipeline"

    // Segmentation is local SQLite work (seconds); the margin covers a cold
    // JS-runtime boot plus a multi-day backlog.
    const val TASK_TIMEOUT_MS = 120_000L
  }
}
