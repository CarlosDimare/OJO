package com.opencode.tahc;

import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.method.LinkMovementMethod;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
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
        if (item.info != null && "user".equals(item.info.role)) return TYPE_USER;
        return TYPE_AI;
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

        if (h instanceof UserHolder) {
            String text = partsToPlainText(item.parts);
            ((UserHolder) h).text.setText(text);
        } else if (h instanceof AiHolder) {
            AiHolder ai = (AiHolder) h;
            ai.container.removeAllViews();

            if (item.parts == null || item.parts.isEmpty()) return;

            for (Models.Part part : item.parts) {
                if (part == null) continue;

                switch (part.type != null ? part.type : "") {
                    case "thinking":
                        addThinkingView(ai.container, part);
                        break;
                    case "tool_use":
                        addToolUseView(ai.container, part);
                        break;
                    case "tool_result":
                        // Hide tool results by default
                        break;
                    case "text":
                    default:
                        addTextView(ai.container, part.text);
                        break;
                }
            }
        }
    }

    private String partsToPlainText(List<Models.Part> parts) {
        if (parts == null || parts.isEmpty()) return "";
        StringBuilder sb = new StringBuilder();
        for (Models.Part p : parts) {
            if (p.text != null) sb.append(p.text);
        }
        return sb.toString();
    }

    private void addThinkingView(LinearLayout container, Models.Part part) {
        if (part.thinking == null || part.thinking.isEmpty()) return;

        LayoutInflater inflater = LayoutInflater.from(container.getContext());
        View view = inflater.inflate(R.layout.item_thinking, container, false);

        TextView label = view.findViewById(R.id.thinking_label);
        TextView toggle = view.findViewById(R.id.thinking_toggle);
        TextView textView = view.findViewById(R.id.thinking_text);
        View header = view.findViewById(R.id.thinking_header);

        label.setText("Razonamiento");
        textView.setText(part.thinking);

        header.setOnClickListener(v -> {
            boolean visible = textView.getVisibility() == View.VISIBLE;
            textView.setVisibility(visible ? View.GONE : View.VISIBLE);
            toggle.setText(visible ? "▸" : "▾");
        });

        container.addView(view);
    }

    private void addToolUseView(LinearLayout container, Models.Part part) {
        TextView tv = new TextView(container.getContext());
        tv.setPadding(0, 4, 0, 4);
        tv.setTextSize(13);
        tv.setTextColor(container.getContext().getColor(R.color.tool_use_text));

        String toolName = part.name != null ? part.name : "herramienta";
        tv.setText("⚙ " + toolName);

        container.addView(tv);
    }

    private void addTextView(LinearLayout container, String text) {
        if (text == null || text.isEmpty()) return;

        TextView tv = new TextView(container.getContext());
        tv.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));
        tv.setTextColor(container.getContext().getColor(R.color.on_surface));
        tv.setTextSize(15);
        tv.setLineSpacing(0, 1.35f);

        if (markwon != null) {
            markwon.setMarkdown(tv, text);
        } else {
            tv.setText(text);
        }

        container.addView(tv);
    }

    static class UserHolder extends RecyclerView.ViewHolder {
        TextView text;
        UserHolder(View v) { super(v); text = v.findViewById(R.id.msg_text); }
    }

    static class AiHolder extends RecyclerView.ViewHolder {
        LinearLayout container;
        AiHolder(View v) { super(v); container = v.findViewById(R.id.ai_container); }
    }
}
