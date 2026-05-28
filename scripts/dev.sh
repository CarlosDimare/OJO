#!/usr/bin/env bash
set -e

BACKEND_PORT="${BACKEND_PORT:-5000}"
VITE_PORT="${VITE_PORT:-5173}"

# Ensure dependencies and dist exist
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  pnpm install
fi
if [ ! -f "artifacts/api-server/dist/index.mjs" ]; then
  echo "Building workspace..."
  pnpm run build
fi

# Start backend
echo "Starting backend on port ${BACKEND_PORT}..."
PORT=${BACKEND_PORT} node --enable-source-maps ./artifacts/api-server/dist/index.mjs &
BACKEND_PID=$!

# Wait for backend to be ready
for i in $(seq 1 15); do
  if curl -s http://localhost:${BACKEND_PORT}/api/redaccion >/dev/null 2>&1; then
    echo "Backend ready on port ${BACKEND_PORT}"
    break
  fi
  if [ $i -eq 15 ]; then
    echo "WARNING: Backend not ready after 15s, starting Vite anyway"
  fi
  sleep 1
done

# Start Vite dev server
echo "Starting Vite on port ${VITE_PORT}..."
PORT=${VITE_PORT} BASE_PATH=/ pnpm --filter @workspace/web-terminal run dev &
VITE_PID=$!

echo ""
echo "==================================="
echo " Backend:  http://localhost:${BACKEND_PORT}"
echo " Vite:     http://localhost:${VITE_PORT}"
echo "==================================="
echo " Backend PID: ${BACKEND_PID}"
echo " Vite PID:    ${VITE_PID}"
echo ""

# Wait for either to exit
wait 2>/dev/null
