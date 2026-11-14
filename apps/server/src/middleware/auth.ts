import type { NextFunction, Request, Response } from 'express';
import { openDb } from '../db/client.js';
import { findUserById, mapUser, verifyToken } from '../services/auth.js';
import { hasSessionKick } from '../services/sessionKick.js';
import { maxSecrecyBindIp, maxSecrecyEnabled } from '../services/maxSecrecy.js';
import type { AuthUser, Role } from '../types.js';

export type AuthedRequest = Request & { user?: AuthUser };

function normalizeIp(ip: string | undefined): string {
  const s = String(ip ?? '').trim();
  if (s.startsWith('::ffff:')) return s.slice(7);
  return s;
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  const payload = await verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const db = openDb();
  const dbUser = findUserById(db, payload.id);
  if (!dbUser) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  // Prefer explicit kick (soft-delete also writes session_kicks) so UI shows「账号已下线」.
  if (dbUser.role === 'student' && hasSessionKick(dbUser.id, db)) {
    res.status(401).json({ error: 'session_kicked', message: '账号已下线，请重新选择身份' });
    return;
  }
  // Soft-deleted students must not keep using unexpired JWTs.
  if (
    dbUser.role === 'student' &&
    dbUser.deleted_at != null &&
    String(dbUser.deleted_at).trim() !== ''
  ) {
    res.status(401).json({ error: 'account_deleted', message: '账号已删除，请重新选择身份' });
    return;
  }
  if (
    (dbUser.role === 'assistant' || dbUser.role === 'teacher') &&
    dbUser.disabled_at != null &&
    String(dbUser.disabled_at).trim() !== ''
  ) {
    res.status(401).json({ error: 'account_disabled', message: '账号已停用' });
    return;
  }
  // Max-secrecy: staff JWT IP bind (tokens issued with bindIp).
  if (
    maxSecrecyEnabled(db) &&
    maxSecrecyBindIp(db) &&
    (dbUser.role === 'teacher' || dbUser.role === 'admin' || dbUser.role === 'assistant') &&
    payload.bindIp
  ) {
    const nowIp = normalizeIp(req.ip);
    const bound = normalizeIp(payload.bindIp);
    if (bound && nowIp && bound !== nowIp) {
      res.status(401).json({
        error: 'ip_bind_mismatch',
        message: '最高保密档：会话已绑定登录 IP，请在原终端重新登录',
      });
      return;
    }
  }
  req.user = mapUser(dbUser);
  next();
}

export function requireRoles(...roles: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}
