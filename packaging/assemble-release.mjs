#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  process.stderr.write(`assemble-release: ${message}\n`);
  process.exit(1);
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value) fail(`${name} requires a value`);
  return value;
}

async function filesUnder(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await filesUnder(path)));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function platformFor(path) {
  const first = path.split('/')[0];
  return new Set([
    'engine',
    'windows',
    'macos',
    'linux',
    'android',
    'ios',
    'harmonyos',
    'relay',
    'source',
    'sbom',
    'test-reports',
  ]).has(first)
    ? first
    : 'release-metadata';
}

function architecturesFor(name) {
  const lower = name.toLowerCase();
  const architectures = [];
  if (/(x86_64|x64|amd64)/.test(lower)) architectures.push('x86_64');
  if (/(aarch64|arm64|arm64-v8a)/.test(lower)) architectures.push('aarch64');
  if (/armeabi-v7a/.test(lower)) architectures.push('armv7');
  if (/universal/.test(lower)) architectures.push('universal');
  return [...new Set(architectures)];
}

function signingFor(path) {
  const lower = path.toLowerCase();
  if (lower.includes('test-signed') || lower.includes('testing')) return 'test-signed';
  if (lower.includes('ad-hoc') || lower.includes('adhoc')) return 'ad-hoc';
  if (lower.includes('unsigned')) return 'unsigned-testing';
  if (lower.startsWith('source/') || lower.startsWith('sbom/') || lower.startsWith('test-reports/')) {
    return 'not-applicable';
  }
  return 'unverified';
}

const version = argument('--version', (await readFile(join(root, 'VERSION'), 'utf8')).trim());
const dist = resolve(argument('--dist', join(root, 'dist', version)));
const lock = JSON.parse(await readFile(join(root, 'upstreams.lock.json'), 'utf8'));
const checksumDirectory = join(dist, 'checksums');
await mkdir(checksumDirectory, { recursive: true });

const ignored = new Set(['manifest.json', 'checksums/SHA256SUMS']);
const paths = (await filesUnder(dist))
  .map((path) => ({ path, relative: relative(dist, path).split(sep).join('/') }))
  .filter(({ relative: name }) => !ignored.has(name))
  .sort((left, right) => left.relative.localeCompare(right.relative));

const artifacts = [];
for (const item of paths) {
  const info = await stat(item.path);
  artifacts.push({
    path: item.relative,
    filename: basename(item.relative),
    platform: platformFor(item.relative),
    architectures: architecturesFor(item.relative),
    bytes: info.size,
    sha256: await sha256(item.path),
    signing: signingFor(item.relative),
  });
}

const checksums = `${artifacts.map((item) => `${item.sha256}  ${item.path}`).join('\n')}\n`;
await writeFile(join(checksumDirectory, 'SHA256SUMS'), checksums, { mode: 0o644 });

const manifest = {
  schemaVersion: 1,
  product: 'UniClipboard FullMesh',
  version,
  generatedAt: new Date().toISOString(),
  source: {
    integrationCommit: process.env.GITHUB_SHA ?? process.env.UC_INTEGRATION_COMMIT ?? 'local-uncommitted',
    components: Object.fromEntries(
      Object.entries(lock.components).map(([name, value]) => [name, value.commit]),
    ),
  },
  build: {
    runner: process.env.GITHUB_RUN_ID
      ? `github-actions:${process.env.GITHUB_REPOSITORY}:${process.env.GITHUB_RUN_ID}`
      : 'local',
    productionSigningConfigured: false,
  },
  artifacts,
  checksumFile: 'checksums/SHA256SUMS',
  requirementsMatrix: 'docs/verification/REQUIREMENTS_MATRIX.md',
  trueDeviceChecklist: 'docs/verification/TRUE_DEVICE_ACCEPTANCE.md',
};
await writeFile(join(dist, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
  mode: 0o644,
});
process.stdout.write(`assembled ${artifacts.length} artifacts in ${dist}\n`);
