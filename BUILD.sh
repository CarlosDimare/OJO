#!/bin/bash
# ============================================================
#  OpenCode Android Builder
#  Requisitos: Docker
# ============================================================
set -e

if ! command -v docker &> /dev/null; then
  echo "Docker no encontrado. Instalalo desde https://docker.com"
  exit 1
fi

mkdir -p output
docker build -f Dockerfile.build -t opencode-android-builder .
docker run --rm -v "$PWD/output:/output" opencode-android-builder

echo ""
echo "APK generada: output/opencode.apk"
