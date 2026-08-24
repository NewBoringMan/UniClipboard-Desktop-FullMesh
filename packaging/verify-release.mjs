#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2] ?? (await readFile(join(root, 'VERSION'), 'utf8')).trim();
const dist = resolve(root, 'dist', version);
const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.version, version);
assert.ok(Array.isArray(manifest.artifacts));
assert.ok(manifest.artifacts.length > 0);

for (const artifact of manifest.artifacts) {
  assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
  assert.ok(!artifact.path.startsWith('/') && !artifact.path.includes('..'));
  const path = join(dist, artifact.path);
  const info = await stat(path);
  assert.equal(info.size, artifact.bytes, `${artifact.path} size`);
  const actual = createHash('sha256').update(await readFile(path)).digest('hex');
  assert.equal(actual, artifact.sha256, `${artifact.path} SHA-256`);
}

const checksumText = await readFile(join(dist, manifest.checksumFile), 'utf8');
for (const artifact of manifest.artifacts) {
  assert.ok(checksumText.includes(`${artifact.sha256}  ${artifact.path}\n`));
}
process.stdout.write(`verified ${manifest.artifacts.length} release artifacts for ${version}\n`);
