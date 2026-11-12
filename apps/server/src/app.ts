import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDataDir } from './db/client.js';
import { assignmentsRouter } from './routes/assignments.js';
import { attendanceRouter } from './routes/attendance.js';
import { auditRouter } from './routes/audit.js';
import { assistantGrantsRouter } from './routes/assistantGrants.js';
import { authRouter } from './routes/auth.js';
import { classesRouter } from './routes/classes.js';
import { exportsRouter } from './routes/exports.js';
import { healthRouter } from './routes/health.js';
import { messagesRouter } from './routes/messages.js';
import { opsRouter } from './routes/ops.js';
import { packsRouter } from './routes/packs.js';
import { pointRequestsRouter } from './routes/pointRequests.js';
import { pointsRouter } from './routes/points.js';
import { presenceRouter } from './routes/presence.js';
import { questionsRouter } from './routes/questions.js';
import { reportsRouter } from './routes/reports.js';
import { seatsRouter } from './routes/seats.js';
import { sessionLiveRouter } from './routes/sessionLive.js';
import { settingsRouter } from './routes/settings.js';
import { upgradesRouter } from './routes/upgrades.js';
import { uploadsRouter } from './routes/uploads.js';
import { deepLockRouter } from './routes/deepLock.js';
import { deviceControlRouter } from './routes/deviceControl.js';
import { networkZonesRouter } from './routes/networkZones.js';
import { portalRouter } from './routes/portal.js';
import { principalRouter } from './routes/principal.js';
import { federationRouter } from './routes/federation.js';
import { c2EvidenceRouter } from './routes/c2Evidence.js';
import { endOfLessonRouter } from './routes/endOfLesson.js';
import { gatewayLiveRouter } from './routes/gatewayLive.js';
import { deskDnsRouter } from './routes/deskDns.js';
import { shieldWizardRouter } from './routes/shieldWizard.js';
import { versionForceReportRouter } from './routes/versionForceReport.js';

function resolveTeacherDist(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, '../../../teacher-web/dist'),
    path.resolve(process.cwd(), '../teacher-web/dist'),
    path.resolve(process.cwd(), 'apps/teacher-web/dist'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) return candidate;
  }
  return null;
}

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use('/uploads', express.static(path.join(getDataDir(), 'uploads')));
  const upgradesPath = process.env.CLASSROOM_DESK_UPGRADES_DIR
    ? path.resolve(process.env.CLASSROOM_DESK_UPGRADES_DIR)
    : path.join(getDataDir(), 'upgrades');
  fs.mkdirSync(upgradesPath, { recursive: true });
  app.use('/upgrades', express.static(upgradesPath));
  const serverPublic = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public');
  app.use(express.static(serverPublic, { index: false }));

  app.use(healthRouter);
  app.use(settingsRouter);
  app.use(deepLockRouter);
  app.use(deviceControlRouter);
  app.use(networkZonesRouter);
  app.use(portalRouter);
  app.use(principalRouter);
  app.use(federationRouter);
  app.use(c2EvidenceRouter);
  app.use(endOfLessonRouter);
  app.use(gatewayLiveRouter);
  app.use(deskDnsRouter);
  app.use(shieldWizardRouter);
  app.use(versionForceReportRouter);
  app.use(authRouter);
  app.use(assistantGrantsRouter);
  app.use(auditRouter);
  app.use(opsRouter);
  app.use(classesRouter);
  app.use(seatsRouter);
  app.use(assignmentsRouter);
  app.use(pointRequestsRouter);
  app.use(pointsRouter);
  app.use(attendanceRouter);
  app.use(presenceRouter);
  app.use(sessionLiveRouter);
  app.use(messagesRouter);
  app.use(questionsRouter);
  app.use(packsRouter);
  app.use(reportsRouter);
  app.use(upgradesRouter);
  app.use(exportsRouter);
  app.use(uploadsRouter);

  const teacherDist = resolveTeacherDist();
  if (teacherDist) {
    app.use(
      '/admin',
      express.static(teacherDist, {
        index: false,
        setHeaders(res, filePath) {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          } else {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
    // SPA fallback: deep links under /admin/* serve index.html (no-cache).
    app.get(/^\/admin(?:\/.*)?$/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.sendFile(path.join(teacherDist, 'index.html'));
    });
    console.log(`[classroom-desk-server] teacher admin UI: /admin (${teacherDist})`);
  }

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  return app;
}
