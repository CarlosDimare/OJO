package com.opencode.tahc;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.drawerlayout.widget.DrawerLayout;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.opencode.tahc.api.Models;
import com.opencode.tahc.api.OpenCodeClient;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends AppCompatActivity {

    private static final String BASE_URL = "http://127.0.0.1:4096";

    private OpenCodeClient client;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private String currentSessionId;

    private DrawerLayout drawerLayout;
    private View setupView;
    private View chatContainer;
    private RecyclerView sessionList;
    private SessionAdapter sessionAdapter;
    private ChatFragment chatFragment;
    private View newChatBtn;
    private ProgressBar loadingBar;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        client = new OpenCodeClient(BASE_URL);

        drawerLayout = findViewById(R.id.drawer);
        sessionList = findViewById(R.id.session_list);
        newChatBtn = findViewById(R.id.new_chat_btn);
        loadingBar = new ProgressBar(this);

        sessionList.setLayoutManager(new LinearLayoutManager(this));
        sessionAdapter = new SessionAdapter(new ArrayList<>(), new SessionAdapter.OnSessionListener() {
            @Override public void onSessionClick(Models.Session s) { switchSession(s); }
            @Override public void onSessionLongClick(Models.Session s) { deleteSession(s); }
        });
        sessionList.setAdapter(sessionAdapter);

        com.google.android.material.appbar.MaterialToolbar toolbar =
                findViewById(R.id.toolbar);
        toolbar.setNavigationOnClickListener(v ->
                drawerLayout.openDrawer(Gravity.START));

        newChatBtn.setOnClickListener(v -> startNewChat());

        chatFragment = new ChatFragment();
        chatFragment.setClient(client);
        getSupportFragmentManager().beginTransaction()
                .replace(R.id.content_frame, chatFragment)
                .commit();

        // Will show loading when needed

        checkServer();
    }

    private void checkServer() {
        executor.execute(() -> {
            try {
                Models.HealthResponse health = client.health();
                if (health.healthy) {
                    runOnUiThread(this::onServerReady);
                } else {
                    runOnUiThread(() -> showSetup("Servidor no saludable"));
                }
            } catch (Exception e) {
                runOnUiThread(() -> showSetup(null));
            }
        });
    }

    private void onServerReady() {
        hideSetup();
        loadSessions();

        if (currentSessionId == null) {
            startNewChat();
        }
    }

    private void showSetup(String detail) {
        if (setupView != null) return;

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(48, 48, 48, 48);
        layout.setGravity(Gravity.CENTER);

        TextView title = new TextView(this);
        title.setText("Servidor no encontrado");
        title.setTextSize(20);
        title.setTextAlignment(View.TEXT_ALIGNMENT_CENTER);
        layout.addView(title);

        if (detail != null) {
            TextView dt = new TextView(this);
            dt.setText(detail);
            dt.setTextSize(14);
            dt.setTextColor(0xff666666);
            dt.setTextAlignment(View.TEXT_ALIGNMENT_CENTER);
            dt.setPadding(0, 12, 0, 0);
            layout.addView(dt);
        }

        TextView msg = new TextView(this);
        msg.setText("Asegurate que opencode serve esté corriendo en Termux.\n\n" +
                "Comando:\nopencode serve --port 4096\n\n" +
                "O toca el botón para iniciarlo automáticamente.");
        msg.setTextSize(15);
        msg.setPadding(0, 24, 0, 0);
        msg.setTextAlignment(View.TEXT_ALIGNMENT_CENTER);
        msg.setLineSpacing(8, 1);
        layout.addView(msg);

        Button startBtn = new Button(this);
        startBtn.setText("Iniciar servidor");
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = 24;
        startBtn.setLayoutParams(lp);
        startBtn.setOnClickListener(v -> startServer());
        layout.addView(startBtn);

        Button copyBtn = new Button(this);
        copyBtn.setText("Copiar comando");
        copyBtn.setOnClickListener(v -> {
            ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            cm.setPrimaryClip(ClipData.newPlainText("opencode", "opencode serve --port 4096"));
            Toast.makeText(this, "Comando copiado", Toast.LENGTH_SHORT).show();
        });
        layout.addView(copyBtn);

        Button retryBtn = new Button(this);
        retryBtn.setText("Reintentar");
        retryBtn.setOnClickListener(v -> {
            FrameLayout cf = findViewById(R.id.content_frame);
            if (setupView != null) cf.removeView(setupView);
            setupView = null;
            checkServer();
        });
        layout.addView(retryBtn);

        setupView = layout;
        FrameLayout cf = findViewById(R.id.content_frame);
        cf.addView(setupView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
    }

    private void hideSetup() {
        if (setupView != null) {
            FrameLayout cf = findViewById(R.id.content_frame);
            cf.removeView(setupView);
            setupView = null;
        }
    }

    private void startServer() {
        try {
            Intent intent = new Intent("com.termux.RUN_COMMAND");
            intent.setClassName("com.termux", "com.termux.app.RunCommandService");
            intent.putExtra("com.termux.RUN_COMMAND_PATH",
                    "/data/data/com.termux/files/usr/bin/opencode");
            intent.putExtra("com.termux.RUN_COMMAND_ARGUMENTS",
                    new String[]{"serve", "--port", "4096"});
            intent.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
            startService(intent);

            Toast.makeText(this, "Iniciando servidor, esperá 3s…", Toast.LENGTH_LONG).show();

            // Re-check after delay
            findViewById(R.id.content_frame).postDelayed(this::checkServer, 3000);
        } catch (Exception e) {
            Toast.makeText(this, "No se pudo iniciar Termux: " + e.getMessage(),
                    Toast.LENGTH_LONG).show();
        }
    }

    private void loadSessions() {
        executor.execute(() -> {
            try {
                List<Models.Session> sessions = client.listSessions();
                runOnUiThread(() -> sessionAdapter.update(sessions));
            } catch (Exception e) {
                android.util.Log.e("Tahc", "load sessions failed", e);
            }
        });
    }

    private void startNewChat() {
        executor.execute(() -> {
            try {
                Models.Session session = client.createSession("Nuevo chat");
                runOnUiThread(() -> {
                    currentSessionId = session.id;
                    chatFragment.setSessionId(session.id);
                    drawerLayout.closeDrawer(Gravity.START);
                    loadSessions();
                });
            } catch (Exception e) {
                android.util.Log.e("Tahc", "create session failed", e);
            }
        });
    }

    private void switchSession(Models.Session session) {
        currentSessionId = session.id;
        chatFragment.setSessionId(session.id);
        drawerLayout.closeDrawer(Gravity.START);
    }

    private void deleteSession(Models.Session session) {
        new androidx.appcompat.app.AlertDialog.Builder(this)
                .setTitle("Eliminar")
                .setMessage("¿Eliminar esta conversación?")
                .setPositiveButton("Eliminar", (d, w) -> {
                    executor.execute(() -> {
                        try {
                            client.deleteSession(session.id);
                            runOnUiThread(() -> {
                                loadSessions();
                                if (session.id.equals(currentSessionId)) {
                                    startNewChat();
                                }
                            });
                        } catch (Exception e) {
                            android.util.Log.e("Tahc", "delete failed", e);
                        }
                    });
                })
                .setNegativeButton("Cancelar", null)
                .show();
    }
}
