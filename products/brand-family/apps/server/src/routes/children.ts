import { Router } from 'express';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { createChild, deleteChild, listChildren } from '../services/children.js';
import { writeAudit } from '../services/auth.js';

export const childrenRouter = Router();

childrenRouter.use(requireAuth, requireRoles('parent'));

childrenRouter.get('/', (req: AuthedRequest, res) => {
  res.json({ children: listChildren(req.user!.id) });
});

childrenRouter.post('/', (req: AuthedRequest, res) => {
  const { displayName, note } = req.body ?? {};
  if (!displayName?.trim()) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const child = createChild(req.user!.id, { displayName, note });
  writeAudit('child.create', { childId: child.id }, req.user);
  res.status(201).json({ child });
});

childrenRouter.delete('/:id', (req: AuthedRequest, res) => {
  const ok = deleteChild(req.user!.id, req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  writeAudit('child.delete', { childId: req.params.id }, req.user);
  res.json({ ok: true });
});
