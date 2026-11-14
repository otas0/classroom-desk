/**
 * One-click「本班专用」USB pack: config + class card + optional Setup.exe/sha + C2 checklist.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { openDb } from '../db/client.js';
import { getSetting } from '../db/migrate.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { config } from '../config.js';
import { resolveAdvertiseLanIp, listDetectedLanIpv4s } from '../services/lanNetwork.js';
import { writeAudit } from '../services/audit.js';
import { buildStoreZip } from '../utils/simpleZip.js';
import { nowIso } from '../utils/id.js';

export const usbClassPackRouter = Router();

const VERSION = process.env.CD_SETUP_VERSION || '0.1.7';

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
}

function resolveApiBase(db: ReturnType<typeof openDb>): string {
  const stored = String(getSetting(db, 'classroom_api_base') ?? '')
    .trim()
    .replace(/\/$/, '');
  if (stored && !/127\.0\.0\.1|localhost/i.test(stored)) return stored;
  const adv = resolveAdvertiseLanIp(db);
  if (adv) return `http://${adv}:${config.port}`;
  const lan = listDetectedLanIpv4s()[0];
  if (lan) return `http://${lan}:${config.port}`;
  return `http://127.0.0.1:${config.port}`;
}

function findSetupArtifacts(): Array<{ name: string; path: string }> {
  const root = repoRoot();
  const names = [
    `ClassroomDesk-Setup-${VERSION}-x64.exe`,
    `ClassroomDesk-Setup-${VERSION}.exe`,
    `ClassroomDesk-Setup-${VERSION}-arm64.exe`,
  ];
  const dirs = [
    path.join(root, 'artifacts', 'windows-pack-check'),
    path.join(root, 'apps', 'student-desktop', 'release'),
  ];
  // Prefer releases/<ip>/ if any
  const releases = path.join(root, 'releases');
  if (fs.existsSync(releases)) {
    for (const ent of fs.readdirSync(releases, { withFileTypes: true })) {
      if (ent.isDirectory()) dirs.unshift(path.join(releases, ent.name));
    }
  }
  const out: Array<{ name: string; path: string }> = [];
  const seen = new Set<string>();
  for (const name of names) {
    for (const dir of dirs) {
      const p = path.join(dir, name);
      if (fs.existsSync(p) && !seen.has(name)) {
        seen.add(name);
        out.push({ name, path: p });
        break;
      }
    }
  }
  return out;
}

function sha256File(filePath: string): string {
  const h = createHash('sha256');
  h.update(fs.readFileSync(filePath));
  return h.digest('hex');
}

usbClassPackRouter.get(
  '/api/v1/usb-class-pack',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = String(req.query.classId ?? '').trim();
    if (!classId) {
      res.status(400).json({ error: 'class_id_required' });
      return;
    }
    const db = openDb();
    const klass = db
      .prepare(`SELECT id, name FROM classes WHERE id = ?`)
      .get(classId) as { id: string; name: string } | undefined;
    if (!klass) {
      res.status(404).json({ error: 'class_not_found' });
      return;
    }

    const apiBase = resolveApiBase(db);
    const displayName = String(getSetting(db, 'classroom_display_name') ?? '').trim();
    const roomId = String(getSetting(db, 'classroom_room_id') ?? '').trim();
    const packedAt = nowIso();

    const configJson = {
      apiBase,
      classId: klass.id,
      className: klass.name,
      classroomDisplayName: displayName || undefined,
      classroomRoomId: roomId || undefined,
      comment: '本班专用 U 盘配置。学生机禁止使用 127.0.0.1。',
      packedAt,
    };

    const setupFiles = findSetupArtifacts();
    const shaLines: string[] = [];
    for (const s of setupFiles) {
      const hash = sha256File(s.path);
      shaLines.push(`${hash}  ${s.name}`);
    }

    const classCard = [
      'Classroom Desk · 本班专用 U 盘包',
      `班级：${klass.name}`,
      `classId：${klass.id}`,
      `apiBase：${apiBase}`,
      displayName ? `讲台显示名：${displayName}` : '',
      roomId ? `教室号：${roomId}` : '',
      `打包时间：${packedAt}`,
      '',
      '安装步骤：',
      '1. 在学生机运行 ClassroomDesk-Setup-*.exe（若本包含安装包）',
      '2. 将 classroom-desk-config.json 拷到学生端配置目录（或启动后导入）',
      '3. 浏览器打开 apiBase/health 确认可达，禁止 127.0.0.1',
      '4. C2 勾选见 C2-USB-CHECKLIST.txt；座位对照见 SEAT-MAP 说明',
      '',
      ...(shaLines.length
        ? ['安装包 SHA256：', ...shaLines]
        : ['（本包未含 Setup.exe：请从 GitHub Release / artifacts 另拷安装包）']),
      '',
    ]
      .filter((line) => line !== undefined)
      .join('\n');

    const readme = [
      '# 本班专用 U 盘包',
      '',
      '本 zip 由教师端「本班专用一键打包」生成，绑定当前班级。',
      '',
      '| 文件 | 说明 |',
      '|---|---|',
      '| classroom-desk-config.json | 学生端 apiBase + classId |',
      '| CLASS-CARD.txt | 本班身份卡（可打印） |',
      '| C2-USB-CHECKLIST.txt | 现场 C2 勾选 |',
      '| ClassroomDesk-Setup-*.exe | 安装包（若教师机本地有缓存） |',
      '| *.sha256 | 校验和 |',
      '',
      '命令行等价：`CD_CLASS_ID=… bash scripts/prepare-usb-pack.sh <IP>`',
      '详见 docs/LOCAL_USB_CHECKLIST.md',
      '',
    ].join('\n');

    const c2ChecklistPath = path.join(repoRoot(), 'releases');
    let c2Body = '';
    // Prefer freshly written checklist from prepare-usb-pack if present under any release dir
    if (fs.existsSync(c2ChecklistPath)) {
      for (const ent of fs.readdirSync(c2ChecklistPath, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const p = path.join(c2ChecklistPath, ent.name, 'C2-USB-CHECKLIST.txt');
        if (fs.existsSync(p)) {
          c2Body = fs.readFileSync(p, 'utf8');
          break;
        }
      }
    }
    if (!c2Body) {
      c2Body = [
        'C2 / 现场勾选（本班专用包）',
        '',
        '□ 安装 Release exe + 本班 classroom-desk-config.json',
        '□ health 可达且非 127.0.0.1',
        '□ 一键连班 / 扫码 / U 盘配置任一路径可连本班',
        '□ 深锁演示：冻结 / 仅试卷 / 下课恢复',
        '□ （机房考试）Assigned Access + C2 证据夹见教师「加固体检」',
        '',
        '证据：证据/C2-YYYYMMDD/ · 导出：教师端「导出 C2 验收 PDF」',
        '',
      ].join('\n');
    }

    const files: Array<{ name: string; data: Buffer | string }> = [
      {
        name: 'classroom-desk-config.json',
        data: JSON.stringify(configJson, null, 2) + '\n',
      },
      { name: 'CLASS-CARD.txt', data: classCard },
      { name: 'README-本班专用.md', data: readme },
      { name: 'C2-USB-CHECKLIST.txt', data: c2Body },
      {
        name: 'CLASS-PACK.json',
        data:
          JSON.stringify(
            {
              format: 'classroom-desk-usb-class-pack',
              version: 1,
              classId: klass.id,
              className: klass.name,
              apiBase,
              packedAt,
              setup: setupFiles.map((s) => s.name),
              sha256: shaLines,
            },
            null,
            2,
          ) + '\n',
      },
    ];

    for (const s of setupFiles) {
      files.push({ name: s.name, data: fs.readFileSync(s.path) });
      const shaBeside = `${s.path}.sha256`;
      if (fs.existsSync(shaBeside)) {
        files.push({ name: `${s.name}.sha256`, data: fs.readFileSync(shaBeside) });
      } else {
        const hash = sha256File(s.path);
        files.push({ name: `${s.name}.sha256`, data: `${hash}  ${s.name}\n` });
      }
    }

    const zip = buildStoreZip(files);
    const safeName = klass.name.replace(/[^\w\u4e00-\u9fff-]+/g, '_').slice(0, 40) || 'class';
    const filename = `usb-class-pack-${safeName}-${klass.id.slice(0, 8)}.zip`;

    writeAudit({
      actorUserId: req.user?.id ?? null,
      actorRole: req.user?.role ?? 'teacher',
      action: 'usb.class_pack',
      detail: {
        classId: klass.id,
        className: klass.name,
        apiBase,
        setupCount: setupFiles.length,
        bytes: zip.length,
      },
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(zip);
  },
);
