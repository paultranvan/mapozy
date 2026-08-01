const { withAppBuildGradle } = require('@expo/config-plugins');

// Optionally suffix the release applicationId (e.g. ".debug") so a test build
// installs ALONGSIDE the production app instead of overwriting it. Gated on the
// MAPOZY_APP_ID_SUFFIX env var: absent (the normal case, including real
// releases) → this plugin is a no-op. Set in CI for isolated test builds.
//
// We append to build.gradle rather than editing the template, mirroring
// withReleaseSigningConfig. applicationIdSuffix only changes the installed
// package id; the APK output path (app-release.apk) is unaffected.
const MARKER = '// --- mapozy debug app id suffix (injected by withDebugAppId) ---';

module.exports = function withDebugAppId(config) {
  const suffix = process.env.MAPOZY_APP_ID_SUFFIX;
  if (!suffix) return config;
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error(
        'withDebugAppId: expected a Groovy build.gradle, got ' +
          cfg.modResults.language
      );
    }
    if (!cfg.modResults.contents.includes(MARKER)) {
      cfg.modResults.contents += `

${MARKER}
android.buildTypes.release.applicationIdSuffix "${suffix}"
// --- end mapozy debug app id suffix ---
`;
    }
    return cfg;
  });
};
