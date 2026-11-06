import { randomBytes, randomUUID } from 'node:crypto';

export function newId(): string {
  return randomUUID();
}

export function newClassCode(): string {
  return randomBytes(3).toString('hex').toUpperCase();
}

export function nowIso(): string {
  return new Date().toISOString();
}
