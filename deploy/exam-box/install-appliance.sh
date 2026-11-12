#!/usr/bin/env bash
# Exam Box appliance first-boot: pull GHCR image + compose up.
# Run on the mini-PC / Pi (Linux + Docker). Does not flip examBoxHardware.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
    echo "Wrote .env from .env.example — edit CD_API_BASE before continuing."
    exit 2
  fi
  echo "Missing .env (CD_API_BASE=http://教师机LAN:8787)" >&2
  exit 2
fi

# shellcheck disable=SC1091
source .env
if [[ -z "${CD_API_BASE:-}" ]]; then
  echo "CD_API_BASE empty in .env" >&2
  exit 2
fi
if [[ "$CD_API_BASE" == *"127.0.0.1"* ]] || [[ "$CD_API_BASE" == *"localhost"* ]]; then
  echo "CD_API_BASE must be the teacher LAN IP, not loopback." >&2
  exit 2
fi

OWNER="${EXAM_BOX_GHCR_OWNER:-otas0}"
TAG="${EXAM_BOX_IMAGE_TAG:-latest}"
IMAGE="ghcr.io/${OWNER}/classroom-desk-exam-box:${TAG}"

echo "Pulling ${IMAGE} ..."
docker pull "$IMAGE"
docker tag "$IMAGE" classroom-desk-exam-box:local

echo "Checking teacher API ${CD_API_BASE}/health ..."
curl -fsS --connect-timeout 5 --max-time 15 "${CD_API_BASE}/health" >/dev/null

docker compose up -d
echo "Exam Box proxy should listen on :8080"
curl -fsS --connect-timeout 5 --max-time 15 "http://127.0.0.1:8080/health" >/dev/null
LOC="$(curl -sI --connect-timeout 5 --max-time 15 "http://127.0.0.1:8080/" | tr -d '\r' | awk -F': ' 'tolower($1)=="location"{print $2}')"
if [[ "$LOC" != *portal* ]]; then
  echo "Expected redirect to /portal, got: ${LOC:-none}" >&2
  exit 2
fi

echo "OK — appliance up. Fill HARDWARE.md / teacher settings (serial + image tag + accept)."
echo "Image tag used: ${TAG}"
