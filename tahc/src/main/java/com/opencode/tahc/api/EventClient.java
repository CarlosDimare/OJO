package com.opencode.tahc.api;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.BufferedReader;
import java.io.InputStreamReader;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

public class EventClient {

    public interface EventListener {
        void onConnected();
        void onStatusUpdate(String sessionId, String status, String message);
        void onMessageCompleted(String sessionId, Models.MessageResponse message);
        void onError(String error);
    }

    private final String baseUrl;
    private final OkHttpClient http;
    private final Gson gson;
    private volatile boolean running;
    private Thread thread;

    public EventClient(OpenCodeClient client) {
        this.baseUrl = client.getBaseUrl();
        this.http = client.getHttp();
        this.gson = new Gson();
    }

    public void start(String sessionId, EventListener listener) {
        stop();
        running = true;
        thread = new Thread(() -> run(sessionId, listener), "sse-events");
        thread.setDaemon(true);
        thread.start();
    }

    public void stop() {
        running = false;
        if (thread != null) {
            thread.interrupt();
            thread = null;
        }
    }

    private void run(String sessionId, EventListener listener) {
        Request req = new Request.Builder()
                .url(baseUrl + "/event")
                .header("Accept", "text/event-stream")
                .header("Cache-Control", "no-cache")
                .build();
        try {
            Response res = http.newCall(req).execute();
            if (!res.isSuccessful() || res.body() == null) {
                listener.onError("SSE: HTTP " + res.code());
                return;
            }
            listener.onConnected();

            BufferedReader reader = new BufferedReader(new InputStreamReader(res.body().byteStream()));
            String line;
            String currentEvent = null;
            StringBuilder currentData = new StringBuilder();

            while (running && (line = reader.readLine()) != null) {
                if (line.startsWith("event: ")) {
                    currentEvent = line.substring(7).trim();
                } else if (line.startsWith("data: ")) {
                    if (currentData.length() > 0) currentData.append("\n");
                    currentData.append(line.substring(6));
                } else if (line.isEmpty() && currentEvent != null) {
                    String data = currentData.toString().trim();
                    if (!data.isEmpty()) {
                        processEvent(currentEvent, data, sessionId, listener);
                    }
                    currentEvent = null;
                    currentData.setLength(0);
                }
            }
        } catch (Exception e) {
            if (running) {
                listener.onError("SSE: " + e.getClass().getSimpleName());
            }
        }
    }

    private void processEvent(String event, String data, String ourId, EventListener listener) {
        try {
            if (ourId == null) return;

            JsonObject json = JsonParser.parseString(data).getAsJsonObject();

            // Check if this event is for our session
            String sid = null;
            if (json.has("sessionID") && !json.get("sessionID").isJsonNull())
                sid = json.get("sessionID").getAsString();
            if (sid != null && !sid.equals(ourId)) return;

            // If data contains info+parts, it's a completed message
            if (json.has("info") && json.has("parts")) {
                Models.MessageResponse mr = gson.fromJson(data, Models.MessageResponse.class);
                if (mr != null && mr.info != null && mr.parts != null) {
                    listener.onMessageCompleted(ourId, mr);
                    return;
                }
            }

            // Extract status
            String status = json.has("status") && !json.get("status").isJsonNull()
                    ? json.get("status").getAsString() : event;

            String message = json.has("message") && !json.get("message").isJsonNull()
                    ? json.get("message").getAsString() : translateStatus(status);

            if (!message.isEmpty()) {
                listener.onStatusUpdate(ourId, status, message);
            }
        } catch (Exception ignored) {}
    }

    private String translateStatus(String status) {
        if (status == null) return "";
        String s = status.toLowerCase();
        if (s.contains("think")) return "Pensando…";
        if (s.contains("web") || s.contains("search") || s.contains("find")) return "Buscando en la web…";
        if (s.contains("tool") || s.contains("function")) return "Usando herramienta…";
        if (s.contains("file") || s.contains("read")) return "Leyendo archivos…";
        if (s.contains("code") || s.contains("write")) return "Escribiendo código…";
        if (s.contains("error") || s.contains("fail")) return "Error";
        if (s.contains("done") || s.contains("complete") || s.contains("finish")) return "Completado";
        return "";
    }
}
