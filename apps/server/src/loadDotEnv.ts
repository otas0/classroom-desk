import fs from 'node:fs';
import path from 'node:path';

/**
 * Load InstallRoot `.env` into process.env (does not override existing keys).
 * Teacher-Setup writes TEACHER_PASSWORD / JWT_SECRET / BOOTSTRAP_LOGIN_TOKEN here.
 */
export function loadDotEnv(root = process.cwd()): void {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;
  let raw = '';
  try {
    raw = fs.readFileSync(envPath, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
