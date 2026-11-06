import type { NextFunction, Request, Response } from 'express';
import { openDb } from '../db/client.js';
import { findUserById, mapUser, verifyToken } from '../services/auth.js';
import type { AuthUser, Role } from '../types.js';

export type AuthedRequest = Request & { user?: AuthUser };

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
  const dbUser = findUserById(openDb(), payload.id);
  if (!dbUser) {
    res.status(401).json({ error: 'unauthorized' });
    return;
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
