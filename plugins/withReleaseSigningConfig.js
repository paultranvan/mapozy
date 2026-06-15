const { withAppBuildGradle } = require('@expo/config-plugins');

// Re-injects the release signing config after every `expo prebuild`, so the
// signed release build is reproducible both locally and in CI. Without this,
// `prebuild` regenerates android/app/build.gradle from the Expo template
// (debug signing only) and the release signing config is lost.
//
// We APPEND a block at the end of build.gradle that reconfigures
// `android.signingConfigs.release` after the `android { }` block has run,
// rather than doing fragile regex surgery on the template. It reads the same
// android/keystore.properties used for local builds, and is a no-op when that
// file is absent (so unsigned/debug prebuilds still work).
const MARKER = '// --- mapozy release signing (injected by withReleaseSigningConfig) ---';

const SNIPPET = `

${MARKER}
def mapozyKeystorePropsFile = rootProject.file('keystore.properties')
if (mapozyKeystorePropsFile.exists()) {
    def mapozyKeystoreProps = new Properties()
    mapozyKeystoreProps.load(new FileInputStream(mapozyKeystorePropsFile))
    android.signingConfigs {
        release {
            storeFile file(mapozyKeystoreProps['storeFile'])
            storePassword mapozyKeystoreProps['storePassword']
            keyAlias mapozyKeystoreProps['keyAlias']
            keyPassword mapozyKeystoreProps['keyPassword']
        }
    }
    android.buildTypes.release.signingConfig android.signingConfigs.release
}
// --- end mapozy release signing ---
`;

module.exports = function withReleaseSigningConfig(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error(
        'withReleaseSigningConfig: expected a Groovy build.gradle, got ' +
          cfg.modResults.language
      );
    }
    if (!cfg.modResults.contents.includes(MARKER)) {
      cfg.modResults.contents += SNIPPET;
    }
    return cfg;
  });
};
