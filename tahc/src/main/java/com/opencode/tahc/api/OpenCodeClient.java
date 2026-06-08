package com.opencode.tahc.api;

import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;

import java.io.IOException;
import java.lang.reflect.Type;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class OpenCodeClient {

    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    private final String baseUrl;
    private final OkHttpClient http;
    private final Gson gson;

    public OpenCodeClient(String baseUrl) {
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        this.http = new OkHttpClient.Builder()
                .connectTimeout(5, TimeUnit.SECONDS)
                .readTimeout(180, TimeUnit.SECONDS)
                .writeTimeout(30, TimeUnit.SECONDS)
                .build();
        this.gson = new Gson();
    }

    public OkHttpClient getHttp() { return http; }
    public String getBaseUrl() { return baseUrl; }

    public Models.HealthResponse health() throws IOException {
        Request req = new Request.Builder()
                .url(baseUrl + "/global/health")
                .get()
                .build();
        try (Response res = http.newCall(req).execute()) {
            return gson.fromJson(res.body().string(), Models.HealthResponse.class);
        }
    }

    public List<Models.Session> listSessions() throws IOException {
        Request req = new Request.Builder()
                .url(baseUrl + "/session")
                .get()
                .build();
        try (Response res = http.newCall(req).execute()) {
            if (!res.isSuccessful()) return Collections.emptyList();
            okhttp3.ResponseBody rb = res.body();
            if (rb == null) return Collections.emptyList();
            Type type = new TypeToken<List<Models.Session>>() {}.getType();
            List<Models.Session> sessions = gson.fromJson(rb.string(), type);
            return sessions != null ? sessions : Collections.emptyList();
        }
    }

    public Models.Session createSession(String title) throws IOException {
        Models.CreateSessionBody body = new Models.CreateSessionBody(title);
        String json = gson.toJson(body);
        Request req = new Request.Builder()
                .url(baseUrl + "/session")
                .post(RequestBody.create(json, JSON))
                .build();
        try (Response res = http.newCall(req).execute()) {
            return gson.fromJson(res.body().string(), Models.Session.class);
        }
    }

    public boolean deleteSession(String sessionId) throws IOException {
        Request req = new Request.Builder()
                .url(baseUrl + "/session/" + sessionId)
                .delete()
                .build();
        try (Response res = http.newCall(req).execute()) {
            return res.isSuccessful();
        }
    }

    public void patchSessionTitle(String sessionId, String title) throws IOException {
        Models.PatchSessionBody body = new Models.PatchSessionBody(title);
        String json = gson.toJson(body);
        Request req = new Request.Builder()
                .url(baseUrl + "/session/" + sessionId)
                .patch(RequestBody.create(json, JSON))
                .build();
        try (Response res = http.newCall(req).execute()) {
            // ignore
        }
    }

    public List<Models.MessageItem> listMessages(String sessionId) throws IOException {
        Request req = new Request.Builder()
                .url(baseUrl + "/session/" + sessionId + "/message")
                .get()
                .build();
        try (Response res = http.newCall(req).execute()) {
            if (!res.isSuccessful()) return Collections.emptyList();
            okhttp3.ResponseBody rb = res.body();
            if (rb == null) return Collections.emptyList();
            Type type = new TypeToken<List<Models.MessageItem>>() {}.getType();
            List<Models.MessageItem> messages = gson.fromJson(rb.string(), type);
            return messages != null ? messages : Collections.emptyList();
        }
    }

    public Models.MessageResponse sendMessage(String sessionId, String text, String system) throws IOException {
        Models.SendMessageBody body = new Models.SendMessageBody();
        Models.Part part = new Models.Part();
        part.type = "text";
        part.text = text;
        body.parts = Collections.singletonList(part);
        if (system != null && !system.isEmpty()) {
            body.system = system;
        }

        String json = gson.toJson(body);
        Request req = new Request.Builder()
                .url(baseUrl + "/session/" + sessionId + "/message")
                .post(RequestBody.create(json, JSON))
                .build();
        try (Response res = http.newCall(req).execute()) {
            if (!res.isSuccessful()) {
                throw new IOException("Server returned " + res.code() + ": " + res.body().string());
            }
            okhttp3.ResponseBody rb = res.body();
            if (rb == null) throw new IOException("Empty response body");
            return gson.fromJson(rb.string(), Models.MessageResponse.class);
        }
    }

    public Map<String, Models.SessionStatusValue> getSessionStatus() throws IOException {
        Request req = new Request.Builder()
                .url(baseUrl + "/session/status")
                .get()
                .build();
        try (Response res = http.newCall(req).execute()) {
            if (!res.isSuccessful()) return Collections.emptyMap();
            okhttp3.ResponseBody rb = res.body();
            if (rb == null) return Collections.emptyMap();
            Type type = new TypeToken<Map<String, Models.SessionStatusValue>>() {}.getType();
            Map<String, Models.SessionStatusValue> status = gson.fromJson(rb.string(), type);
            return status != null ? status : Collections.emptyMap();
        }
    }
}
