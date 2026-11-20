export const APP_NAME = 'Brand Family';

export const APP_NOTICE =
  '家长显式配置孩子设备、网页与 App 管控策略。品牌名待定。';

export type Role = 'parent';

export type RuleAction = 'allow' | 'block';

export type DevicePlatform = 'ios' | 'android' | 'windows' | 'macos' | 'other';

export interface PublicUser {
  id: string;
  role: Role;
  displayName: string;
  username: string;
}

export interface ChildProfile {
  id: string;
  displayName: string;
  note: string | null;
  createdAt: string;
}

export interface DeviceRecord {
  id: string;
  childId: string;
  childName?: string;
  name: string;
  platform: DevicePlatform;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface WebRule {
  id: string;
  childId: string;
  childName?: string;
  domain: string;
  action: RuleAction;
  createdAt: string;
}

export interface AppRule {
  id: string;
  childId: string;
  childName?: string;
  appId: string;
  appLabel: string | null;
  action: RuleAction;
  createdAt: string;
}
