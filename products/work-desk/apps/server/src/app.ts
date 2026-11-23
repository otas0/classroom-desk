import express from 'express';
import cors from 'cors';
import { APP_NAME, APP_NOTICE } from '@work-desk/shared';
import { authRouter } from './routes/auth.js';
import { departmentsRouter } from './routes/departments.js';
import { employeesRouter } from './routes/employees.js';
import { timeRouter } from './routes/time.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cors());
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/v1/health', (_req, res) => {
    res.json({ ok: true, name: APP_NAME, notice: APP_NOTICE });
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/departments', departmentsRouter);
  app.use('/api/v1/employees', employeesRouter);
  app.use('/api/v1/time', timeRouter);

  return app;
}
