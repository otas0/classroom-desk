#!/usr/bin/env bash
set -euo pipefail
cp -f packages/i18n/locales/portal/*.json apps/server/public/portal/i18n/
echo "portal i18n synced → apps/server/public/portal/i18n"
