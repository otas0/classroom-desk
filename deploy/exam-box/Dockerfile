# Build from repository root:
#   docker build -f deploy/exam-box/Dockerfile -t classroom-desk-exam-box:local .
FROM caddy:2-alpine
RUN apk add --no-cache bash curl jq
COPY deploy/exam-box/Caddyfile /etc/caddy/Caddyfile
COPY deploy/opennds/auth_allowlist.sh /usr/local/bin/cd-opennds-allowlist.sh
COPY deploy/opennds/binauth.sh /usr/local/bin/cd-opennds-binauth.sh
RUN chmod +x /usr/local/bin/cd-opennds-allowlist.sh /usr/local/bin/cd-opennds-binauth.sh
LABEL org.opencontainers.image.title="Classroom Desk Exam Box" \
      org.opencontainers.image.description="Exam Box sidecar (Caddy + openNDS allowlist/BinAuth helpers)"
