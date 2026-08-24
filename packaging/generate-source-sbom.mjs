#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2] ?? (await readFile(join(root, 'VERSION'), 'utf8')).trim();
const output = join(root, 'dist', version, 'sbom');
const cargo = process.env.CARGO ?? 'cargo';

function idFor(ecosystem, name, packageVersion, source = '') {
  const digest = createHash('sha256')
    .update(`${ecosystem}\0${name}\0${packageVersion}\0${source}`)
    .digest('hex')
    .slice(0, 20);
  return `SPDXRef-Package-${digest}`;
}

function normalizeLicense(value) {
  if (!value || typeof value !== 'string') return 'NOASSERTION';
  return value.replaceAll('/', ' OR ');
}

function packageRecord(ecosystem, name, packageVersion, source, license) {
  return {
    SPDXID: idFor(ecosystem, name, packageVersion, source),
    name,
    versionInfo: packageVersion || 'NOASSERTION',
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: normalizeLicense(license),
    copyrightText: 'NOASSERTION',
    externalRefs: [
      {
        referenceCategory: 'PACKAGE-MANAGER',
        referenceType: 'purl',
        referenceLocator: `pkg:${ecosystem}/${encodeURIComponent(name)}@${encodeURIComponent(packageVersion || 'unknown')}`,
      },
    ],
    sourceInfo: source || undefined,
  };
}

function cargoPackages(component) {
  const metadata = JSON.parse(
    execFileSync(cargo, ['metadata', '--locked', '--offline', '--format-version', '1'], {
      cwd: join(root, component),
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
    }),
  );
  return metadata.packages.map((pkg) =>
    packageRecord('cargo', pkg.name, pkg.version, pkg.source ?? `path:${component}`, pkg.license),
  );
}

function npmPackages(lock) {
  const records = [];
  for (const [path, value] of Object.entries(lock.packages ?? {})) {
    if (!path || !value?.version) continue;
    const marker = 'node_modules/';
    const index = path.lastIndexOf(marker);
    const name = value.name ?? path.slice(index + marker.length);
    records.push(packageRecord('npm', name, value.version, `mobile/package-lock.json:${path}`, value.license));
  }
  return records;
}

function bunPackages(text) {
  const records = [];
  const seen = new Set();
  const entry = /^\s+"[^"]+": \["((?:@[^/]+\/)?[^"@]+)@([^"\s]+)"/gm;
  for (const match of text.matchAll(entry)) {
    const [, name, packageVersion] = match;
    const key = `${name}@${packageVersion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    records.push(packageRecord('npm', name, packageVersion, 'desktop/bun.lock', null));
  }
  return records;
}

const mobileLock = JSON.parse(await readFile(join(root, 'mobile', 'package-lock.json'), 'utf8'));
const bunLock = await readFile(join(root, 'desktop', 'bun.lock'), 'utf8');
const all = [
  ...cargoPackages('engine'),
  ...cargoPackages('desktop'),
  ...npmPackages(mobileLock),
  ...bunPackages(bunLock),
  packageRecord('generic', '@uniclipboard/fullmesh-relay-control-plane', version, 'relay/package.json', 'AGPL-3.0-only'),
];
const unique = [...new Map(all.map((pkg) => [pkg.SPDXID, pkg])).values()].sort((a, b) =>
  `${a.name}@${a.versionInfo}`.localeCompare(`${b.name}@${b.versionInfo}`),
);
const namespaceId = randomUUID();
const document = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: `UniClipboard-FullMesh-${version}-source-locks`,
  documentNamespace: `https://uniclipboard.app/spdx/${version}/${namespaceId}`,
  creationInfo: {
    created: new Date().toISOString(),
    creators: ['Tool: packaging/generate-source-sbom.mjs'],
  },
  documentDescribes: unique.map((pkg) => pkg.SPDXID),
  packages: unique,
};

await mkdir(output, { recursive: true });
await writeFile(join(output, `UniClipboard-FullMesh-${version}-source-locks.spdx.json`), `${JSON.stringify(document, null, 2)}\n`);
const licenses = ['ecosystem\tname\tversion\tdeclared-license'];
for (const pkg of unique) {
  const ecosystem = pkg.externalRefs[0].referenceLocator.split(':', 2)[1].split('/', 1)[0];
  licenses.push(`${ecosystem}\t${pkg.name}\t${pkg.versionInfo}\t${pkg.licenseDeclared}`);
}
await writeFile(join(output, 'dependency-licenses.tsv'), `${licenses.join('\n')}\n`);
process.stdout.write(`generated SPDX SBOM and license list for ${unique.length} locked packages\n`);
