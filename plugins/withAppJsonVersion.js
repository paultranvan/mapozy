const { withAppBuildGradle } = require('@expo/config-plugins');

// Keeps the native Android version in lock-step with app.json, so a stale
// (gitignored) android/ project never ships a wrong version. The Expo template
// hard-codes `versionCode` / `versionName` at prebuild time; if app.json is
// later bumped (e.g. scripts/release.sh) without re-running prebuild, the local
// android/app/build.gradle drifts and a build carries the old version. This bit
// Firebase debug distribution (shipped 0.3.0 while app.json was 0.3.2).
//
// We APPEND a block that re-reads app.json at *gradle eval time* and overrides
// defaultConfig, rather than doing regex surgery on the hard-coded lines — same
// approach as withReleaseSigningConfig. app.json becomes the single source of
// truth: every build picks up the current version, prebuild or not.
const MARKER = '// --- mapozy version sync (injected by withAppJsonVersion) ---';

const SNIPPET = `

${MARKER}
def mapozyAppConfig = new groovy.json.JsonSlurper().parseText(rootProject.file('../app.json').text)
android.defaultConfig.versionName = mapozyAppConfig.expo.version
android.defaultConfig.versionCode = mapozyAppConfig.expo.android.versionCode
// --- end mapozy version sync ---
`;

module.exports = function withAppJsonVersion(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error(
        'withAppJsonVersion: expected a Groovy build.gradle, got ' +
          cfg.modResults.language
      );
    }
    if (!cfg.modResults.contents.includes(MARKER)) {
      cfg.modResults.contents += SNIPPET;
    }
    return cfg;
  });
};
