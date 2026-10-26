/**
 * Expo config plugin: makes release signing survive `expo prebuild --clean`.
 *
 * The stock Expo template signs RELEASE builds with the public debug keystore (and ships that
 * keystore). A debug-signed APK is what Play Protect / phone scanners flag. This plugin, on every prebuild:
 *   1. deletes android/app/debug.keystore (debug builds fall back to Android's own auto-generated debug key),
 *   2. replaces the signingConfigs block with a `release` config read from keystore.properties,
 *      gradle properties or environment variables (MYAPP_UPLOAD_STORE_FILE, MYAPP_UPLOAD_STORE_PASSWORD,
 *      MYAPP_UPLOAD_KEY_ALIAS, MYAPP_UPLOAD_KEY_PASSWORD),
 *   3. points the release buildType at that config, and
 *   4. makes any release build FAIL with "Release keystore not configured" if those values are missing.
 * It never falls back to the debug key and never prints a password.
 */
const fs = require('fs');
const path = require('path');
const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins');

const MARKER = '// [scamsafe] release signing';

const HELPER = `${MARKER}
def keystoreProps = new Properties()
def keystorePropsFile = rootProject.file('keystore.properties')
if (keystorePropsFile.exists()) {
    keystorePropsFile.withInputStream { keystoreProps.load(it) }
}
def signingValue = { String name ->
    def v = keystoreProps.getProperty(name) ?: findProperty(name) ?: System.getenv(name)
    return (v == null || v.toString().trim().isEmpty()) ? null : v.toString()
}
def releaseStoreFileValue = signingValue('MYAPP_UPLOAD_STORE_FILE')
def releaseStoreFile = releaseStoreFileValue == null ? null : (new File(releaseStoreFileValue).isAbsolute() ? new File(releaseStoreFileValue) : rootProject.file(releaseStoreFileValue))
def releaseSigningConfigured = releaseStoreFile != null && releaseStoreFile.exists() &&
    signingValue('MYAPP_UPLOAD_STORE_PASSWORD') != null &&
    signingValue('MYAPP_UPLOAD_KEY_ALIAS') != null &&
    signingValue('MYAPP_UPLOAD_KEY_PASSWORD') != null

// Fail ONLY when a release task is requested. Debug builds and IDE sync are not affected.
gradle.taskGraph.whenReady { graph ->
    def releaseRequested = graph.allTasks.any { it.project == project && it.name.contains('Release') }
    if (releaseRequested && !releaseSigningConfigured) {
        throw new GradleException('Release keystore not configured. Set MYAPP_UPLOAD_STORE_FILE, MYAPP_UPLOAD_STORE_PASSWORD, MYAPP_UPLOAD_KEY_ALIAS and MYAPP_UPLOAD_KEY_PASSWORD (keystore.properties in android/, ~/.gradle/gradle.properties, or environment variables). See README: "Release signing". Release builds never use the debug key.')
    }
}

`;

const SIGNING_BLOCK = `    signingConfigs {
        // No custom "debug" config: debug builds use Android's auto-generated debug key.
        release {
            if (releaseSigningConfigured) {
                storeFile releaseStoreFile
                storePassword signingValue('MYAPP_UPLOAD_STORE_PASSWORD')
                keyAlias signingValue('MYAPP_UPLOAD_KEY_ALIAS')
                keyPassword signingValue('MYAPP_UPLOAD_KEY_PASSWORD')
            }
        }
    }`;

/** Index just after the brace that closes the block whose "{" is at openIndex. */
function endOfBlock(src, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error('[withReleaseSigning] unbalanced braces in build.gradle');
}

function patchBuildGradle(src) {
  if (src.includes(MARKER)) return src; // already patched

  // 1. signingConfigs block
  const sigStart = src.search(/^\s*signingConfigs\s*\{/m);
  if (sigStart < 0) throw new Error('[withReleaseSigning] signingConfigs block not found in app/build.gradle');
  const sigOpen = src.indexOf('{', sigStart);
  const sigEnd = endOfBlock(src, sigOpen);
  src = src.slice(0, sigStart).replace(/[ \t]*$/, '') + SIGNING_BLOCK + src.slice(sigEnd);

  // 2. release buildType must use the release config
  const relMatch = src.match(/buildTypes\s*\{[\s\S]*?\n\s*release\s*\{/);
  if (!relMatch) throw new Error('[withReleaseSigning] release buildType not found in app/build.gradle');
  const relOpen = src.indexOf('{', relMatch.index + relMatch[0].length - 1);
  const relEnd = endOfBlock(src, relOpen);
  let relBlock = src.slice(relOpen, relEnd);
  relBlock = relBlock.replace(/^\s*\/\/.*(?:debug|keystore|production).*\n/gim, '');
  if (/signingConfig\s+signingConfigs\.\w+/.test(relBlock)) {
    relBlock = relBlock.replace(/signingConfig\s+signingConfigs\.\w+/, 'signingConfig signingConfigs.release');
  } else {
    relBlock = relBlock.replace('{', '{\n            signingConfig signingConfigs.release');
  }
  src = src.slice(0, relOpen) + relBlock + src.slice(relEnd);

  // 3. helper + failing guard, placed right before the android { } block
  const androidIdx = src.search(/^android\s*\{/m);
  if (androidIdx < 0) throw new Error('[withReleaseSigning] android block not found in app/build.gradle');
  return src.slice(0, androidIdx) + HELPER + src.slice(androidIdx);
}

module.exports = function withReleaseSigning(config) {
  config = withAppBuildGradle(config, cfg => {
    cfg.modResults.contents = patchBuildGradle(cfg.modResults.contents);
    return cfg;
  });
  config = withDangerousMod(config, [
    'android',
    async cfg => {
      const keystore = path.join(cfg.modRequest.platformProjectRoot, 'app', 'debug.keystore');
      if (fs.existsSync(keystore)) fs.rmSync(keystore);
      return cfg;
    }
  ]);
  return config;
};
module.exports.patchBuildGradle = patchBuildGradle;
