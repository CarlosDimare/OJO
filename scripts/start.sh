#!/usr/bin/env bash
set -e
PORT="${PORT:-5000}"
# Build frontend if not already built
if [ ! -f "artifacts/web-terminal/dist/public/index.html" ]; then
  echo "Building frontend..."
  PORT=5000 BASE_PATH=/ pnpm --filter @workspace/web-terminal run build
fi
# Start backend (which serves both API + frontend)
export PORT
exec node --enable-source-maps ./artifacts/api-server/dist/index.mjs
