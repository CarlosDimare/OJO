#!/bin/sh
# Gradle wrapper script
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$JAVA_HOME/bin/java" \
  -classpath "$SCRIPT_DIR/gradle/wrapper/gradle-wrapper.jar" \
  org.gradle.wrapper.GradleWrapperMain "$@"
