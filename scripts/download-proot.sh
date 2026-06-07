#!/bin/bash
# scripts/download-proot.sh
# Descarga proot estático para ARM64 y lo pone en assets
set -e

PROOT_VERSION="5.4.0"
ASSET_DIR="../app/src/main/assets"

mkdir -p "$ASSET_DIR"

echo "Descargando proot estático ARM64..."
wget -q "https://github.com/proot-me/proot/releases/download/v${PROOT_VERSION}/proot-v${PROOT_VERSION}-aarch64-static" \
     -O "$ASSET_DIR/proot-static-arm64"

chmod +x "$ASSET_DIR/proot-static-arm64"
echo "✅ proot descargado: $ASSET_DIR/proot-static-arm64"
