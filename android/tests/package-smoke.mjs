import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';

const run = promisify(execFile);
const apk = resolve(process.env.ANDROID_APK_PATH || 'artifacts/block-ops-v0.5.1-zombies.apk');
const dist = resolve(process.env.DIST_DIR || 'artifacts/zombie-damage-review/dist');
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
test('zombie APK metadata identifies the new test build', () => {
  assert.match(badging, /package: name='au\.local\.blockops'/);
  assert.match(badging, /versionCode='7'/);
  assert.match(badging, /versionName='0\.5\.1'/);
  assert.match(badging, /sdkVersion:'26'/);
  assert.match(badging, /targetSdkVersion:'36'/);
  assert.deepEqual([...badging.matchAll(/^uses-permission: name='([^']+)'/gm)].map(match => match[1]), ['android.permission.INTERNET']);
  assert.doesNotMatch(badging, /^native-code:/m, 'APK remains independent of CPU architecture');
});

test('zombie APK retains valid Android debug signing', async () => {
  const { stdout } = await run(join(buildTools, 'apksigner'), ['verify', '--verbose', '--print-certs', apk]);
  assert.match(stdout, /^Verifies\r?$/m);
  assert.match(stdout, /Signer #1 certificate DN: .*CN=Android Debug/);
});

test('zombie APK bundles the exact reviewed offline assets', async () => {
  for (const name of ['index.html', 'game.js', 'styles.css', 'THREE-LICENSE.txt']) {
    const expected = await readFile(join(dist, name));
    assert.ok(expected.length > 0, `${name} must not be empty`);
    const { stdout } = await run('unzip', ['-p', apk, `assets/${name}`], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
    assert.deepEqual(stdout, expected, `${name} bundled bytes must match the tested DIST_DIR`);
  }
});

console.log(`APK SHA-256: ${createHash('sha256').update(await readFile(apk)).digest('hex')}`);
