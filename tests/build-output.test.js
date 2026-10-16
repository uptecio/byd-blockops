import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, readdir, mkdtemp, mkdir, writeFile, cp, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const staged = '.superpowers/sdd/2026-10-02-home-maps-skins-modes/dist';
async function files(root) {
  const result = {};
  for (const item of await readdir(root, { withFileTypes: true })) {
    if (item.isDirectory()) Object.assign(result, await files(`${root}/${item.name}`));
    else result[`${root}/${item.name}`] = createHash('sha256').update(await readFile(`${root}/${item.name}`)).digest('hex');
  }
  return result;
}
async function optionalFiles(root) {
  try { return await files(root); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
test('isolated build and preview serve staged assets while live dist is preserved', async context => {
  const before = await optionalFiles('dist');
  // Even a regression that ignores BUILD_DIR can write only this test-owned cwd.
  const scratch = await mkdtemp(join(tmpdir(), 'arena-build-'));
  context.after(() => rm(scratch, { recursive: true, force: true }));
  for (const name of ['src', 'node_modules']) await symlink(resolve(name), join(scratch, name), 'dir');
  for (const name of ['index.html', 'game-server.json']) await cp(name, join(scratch, name));
  await mkdir(join(scratch, 'dist'));
  await writeFile(join(scratch, 'dist', 'game.js'), 'disposable baseline bundle');
  await writeFile(join(scratch, 'dist', 'index.html'), 'disposable baseline page');
  const scratchBefore = await files(join(scratch, 'dist'));
  const build = spawn(process.execPath, [resolve('scripts/build.mjs')], { cwd: scratch, env: { ...process.env, BUILD_DIR: staged } });
  let output = ''; build.stdout.on('data', data => { output += data; }); build.stderr.on('data', data => { output += data; });
  const exit = await new Promise(resolve => build.on('close', resolve));
  assert.equal(exit, 0, output);
  assert.deepEqual(await optionalFiles('dist'), before);
  assert.deepEqual(await files(join(scratch, 'dist')), scratchBefore);
  const stageRoot = join(scratch, staged);
  assert.ok((await readFile(`${stageRoot}/game.js`, 'utf8')).length > 10000);
  const page = await readFile(`${stageRoot}/index.html`, 'utf8');
  assert.match(page, /v0\.11\.0 · GITHUB UPDATES/); assert.match(page, /id="climb-hint"/);
  const server = spawn(process.execPath, [resolve('scripts/serve.mjs')], { cwd: scratch, env: { ...process.env, DIST_DIR: staged, PORT: '0' } });
  try {
    const address = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Preview did not start')), 5000);
      server.stdout.on('data', data => { const match = String(data).match(/http:\/\/localhost:\d+/); if (match) { clearTimeout(timeout); resolve(match[0]); } });
      server.on('error', reject);
    });
    assert.equal(await (await fetch(`${address}/game.js`)).text(), await readFile(`${stageRoot}/game.js`, 'utf8'));
    assert.deepEqual(await optionalFiles('dist'), before);
  } finally { server.kill(); await new Promise(resolve => server.on('close', resolve)); }
});

// Catch a missing candidate selector, unknown selectors and ambiguous migration
// requests before any SDK/artifact lookup. No APK or device mutation is needed.
test('package release selectors reject ambiguity and recognize shooting range', async () => {
  for (const [selection,pattern] of [
    [{ANDROID_PACKAGE_RELEASE:'unknown-release'}, /Unknown ANDROID_PACKAGE_RELEASE/],
    [{ANDROID_PACKAGE_RELEASE:'shooting-range',ANDROID_PACKAGE_BASELINE:'1'}, /Conflicting package selectors/],
    [{ANDROID_PACKAGE_RELEASE:'solo-powers',ANDROID_PACKAGE_BASELINE:'1'}, /Conflicting package selectors/],
    [{ANDROID_PACKAGE_RELEASE:'minigun',ANDROID_PACKAGE_BASELINE:'1'}, /Conflicting package selectors/],
    [{ANDROID_PACKAGE_RELEASE:'github-updater',ANDROID_PACKAGE_BASELINE:'1'}, /Conflicting package selectors/],
  ]) {
    const {ANDROID_PACKAGE_RELEASE,ANDROID_PACKAGE_BASELINE,...env}=process.env;
    const child=spawn(process.execPath,[resolve('android/tests/package-smoke.mjs')],{env:{...env,...selection}});
    let output='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});
    const exit=await new Promise(resolve=>child.on('close',resolve));
    assert.notEqual(exit,0);assert.match(output,pattern);
  }
});

