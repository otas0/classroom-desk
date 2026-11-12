# Classroom Desk federation hub (campus rendezvous)

Small standalone service that collects **podium announce** payloads from many teacher PCs so students can discover classrooms without scanning every `/24`.

## Run

```bash
cd deploy/federation-hub
export FEDERATION_HUB_TOKEN='choose-a-long-random-secret'
export PORT=8790
npm install
npm start
```

Endpoints:

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/health` | none |
| `GET` | `/api/v1/federation/peers` | none |
| `POST` | `/api/v1/federation/ingest` | `Authorization: Bearer $FEDERATION_HUB_TOKEN` |

Peers expire after 5 minutes without refresh (same TTL as in-app LAN federation).

## Point teacher servers at the hub

On each **teacher Classroom Desk API** host:

```bash
export CLASSROOM_DESK_FEDERATION_HUB='https://hub.school.edu:8790/api/v1/federation/ingest'
export CLASSROOM_DESK_FEDERATION_HUB_TOKEN='same-secret-as-hub'
```

The server already announces locally every 60s; with these env vars it also `POST`s the same JSON body to the hub.

Students listing federation peers should call the hub `GET /api/v1/federation/peers` (or stay on-LAN via their teacher’s own API if co-located).

## Reverse proxy

Terminate TLS at nginx/Caddy and forward to `127.0.0.1:8790`. Do not expose ingest without the bearer token.

## Manual ops

- Rotate `FEDERATION_HUB_TOKEN` on hub and all teachers together.
- Hub state is in-memory only; restart clears peers until teachers re-announce.
