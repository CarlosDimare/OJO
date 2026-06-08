package com.opencode.tahc;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.opencode.tahc.api.Models;

import java.util.ArrayList;
import java.util.List;

import io.noties.markwon.Markwon;

public class MessageAdapter extends RecyclerView.Adapter<RecyclerView.ViewHolder> {

    private static final int TYPE_USER = 0;
    private static final int TYPE_AI = 1;

    private final List<Models.MessageItem> messages = new ArrayList<>();
    private Markwon markwon;

    public void setMarkwon(Markwon m) { this.markwon = m; }

    public void setMessages(List<Models.MessageItem> items) {
        messages.clear();
        messages.addAll(items);
        notifyDataSetChanged();
    }

    public void addMessage(Models.MessageItem item) {
        messages.add(item);
        notifyItemInserted(messages.size() - 1);
    }

    public int getItemCount() { return messages.size(); }

    public Models.MessageItem getItem(int pos) { return messages.get(pos); }

    @Override
    public int getItemViewType(int pos) {
        Models.MessageItem item = messages.get(pos);
        return "user".equals(item.info.role) ? TYPE_USER : TYPE_AI;
    }

    @NonNull
    @Override
    public RecyclerView.ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int type) {
        LayoutInflater inflater = LayoutInflater.from(parent.getContext());
        if (type == TYPE_USER) {
            return new UserHolder(inflater.inflate(R.layout.item_msg_user, parent, false));
        }
        return new AiHolder(inflater.inflate(R.layout.item_msg_ai, parent, false));
    }

    @Override
    public void onBindViewHolder(@NonNull RecyclerView.ViewHolder h, int i) {
        Models.MessageItem item = messages.get(i);
        String text = partsToString(item.parts);

        if (h instanceof UserHolder) {
            ((UserHolder) h).text.setText(text);
        } else if (h instanceof AiHolder && markwon != null) {
            markwon.setMarkdown(((AiHolder) h).text, text);
        } else if (h instanceof AiHolder) {
            ((AiHolder) h).text.setText(text);
        }
    }

    private String partsToString(List<Models.Part> parts) {
        if (parts == null || parts.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        for (Models.Part p : parts) {
            if (p.content != null) sb.append(p.content);
        }
        return sb.toString();
    }

    static class UserHolder extends RecyclerView.ViewHolder {
        TextView text;
        UserHolder(View v) { super(v); text = v.findViewById(R.id.msg_text); }
    }

    static class AiHolder extends RecyclerView.ViewHolder {
        TextView text;
        AiHolder(View v) { super(v); text = v.findViewById(R.id.msg_markdown); }
    }
}
