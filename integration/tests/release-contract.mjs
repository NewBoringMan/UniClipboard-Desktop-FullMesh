#!/usr/bin/env node

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFile(join(root, path), 'utf8');

const workflow = await read('.github/workflows/fullmesh-ci.yml');
for (const runner of [
  'windows-latest',
  'macos-latest',
  'ubuntu-22.04',
  'ubuntu-22.04-arm',
  'macos-26',
]) {
  assert.ok(workflow.includes(runner), `missing runner ${runner}`);
}
for (const target of [
  'x86_64-pc-windows-msvc',
  'aarch64-pc-windows-msvc',
  'x86_64-apple-darwin',
  'aarch64-apple-darwin',
  'x86_64-unknown-linux-gnu',
  'aarch64-unknown-linux-gnu',
]) {
  assert.ok(workflow.includes(target), `missing desktop target ${target}`);
}
for (const gate of [
  'cargo test --workspace --locked',
  'scripts/build-android-release.sh',
  'scripts/verify-android-release.sh',
  'android-emulator-runner',
  'prepare-local-unified-engine-core.sh engine',
  "destination 'generic/platform=iOS Simulator'",
  'linux/amd64,linux/arm64',
  'test-msix-lifecycle.ps1',
  'createUpdaterArtifacts":false',
  'unsigned-testing-portable.zip',
  'ad-hoc-testing.app.zip',
  'android-universal-test-signed.aab',
  'relay-amd64-arm64-unsigned-testing.oci.tar',
]) {
  assert.ok(workflow.includes(gate), `missing CI gate ${gate}`);
}

const requiredDeliveryPaths = [
  'source',
  'engine',
  'windows',
  'macos',
  'linux',
  'android',
  'ios',
  'harmonyos',
  'relay',
  'checksums',
  'sbom',
  'test-reports',
];
const assembler = await read('packaging/assemble-release.mjs');
for (const path of requiredDeliveryPaths) {
  assert.ok(assembler.includes(`'${path}'`), `assembler does not classify ${path}`);
}
const stager = await read('packaging/stage-ci-artifacts.mjs');
assert.ok(stager.includes('isDeliveryArtifact'), 'CI staging must exclude unpacked app internals');

for (const path of [
  'docs/verification/REQUIREMENTS_MATRIX.md',
  'docs/verification/TRUE_DEVICE_ACCEPTANCE.md',
  'docs/build/SIGNING_REQUIREMENTS.md',
  'docs/security/THREAT_MODEL.md',
  'docs/privacy/METADATA.md',
]) {
  await access(join(root, path));
}
await access(join(root, 'packaging/generate-source-sbom.mjs'));

process.stdout.write('FullMesh release/runner/delivery contract PASS\n');
