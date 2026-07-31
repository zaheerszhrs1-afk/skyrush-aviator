#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/b9t9}"
cd "$APP_DIR"

docker compose --env-file .env.production up -d --build --remove-orphans
docker compose ps
docker image prune -f
