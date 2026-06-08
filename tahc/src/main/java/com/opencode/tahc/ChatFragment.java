package com.opencode.tahc;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.opencode.tahc.api.EventClient;
import com.opencode.tahc.api.Models;
import com.opencode.tahc.api.OpenCodeClient;

import java.util.Timer;
import java.util.TimerTask;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

import io.noties.markwon.Markwon;
import io.noties.markwon.ext.tables.MarkwonTablesPlugin;

public class ChatFragment extends Fragment {

    private OpenCodeClient client;
    private EventClient eventClient;
    private String sessionId;
    private String currentSystemPrompt;
    private final MessageAdapter adapter = new MessageAdapter();
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private RecyclerView messageList;
    private EditText inputField;
    private ImageButton sendBtn;
    private FrameLayout statusBar;
    private TextView statusText;

    private final AtomicBoolean isProcessing = new AtomicBoolean(false);
    private Timer statusTimer;
    private int thinkingDotCount = 0;

    public void setClient(OpenCodeClient c) {
        this.client = c;
        this.eventClient = new EventClient(c);
    }

    public void setSystemPrompt(String prompt) {
        this.currentSystemPrompt = prompt;
    }

    public void setSessionId(String id) {
        eventClient.stop();
        this.sessionId = id;
        loadMessages();
    }

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container,
                             @Nullable Bundle savedInstanceState) {
        View v = inflater.inflate(R.layout.fragment_chat, container, false);
        messageList = v.findViewById(R.id.message_list);
        inputField = v.findViewById(R.id.input_field);
        sendBtn = v.findViewById(R.id.send_btn);
        statusBar = v.findViewById(R.id.status_bar);
        statusText = v.findViewById(R.id.status_text);

        messageList.setLayoutManager(new LinearLayoutManager(getContext()));
        messageList.setAdapter(adapter);

        Markwon markwon = Markwon.builder(requireContext())
                .usePlugin(MarkwonTablesPlugin.create(requireContext()))
                .build();
        adapter.setMarkwon(markwon);

        sendBtn.setOnClickListener(view -> sendMessage());

        return v;
    }

    private void loadMessages() {
        if (client == null || sessionId == null) return;
        executor.execute(() -> {
            try {
                java.util.List<Models.MessageItem> msgs = client.listMessages(sessionId);
                if (getActivity() != null) {
                    getActivity().runOnUiThread(() -> {
                        adapter.setMessages(msgs);
                        scrollToBottom();
                    });
                }
            } catch (Exception e) {
                android.util.Log.e("Tahc", "load messages failed", e);
            }
        });
    }

    private void sendMessage() {
        String text = inputField.getText().toString().trim();
        if (text.isEmpty() || client == null || sessionId == null || isProcessing.get()) return;

        inputField.setText("");
        isProcessing.set(true);
        sendBtn.setEnabled(false);

        // Add user message optimistically
        Models.MessageItem userMsg = new Models.MessageItem();
        userMsg.info = new Models.MessageInfo();
        userMsg.info.role = "user";
        Models.Part userPart = new Models.Part();
        userPart.type = "text";
        userPart.text = text;
        userMsg.parts = java.util.Collections.singletonList(userPart);
        adapter.addMessage(userMsg);
        scrollToBottom();

        // Show status bar with "Pensando..."
        showStatus("Pensando…");
        startThinkingAnimation();

        // Start SSE listener for real-time status
        eventClient.start(sessionId, new EventClient.EventListener() {
            @Override public void onConnected() {}
            @Override
            public void onStatusUpdate(String sid, String status, String message) {
                if (sessionId != null && sessionId.equals(sid) && message != null && !message.isEmpty()) {
                    android.app.Activity act = getActivity();
                    if (act != null) {
                        act.runOnUiThread(() -> showStatus(message));
                    }
                }
            }
            @Override
            public void onMessageCompleted(String sid, Models.MessageResponse msg) {
                // SSE delivered the response; we still rely on POST for the full response
            }
            @Override
            public void onError(String error) {
                android.util.Log.w("Tahc", "SSE: " + error);
            }
        });

        // POST the message (blocks until complete)
        executor.execute(() -> {
            try {
                Models.MessageResponse resp = client.sendMessage(sessionId, text, currentSystemPrompt);
                mainHandler.post(() -> {
                    stopThinkingAnimation();
                    hideStatus();
                    isProcessing.set(false);
                    sendBtn.setEnabled(true);
                    eventClient.stop();

                    if (resp != null && resp.info != null && resp.parts != null) {
                        Models.MessageItem aiMsg = new Models.MessageItem();
                        aiMsg.info = resp.info;
                        aiMsg.parts = resp.parts;
                        adapter.addMessage(aiMsg);
                        scrollToBottom();

                        // Update session title after first AI response
                        if (adapter.getItemCount() <= 3) {
                            updateSessionTitle(text);
                        }
                    }
                });
            } catch (Exception e) {
                android.util.Log.e("Tahc", "send failed", e);
                mainHandler.post(() -> {
                    stopThinkingAnimation();
                    hideStatus();
                    isProcessing.set(false);
                    sendBtn.setEnabled(true);
                    eventClient.stop();

                    showStatus("Error: " + e.getMessage());
                    mainHandler.postDelayed(() -> hideStatus(), 4000);
                });
            }
        });
    }

    private void updateSessionTitle(String firstMessage) {
        String title = firstMessage.length() > 40
                ? firstMessage.substring(0, 40).trim() + "…"
                : firstMessage.trim();
        executor.execute(() -> {
            try {
                client.patchSessionTitle(sessionId, title);
            } catch (Exception e) {
                android.util.Log.e("Tahc", "patch title failed", e);
            }
        });
    }

    private void showStatus(String text) {
        statusBar.setVisibility(View.VISIBLE);
        statusText.setText(text);
    }

    private void hideStatus() {
        statusBar.setVisibility(View.GONE);
    }

    private void startThinkingAnimation() {
        thinkingDotCount = 0;
        statusTimer = new Timer();
        statusTimer.scheduleAtFixedRate(new TimerTask() {
            @Override
            public void run() {
                thinkingDotCount = (thinkingDotCount % 3) + 1;
                StringBuilder sb = new StringBuilder("Pensando");
                for (int i = 0; i < thinkingDotCount; i++) sb.append(".");
                String dots = sb.toString();
                mainHandler.post(() -> {
                    if (statusBar.getVisibility() == View.VISIBLE) {
                        statusText.setText(dots);
                    }
                });
            }
        }, 500, 500);
    }

    private void stopThinkingAnimation() {
        if (statusTimer != null) {
            statusTimer.cancel();
            statusTimer = null;
        }
    }

    private void scrollToBottom() {
        messageList.scrollToPosition(adapter.getItemCount() - 1);
    }

    @Override
    public void onDestroyView() {
        super.onDestroyView();
        eventClient.stop();
        stopThinkingAnimation();
    }
}
