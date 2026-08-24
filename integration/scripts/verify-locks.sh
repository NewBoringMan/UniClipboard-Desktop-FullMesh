#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

node - "$root_dir" <<'NODE'
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = process.argv[2];
const lock = JSON.parse(readFileSync(join(root, 'upstreams.lock.json'), 'utf8'));
let failed = false;
for (const [name, expected] of Object.entries(lock.components)) {
  const entry = execFileSync('git', ['-C', root, 'ls-tree', 'HEAD', name], { encoding: 'utf8' }).trim();
  const [, type, sha] = entry.split(/\s+/u);
  if (type === 'tree') {
    if (sha !== expected.tree) {
      process.stderr.write(`${name}: expected vendored tree ${expected.tree}, found ${sha}\n`);
      failed = true;
    } else {
      process.stdout.write(`${name}: ${sha} (vendored-tree)\n`);
    }
    continue;
  }
  const actual = execFileSync('git', ['-C', join(root, name), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const accepted = [expected.commit, expected.sourceCommit].filter(Boolean);
  if (!accepted.includes(actual)) {
    process.stderr.write(`${name}: expected one of ${accepted.join(', ')}, found ${actual}\n`);
    failed = true;
  } else {
    const mode = actual === expected.commit ? 'delivery' : 'source-bundle';
    process.stdout.write(`${name}: ${actual} (${mode})\n`);
  }
}
if (failed) process.exit(1);
NODE
