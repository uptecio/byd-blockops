import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const run = promisify(execFile);
// Migration checks may explicitly verify the retained baseline, never infer
// expected metadata from the artifact being tested.
const baseline = process.env.ANDROID_PACKAGE_BASELINE === '1';
const release = process.env.ANDROID_PACKAGE_RELEASE;
assert.ok(release === undefined || release === 'solo-powers', 'Unknown ANDROID_PACKAGE_RELEASE');
assert.ok(!(baseline && release !== undefined), 'Conflicting package selectors');
const powers = release === 'solo-powers';
const apk = resolve(process.env.ANDROID_APK_PATH || (powers ? 'artifacts/block-ops-v0.9.1-solo-powers.apk' : baseline ? 'artifacts/block-ops-v0.8.0-rooftops-hiding.apk' : 'artifacts/block-ops-v0.9.0-tall-roofs.apk'));
const dist = resolve(process.env.DIST_DIR || 'dist');
const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || `${process.env.HOME}/Android/Sdk`;
const versions = (await readdir(join(sdk, 'build-tools'))).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
let buildTools;
for (const version of versions) {
  const directory = join(sdk, 'build-tools', version);
  try { await access(join(directory, 'aapt')); await access(join(directory, 'apksigner')); buildTools = directory; break; } catch {}
}
assert.ok(buildTools, 'SDK aapt and apksigner must be available');
const { stdout: badging } = await run(join(buildTools, 'aapt'), ['dump', 'badging', apk]);

// Catches accidentally packaging the previous release or changing its Android compatibility.
test('APK metadata identifies the explicitly selected release', () => {
  assert.match(badging, /package: name='au\.local\.blockops'/);
  assert.match(badging, powers ? /versionCode='12'/ : baseline ? /versionCode='10'/ : /versionCode='11'/);
  assert.match(badging, powers ? /versionName='0\.9\.1'/ : baseline ? /versionName='0\.8\.0'/ : /versionName='0\.9\.0'/);
  assert.match(badging, /sdkVersion:'26'/);
  assert.match(badging, /targetSdkVersion:'36'/);
  assert.deepEqual([...badging.matchAll(/^uses-permission: name='([^']+)'/gm)].map(match => match[1]), ['android.permission.INTERNET']);
  assert.doesNotMatch(badging, /^native-code:/m, 'APK remains independent of CPU architecture');
});

test('APK retains the existing release signer', async () => {
  const { stdout } = await run(join(buildTools, 'apksigner'), ['verify', '--verbose', '--print-certs', apk]);
  assert.match(stdout, /^Verifies\r?$/m);
  assert.match(stdout, /Signer #1 certificate DN: .*CN=Android Debug/);
  assert.match(stdout, /Signer #1 certificate SHA-256 digest: 6b2d84eb4133168fec0850ed710acffa01d8399b75c8410621b2d0ce9881cb49/);
});

test('APK bundles the exact reviewed offline assets', async () => {
  for (const name of ['index.html', 'game.js', 'styles.css', 'THREE-LICENSE.txt']) {
    const expected = await readFile(join(dist, name));
    assert.ok(expected.length > 0, `${name} must not be empty`);
    const { stdout } = await run('unzip', ['-p', apk, `assets/${name}`], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
    assert.deepEqual(stdout, expected, `${name} bundled bytes must match the tested DIST_DIR`);
    if(name==='index.html')assert.match(stdout.toString(),powers ? /v0\.9\.1 SOLO POWERS/ : baseline ? /v0\.8\.0 ROOFTOPS \+ HIDING/ : /v0\.9\.0 TALL ROOFS/,'visible release label matches package');
  }
});

console.log(`APK SHA-256: ${createHash('sha256').update(await readFile(apk)).digest('hex')}`);
