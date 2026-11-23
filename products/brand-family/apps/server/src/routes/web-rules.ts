import { Router } from 'express';
import type { RuleAction } from '@brand-family/shared';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { createWebRule, deleteWebRule, listWebRules } from '../services/rules.js';
import { writeAudit } from '../services/auth.js';

const ACTIONS = new Set<RuleAction>(['allow', 'block']);

export const webRulesRouter = Router();

webRulesRouter.use(requireAuth, requireRoles('parent'));

webRulesRouter.get('/', (req: AuthedRequest, res) => {
  res.json({ rules: listWebRules(req.user!.id) });
});

webRulesRouter.post('/', (req: AuthedRequest, res) => {
  const { childId, domain, action } = req.body ?? {};
  if (!childId?.trim() || !domain?.trim() || !ACTIONS.has(action)) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  try {
    const rule = createWebRule(req.user!.id, { childId, domain, action });
    if (!rule) {
      res.status(404).json({ error: 'child_not_found' });
      return;
    }
    writeAudit('web_rule.create', { ruleId: rule.id }, req.user);
    res.status(201).json({ rule });
  } catch {
    res.status(409).json({ error: 'duplicate_domain' });
  }
});

webRulesRouter.delete('/:id', (req: AuthedRequest, res) => {
  const ok = deleteWebRule(req.user!.id, req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  writeAudit('web_rule.delete', { ruleId: req.params.id }, req.user);
  res.json({ ok: true });
});
