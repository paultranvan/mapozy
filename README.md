# Mapozy

Android-first GPS tracking and trip visualization app. Fully on-device: no server, no account, no cloud sync. Records your movements in the background, segments them into trips, and shows distance / mode / CO₂ stats.

Built with Expo SDK 52, React Native 0.76, MapLibre, SQLite, and a custom Kotlin Expo native module for background tracking.

See [`docs/state-of-app.md`](docs/state-of-app.md) for the current feature status.

## Requirements

- **Node.js** 20+ and npm
- **JDK 17** (required by the Android Gradle plugin used by RN 0.76)
- **Android SDK** with platform 34 and build-tools 35.0.0
  - Easiest path: install Android Studio, then accept SDK licenses with `sdkmanager --licenses`
- `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) exported in your shell
- A physical Android device with USB debugging enabled, **or** an emulator running API 34+

iOS is out of scope for this version — the native tracking module is Android-only.

## Install

```bash
git clone <repo-url> mapozy
cd mapozy
npm install
```

The `android/` directory is gitignored; it is regenerated from `app.json` and the custom module on demand:

```bash
npm run prebuild
```

This runs `expo prebuild --platform android` and produces a native Android project that bundles the `mapozy-tracker` Kotlin module.

## Run on a device or emulator

Plug in a device (or start an emulator) and run:

```bash
npm run android
```

The first run compiles the APK, installs it, starts the Expo dev client, and opens the JS bundler. Subsequent JS-only changes reload automatically — no rebuild needed unless you touch native code (anything under `modules/mapozy-tracker/android/` or `app.json` plugins/permissions).

To re-attach the Metro bundler without rebuilding the APK:

```bash
npm start
```

### Granting permissions

On first launch the onboarding wizard requests permissions in the required order:

1. Foreground location (fine)
2. Background location
3. Activity recognition
4. Notifications (Android 13+)

Background location **cannot** be granted before foreground location — the wizard enforces this. If you skip background location, tracking will pause whenever the app is backgrounded.

For reliable long-running background tracking on Android 12+, also disable battery optimization for Mapozy manually in system settings (Settings → Apps → Mapozy → Battery → Unrestricted). The in-app prompt for this is on the v0.2 roadmap.

## Project layout

```
app/                    Expo Router screens (onboarding, tabs, trip detail)
src/
  db/                   SQLite schema + 7 typed repositories
  pipeline/             8-stage pure-function trip extraction pipeline
  tracking/             JS bridge to the native module
  stats/, co2/, lib/    Derived stats, CO₂ estimates, shared utils
  queries/              React Query hooks
  ui/, theme/           Components and design tokens
modules/mapozy-tracker/ Custom Kotlin Expo module
  android/src/main/java/expo/modules/mapozytracker/
                        FusedLocation + ActivityRecognition + foreground service
docs/                   Project state and design notes
```

## Scripts

| Command              | Purpose                                              |
|----------------------|------------------------------------------------------|
| `npm start`          | Start Metro / Expo dev server (dev client mode)      |
| `npm run android`    | Build, install, and launch on a connected device     |
| `npm run prebuild`   | Regenerate the `android/` native project             |
| `npm test`           | Run Jest (43 unit tests across db / pipeline / stats)|
| `npm run test:watch` | Jest in watch mode                                   |
| `npm run typecheck`  | `tsc --noEmit`                                       |
| `npm run lint`       | `expo lint`                                          |

## Troubleshooting

- **`SDK location not found`** — set `ANDROID_HOME=$HOME/Android/Sdk` (or wherever your SDK lives) and re-source your shell config.
- **Gradle complains about JDK version** — confirm `java -version` is 17. On Linux: `sudo update-alternatives --config java`.
- **`mapozy-tracker` not found at runtime** — you skipped or interrupted `npm run prebuild`. Delete `android/` and re-run it.
- **Background location denied silently** — Android requires foreground location to be granted *first*. Reset onboarding from Settings → "Reset onboarding" and accept in order.
- **No trip appears after walking around** — the pipeline only runs after 5 minutes of stationary activity. Use Settings → "Force pipeline" to trigger it manually, or "Inject demo trip" to seed sample data.

## Privacy

All data — GPS samples, activity classifications, derived trips, geocoded place names — lives in a single SQLite database on the device (`expo-sqlite`). Reverse geocoding uses the public Nominatim API and is the only outbound network call; trips without network connectivity fall back to coordinate strings. There is no analytics, no telemetry, and no account system.
