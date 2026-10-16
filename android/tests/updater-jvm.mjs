import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const suites = {
  controller: {
    sources: ['UpdateModel', 'UpdatePolicy', 'UpdatePorts', 'UpdateCancellation', 'UpdateController'],
    test: 'UpdaterControllerTest',
  },
  policy: {
    sources: ['UpdateModel', 'UpdatePolicy', 'UpdatePorts', 'UpdateCancellation'],
    test: 'UpdaterPolicyTest',
  },
  transfer: {
    sources: ['UpdateModel', 'UpdatePolicy', 'UpdatePorts', 'UpdateCancellation',
      'HttpsUpdateTransport', 'UpdateCandidateStore'],
    test: 'UpdaterTransferTest',
  },
};
const suite = suites[process.argv[2] ?? 'policy'];
if (!suite) throw new Error('Unknown updater JVM suite');
const output = await mkdtemp(join(tmpdir(), 'blockops-updater-jvm-'));
try {
  const sources = suite.sources.map(name => join(root,
    'android/app/src/main/java/au/local/blockops/updates', `${name}.java`));
  sources.push(join(root, 'android/tests', `${suite.test}.java`));
  for (const [command, args] of [
    ['javac', ['-encoding', 'UTF-8', '-d', output, ...sources]],
    ['java', ['-ea', '-cp', output, `au.local.blockops.updates.${suite.test}`, ...process.argv.slice(3)]],
  ]) {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60_000 });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      break;
    }
  }
} finally {
  await rm(output, { recursive: true, force: true });
}
