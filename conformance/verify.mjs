import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runWireVectors } from './v1/node-wire.mjs';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('./v1/manifest.json', import.meta.url), 'utf8'));
for (const resource of manifest.resources) {
  assert.match(resource.path, /^(protocol|conformance)\//);
  assert(!resource.path.includes('..'));
  const bytes = readFileSync(new URL(resource.path, root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), resource.sha256, resource.path);
}
if (process.argv.includes('--core')) {
  const command = spawnSync('cargo', ['metadata', '--no-deps', '--format-version=1', '--locked'], { cwd: root, encoding: 'utf8' });
  assert.equal(command.status, 0, command.stderr);
  const core = JSON.parse(command.stdout).packages.find(pkg => pkg.name === 'hyperion-stream-core');
  assert(core); assert.deepEqual(core.dependencies, [], 'Core must have no third-party, development or build dependencies');
}
console.log(`${manifest.resources.length} corpus hashes and ${runWireVectors()} native JSON/BigInt vectors passed`);
