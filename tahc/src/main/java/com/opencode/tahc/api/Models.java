package com.opencode.tahc.api;

import java.util.List;

public class Models {

    public static class HealthResponse {
        public boolean healthy;
        public String version;
    }

    public static class Session {
        public String id;
        public String title;
        public String createdAt;
        public String updatedAt;
    }

    public static class MessageItem {
        public MessageInfo info;
        public List<Part> parts;
    }

    public static class MessageInfo {
        public String id;
        public String role;
        public String status;
        public String createdAt;
    }

    public static class Part {
        public String type;
        public String content;
    }

    public static class SendMessageBody {
        public List<Part> parts;
    }

    public static class MessageResponse {
        public MessageInfo info;
        public List<Part> parts;
    }

    public static class CreateSessionBody {
        public String title;
        public CreateSessionBody(String title) { this.title = title; }
    }

    public static class MessagesListResponse {
        public List<MessageItem> messages;
    }
}
