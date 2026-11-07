import { createApp } from './app.js';
import { config } from './config.js';
import { closeDb, getDbPath } from './db/client.js';
import { migrate } from './db/migrate.js';
import { startCleanupScheduler, stopCleanupScheduler } from './jobs/scheduler.js';
import { ensureBootstrap } from './services/auth.js';
import { getClientExitLockState } from './services/exitLock.js';
import { attachExitLockWebSocket, broadcastExitLockPayload } from './services/exitLockHub.js';

const db = migrate();
await ensureBootstrap(db);

const app = createApp();
startCleanupScheduler();

const server = app.listen(config.port, config.host, () => {
  console.log(`[classroom-desk-server] listening on http://${config.host}:${config.port}`);
  console.log(`[classroom-desk-server] sqlite: ${getDbPath()}`);
  console.log(`[classroom-desk-server] health: http://127.0.0.1:${config.port}/health`);
});

attachExitLockWebSocket(server);
broadcastExitLockPayload(getClientExitLockState(db));

function shutdown() {
  stopCleanupScheduler();
  server.close(() => {
    closeDb();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
