import { Router } from 'express';
import type { RuleAction } from '@brand-family/shared';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { createAppRule, deleteAppRule, listAppRules } from '../services/rules.js';
import { writeAudit } from '../services/auth.js';

const ACTIONS = new Set<RuleAction>(['allow', 'block']);

export const appRulesRouter = Router();

appRulesRouter.use(requireAuth, requireRoles('parent'));

appRulesRouter.get('/', (req: AuthedRequest, res) => {
  res.json({ rules: listAppRules(req.user!.id) });
});

appRulesRouter.post('/', (req: AuthedRequest, res) => {
  const { childId, appId, appLabel, action } = req.body ?? {};
  if (!childId?.trim() || !appId?.trim() || !ACTIONS.has(action)) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  try {
    const rule = createAppRule(req.user!.id, { childId, appId, appLabel, action });
    if (!rule) {
      res.status(404).json({ error: 'child_not_found' });
      return;
    }
    writeAudit('app_rule.create', { ruleId: rule.id }, req.user);
    res.status(201).json({ rule });
  } catch {
    res.status(409).json({ error: 'duplicate_app' });
  }
});

appRulesRouter.delete('/:id', (req: AuthedRequest, res) => {
  const ok = deleteAppRule(req.user!.id, req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  writeAudit('app_rule.delete', { ruleId: req.params.id }, req.user);
  res.json({ ok: true });
});
