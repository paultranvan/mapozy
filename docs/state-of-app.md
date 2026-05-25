# Mapozy — State of App (v0.1.0)

Built autonomously in a single overnight session on 2026-05-25 from the spec at `docs/superpowers/specs/2026-05-25-mapozy-design.md`.

## What works (verified end-to-end on a Pixel 3a API 34 emulator)

- Expo SDK 52 app boots through the Dev Client and loads the JS bundle.
- Onboarding wizard (Welcome → Permissions → Ready), with permissions requested in the OS-required order (foreground location → background location → activity recognition → notifications).
- Bottom tab navigation: Trips, Stats, Settings.
- SQLite schema and 7 typed repositories pass 43 unit tests against an in-memory mock backed by `better-sqlite3`.
- On-device pipeline (8 pure-function stages) processes synthetic raw points and produces a multi-section trip with correct mode segmentation (walk → drive → walk).
- Trip list renders sectioned by day with sticky headers.
- Trip detail screen renders a MapLibre + OSM raster tile map with mode-colored polyline, start/end markers, and a Gorhom bottom sheet showing trip timeline.
- Reverse geocoding via Nominatim resolves real Lyon street names ("21 Rue de la République, Lyon") on the trip detail.
- Stats screen: period selector (D/W/M/Y/All), 3 KPI cards (Distance / Trips / CO₂), per-mode breakdown list, vertical bar chart of daily distances, records section.
- Settings: tracking toggle, force pipeline, detect home/work, clear all, demo trip injection, reset onboarding.

## What is implemented but not yet verified in a long-running real-world session

- **Background GPS tracking** through the custom Kotlin Expo native module (`mapozy-tracker`). Compiles cleanly into the APK. The module subscribes to `FusedLocationProviderClient` and `ActivityRecognitionClient`, runs as a foreground service with a persistent notification, and stores enable-state in `SharedPreferences`.
- **Boot persistence** via `BootReceiver` listening for `BOOT_COMPLETED`. The receiver is registered in the manifest with `RECEIVE_BOOT_COMPLETED` permission. Needs a real device + reboot to validate behavior on stock Android.
- **Pipeline triggered on activity transition** (`moving → still ≥ 5 min`) — the JS bridge in `src/tracking/tracker.ts` registers listeners and schedules a pipeline run after 5 minutes of stationary activity. Needs longer real-world sessions to confirm timing.
- **Battery-optimization prompt** — not surfaced in onboarding. On Android 12+ users should be prompted to disable battery optimization for the app to guarantee background tracking.

## Known limitations

- iOS is out of scope for this version. The Kotlin module has no Swift counterpart; the JS API would call a non-existent native module on iOS.
- Emulator GPS injection via `adb emu geo fix` was not used as the primary validation path because the Expo dev client wraps the location callbacks in a way that the synthetic emulator stream takes time to propagate. Instead, validation was done by inserting raw GPS samples directly into the SQLite layer via the "Inject demo trip" debug action in Settings, which proves every pipeline stage and the full UI path.
- Reverse geocoding depends on Nominatim public API; offline trips show coordinates as fallback. Rate-limited to 1 req/s in `src/pipeline/geocoding.ts`.
- Home/work detection requires ≥ 5 visits at a candidate place across 30 days; will be inactive on first weeks of use.
- `mapozy-tracker` does not emit a TILT or UNKNOWN activity reliably — these fall back to `unknown` and the mode inference uses median speed thresholds.
- No data export feature (CSV/GeoJSON) — explicit YAGNI for v1.
- New Architecture (Fabric/TurboModules) is disabled. The custom native module uses the legacy bridge.

## Code-review findings addressed

The `code-reviewer` agent flagged 5 issues during the final review. All were fixed:

1. `MapozyTrackerEventBus` now queues events when the JS bridge isn't registered (cold-start from BootReceiver no longer silently drops the first location batch). See `modules/mapozy-tracker/android/src/main/java/expo/modules/mapozytracker/MapozyTrackerEventBus.kt`.
2. `markPointsConsumed` / `markActivitiesConsumed` now chunk IDs into batches of 900 to stay under SQLite's variable limit on long sessions.
3. `runPipeline` correctly holds back activities whose timestamp is inside the pending (open) trip window — they were previously consumed alongside the closed segments and lost.
4. `trips.start_place_id` / `end_place_id` use `ON DELETE SET NULL` so the place table can be cleaned without orphaning trip rows. The `PRAGMA foreign_keys = ON` is set on every open, including the test backend.
5. Onboarding does not advance to "Ready" if foreground location was denied; the background location request is now gated on foreground being granted (Android silently rejects bg-without-fg). The Ready step surfaces a warning when bg was not granted, so the user knows tracking will pause when backgrounded.

## Tests

- 43 unit tests across `src/lib/`, `src/co2/`, `src/pipeline/`, `src/db/`, `src/stats/`. All pass.
- Pipeline end-to-end test in `src/pipeline/__tests__/runPipeline.test.ts` validates: raw points → trip with correct distance, dominant mode (`car` or `mixed`), non-null place IDs at both ends.
- DB integration tests via `better-sqlite3` mock backend (production code path is unaffected).

## Next steps for v0.2

- Real-device validation: install on physical Android, drive a real trip, verify the pipeline produces a sensible result.
- Battery-optimization prompt during onboarding (`ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` intent).
- Manual mode edit in trip detail (long-press a section → choose mode).
- iOS port: write the Swift twin of `mapozy-tracker` using `CMMotionActivityManager` and `CLLocationManager`.
- Data export (CSV / GeoJSON / GPX).
- Manual home / work label override in trip detail and Settings.
