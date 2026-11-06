import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDataDir } from './db/client.js';
import { assignmentsRouter } from './routes/assignments.js';
import { attendanceRouter } from './routes/attendance.js';
import { authRouter } from './routes/auth.js';
import { classesRouter } from './routes/classes.js';
import { exportsRouter } from './routes/exports.js';
import { healthRouter } from './routes/health.js';
import { messagesRouter } from './routes/messages.js';
import { pointRequestsRouter } from './routes/pointRequests.js';
import { pointsRouter } from './routes/points.js';
import { presenceRouter } from './routes/presence.js';
import { questionsRouter } from './routes/questions.js';
import { settingsRouter } from './routes/settings.js';
import { uploadsRouter } from './routes/uploads.js';

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

  app.use(healthRouter);
  app.use(settingsRouter);
  app.use(authRouter);
  app.use(classesRouter);
  app.use(assignmentsRouter);
  app.use(pointRequestsRouter);
  app.use(pointsRouter);
  app.use(attendanceRouter);
  app.use(presenceRouter);
  app.use(messagesRouter);
  app.use(questionsRouter);
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
