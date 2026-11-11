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
const SUFFIX_RE = /^(\.[a-z][a-z0-9_]*)+$/;

module.exports = function withDebugAppId(config) {
  const suffix = process.env.MAPOZY_APP_ID_SUFFIX;
  if (!suffix) return config;
  // The suffix is spliced into build.gradle, i.e. into executable Groovy. It
  // comes from an environment variable (a CI workflow input), so anything but
  // a plain applicationId suffix — `.debug`, `.qa.two` — is refused rather
  // than escaped: `"; <groovy> //` here would run on the build machine, next
  // to the release keystore.
  if (!SUFFIX_RE.test(suffix)) {
    throw new Error(
      'withDebugAppId: MAPOZY_APP_ID_SUFFIX must be a dot-prefixed applicationId ' +
        'suffix such as ".debug" (lowercase letters, digits, underscores).'
    );
  }
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
