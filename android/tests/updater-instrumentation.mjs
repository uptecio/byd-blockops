import { spawnSync } from 'node:child_process';
import { access, copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const suite = process.argv[2];
if (!['installer', 'controller'].includes(suite)) throw new Error('Expected installer or controller suite');
for (const key of ['ANDROID_TEST_SERIAL', 'ANDROID_TEST_AVD', 'ANDROID_TEST_ARTIFACTS']) {
  if (!process.env[key]) throw new Error(`Explicit ${key} is required`);
}
const serial = process.env.ANDROID_TEST_SERIAL;
const avd = process.env.ANDROID_TEST_AVD;
if (serial !== 'emulator-5580' || avd !== 'bydgame_updater_api36') {
  throw new Error('Only the owned API36 updater emulator is supported');
}
const artifacts = resolve(process.env.ANDROID_TEST_ARTIFACTS);
if (!artifacts.startsWith(join(root, 'artifacts') + sep)) throw new Error('Artifacts must be inside this worktree/artifacts');
await mkdir(artifacts, { recursive: true });
if (!(await realpath(artifacts)).startsWith((await realpath(join(root, 'artifacts'))) + sep)) {
  throw new Error('Artifacts may not escape through a symlink');
}
const adb = process.env.ADB_BINARY || '/usr/bin/adb';
const sdk = process.env.ANDROID_BUILD_SDK || '/home/alex/Android/Sdk';
const gradle = process.env.GRADLE_BINARY || '/home/alex/.gradle/wrapper/dists/gradle-8.14.3-bin/cv11ve7ro1n3o1j4so8xd9n66/gradle-8.14.3/bin/gradle';
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 300_000,
    maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
function identity() {
  const name = run(adb, ['-s', serial, 'emu', 'avd', 'name']).replace(/\r/g, '').split('\n')[0];
  const api = run(adb, ['-s', serial, 'shell', 'getprop', 'ro.build.version.sdk']).trim();
  const boot = run(adb, ['-s', serial, 'shell', 'getprop', 'sys.boot_completed']).trim();
  if (name !== avd || api !== '36' || boot !== '1') throw new Error(`Owned device identity mismatch: ${name}, API ${api}, boot ${boot}`);
  return { serial, avd: name, api, fingerprint: run(adb, ['-s', serial, 'shell', 'getprop', 'ro.build.fingerprint']).trim() };
}
function mutate(args) {
  identity(); // Recheck actual identity immediately before every device mutation.
  return run(adb, ['-s', serial, ...args]);
}
const device = identity();
const fixture = process.env.ANDROID_TEST_APK_FIXTURE;
if (!fixture) throw new Error('ANDROID_TEST_APK_FIXTURE must identify the known baseline APK');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fixtureHash = hash(await readFile(fixture));
if (fixtureHash !== 'e208ef6fd6fdefb0cc6ea1e49eb31d4e0deff2956f3299252e86c51ae7a6385b') {
  throw new Error('Baseline fixture hash mismatch');
}
const testAssets = join(root, 'android/app/build/updater-test-assets');
await mkdir(testAssets, { recursive: true });
await copyFile(fixture, join(testAssets, 'baseline.apk'));
const signingHome = join(homedir(), '.android');
const signingKey = join(signingHome, 'debug.keystore');
await access(signingKey); // Never let Gradle generate a replacement key.
const certificate = run('keytool', ['-list', '-v', '-keystore', signingKey, '-alias', 'androiddebugkey', '-storepass', 'android']);
if (!certificate.replace(/:/g, '').toLowerCase().includes('6b2d84eb4133168fec0850ed710acffa01d8399b75c8410621b2d0ce9881cb49')) {
  throw new Error('Existing signing key does not match the original signer');
}
const env = { ...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, ANDROID_USER_HOME: signingHome };
const build = run(gradle, ['-p', join(root, 'android'), '--console=plain', ':app:assembleDebug', ':app:assembleDebugAndroidTest'], { env });
await writeFile(join(artifacts, 'build.log'), build);
const target = join(artifacts, 'target.apk');
const test = join(artifacts, 'instrumentation.apk');
await copyFile(join(root, 'android/app/build/outputs/apk/debug/app-debug.apk'), target);
await copyFile(join(root, 'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'), test);
const signing = run(join(sdk, 'build-tools/36.0.0/apksigner'), ['verify', '--print-certs', target]);
if (!signing.includes('6b2d84eb4133168fec0850ed710acffa01d8399b75c8410621b2d0ce9881cb49')) {
  throw new Error('Target signer mismatch');
}
await writeFile(join(artifacts, 'identity.json'), JSON.stringify({ ...device, fixtureHash,
  targetSha256: hash(await readFile(target)), testSha256: hash(await readFile(test)) }, null, 2));
process.stdout.write(mutate(['install', '-r', target]));
process.stdout.write(mutate(['install', '-r', '-t', test]));
const output = mutate(['shell', 'am', 'instrument', '-w', '-r', '-e', 'suite', suite,
  'au.local.blockops.test/au.local.blockops.updates.UpdaterInstrumentation']);
await writeFile(join(artifacts, 'instrumentation.log'), output);
process.stdout.write(output);
const names = ['parseGithubJson', 'parseActualApk', 'permissionRequiresSecondTap', 'wrongSessionIgnored',
  'pendingActionForegroundOnly', 'restartDoesNotRecommit', 'cancelOnlyOwnedSession', 'sessionRemovalTiming',
  'delayedSessionRemoval', 'removalCallbacksRemainResponsive', 'realOwnedSessions'];
if (suite === 'controller') names.push('discoverOwnedSession', 'durablePreferences', 'nativeDialog', 'applicationLifecycle');
if (output.includes('FAIL ') || !output.includes('INSTRUMENTATION_CODE: -1')
    || names.some(name => !output.includes(`PASS ${name}`)) || !output.includes(`PASS ${suite}`)) {
  throw new Error('Instrumentation did not pass every required case');
}
