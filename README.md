# OpenCode Android

APK mínima para ejecutar **opencode-ai** en Android sin Termux.

## Arquitectura

```
APK
├── MainActivity       → Pantalla de setup (primera vez)
├── TerminalActivity   → Terminal xterm.js en WebView
├── assets/
│   ├── alpine-arm64.tar.gz      → Alpine Linux ARM64 (rootfs)
│   ├── bun-linux-aarch64.zip    → Bun runtime
│   └── proot-static-arm64       → proot sin root
└── java/
    ├── MainActivity.java         → Extrae assets, instala opencode
    └── TerminalActivity.java     → UI terminal + comunicación con proceso
```

**Flujo:**
1. Primera apertura: extrae Alpine + Bun, instala `opencode-ai` vía npm dentro de proot
2. Aperturas posteriores: lanza directamente `opencode` en proot Alpine

---

## Requisitos para compilar

- Docker instalado y corriendo
- Conexión a internet (descarga Android SDK + Alpine + Bun)
- ~8GB de espacio libre (imagen Docker temporal)

---

## Pasos para compilar

```bash
# 1. Clonar / descomprimir este proyecto
cd opencode-android

# 2. Ejecutar el build (todo dentro de Docker, no necesitás Android Studio)
chmod +x BUILD.sh
./BUILD.sh

# 3. El APK queda en:
output/opencode.apk
```

### Instalar en el teléfono

**Opción A — ADB (con cable o WiFi):**
```bash
adb install output/opencode.apk
```

**Opción B — Manual:**
- Copiar `opencode.apk` al teléfono
- Activar "Fuentes desconocidas" en Ajustes → Seguridad
- Abrir el APK desde el administrador de archivos

---

## Primera ejecución en el teléfono

1. Abrir la app **OpenCode**
2. Espera ~3-5 minutos mientras instala (solo la primera vez):
   - Extrae Alpine Linux ARM64
   - Instala Node.js + npm dentro de Alpine
   - Instala `opencode-ai` globalmente
3. Se abre el terminal automáticamente
4. Configurar tu API key:
   ```
   opencode config set ANTHROPIC_API_KEY sk-ant-...
   ```

---

## Requisitos del teléfono

| Requisito | Mínimo |
|-----------|--------|
| Android   | 8.0 (API 26) |
| Arquitectura | ARM64 (casi todos los teléfonos desde 2016) |
| RAM libre | ~512MB |
| Almacenamiento | ~500MB (Alpine + opencode) |
| Internet | Solo para instalar y usar la AI |

---

## Notas técnicas

- **Sin root**: proot emula el entorno Linux sin privilegios
- **Alpine Linux**: rootfs mínimo (~5MB), solo lo necesario
- **Bun**: runtime JS ultrarrápido para ARM64
- **xterm.js**: emulador VT100 completo en WebView
- **Sin Termux**: la app es autónoma

---

## Personalización

### Cambiar el modelo AI por defecto
Editar `app/src/main/java/.../MainActivity.java`:
```java
// En writeInstallScript(), agregar después de la instalación:
pw.println("opencode config set model anthropic/claude-sonnet-4-6");
```

### Usar modelo local (Ollama en red local)
Dentro del terminal de la app:
```bash
opencode config set provider ollama
opencode config set model llama3
```

---

## Troubleshooting

**"proot: /proc/self/exe: no such file"**
→ El teléfono tiene SELinux muy restrictivo. Probar en modo desarrollador.

**"npm: not found"**
→ La instalación de Alpine falló. Borrar datos de la app y volver a abrir.

**La terminal no responde al teclado**
→ Tocar la pantalla del WebView para activar el foco.

**opencode no conecta a la API**
→ Verificar que el teléfono tiene internet y la API key es válida.
