package com.opencode.tahc;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.opencode.tahc.api.Models;

import java.util.List;

public class SessionAdapter extends RecyclerView.Adapter<SessionAdapter.ViewHolder> {

    private List<Models.Session> sessions;
    private final OnSessionListener listener;

    public interface OnSessionListener {
        void onSessionClick(Models.Session session);
        void onSessionLongClick(Models.Session session);
    }

    public SessionAdapter(List<Models.Session> sessions, OnSessionListener listener) {
        this.sessions = sessions;
        this.listener = listener;
    }

    public void update(List<Models.Session> newSessions) {
        this.sessions = newSessions;
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View v = LayoutInflater.from(parent.getContext())
                .inflate(R.layout.item_session, parent, false);
        return new ViewHolder(v);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder h, int i) {
        Models.Session s = sessions.get(i);
        h.title.setText(s.title != null && !s.title.isEmpty() ? s.title : "Chat");
        h.preview.setText(formatDate(s.createdAt));
        h.itemView.setOnClickListener(v -> listener.onSessionClick(s));
        h.itemView.setOnLongClickListener(v -> {
            listener.onSessionLongClick(s);
            return true;
        });
    }

    private String formatDate(String date) {
        if (date == null || date.isEmpty()) return "";
        try {
            if (date.length() >= 10) return date.substring(0, 10);
        } catch (Exception ignored) {}
        return date;
    }

    @Override
    public int getItemCount() { return sessions.size(); }

    static class ViewHolder extends RecyclerView.ViewHolder {
        TextView title, preview;
        ViewHolder(View v) {
            super(v);
            title = v.findViewById(R.id.session_title);
            preview = v.findViewById(R.id.session_preview);
        }
    }
}
