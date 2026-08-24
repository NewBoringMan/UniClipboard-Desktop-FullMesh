#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const relayEntry = join(root, 'relay', 'src', 'index.mjs');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function headers(token, eventId) {
  return {
    authorization: `Bearer ${token}`,
    ...(eventId
      ? {
          'content-type': 'application/octet-stream',
          'x-uniclipboard-event-id': eventId,
          'x-uniclipboard-ttl-seconds': '60',
        }
      : {}),
  };
}

async function upload(baseUrl, token, mailbox, eventId, body) {
  const response = await fetch(`${baseUrl}/v1/mailboxes/${mailbox}/events`, {
    method: 'POST',
    headers: headers(token, eventId),
    body,
  });
  assert.ok([200, 201].includes(response.status), `upload ${eventId}: ${response.status}`);
  return response.json();
}

async function worker() {
  const [, , , baseUrl, token, mailbox, ordinal] = process.argv;
  await Promise.all([
    upload(
      baseUrl,
      token,
      mailbox,
      `event_parallel_${ordinal.padStart(4, '0')}`,
      Buffer.from(`ciphertext-worker-${ordinal}`),
    ),
    upload(baseUrl, token, mailbox, 'event_common_0001', Buffer.from('ciphertext-common')),
  ]);
}

async function unusedPort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  assert.equal(typeof address, 'object');
  const port = address.port;
  await new Promise((resolveClose) => probe.close(resolveClose));
  return port;
}

async function startRelay({ authFile, dataDir, port }) {
  const child = spawn(process.execPath, [relayEntry], {
    cwd: root,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      MAILBOX_AUTH_FILE: authFile,
      DATA_DIR: dataDir,
      MIN_TTL_SECONDS: '5',
      MAX_TTL_SECONDS: '3600',
      RATE_BURST: '1000',
      RATE_PER_MINUTE: '10000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`relay exited early: ${logs.join('')}`);
    try {
      if ((await fetch(`${baseUrl}/readyz`)).status === 200) return { child, baseUrl, logs };
    } catch {
      // The child has not opened its listener yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  child.kill('SIGTERM');
  throw new Error(`relay did not become ready: ${logs.join('')}`);
}

async function stopRelay(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await once(child, 'exit');
  assert.equal(child.exitCode, 0);
}

async function runClientProcess(baseUrl, token, mailbox, ordinal) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker', baseUrl, token, mailbox, String(ordinal)], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  await once(child, 'exit');
  assert.equal(child.exitCode, 0, Buffer.concat(stderr).toString() || Buffer.concat(stdout).toString());
}

async function drain(baseUrl, token, mailbox) {
  const bodies = [];
  while (true) {
    const response = await fetch(`${baseUrl}/v1/mailboxes/${mailbox}/events/next`, {
      headers: headers(token),
    });
    if (response.status === 204) return bodies;
    assert.equal(response.status, 200);
    bodies.push(Buffer.from(await response.arrayBuffer()).toString());
    const receipt = response.headers.get('x-uniclipboard-receipt');
    assert.ok(receipt);
    const acknowledged = await fetch(
      `${baseUrl}/v1/mailboxes/${mailbox}/events/receipts/${receipt}`,
      { method: 'DELETE', headers: headers(token) },
    );
    assert.equal(acknowledged.status, 204);
  }
}

async function coordinator() {
  const scratch = await mkdtemp(join(tmpdir(), 'uniclipboard-multiprocess-'));
  const token = 'multiprocess-space-token-with-256-bits-of-test-entropy';
  const spaceId = 'space_multiprocess_0001';
  const mailbox = 'mailbox_target_000001';
  const authFile = join(scratch, 'auth.json');
  const dataDir = join(scratch, 'data');
  await writeFile(
    authFile,
    `${JSON.stringify({ schemaVersion: 2, spaces: { [spaceId]: { tokenSha256: sha256(token) } } })}\n`,
    { mode: 0o600 },
  );

  let relay;
  try {
    relay = await startRelay({ authFile, dataDir, port: await unusedPort() });
    await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        runClientProcess(relay.baseUrl, token, mailbox, index + 1),
      ),
    );
    const bodies = await drain(relay.baseUrl, token, mailbox);
    assert.equal(bodies.length, 5, 'four unique events plus one idempotent common event');
    assert.deepEqual(
      new Set(bodies),
      new Set([
        'ciphertext-common',
        'ciphertext-worker-1',
        'ciphertext-worker-2',
        'ciphertext-worker-3',
        'ciphertext-worker-4',
      ]),
    );
    assert.equal(JSON.stringify(relay.logs).includes(token), false);
    await stopRelay(relay.child);

    relay = await startRelay({ authFile, dataDir, port: await unusedPort() });
    assert.deepEqual(await drain(relay.baseUrl, token, mailbox), []);
    await stopRelay(relay.child);
    relay = null;
    process.stdout.write('relay multiprocess: 4 producers, idempotency, drain, restart persistence PASS\n');
  } finally {
    if (relay) await stopRelay(relay.child);
    await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--worker') {
  await worker();
} else {
  await coordinator();
}
