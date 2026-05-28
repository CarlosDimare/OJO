#!/usr/bin/env bash
set -e
PORT="${PORT:-5000}"

# Ensure dependencies are installed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  pnpm install
fi

# Build if needed
if [ ! -f "artifacts/api-server/dist/index.mjs" ]; then
  echo "Building workspace..."
  pnpm run build
elif [ ! -f "artifacts/web-terminal/dist/public/index.html" ]; then
  echo "Building frontend..."
  PORT=5000 BASE_PATH=/ pnpm --filter @workspace/web-terminal run build
fi

# Start backend (which serves both API + frontend)
export PORT
exec node --enable-source-maps ./artifacts/api-server/dist/index.mjs
