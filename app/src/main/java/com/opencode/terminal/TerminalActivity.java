package com.opencode.terminal;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.JavascriptInterface;
import android.view.WindowManager;
import java.io.*;

/**
 * TerminalActivity
 *
 * Muestra un emulador de terminal VT100 (xterm.js via WebView).
 * Se comunica con el proceso opencode via stdin/stdout en un hilo separado.
 */
public class TerminalActivity extends Activity {

    private WebView webView;
    private Process opencodeProcess;
    private OutputStream processStdin;
    private Thread outputThread;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Pantalla completa
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        setContentView(R.layout.activity_terminal);

        webView = findViewById(R.id.terminalWebView);
        setupWebView();
        loadTerminalUI();
        startOpencode();
    }

    private void setupWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        webView.setWebViewClient(new WebViewClient());
        webView.addJavascriptInterface(new TerminalBridge(), "AndroidBridge");
    }

    private void loadTerminalUI() {
        // HTML con xterm.js embebido desde CDN (requiere internet la primera vez)
        // Luego cacheado por WebView
        String html = "<!DOCTYPE html><html><head>" +
            "<meta name='viewport' content='width=device-width, initial-scale=1, user-scalable=no'>" +
            "<link rel='stylesheet' href='https://cdnjs.cloudflare.com/ajax/libs/xterm/5.3.0/xterm.min.css'/>" +
            "<style>" +
            "* { margin:0; padding:0; box-sizing:border-box; }" +
            "body { background:#0a0a0a; overflow:hidden; }" +
            "#terminal { width:100vw; height:100vh; }" +
            ".xterm-viewport { background:#0a0a0a !important; }" +
            "</style>" +
            "</head><body>" +
            "<div id='terminal'></div>" +
            "<script src='https://cdnjs.cloudflare.com/ajax/libs/xterm/5.3.0/xterm.min.js'></script>" +
            "<script src='https://cdnjs.cloudflare.com/ajax/libs/xterm/5.3.0/addon-fit/addon-fit.min.js'></script>" +
            "<script>" +
            "const term = new Terminal({" +
            "  cursorBlink: true," +
            "  fontSize: 13," +
            "  fontFamily: 'Menlo, Consolas, monospace'," +
            "  theme: { background:'#0a0a0a', foreground:'#e8e8e8', cursor:'#00ff88', selection:'rgba(0,255,136,0.3)' }," +
            "  cols: 120, rows: 40" +
            "});" +
            "const fitAddon = new FitAddon.FitAddon();" +
            "term.loadAddon(fitAddon);" +
            "term.open(document.getElementById('terminal'));" +
            "fitAddon.fit();" +
            "window.addEventListener('resize', () => fitAddon.fit());" +
            // Recibir output del proceso
            "window.writeToTerminal = function(data) { term.write(data); };" +
            // Enviar input al proceso
            "term.onData(data => { AndroidBridge.sendInput(data); });" +
            "term.writeln('\\x1b[32m OpenCode Terminal \\x1b[0m');" +
            "term.writeln('\\x1b[90mIniciando opencode...\\x1b[0m');" +
            "term.writeln('');" +
            "</script></body></html>";

        webView.loadDataWithBaseURL("https://opencode.local", html, "text/html", "UTF-8", null);
    }

    private void startOpencode() {
        new Thread(() -> {
            try {
                File rootfs = new File(getFilesDir(), "alpine-rootfs");
                File prootBin = new File(getFilesDir(), "bin/proot");
                File dataDir = getFilesDir();

                ProcessBuilder pb = new ProcessBuilder(
                    prootBin.getAbsolutePath(),
                    "--rootfs=" + rootfs.getAbsolutePath(),
                    "-b", "/dev",
                    "-b", "/proc",
                    "-b", "/sys",
                    "-b", dataDir.getAbsolutePath() + ":/host-data",
                    "-w", "/root",
                    "--kill-on-exit",
                    "/bin/sh", "-c",
                    "export PATH=/usr/local/bin:/usr/bin:/bin && opencode"
                );

                pb.environment().put("HOME", "/root");
                pb.environment().put("TERM", "xterm-256color");
                pb.environment().put("COLORTERM", "truecolor");
                pb.environment().put("LANG", "en_US.UTF-8");
                pb.redirectErrorStream(true);

                opencodeProcess = pb.start();
                processStdin = opencodeProcess.getOutputStream();

                // Leer stdout y enviarlo al WebView
                outputThread = new Thread(() -> {
                    try (BufferedReader reader = new BufferedReader(
                            new InputStreamReader(opencodeProcess.getInputStream()))) {
                        char[] buf = new char[1024];
                        int n;
                        while ((n = reader.read(buf)) != -1) {
                            String chunk = new String(buf, 0, n);
                            String escaped = chunk
                                .replace("\\", "\\\\")
                                .replace("'", "\\'")
                                .replace("\r", "\\r")
                                .replace("\n", "\\n");
                            webView.post(() ->
                                webView.evaluateJavascript(
                                    "writeToTerminal('" + escaped + "')", null)
                            );
                        }
                    } catch (IOException e) {
                        android.util.Log.e("OpenCode", "Read error", e);
                    }
                });
                outputThread.start();

            } catch (Exception e) {
                android.util.Log.e("OpenCode", "Failed to start process", e);
                webView.post(() ->
                    webView.evaluateJavascript(
                        "writeToTerminal('\\r\\nError: " + e.getMessage() + "\\r\\n')", null)
                );
            }
        }).start();
    }

    /** Puente JS → Java para enviar input del teclado al proceso */
    private class TerminalBridge {
        @JavascriptInterface
        public void sendInput(String data) {
            if (processStdin != null) {
                try {
                    processStdin.write(data.getBytes());
                    processStdin.flush();
                } catch (IOException e) {
                    android.util.Log.e("OpenCode", "Write error", e);
                }
            }
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (opencodeProcess != null) {
            opencodeProcess.destroy();
        }
        if (outputThread != null) {
            outputThread.interrupt();
        }
    }
}
