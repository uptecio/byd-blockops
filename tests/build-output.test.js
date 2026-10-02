import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, readdir, mkdtemp, cp, symlink, rm } from 'node:fs/promises';
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
test('isolated build and preview serve staged assets while live dist is preserved', async context => {
  const before = await files('dist');
  // Even a regression that ignores BUILD_DIR can write only this test-owned cwd.
  const scratch = await mkdtemp(join(tmpdir(), 'arena-build-'));
  context.after(() => rm(scratch, { recursive: true, force: true }));
  for (const name of ['src', 'node_modules']) await symlink(resolve(name), join(scratch, name), 'dir');
  for (const name of ['dist', 'index.html', 'game-server.json']) await cp(name, join(scratch, name), { recursive: true });
  const scratchBefore = await files(join(scratch, 'dist'));
  const build = spawn(process.execPath, [resolve('scripts/build.mjs')], { cwd: scratch, env: { ...process.env, BUILD_DIR: staged } });
  let output = ''; build.stdout.on('data', data => { output += data; }); build.stderr.on('data', data => { output += data; });
  const exit = await new Promise(resolve => build.on('close', resolve));
  assert.equal(exit, 0, output);
  assert.deepEqual(await files('dist'), before);
  assert.deepEqual(await files(join(scratch, 'dist')), scratchBefore);
  const stageRoot = join(scratch, staged);
  assert.ok((await readFile(`${stageRoot}/game.js`, 'utf8')).length > 10000);
  const server = spawn(process.execPath, [resolve('scripts/serve.mjs')], { cwd: scratch, env: { ...process.env, DIST_DIR: staged, PORT: '0' } });
  try {
    const address = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Preview did not start')), 5000);
      server.stdout.on('data', data => { const match = String(data).match(/http:\/\/localhost:\d+/); if (match) { clearTimeout(timeout); resolve(match[0]); } });
      server.on('error', reject);
    });
    assert.equal(await (await fetch(`${address}/game.js`)).text(), await readFile(`${stageRoot}/game.js`, 'utf8'));
    assert.deepEqual(await files('dist'), before);
  } finally { server.kill(); await new Promise(resolve => server.on('close', resolve)); }
});
