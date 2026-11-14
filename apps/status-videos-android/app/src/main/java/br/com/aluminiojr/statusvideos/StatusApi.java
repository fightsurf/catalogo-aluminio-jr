package br.com.aluminiojr.statusvideos;

import android.content.Context;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Usa exatamente a API que já atende à página web /status-videos. */
final class StatusApi {
    private static final String BASE_URL = "https://catalogo-aluminio-jr.onrender.com";
    private static final String COOKIE_NAME = "ajr_admin_session";
    private final SecureSession secureSession;
    private volatile String cookie;

    interface Progress {
        void uploaded(long bytes, long total);
    }

    StatusApi(Context context) {
        secureSession = new SecureSession(context);
        cookie = secureSession.load();
    }

    private HttpURLConnection open(String route, String method) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(BASE_URL + route).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(25000);
        c.setReadTimeout(120000);
        c.setInstanceFollowRedirects(false);
        c.setRequestProperty("Accept", "application/json");
        if (cookie != null) c.setRequestProperty("Cookie", cookie);
        return c;
    }

    private static String errorText(JSONObject json) {
        String message = json.optString("message", "");
        if (message.isEmpty()) message = json.optString("erro", "");
        return message;
    }

    private JSONObject body(HttpURLConnection c) throws Exception {
        try {
            int code = c.getResponseCode();
            InputStream stream = code < 400 ? c.getInputStream() : c.getErrorStream();
            String raw = "";
            if (stream != null) {
                try (InputStream input = stream; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                    byte[] buf = new byte[4096];
                    int n;
                    while ((n = input.read(buf)) != -1) out.write(buf, 0, n);
                    raw = out.toString("UTF-8");
                }
            }
            JSONObject json;
            try {
                json = new JSONObject(raw);
            } catch (Exception ignored) {
                throw new Exception(code == 401 ? "Sessão expirada. Entre novamente." :
                    "Resposta inesperada do servidor (HTTP " + code + ").");
            }
            if (code == 401) {
                logout();
                throw new Exception("Sessão expirada. Entre novamente.");
            }
            if (code >= 400 || json.optBoolean("success", true) == false) {
                String message = errorText(json);
                throw new Exception(message.isEmpty() ? "Erro HTTP " + code : message);
            }
            return json;
        } finally {
            c.disconnect();
        }
    }

    boolean checkSession() throws Exception {
        if (cookie == null) return false;
        JSONObject json = request("/auth/status");
        boolean valid = json.optBoolean("autenticado", false);
        if (!valid) logout();
        return valid;
    }

    JSONObject login(String user, String password) throws Exception {
        HttpURLConnection c = open("/auth/login", "POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        byte[] payload = new JSONObject().put("usuario", user).put("senha", password)
            .toString().getBytes(StandardCharsets.UTF_8);
        c.setFixedLengthStreamingMode(payload.length);
        try (OutputStream out = c.getOutputStream()) {
            out.write(payload);
        }
        Map<String, List<String>> headers = c.getHeaderFields();
        String newCookie = null;
        for (Map.Entry<String, List<String>> entry : headers.entrySet()) {
            if (entry.getKey() != null && entry.getKey().equalsIgnoreCase("set-cookie")) {
                for (String item : entry.getValue()) {
                    if (item.startsWith(COOKIE_NAME + "=")) {
                        newCookie = item.substring(0, item.indexOf(';') > 0 ? item.indexOf(';') : item.length());
                        break;
                    }
                }
            }
        }
        JSONObject result = body(c);
        if (!result.optBoolean("ok", false) || newCookie == null) {
            throw new Exception("Login não confirmado pelo servidor.");
        }
        cookie = newCookie;
        secureSession.save(newCookie);
        return result;
    }

    void logout() {
        cookie = null;
        secureSession.clear();
    }

    JSONObject request(String route) throws Exception {
        return body(open(route, "GET"));
    }

    JSONArray products() throws Exception {
        return request("/api/produtos?ativos=true").optJSONArray("data");
    }

    JSONObject status(String requestId) throws Exception {
        return request("/api/status-videos/publicacoes/" + requestId).getJSONObject("data");
    }

    private static void write(OutputStream output, String value) throws Exception {
        output.write(value.getBytes(StandardCharsets.UTF_8));
    }

    private static void field(OutputStream output, String boundary, String name, String value) throws Exception {
        write(output, "--" + boundary + "\r\nContent-Disposition: form-data; name=\"" +
            name + "\"\r\n\r\n" + value + "\r\n");
    }

    JSONObject upload(Context context, Uri uri, String mime, String type,
                      JSONArray items, String requestId, long total, Progress progress) throws Exception {
        String boundary = "ajr-" + UUID.randomUUID();
        HttpURLConnection c = open("/api/status-videos/publicar", "POST");
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
        c.setChunkedStreamingMode(64 * 1024);
        try (OutputStream output = new BufferedOutputStream(c.getOutputStream(), 128 * 1024)) {
            field(output, boundary, "request_id", requestId);
            field(output, boundary, "tipo_video", type);
            field(output, boundary, "itens", items.toString());
            write(output, "--" + boundary + "\r\nContent-Disposition: form-data; name=\"video\"; filename=\"video-compartilhado.mp4\"\r\n");
            write(output, "Content-Type: " + mime + "\r\n\r\n");
            try (InputStream input = new BufferedInputStream(context.getContentResolver().openInputStream(uri))) {
                byte[] buffer = new byte[64 * 1024];
                int len;
                long sent = 0;
                long notified = 0;
                while ((len = input.read(buffer)) != -1) {
                    if (Thread.currentThread().isInterrupted()) throw new InterruptedException();
                    output.write(buffer, 0, len);
                    sent += len;
                    if (sent - notified > 512 * 1024) {
                        notified = sent;
                        progress.uploaded(sent, total);
                    }
                }
                progress.uploaded(sent, total);
            }
            write(output, "\r\n--" + boundary + "--\r\n");
        } catch (Exception e) {
            c.disconnect();
            throw e;
        }
        return body(c).getJSONObject("data");
    }
}
