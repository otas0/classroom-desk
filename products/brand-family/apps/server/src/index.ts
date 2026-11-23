import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { APP_NAME } from '@brand-family/shared';
import { openDb } from './db/connection.js';
import { createApp } from './app.js';
import { countParents, createUser, findUserByUsername, writeAudit } from './services/auth.js';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv();

async function maybeBootstrapFromEnv(): Promise<void> {
  const username = process.env.BOOTSTRAP_PARENT_USERNAME?.trim();
  const password = process.env.BOOTSTRAP_PARENT_PASSWORD;
  if (!username || !password || password.length < 8) return;
  if (countParents() > 0) return;
  if (findUserByUsername(username)) return;
  const user = await createUser({
    role: 'parent',
    displayName: username,
    username,
    password,
  });
  writeAudit('bootstrap.env', { userId: user.id, username });
  console.log(`[${APP_NAME}] bootstrap parent created from env: ${username}`);
}

async function main() {
  const dataDir = process.env.DATA_DIR || path.resolve(process.cwd(), '../../data');
  openDb(dataDir);
  await maybeBootstrapFromEnv();

  const app = createApp();
  const port = Number(process.env.PORT || 8788);
  app.listen(port, () => {
    console.log(`[${APP_NAME}] listening on http://127.0.0.1:${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
