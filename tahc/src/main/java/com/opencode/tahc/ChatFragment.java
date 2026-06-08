package com.opencode.tahc;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.ImageButton;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.opencode.tahc.api.Models;
import com.opencode.tahc.api.OpenCodeClient;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import io.noties.markwon.Markwon;

public class ChatFragment extends Fragment {

    private OpenCodeClient client;
    private String sessionId;
    private final MessageAdapter adapter = new MessageAdapter();
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private RecyclerView messageList;
    private EditText inputField;
    private ImageButton sendBtn;

    public void setClient(OpenCodeClient c) { this.client = c; }
    public void setSessionId(String id) {
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

        messageList.setLayoutManager(new LinearLayoutManager(getContext()));
        messageList.setAdapter(adapter);

        Markwon markwon = Markwon.create(requireContext());
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
                        messageList.scrollToPosition(adapter.getItemCount() - 1);
                    });
                }
            } catch (Exception e) {
                android.util.Log.e("Tahc", "load messages failed", e);
            }
        });
    }

    private void sendMessage() {
        String text = inputField.getText().toString().trim();
        if (text.isEmpty() || client == null || sessionId == null) return;

        inputField.setText("");

        // Add user message optimistically
        Models.MessageItem userMsg = new Models.MessageItem();
        userMsg.info = new Models.MessageInfo();
        userMsg.info.role = "user";
        Models.Part userPart = new Models.Part();
        userPart.type = "text";
        userPart.content = text;
        userMsg.parts = java.util.Collections.singletonList(userPart);
        adapter.addMessage(userMsg);
        messageList.scrollToPosition(adapter.getItemCount() - 1);

        sendBtn.setEnabled(false);

        executor.execute(() -> {
            try {
                Models.MessageResponse resp = client.sendMessage(sessionId, text);
                if (getActivity() != null) {
                    getActivity().runOnUiThread(() -> {
                        Models.MessageItem aiMsg = new Models.MessageItem();
                        aiMsg.info = resp.info;
                        aiMsg.parts = resp.parts;
                        adapter.addMessage(aiMsg);
                        messageList.scrollToPosition(adapter.getItemCount() - 1);
                        sendBtn.setEnabled(true);
                    });
                }
            } catch (Exception e) {
                android.util.Log.e("Tahc", "send message failed", e);
                if (getActivity() != null) {
                    getActivity().runOnUiThread(() -> {
                        sendBtn.setEnabled(true);
                    });
                }
            }
        });
    }
}
