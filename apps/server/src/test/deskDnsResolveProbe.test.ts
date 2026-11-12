import assert from 'node:assert/strict';
import { probeDeskDnsResolution } from '../services/deskDnsProbe.js';

{
  const r = await probeDeskDnsResolution({
    hostname: 'probe.example',
    teacherIps: ['10.0.0.1'],
    resolve4: async () => ['10.0.0.1', '10.0.0.2'],
  });
  assert.equal(r.pointsAtTeacher, true);
  assert.deepEqual(r.resolved, ['10.0.0.1', '10.0.0.2']);
}

{
  const r = await probeDeskDnsResolution({
    hostname: 'bad.example',
    teacherIps: ['192.168.1.10'],
    resolve4: async () => ['8.8.8.8'],
  });
  assert.equal(r.pointsAtTeacher, false);
}

console.log('deskDnsResolveProbe.test.ts ok');
