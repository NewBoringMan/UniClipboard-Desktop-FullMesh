#!/usr/bin/env node

import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const input = resolve(process.argv[2] ?? join(root, '.release-artifacts'));
const version = process.argv[3] ?? '0.1.0-alpha.1';
const output = resolve(root, 'dist', version);
const deliveryDirectories = [
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

async function filesUnder(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await filesUnder(path)));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

function isDeliveryArtifact(path) {
  const lower = path.toLowerCase();
  const name = basename(path).toLowerCase();
  if (
    /\.(aar|aab|apk|appimage|cer|deb|dmg|exe|ipa|msi|msix|pkg|pom|rpm|swift|tar|tgz|zip)$/.test(
      name,
    )
  ) {
    return true;
  }
  return (
    lower.includes('provenance') ||
    lower.includes('sha256sums') ||
    lower.includes('source-commit') ||
    lower.includes('runtime-dependencies') ||
    lower.includes('version.txt')
  );
}

function destinationFor(path) {
  const rel = relative(input, path).split(sep).join('/');
  const lower = rel.toLowerCase();
  const name = basename(path).toLowerCase();
  if (name.endsWith('.aar') || name.endsWith('.pom') || lower.includes('uniclipboardengine')) {
    return 'engine';
  }
  if (lower.startsWith('android-') || /\.(apk|aab)$/.test(name)) return 'android';
  if (lower.startsWith('ios-') || /\.(ipa|xcarchive)$/.test(name)) return 'ios';
  if (lower.startsWith('relay-') || name.includes('relay.oci')) return 'relay';
  if (lower.includes('windows') || /\.(msix|msi|exe)$/.test(name) || name.includes('portable')) {
    return 'windows';
  }
  if (lower.includes('apple') || /\.(dmg|pkg)$/.test(name) || name.includes('.app.')) return 'macos';
  if (lower.includes('linux') || /\.(appimage|deb|rpm)$/.test(name)) return 'linux';
  return 'test-reports';
}

const used = new Set();
let count = 0;
await Promise.all(deliveryDirectories.map((directory) => mkdir(join(output, directory), { recursive: true })));
for (const path of (await filesUnder(input)).filter(isDeliveryArtifact)) {
  const platform = destinationFor(path);
  let filename = basename(path);
  const key = `${platform}/${filename}`.toLowerCase();
  if (used.has(key)) {
    const artifactName = relative(input, path).split(sep)[0].replace(/[^A-Za-z0-9._-]/g, '-');
    filename = `${artifactName}-${filename}`;
  }
  used.add(`${platform}/${filename}`.toLowerCase());
  await mkdir(join(output, platform), { recursive: true });
  await copyFile(path, join(output, platform, filename));
  count += 1;
}

process.stdout.write(`staged ${count} CI artifacts into ${output}\n`);