test('GitHub updater metadata and runners identify the candidate explicitly', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  assert.equal(pkg.version, '0.11.0');
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.match(await readFile('android/app/build.gradle', 'utf8'), /versionCode 15\s+versionName '0\.11\.0'/);
  assert.equal(pkg.scripts['test:updates:native'], 'node android/tests/updater-jvm.mjs policy && node android/tests/updater-jvm.mjs transfer && node android/tests/updater-jvm.mjs controller');
  assert.equal(pkg.scripts['test:updates:android'], 'node android/tests/updater-smoke.mjs');
  const { ANDROID_PACKAGE_RELEASE, ANDROID_PACKAGE_BASELINE, ...env } = process.env;
  const child = spawn(process.execPath, [resolve('android/tests/package-smoke.mjs')], {
    env: { ...env, ANDROID_PACKAGE_RELEASE: 'github-updater', ANDROID_SDK_ROOT: '/nonexistent-updater-selector-probe' },
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  assert.notEqual(await new Promise(resolve => child.on('close', resolve)), 0);
  assert.doesNotMatch(output, /Unknown ANDROID_PACKAGE_RELEASE/);
  assert.match(output, /nonexistent-updater-selector-probe/);
});

test('production updater endpoint has no configurable entry point', async () => {
  const root = 'android/app/src/main/java/au/local/blockops';
  const policy = await readFile(`${root}/updates/UpdatePolicy.java`, 'utf8');
  const client = await readFile(`${root}/updates/GithubReleaseClient.java`, 'utf8');
  const application = await readFile(`${root}/BlockOpsApplication.java`, 'utf8');
  assert.match(policy, /public static final URI RELEASES_URI\s*=\s*URI\.create\("https:\/\/api\.github\.com\/repos\/uptecio\/byd-blockops\/releases\/latest"\)/);
  assert.deepEqual([...client.matchAll(/public GithubReleaseClient\(([^)]*)\)/g)].map(match => match[1]), ['HttpsUpdateTransport transport']);
  assert.match(client, /transport\.read\(UpdatePolicy\.RELEASES_URI,/);
  assert.match(application, /new GithubReleaseClient\(transport\)/);
  assert.doesNotMatch(client + application, /System\.getProperty|System\.getenv|getIntent\(|getStringExtra\(/);
});

test('build-output validation succeeds in a checkout without generated dist', async context => {
  const checkout = await mkdtemp(join(tmpdir(), 'arena-clean-checkout-'));
  context.after(() => rm(checkout, { recursive: true, force: true }));
  for (const name of ['src', 'node_modules', 'scripts']) await symlink(resolve(name), join(checkout, name), 'dir');
  for (const name of ['index.html', 'game-server.json']) await cp(name, join(checkout, name));
  await assert.rejects(readdir(join(checkout, 'dist')), { code: 'ENOENT' });
  // Do not inherit the parent test-runner marker: this is a fresh runner.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const child = spawn(process.execPath, ['--test', '--test-name-pattern=^isolated build', resolve('tests/build-output.test.js')], { cwd: checkout, env });
  let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  const exit = await new Promise(resolve => child.on('close', resolve));
  assert.equal(exit, 0, output);
  assert.match(output, /isolated build and preview serve staged assets/);
  await assert.rejects(readdir(join(checkout, 'dist')), { code: 'ENOENT' });
});
