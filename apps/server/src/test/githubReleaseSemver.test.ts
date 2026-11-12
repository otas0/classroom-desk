import assert from 'node:assert/strict';
import {
  compareSemver,
  isReleaseSideAsset,
  isSetupAssetName,
} from '../services/githubRelease.js';

assert.equal(compareSemver('0.1.7', '0.1.7'), 0);
assert.equal(compareSemver('v0.1.8', '0.1.7'), 1);
assert.equal(compareSemver('0.1.6', '0.1.7'), -1);
assert.equal(compareSemver('0.2.0', '0.1.9'), 1);
assert.ok(isSetupAssetName('ClassroomDesk-Setup-0.1.7-x64.exe'));
assert.ok(isSetupAssetName('ClassroomDesk-Setup-0.1.7-arm64.exe'));
assert.ok(!isSetupAssetName('notes.txt'));
assert.ok(isReleaseSideAsset('ClassroomDesk-Setup-0.1.7-x64.exe.sha256'));
assert.ok(isReleaseSideAsset('ClassroomDesk-Setup-0.1.7-x64.exe.blockmap'));

console.log('githubReleaseSemver.test.ts: ok');
