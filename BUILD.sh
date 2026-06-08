#!/bin/bash
# ============================================================
#  OpenCode Android Builder
#  Requisitos: Docker, Java 17+, Android SDK (o solo Docker)
# ============================================================
set -e

echo "🔧 OpenCode Android Builder"
echo "==========================="

# Detectar si tiene Docker
if ! command -v docker &> /dev/null; then
  echo "❌ Docker no encontrado. Instálalo desde https://docker.com"
  exit 1
fi

echo "✅ Docker encontrado"
echo "📦 Construyendo imagen de build..."

docker build -f Dockerfile.build -t opencode-android-builder .

echo "🚀 Compilando APK..."
docker run --rm -v "$PWD/output:/output" opencode-android-builder

echo ""
echo "✅ APK generada en: output/opencode.apk"
echo "📲 Instalá con: adb install output/opencode.apk"
echo "   o copiá el APK a tu teléfono y abrilo"
