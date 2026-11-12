import express from 'express';

const PORT = Number(process.env.PORT ?? 8790);
const TOKEN = String(process.env.FEDERATION_HUB_TOKEN ?? '').trim();
const TTL_MS = 5 * 60_000;

/** @type {Map<string, object>} */
const peers = new Map();

function prune() {
  const now = Date.now();
  for (const [k, p] of peers) {
    const t = Date.parse(String(p.updatedAt ?? ''));
    if (!Number.isFinite(t) || now - t >= TTL_MS) peers.delete(k);
  }
}

function authIngest(req, res, next) {
  if (!TOKEN) {
    res.status(503).json({ error: 'hub_token_not_configured' });
    return;
  }
  const hdr = String(req.headers.authorization ?? '');
  const bearer = hdr.startsWith('Bearer ') ? hdr.slice(7).trim() : '';
  if (bearer !== TOKEN) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

const app = express();
app.use(express.json({ limit: '32kb' }));

app.get('/health', (_req, res) => {
  prune();
  res.json({ ok: true, peers: peers.size, tokenRequired: Boolean(TOKEN) });
});

app.get('/api/v1/federation/peers', (_req, res) => {
  prune();
  res.json({
    ok: true,
    peers: [...peers.values()].sort((a, b) =>
      String(a.displayName ?? a.roomId ?? a.apiBase).localeCompare(
        String(b.displayName ?? b.roomId ?? b.apiBase),
      ),
    ),
  });
});

app.post('/api/v1/federation/ingest', authIngest, (req, res) => {
  const body = req.body ?? {};
  const apiBase = String(body.apiBase ?? '')
    .trim()
    .replace(/\/$/, '');
  if (!apiBase || !/^https?:\/\//i.test(apiBase) || /127\.0\.0\.1|localhost/i.test(apiBase)) {
    res.status(400).json({ error: 'invalid_api_base' });
    return;
  }
  const peer = {
    apiBase,
    displayName: String(body.displayName ?? '').trim().slice(0, 64),
    roomId: String(body.roomId ?? '').trim().slice(0, 32),
    roomCode: body.roomCode ? String(body.roomCode).trim().slice(0, 16) : null,
    hostName: String(body.hostName ?? '').trim().slice(0, 64),
    classId: body.classId ? String(body.classId).trim() : null,
    className: body.className ? String(body.className).trim().slice(0, 64) : null,
    updatedAt: new Date().toISOString(),
  };
  peers.set(apiBase, peer);
  prune();
  res.json({ ok: true, peers: peers.size });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[federation-hub] listening :${PORT} token=${TOKEN ? 'set' : 'MISSING'}`);
});
