import { nanoid } from 'nanoid';
import type { AppRule, RuleAction, WebRule } from '@brand-family/shared';
import { getDb } from '../db/connection.js';
import { getChildOwned } from './children.js';

function normalizeDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
}

type WebRow = {
  id: string;
  child_id: string;
  child_name: string;
  domain: string;
  action: RuleAction;
  created_at: string;
};

type AppRow = {
  id: string;
  child_id: string;
  child_name: string;
  app_id: string;
  app_label: string | null;
  action: RuleAction;
  created_at: string;
};

function toWeb(row: WebRow): WebRule {
  return {
    id: row.id,
    childId: row.child_id,
    childName: row.child_name,
    domain: row.domain,
    action: row.action,
    createdAt: row.created_at,
  };
}

function toApp(row: AppRow): AppRule {
  return {
    id: row.id,
    childId: row.child_id,
    childName: row.child_name,
    appId: row.app_id,
    appLabel: row.app_label,
    action: row.action,
    createdAt: row.created_at,
  };
}

export function listWebRules(parentId: string): WebRule[] {
  const rows = getDb()
    .prepare(
      `SELECT r.id, r.child_id, c.display_name AS child_name, r.domain, r.action, r.created_at
       FROM web_rules r
       JOIN children c ON c.id = r.child_id
       WHERE c.parent_id = ?
       ORDER BY r.created_at ASC`,
    )
    .all(parentId) as WebRow[];
  return rows.map(toWeb);
}

export function createWebRule(
  parentId: string,
  input: { childId: string; domain: string; action: RuleAction },
): WebRule | null {
  if (!getChildOwned(parentId, input.childId)) return null;
  const domain = normalizeDomain(input.domain);
  if (!domain) return null;
  const id = nanoid();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO web_rules (id, child_id, domain, action, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, input.childId, domain, input.action, now);
  const row = getDb()
    .prepare(
      `SELECT r.id, r.child_id, c.display_name AS child_name, r.domain, r.action, r.created_at
       FROM web_rules r
       JOIN children c ON c.id = r.child_id
       WHERE r.id = ?`,
    )
    .get(id) as WebRow | undefined;
  return row ? toWeb(row) : null;
}

export function deleteWebRule(parentId: string, ruleId: string): boolean {
  const result = getDb()
    .prepare(
      `DELETE FROM web_rules
       WHERE id = ? AND child_id IN (SELECT id FROM children WHERE parent_id = ?)`,
    )
    .run(ruleId, parentId);
  return result.changes > 0;
}

export function listAppRules(parentId: string): AppRule[] {
  const rows = getDb()
    .prepare(
      `SELECT r.id, r.child_id, c.display_name AS child_name, r.app_id, r.app_label, r.action, r.created_at
       FROM app_rules r
       JOIN children c ON c.id = r.child_id
       WHERE c.parent_id = ?
       ORDER BY r.created_at ASC`,
    )
    .all(parentId) as AppRow[];
  return rows.map(toApp);
}

export function createAppRule(
  parentId: string,
  input: { childId: string; appId: string; appLabel?: string | null; action: RuleAction },
): AppRule | null {
  if (!getChildOwned(parentId, input.childId)) return null;
  const appId = input.appId.trim();
  if (!appId) return null;
  const id = nanoid();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO app_rules (id, child_id, app_id, app_label, action, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.childId, appId, input.appLabel?.trim() || null, input.action, now);
  const row = getDb()
    .prepare(
      `SELECT r.id, r.child_id, c.display_name AS child_name, r.app_id, r.app_label, r.action, r.created_at
       FROM app_rules r
       JOIN children c ON c.id = r.child_id
       WHERE r.id = ?`,
    )
    .get(id) as AppRow | undefined;
  return row ? toApp(row) : null;
}

export function deleteAppRule(parentId: string, ruleId: string): boolean {
  const result = getDb()
    .prepare(
      `DELETE FROM app_rules
       WHERE id = ? AND child_id IN (SELECT id FROM children WHERE parent_id = ?)`,
    )
    .run(ruleId, parentId);
  return result.changes > 0;
}
