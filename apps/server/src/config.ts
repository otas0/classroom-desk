import { randomBytes } from 'node:crypto';

const WEAK_SECRET_RE =
  /replace|change-me|dev-secret|please-change|classroom-desk-secret|secret123/i;

function assertStrongProductionSecret(name: string, value: string): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (value.length < 32) {
    throw new Error(`${name} must be ≥32 characters in production (openssl rand -hex 32)`);
  }
  if (WEAK_SECRET_RE.test(value)) {
    throw new Error(
      `${name} looks like a placeholder — set a strong secret (see docs/PILOT_GO_LIVE.md)`,
    );
  }
}

function requireOrDevSecret(name: string, ephemeralLabel: string): string {
  const value = process.env[name]?.trim();
  if (value) {
    assertStrongProductionSecret(name, value);
    return value;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${name} must be set via environment variable in production`);
  }

  const generated = randomBytes(32).toString('hex');
  console.warn(
    `[config] ${name} not set; using ephemeral ${ephemeralLabel} for this process only. Set ${name} in env for stable tokens.`,
  );
  return generated;
}

const jwtSecret = requireOrDevSecret('JWT_SECRET', 'JWT secret');

const auditFromEnv = process.env.AUDIT_HMAC_KEY?.trim() || '';
if (auditFromEnv) {
  assertStrongProductionSecret('AUDIT_HMAC_KEY', auditFromEnv);
} else if (process.env.NODE_ENV === 'production') {
  console.warn(
    '[config] AUDIT_HMAC_KEY not set; using JWT_SECRET for audit HMAC. Prefer a separate key (docs/PILOT_GO_LIVE.md).',
  );
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '0.0.0.0',
  jwtSecret,
  /**
   * Key for audit HMAC chain + compliance pack seal.
   * Prefer AUDIT_HMAC_KEY; falls back to JWT_SECRET (same process lifetime in dev).
   */
  auditHmacKey: auditFromEnv || jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  defaultPointRequestTtlMinutes: 60,
  minPointRequestTtlMinutes: 1,
  maxPointRequestTtlMinutes: 10080,
};
