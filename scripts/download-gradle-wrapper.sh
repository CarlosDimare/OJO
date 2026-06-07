#!/bin/bash
# scripts/download-gradle-wrapper.sh
set -e

WRAPPER_DIR="../gradle/wrapper"
mkdir -p "$WRAPPER_DIR"

echo "Descargando gradle-wrapper.jar..."
wget -q "https://raw.githubusercontent.com/gradle/gradle/v8.4.0/gradle/wrapper/gradle-wrapper.jar" \
     -O "$WRAPPER_DIR/gradle-wrapper.jar" || \
wget -q "https://services.gradle.org/distributions/gradle-8.4-wrapper.jar" \
     -O "$WRAPPER_DIR/gradle-wrapper.jar"

echo "✅ gradle-wrapper.jar descargado"
