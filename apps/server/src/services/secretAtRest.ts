import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import { getSetting } from '../db/migrate.js';
import { upsertSetting } from './exitLock.js';

const PREFIX = 'enc1:';

const SECRET_KEYS = new Set([
  'shield_http_token',
  'federation_hub_token',
  'backup_encrypt_passphrase',
]);

function keyBytes(): Buffer {
  return createHash('sha256').update(String(config.auditHmacKey), 'utf8').digest();
}

/** AES-256-GCM string seal for settings secrets (max-secrecy at-rest). */
export function encryptSecretPlain(plain: string): string {
  const p = String(plain ?? '');
  if (!p) return '';
  if (p.startsWith(PREFIX)) return p;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(p, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    PREFIX +
    Buffer.concat([iv, tag, enc]).toString('base64url')
  );
}

export function decryptSecretStored(stored: string): string {
  const s = String(stored ?? '');
  if (!s) return '';
  if (!s.startsWith(PREFIX)) return s; // legacy plaintext
  try {
    const buf = Buffer.from(s.slice(PREFIX.length), 'base64url');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', keyBytes(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export function isSecretSettingKey(key: string): boolean {
  return SECRET_KEYS.has(key);
}

export function getSecretSetting(db: DatabaseSync, key: string): string {
  return decryptSecretStored(String(getSetting(db, key) ?? ''));
}

export function setSecretSetting(db: DatabaseSync, key: string, plain: string): void {
  const p = String(plain ?? '').trim();
  upsertSetting(db, key, p ? encryptSecretPlain(p) : '');
}

/** Re-seal plaintext secrets already in DB (idempotent). */
export function resealPlaintextSecrets(db: DatabaseSync): number {
  let n = 0;
  for (const key of SECRET_KEYS) {
    const raw = String(getSetting(db, key) ?? '');
    if (!raw || raw.startsWith(PREFIX)) continue;
    upsertSetting(db, key, encryptSecretPlain(raw));
    n += 1;
  }
  return n;
}
