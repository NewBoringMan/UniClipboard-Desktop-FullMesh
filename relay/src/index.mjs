import { loadConfig } from './config.mjs';
import { MailboxStore } from './mailbox-store.mjs';
import { createRelayServer } from './server.mjs';

const config = await loadConfig();
const store = new MailboxStore(config);
await store.initialize();
const server = createRelayServer({ ...config, store });

server.listen(config.port, config.host, () => {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      event: 'server_started',
      host: config.host,
      port: config.port,
    })}\n`,
  );
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', event: 'shutdown', signal })}\n`,
  );
  const timer = setTimeout(() => process.exit(1), config.shutdownGraceMs);
  timer.unref();
  server.close((error) => {
    clearTimeout(timer);
    process.exit(error ? 1 : 0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

