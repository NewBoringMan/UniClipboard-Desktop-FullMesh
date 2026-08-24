#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

function required(index, description) {
  const value = process.argv[index];
  if (!value) throw new Error(`missing ${description}`);
  return resolve(value);
}

const sourceAar = required(2, 'source AAR');
const jniRoot = required(3, 'JNI root');
const outputDirectory = required(4, 'output directory');
const version = process.argv[5];
const releaseCommit = process.argv[6];
const bindingCommit = process.argv[7];
if (!version || !releaseCommit || !bindingCommit) {
  throw new Error('usage: repack-engine-aar.mjs SOURCE_AAR JNI_ROOT OUT VERSION RELEASE_COMMIT BINDING_COMMIT');
}

const sha256 = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
const stage = await mkdtemp(join(tmpdir(), 'uniclipboard-engine-aar-'));
const artifact = join(outputDirectory, `uniclipboard-engine-${version}.aar`);
const abiPaths = {
  'armeabi-v7a': 'jni/armeabi-v7a/libuc_engine_uniffi.so',
  'arm64-v8a': 'jni/arm64-v8a/libuc_engine_uniffi.so',
  x86_64: 'jni/x86_64/libuc_engine_uniffi.so',
};

try {
  await mkdir(outputDirectory, { recursive: true });
  execFileSync('unzip', ['-q', sourceAar, '-d', stage]);
  const sourceAarSha256 = await sha256(sourceAar);
  const classesJarSha256 = await sha256(join(stage, 'classes.jar'));
  const nativeLibraries = {};
  for (const [abi, relativePath] of Object.entries(abiPaths)) {
    const source = join(jniRoot, abi, 'libuc_engine_uniffi.so');
    const destination = join(stage, relativePath);
    await copyFile(source, destination);
    nativeLibraries[abi] = {
      bytes: (await readFile(source)).byteLength,
      sha256: await sha256(source),
    };
  }
  await rm(artifact, { force: true });
  execFileSync('zip', ['-X', '-q', '-r', artifact, '.'], { cwd: stage });

  const entries = execFileSync('unzip', ['-Z1', artifact], { encoding: 'utf8' })
    .trim()
    .split('\n');
  for (const relativePath of Object.values(abiPaths)) {
    if (!entries.includes(relativePath)) throw new Error(`repacked AAR is missing ${relativePath}`);
  }

  const provenance = {
    schemaVersion: 1,
    artifact: `uniclipboard-engine-${version}.aar`,
    version,
    releaseCommit,
    bindingBytecode: {
      sourceCommit: bindingCommit,
      sourceAarSha256,
      classesJarSha256,
      justification:
        'The UniFFI API and Android library module sources are byte-for-byte unchanged between the binding and release commits; only release metadata, legacy compatibility compilation, and the Android Cargo pipelining default changed.',
    },
    nativeLibraries,
  };
  await writeFile(join(outputDirectory, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`);
  await writeFile(join(outputDirectory, 'version.txt'), `v${version}\n`);
  await writeFile(join(outputDirectory, 'source-commit.txt'), `${releaseCommit}\n`);
  await writeFile(
    join(outputDirectory, `uniclipboard-engine-${version}.pom`),
    `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>app.uniclipboard</groupId>
  <artifactId>uniclipboard-engine</artifactId>
  <version>${version}</version>
  <packaging>aar</packaging>
  <dependencies>
    <dependency><groupId>net.java.dev.jna</groupId><artifactId>jna</artifactId><version>5.14.0</version><type>aar</type><scope>runtime</scope></dependency>
    <dependency><groupId>org.jetbrains.kotlin</groupId><artifactId>kotlin-stdlib</artifactId><version>2.1.20</version><scope>runtime</scope></dependency>
  </dependencies>
</project>
`,
  );
  await writeFile(
    join(outputDirectory, 'runtime-dependencies.txt'),
    'net.java.dev.jna:jna:5.14.0@aar\norg.jetbrains.kotlin:kotlin-stdlib:2.1.20\n',
  );
  await writeFile(
    join(outputDirectory, 'SHA256SUMS'),
    `${await sha256(artifact)}  ${artifact.split('/').at(-1)}\n`,
  );
  process.stdout.write(`repacked and verified ${artifact}\n`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
