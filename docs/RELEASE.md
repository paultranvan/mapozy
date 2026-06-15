# Releasing to testers (Firebase App Distribution)

Testers receive builds through the **Firebase App Tester** app on their phones.
A signed release APK is built and distributed automatically by GitHub Actions.

## How a release works

Use the release script — it bumps `app.json` (`version` + `versionCode`),
commits, tags, and pushes in one shot:

```bash
npm run release           # patch bump: 0.3.0 -> 0.3.1
npm run release -- minor  # 0.3.0 -> 0.4.0
npm run release -- major  # 0.3.0 -> 1.0.0
npm run release -- 0.5.2  # explicit version
npm run release -- patch -y   # skip the confirmation prompt
```

The script refuses to run unless the tree is clean and `main` is up to date
with origin, and it auto-increments `versionCode` so you can never ship a
duplicate. Pushing the `vX.Y.Z` tag triggers CI.

> Doing it by hand instead? Bump `expo.version` **and** `expo.android.versionCode`
> (must increase) in `app.json`, then `git commit`, `git tag vX.Y.Z`, `git push --tags`.

Once the tag lands, the **Distribute to Firebase App Distribution** workflow runs: it regenerates
   the native project (`expo prebuild`), restores the signing keystore from
   secrets, builds `assembleRelease`, and uploads the APK to the `testers` group.
   Testers get a notification in the App Tester app.

Release notes default to the latest commit subject. You can also trigger a build
manually from the **Actions** tab (workflow_dispatch) and type custom notes.

## Firebase project

| Item            | Value                                              |
| --------------- | -------------------------------------------------- |
| Project ID      | `mapozy-app`                                        |
| Android App ID  | `1:736958471752:android:dd125d6adef895b482c27d`     |
| Tester group    | `testers`                                           |
| Console         | https://console.firebase.google.com/project/mapozy-app/appdistribution |

The App ID and group alias are hardcoded in `.github/workflows/distribute.yml`.

### Managing testers

```bash
# add a tester to the group (they get an email invite to install App Tester)
firebase appdistribution:testers:add someone@example.com --group-alias testers --project mapozy-app

# remove
firebase appdistribution:testers:remove someone@example.com --group-alias testers --project mapozy-app
```

## Required GitHub secrets

Set on the repo (`Settings → Secrets and variables → Actions`). All four
keystore secrets are already set; **`FIREBASE_TOKEN` is the only one you must
add manually** (see below).

| Secret                      | Source                                            |
| --------------------------- | ------------------------------------------------- |
| `ANDROID_KEYSTORE_BASE64`   | `base64 -w0 android/app/mapozy-release.keystore`  |
| `ANDROID_KEYSTORE_PASSWORD` | store password from `android/keystore.properties` |
| `ANDROID_KEY_ALIAS`         | key alias from `android/keystore.properties`      |
| `ANDROID_KEY_PASSWORD`      | key password from `android/keystore.properties`   |
| `FIREBASE_TOKEN`            | `firebase login:ci` (see below)                   |

### Getting `FIREBASE_TOKEN`

```bash
firebase login:ci
# Opens a browser, then prints: "✔  Success! Use this token to login on a CI server:"
# Copy the token, then:
gh secret set FIREBASE_TOKEN --repo paultranvan/mapozy --body '<paste-token>'
```

> Note: `FIREBASE_TOKEN` (CI token) still works but Google is gradually steering
> CI auth toward service accounts. If a future firebase-tools drops it, switch
> to a service-account JSON: create a key in the Firebase console
> (`Project settings → Service accounts → Generate new private key`), store it as
> a secret, write it to a file in CI, set `GOOGLE_APPLICATION_CREDENTIALS` to that
> path, and drop the `--token` flag from the distribute step.

## Signing config & prebuild

`android/` is gitignored (Expo CNG), so CI regenerates it with `expo prebuild`.
The release signing config is re-injected on every prebuild by the config plugin
**`plugins/withReleaseSigningConfig.js`** (registered in `app.json`). It reads
`android/keystore.properties` — the same file used locally. This also means a
local `expo prebuild --clean` no longer wipes your signing setup.

## Distribute a build manually (without CI)

```bash
cd android && ./gradlew assembleRelease
firebase appdistribution:distribute \
  app/build/outputs/apk/release/app-release.apk \
  --app 1:736958471752:android:dd125d6adef895b482c27d \
  --groups testers \
  --release-notes "manual build" \
  --project mapozy-app
```
