import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

// Run the real packaging validator against the inspected retained code11 APK.
// Ignoring the selector must fail this test; missing SDK/artifacts do not count
// as the expected version/selection rejection.
const env={...process.env,ANDROID_APK_PATH:resolve('artifacts/block-ops-v0.9.0-tall-roofs.apk'),
  DIST_DIR:resolve('artifacts/tall-roofs-cpsDYg/reviewed-dist')};
delete env.ANDROID_PACKAGE_RELEASE;delete env.ANDROID_PACKAGE_BASELINE;
for(const [selection,pattern] of [
  [{ANDROID_PACKAGE_RELEASE:'unknown-release'},/Unknown ANDROID_PACKAGE_RELEASE/],
  [{ANDROID_PACKAGE_RELEASE:'solo-powers',ANDROID_PACKAGE_BASELINE:'1'},/Conflicting package selectors/],
  [{ANDROID_PACKAGE_RELEASE:'solo-powers'},/versionCode='12'|versionName='0\\?\.9\\?\.1'/],
]) {
  const result=spawnSync(process.execPath,['android/tests/package-smoke.mjs'],{env:{...env,...selection},encoding:'utf8'});
  assert.notEqual(result.status,0,'explicit release selection must not silently validate code11 as solo powers');
  assert.match(result.stdout+result.stderr,pattern,'failure must identify the intended selector/version mismatch');
}
console.log('PASS explicit unknown/conflicting selector rejection and old APK rejected as solo powers');
