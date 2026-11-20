import type { NextFunction, Request, Response } from 'express';
import type { PublicUser, Role } from '@brand-family/shared';
import { findUserById, toPublicUser, verifyToken } from '../services/auth.js';

export type AuthedRequest = Request & {
  user?: PublicUser;
};

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const payload = await verifyToken(header.slice(7));
  if (!payload) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const row = findUserById(payload.sub);
  if (!row || row.disabled_at) {
    res.status(401).json({ error: 'account_disabled' });
    return;
  }
  req.user = toPublicUser(row);
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
