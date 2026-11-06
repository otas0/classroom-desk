import { randomBytes } from 'node:crypto';

function requireOrDevSecret(name: string, ephemeralLabel: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${name} must be set via environment variable in production`);
  }

  const generated = randomBytes(32).toString('hex');
  console.warn(
    `[config] ${name} not set; using ephemeral ${ephemeralLabel} for this process only. Set ${name} in env for stable tokens.`,
  );
  return generated;
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '0.0.0.0',
  jwtSecret: requireOrDevSecret('JWT_SECRET', 'JWT secret'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  defaultPointRequestTtlMinutes: 60,
  minPointRequestTtlMinutes: 1,
  maxPointRequestTtlMinutes: 10080,
};
