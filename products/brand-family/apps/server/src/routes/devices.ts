import { Router } from 'express';
import type { DevicePlatform } from '@brand-family/shared';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { createDevice, deleteDevice, listDevices } from '../services/devices.js';
import { writeAudit } from '../services/auth.js';

const PLATFORMS = new Set<DevicePlatform>(['ios', 'android', 'windows', 'macos', 'other']);

export const devicesRouter = Router();

devicesRouter.use(requireAuth, requireRoles('parent'));

devicesRouter.get('/', (req: AuthedRequest, res) => {
  res.json({ devices: listDevices(req.user!.id) });
});

devicesRouter.post('/', (req: AuthedRequest, res) => {
  const { childId, name, platform } = req.body ?? {};
  if (!childId?.trim() || !name?.trim() || !PLATFORMS.has(platform)) {
    res.status(400).json({ error: 'invalid_input' });
    return;
  }
  const device = createDevice(req.user!.id, { childId, name, platform });
  if (!device) {
    res.status(404).json({ error: 'child_not_found' });
    return;
  }
  writeAudit('device.create', { deviceId: device.id }, req.user);
  res.status(201).json({ device });
});

devicesRouter.delete('/:id', (req: AuthedRequest, res) => {
  const ok = deleteDevice(req.user!.id, req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  writeAudit('device.delete', { deviceId: req.params.id }, req.user);
  res.json({ ok: true });
});
