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
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.GZIPInputStream;

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
                android.util.Log.e("OpenCode", "Setup failed", e);
                publishProgress("Error [" + e.getClass().getSimpleName() + "]: " + e.getMessage(), "-1");
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
             GZIPInputStream gzis = new GZIPInputStream(is);
             BufferedInputStream bis = new BufferedInputStream(gzis)) {
            extractTar(bis, destDir);
        }
    }

    private void extractTar(InputStream in, File destDir) throws IOException {
        byte[] header = new byte[512];
        byte[] buf = new byte[8192];
        String pendingLongName = null;

        while (true) {
            int bytesRead = readFully(in, header);
            if (bytesRead == -1) break;
            if (bytesRead < 512) throw new IOException("Truncated tar header");

            if (isZeroBlock(header)) {
                readFully(in, header);
                break;
            }

            byte typeflag = header[156];
            long size = parseOctal(header, 124, 12);

            if (typeflag == 'L') {
                byte[] nameData = new byte[(int) size];
                readFully(in, nameData);
                pendingLongName = new String(nameData, 0, (int) size - 1, "UTF-8");
                skipPadding(in, size);
                continue;
            }

            if (typeflag == 'K') {
                skipData(in, size);
                continue;
            }

            if (typeflag == 'x' || typeflag == 'g') {
                byte[] paxData = new byte[(int) size];
                readFully(in, paxData);
                String paxStr = new String(paxData, 0, (int) size, "UTF-8");
                String[] lines = paxStr.split("\n");
                for (String line : lines) {
                    int space = line.indexOf(' ');
                    if (space < 0) continue;
                    String kv = line.substring(space + 1);
                    int eq = kv.indexOf('=');
                    if (eq < 0) continue;
                    if (kv.substring(0, eq).equals("path")) {
                        pendingLongName = kv.substring(eq + 1);
                    }
                }
                skipPadding(in, size);
                continue;
            }

            String name;
            if (pendingLongName != null) {
                name = pendingLongName;
                pendingLongName = null;
            } else {
                name = extractString(header, 0, 100);
                String prefix = extractString(header, 345, 155);
                if (!prefix.isEmpty()) name = prefix + "/" + name;
            }

            if (name.startsWith("./")) name = name.substring(2);

            int mode = (int) parseOctal(header, 100, 8);
            File outFile = new File(destDir, name);

            if (!outFile.getCanonicalPath().startsWith(destDir.getCanonicalPath() + File.separator))
                throw new IOException("Entry outside target: " + name);

            if (typeflag == '5') {
                outFile.mkdirs();
            } else if (typeflag == '0' || typeflag == 0) {
                outFile.getParentFile().mkdirs();
                if (size > 0) {
                    try (FileOutputStream fos = new FileOutputStream(outFile)) {
                        long remaining = size;
                        while (remaining > 0) {
                            int toRead = (int) Math.min(buf.length, remaining);
                            int n = in.read(buf, 0, toRead);
                            if (n == -1) throw new IOException("Unexpected EOF reading " + name);
                            fos.write(buf, 0, n);
                            remaining -= n;
                        }
                    }
                }
                if ((mode & 0111) != 0) outFile.setExecutable(true);
            } else if (typeflag == '2') {
                outFile.getParentFile().mkdirs();
                String linkTarget = extractString(header, 157, 100);
                try {
                    android.system.Os.symlink(linkTarget, outFile.getAbsolutePath());
                } catch (Exception e) {
                    android.util.Log.w("OpenCode", "symlink failed: " + name + " -> " + linkTarget);
                }
            }

            skipPadding(in, size);
        }
    }

    private int readFully(InputStream in, byte[] b) throws IOException {
        int total = 0;
        while (total < b.length) {
            int n = in.read(b, total, b.length - total);
            if (n == -1) return total == 0 ? -1 : total;
            total += n;
        }
        return total;
    }

    private long parseOctal(byte[] b, int off, int len) {
        long val = 0;
        for (int i = off; i < off + len; i++) {
            byte c = b[i];
            if (c >= '0' && c <= '7') val = (val << 3) + (c - '0');
            else if (c == '\0' || c == ' ') break;
        }
        return val;
    }

    private String extractString(byte[] b, int off, int len) {
        int end = off;
        while (end < off + len && b[end] != 0) end++;
        return new String(b, off, end - off);
    }

    private boolean isZeroBlock(byte[] b) {
        for (int i = 0; i < 512; i++) if (b[i] != 0) return false;
        return true;
    }

    private void skipPadding(InputStream in, long dataSize) throws IOException {
        long pad = (512 - (dataSize % 512)) % 512;
        skipData(in, pad);
    }

    private void skipData(InputStream in, long count) throws IOException {
        while (count > 0) {
            long n = in.skip(count);
            if (n <= 0) {
                if (in.read() == -1) throw new IOException("Unexpected EOF during skip");
                count--;
            } else {
                count -= n;
            }
        }
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
