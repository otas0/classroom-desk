import { Router } from 'express';
import {
  countAdmins,
  createUser,
  findUserByUsername,
  signToken,
  toPublicUser,
  verifyPassword,
  writeAudit,
} from '../services/auth.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';

export const authRouter = Router();

authRouter.get('/bootstrap-status', (_req, res) => {
  res.json({ needsBootstrap: countAdmins() === 0 });
});

authRouter.post('/bootstrap', async (req, res) => {
  if (countAdmins() > 0) {
    res.status(409).json({ error: 'already_bootstrapped' });
    return;
  }
  const { displayName, username, password } = req.body ?? {};
  if (!displayName?.trim() || !username?.trim() || typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const user = await createUser({
    role: 'admin',
    displayName,
    username,
    password,
  });
  writeAudit('bootstrap.admin', { userId: user.id, username: user.username });
  const token = await signToken(user);
  res.status(201).json({ token, user });
});

authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username?.trim() || typeof password !== 'string') {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const row = findUserByUsername(username);
  if (!row || row.disabled_at) {
    res.status(401).json({ error: 'invalid_credentials' });
    return;
  }
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) {
    res.status(401).json({ error: 'invalid_credentials' });
    return;
  }
  const user = toPublicUser(row);
  const token = await signToken(user);
  writeAudit('auth.login', { userId: user.id }, user);
  res.json({ token, user });
});

authRouter.get('/me', requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: req.user });
});
