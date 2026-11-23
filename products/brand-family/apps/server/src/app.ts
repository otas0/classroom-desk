import express from 'express';
import cors from 'cors';
import { APP_NAME, APP_NOTICE } from '@brand-family/shared';
import { authRouter } from './routes/auth.js';
import { childrenRouter } from './routes/children.js';
import { devicesRouter } from './routes/devices.js';
import { webRulesRouter } from './routes/web-rules.js';
import { appRulesRouter } from './routes/app-rules.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cors());
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/v1/health', (_req, res) => {
    res.json({ ok: true, name: APP_NAME, notice: APP_NOTICE });
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/children', childrenRouter);
  app.use('/api/v1/devices', devicesRouter);
  app.use('/api/v1/web-rules', webRulesRouter);
  app.use('/api/v1/app-rules', appRulesRouter);

  return app;
}
