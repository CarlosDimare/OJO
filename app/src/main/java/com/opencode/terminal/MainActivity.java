package com.opencode.terminal;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.AsyncTask;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.view.View;
import java.io.*;
import java.util.zip.*;

public class MainActivity extends Activity {

    private TextView statusText;
    private ProgressBar progressBar;
    private static final String PREFS = "opencode_prefs";
    private static final String KEY_SETUP_DONE = "setup_done";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        statusText = findViewById(R.id.statusText);
        progressBar = findViewById(R.id.progressBar);

        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);

        if (prefs.getBoolean(KEY_SETUP_DONE, false)) {
            // Ya instalado, abrir terminal directamente
            launchTerminal();
        } else {
            // Primera vez: extraer Alpine + Bun + instalar opencode
            new SetupTask().execute();
        }
    }

    private void launchTerminal() {
        Intent intent = new Intent(this, TerminalActivity.class);
        startActivity(intent);
        finish();
    }

    private void setStatus(String msg) {
        runOnUiThread(() -> statusText.setText(msg));
    }

    private void updateProgress(int pct) {
        runOnUiThread(() -> progressBar.setProgress(pct));
    }

    // --------------------------------------------------------
    //  AsyncTask de setup (solo primera vez, ~2-3 min)
    // --------------------------------------------------------
    private class SetupTask extends AsyncTask<Void, String, Boolean> {

        @Override
        protected void onPreExecute() {
            progressBar.setVisibility(View.VISIBLE);
        }

        @Override
        protected Boolean doInBackground(Void... voids) {
            try {
                File rootfs = new File(getFilesDir(), "alpine-rootfs");
                File bunBin = new File(getFilesDir(), "bin/bun");

                // 1. Extraer Alpine ARM64 rootfs
                publishProgress("Extrayendo Alpine Linux ARM64...", "10");
                extractTarGz("alpine-arm64.tar.gz", rootfs);

                // 2. Extraer Bun ARM64
                publishProgress("Instalando Bun runtime...", "40");
                extractZipAsset("bun-linux-aarch64.zip", new File(getFilesDir(), "bin"));
                new File(getFilesDir(), "bin/bun-linux-aarch64").renameTo(bunBin);
                bunBin.setExecutable(true);

                // 3. Script de instalación de opencode dentro de proot
                publishProgress("Preparando script de instalación...", "55");
                writeInstallScript();

                // 4. Ejecutar proot para instalar opencode via bun/npm
                publishProgress("Instalando opencode-ai (puede tardar)...", "60");
                runInProot(new String[]{
                    "/bin/sh", "/install-opencode.sh"
                });

                // 5. Marcar como listo
                publishProgress("¡Listo!", "100");
                getSharedPreferences(PREFS, MODE_PRIVATE)
                    .edit().putBoolean(KEY_SETUP_DONE, true).apply();

                return true;
            } catch (Exception e) {
                e.printStackTrace();
                publishProgress("Error: " + e.getMessage(), "-1");
                return false;
            }
        }

        @Override
        protected void onProgressUpdate(String... values) {
            setStatus(values[0]);
            try {
                int pct = Integer.parseInt(values[1]);
                if (pct >= 0) updateProgress(pct);
            } catch (NumberFormatException ignored) {}
        }

        @Override
        protected void onPostExecute(Boolean success) {
            if (success) launchTerminal();
        }
    }

    // --------------------------------------------------------
    //  Helpers
    // --------------------------------------------------------

    private void extractTarGz(String assetName, File destDir) throws IOException {
        destDir.mkdirs();
        try (InputStream is = getAssets().open(assetName);
             GZIPInputStream gis = new GZIPInputStream(is)) {
            byte[] buf = new byte[8192];
            while (true) {
                byte[] header = new byte[512];
                if (readFully(gis, header, 512) < 512) break;

                // Check end-of-archive (two zero blocks)
                boolean end = true;
                for (byte b : header) {
                    if (b != 0) { end = false; break; }
                }
                if (end) break;

                // Parse octal size from bytes 124-135
                long size = 0;
                for (int i = 124; i < 136; i++) {
                    if (header[i] >= '0' && header[i] <= '7')
                        size = (size << 3) | (header[i] - '0');
                }

                // Parse name from bytes 0-99 + prefix 345-499
                String name = cString(header, 0, 100);
                if (header[345] != 0)
                    name = cString(header, 345, 155) + "/" + name;
                while (name.startsWith("/") || name.startsWith("./"))
                    name = name.substring(1);

                // Type flag at byte 156
                boolean isDir = header[156] == '5';
                File f = new File(destDir, name);

                if (isDir) {
                    f.mkdirs();
                } else {
                    f.getParentFile().mkdirs();
                    try (FileOutputStream fos = new FileOutputStream(f)) {
                        long remaining = size;
                        while (remaining > 0) {
                            int toRead = (int) Math.min(buf.length, remaining);
                            int n = gis.read(buf, 0, toRead);
                            if (n == -1) break;
                            fos.write(buf, 0, n);
                            remaining -= n;
                        }
                    }
                    if (name.contains("bin/") || name.endsWith(".so"))
                        f.setExecutable(true);
                }

                // Skip padding to next 512-byte boundary
                long skip = (512 - (size % 512)) % 512;
                while (skip > 0) skip -= gis.skip(skip);
            }
        }
    }

    private int readFully(InputStream is, byte[] buf, int len) throws IOException {
        int total = 0;
        while (total < len) {
            int n = is.read(buf, total, len - total);
            if (n == -1) break;
            total += n;
        }
        return total;
    }

    private String cString(byte[] buf, int off, int maxLen) {
        int end = off;
        while (end < off + maxLen && buf[end] != 0) end++;
        return new String(buf, off, end - off);
    }

    private void extractZipAsset(String assetName, File destDir) throws IOException {
        destDir.mkdirs();
        try (InputStream is = getAssets().open(assetName);
             ZipInputStream zis = new ZipInputStream(is)) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                File outFile = new File(destDir, entry.getName());
                if (!entry.isDirectory()) {
                    try (FileOutputStream fos = new FileOutputStream(outFile)) {
                        byte[] buf = new byte[8192];
                        int n;
                        while ((n = zis.read(buf)) != -1) fos.write(buf, 0, n);
                    }
                    outFile.setExecutable(true);
                }
                zis.closeEntry();
            }
        }
    }

    private void writeInstallScript() throws IOException {
        File script = new File(getFilesDir(), "alpine-rootfs/install-opencode.sh");
        try (PrintWriter pw = new PrintWriter(new FileWriter(script))) {
            pw.println("#!/bin/sh");
            pw.println("# Instalar Node/npm dentro de Alpine y luego opencode");
            pw.println("apk add --no-cache nodejs npm 2>&1");
            pw.println("npm install -g opencode-ai@latest 2>&1");
            pw.println("echo INSTALL_OK");
        }
        script.setExecutable(true);
    }

    /**
     * Ejecuta un comando dentro del proot Alpine sin necesitar root.
     * Usa proot del sistema Android + el rootfs Alpine extraído.
     */
    public void runInProot(String[] cmd) throws IOException, InterruptedException {
        File rootfs = new File(getFilesDir(), "alpine-rootfs");
        File prootBin = extractProot(); // extrae proot estático del asset

        String[] fullCmd = new String[]{
            prootBin.getAbsolutePath(),
            "--rootfs=" + rootfs.getAbsolutePath(),
            "-b", "/dev",
            "-b", "/proc",
            "-b", "/sys",
            "-b", getFilesDir().getAbsolutePath() + ":/host-data",
            "-w", "/root",
            "--kill-on-exit"
        };

        // Combinar proot + comando
        String[] combined = new String[fullCmd.length + cmd.length];
        System.arraycopy(fullCmd, 0, combined, 0, fullCmd.length);
        System.arraycopy(cmd, 0, combined, fullCmd.length, cmd.length);

        ProcessBuilder pb = new ProcessBuilder(combined);
        pb.environment().put("HOME", "/root");
        pb.environment().put("PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin");
        pb.redirectErrorStream(true);

        Process p = pb.start();
        // Leer output para logs
        try (BufferedReader br = new BufferedReader(new InputStreamReader(p.getInputStream()))) {
            String line;
            while ((line = br.readLine()) != null) {
                android.util.Log.d("OpenCode", line);
            }
        }
        p.waitFor();
    }

    private File extractProot() throws IOException {
        File prootBin = new File(getFilesDir(), "bin/proot");
        if (!prootBin.exists()) {
            prootBin.getParentFile().mkdirs();
            try (InputStream is = getAssets().open("proot-static-arm64");
                 FileOutputStream fos = new FileOutputStream(prootBin)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = is.read(buf)) != -1) fos.write(buf, 0, n);
            }
            prootBin.setExecutable(true);
        }
        return prootBin;
    }
}
