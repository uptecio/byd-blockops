import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const run = promisify(execFile);
const assets = ['index.html', 'game.js', 'styles.css', 'THREE-LICENSE.txt'];

async function fixture(context) {
  const scratch = await mkdtemp(join(tmpdir(), 'block-ops-apk-input-'));
  context.after(() => rm(scratch, { recursive: true, force: true }));
  const root = join(scratch, 'repo with spaces'), sdk = join(scratch, 'sdk with spaces');
  await mkdir(join(root, 'scripts'), { recursive: true });
  await mkdir(join(sdk, 'platforms', 'android-36'), { recursive: true });
  // Copy the real script: even an incorrect DIST_DIR implementation can mutate
  // only this disposable checkout, never actual Android assets or live dist.
  await cp(resolve('scripts/build-apk.sh'), join(root, 'scripts', 'build-apk.sh'));
  const compiler = join(scratch, 'stub compiler.mjs');
  await writeFile(compiler, `#!${process.execPath}
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const args=process.argv.slice(2), android=args[args.indexOf('-p')+1];
await writeFile(join(android,'compiler-args.json'), JSON.stringify(args));
await mkdir(join(android,'app/build/outputs/apk/debug'),{recursive:true});
await writeFile(join(android,'app/build/outputs/apk/debug/app-debug.apk'),'isolated stub artifact');
`, { mode: 0o755 });
  for (const [directory, prefix] of [['dist', 'default'], ['staged assets', 'staged'], ['android/app/src/main/assets', 'previous']]) {
    await mkdir(join(root, directory), { recursive: true });
    for (const asset of assets) await writeFile(join(root, directory, asset), `${prefix}:${asset}`);
  }
  const { DIST_DIR, APK_OUTPUT_PATH, ...inherited } = process.env;
  const env = { ...inherited, ANDROID_SDK_ROOT: sdk, GRADLE_BINARY: compiler };
  return { root, scratch, env, package: (extraEnv = {}, cwd = scratch) => run('bash', [join(root, 'scripts/build-apk.sh'), '--offline', 'lintDebug'], { cwd, env: { ...env, ...extraEnv } }) };
}

test('APK packaging defaults to repository dist and forwards compiler arguments', async context => {
  const f = await fixture(context);
  await f.package();
  for (const asset of assets) assert.equal(await readFile(join(f.root, 'android/app/src/main/assets', asset), 'utf8'), `default:${asset}`);
  assert.deepEqual(JSON.parse(await readFile(join(f.root, 'android/compiler-args.json'), 'utf8')), ['-p', join(f.root, 'android'), '--console=plain', 'assembleDebug', '--offline', 'lintDebug']);
  assert.equal(await readFile(join(f.root, 'artifacts/block-ops-debug.apk'), 'utf8'), 'isolated stub artifact');
});

test('a separate test APK output preserves the previously released latest APK', async context => {
  const f = await fixture(context);
  await mkdir(join(f.root, 'artifacts'), { recursive:true });
  const previous = join(f.root, 'artifacts/block-ops-debug.apk');
  await writeFile(previous, 'previous verified release');
  const output = join(f.scratch, 'BYD test builds', 'block-ops-test.apk');
  await f.package({ APK_OUTPUT_PATH:output });
  assert.equal(await readFile(previous, 'utf8'), 'previous verified release');
  assert.equal(await readFile(output, 'utf8'), 'isolated stub artifact');
});

for (const relative of [false, true]) test(`APK packaging uses ${relative ? 'relative' : 'absolute'} staged DIST_DIR with spaces without changing default assets`, async context => {
  const f = await fixture(context);
  await f.package({ DIST_DIR: relative ? 'staged assets' : join(f.root, 'staged assets') }, relative ? f.root : f.scratch);
  for (const asset of assets) {
    assert.equal(await readFile(join(f.root, 'android/app/src/main/assets', asset), 'utf8'), `staged:${asset}`);
    assert.equal(await readFile(join(f.root, 'dist', asset), 'utf8'), `default:${asset}`);
  }
});

for (const invalid of ['missing', 'empty', 'directory']) test(`${invalid} staged APK input fails before copying any assets or invoking compiler`, async context => {
  const f = await fixture(context);
  const license = join(f.root, 'staged assets/THREE-LICENSE.txt');
  if (invalid === 'empty') await writeFile(license, '');
  else {
    await rm(license);
    if (invalid === 'directory') await mkdir(license);
  }
  await assert.rejects(f.package({ DIST_DIR: join(f.root, 'staged assets') }), error => {
    assert.match(error.stderr, /Missing.*THREE-LICENSE\.txt/);
    return true;
  });
  for (const asset of assets) assert.equal(await readFile(join(f.root, 'android/app/src/main/assets', asset), 'utf8'), `previous:${asset}`);
  await assert.rejects(readFile(join(f.root, 'android/compiler-args.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(f.root, 'artifacts/block-ops-debug.apk')), { code: 'ENOENT' });
});
