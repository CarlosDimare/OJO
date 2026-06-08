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

    public static class MessageInfo {
        public String id;
        public String role;
        public String status;
        public String createdAt;
    }

    public static class Part {
        public String type;           // "text", "thinking", "tool_use", "tool_result"
        public String text;           // for "text" type
        public String thinking;       // for "thinking" type
        public String name;           // tool name for "tool_use"
        public Object input;          // tool input for "tool_use"
        public String id;             // tool_use id
        public String toolUseId;      // for "tool_result"
        public List<Part> content;    // nested content for "tool_result"
        public Boolean done;          // for streaming tool_use
    }

    public static class MessageItem {
        public MessageInfo info;
        public List<Part> parts;
    }

    public static class MessageResponse {
        public MessageInfo info;
        public List<Part> parts;
    }

    public static class SendMessageBody {
        public String messageID;
        public String model;
        public String system;
        public List<Part> parts;
    }

    public static class CreateSessionBody {
        public String title;
        public CreateSessionBody(String title) { this.title = title; }
    }

    public static class PatchSessionBody {
        public String title;
        public PatchSessionBody(String title) { this.title = title; }
    }

    public static class SessionStatusValue {
        public String status;    // "idle", "processing", "waiting", "error"
        public String message;   // human-readable status
    }
}
