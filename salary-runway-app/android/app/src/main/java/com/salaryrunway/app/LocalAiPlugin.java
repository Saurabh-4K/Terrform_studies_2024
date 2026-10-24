package com.salaryrunway.app;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mediapipe.tasks.genai.llminference.LlmInference;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * An AI model that runs on the phone, for month-end tips. The model is
 * downloaded once (a small open model in MediaPipe's .task format, from the
 * LiteRT community on Hugging Face) and kept in the app's private files.
 * Nothing about the user's money leaves the phone: the download only fetches
 * the model, and the tips are written on the device.
 */
@CapacitorPlugin(name = "LocalAi")
public class LocalAiPlugin extends Plugin {
    // Qwen2.5 1.5B Instruct (Apache-2.0): small enough for a phone, good at short advice.
    static final String REPO = "litert-community/Qwen2.5-1.5B-Instruct";
    private static final String PREFS = "local_ai";

    // Download progress, shared with status() while the download runs.
    private static volatile boolean downloading = false;
    private static volatile boolean cancelled = false;
    private static volatile long done = 0;
    private static volatile long total = 0;
    private static volatile String error = null;

    private static LlmInference engine = null;
    private static String enginePath = null;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private File modelFile() {
        return new File(new File(getContext().getFilesDir(), "ai"), "model.task");
    }

    /** ready, downloading, done/total bytes, size of the downloaded model, last error. */
    @PluginMethod
    public void status(PluginCall call) {
        File model = modelFile();
        JSObject out = new JSObject();
        out.put("ready", model.exists() && !downloading);
        out.put("size", model.exists() ? model.length() : prefs().getLong("size", 0));
        out.put("downloading", downloading);
        out.put("done", done);
        out.put("total", total);
        out.put("error", error);
        call.resolve(out);
    }

    /** Finds the model file and its size, without downloading it. */
    @PluginMethod
    public void info(PluginCall call) {
        new Thread(() -> {
            try {
                JSONObject file = pickFile();
                JSObject out = new JSObject();
                out.put("name", file.getString("rfilename"));
                out.put("size", file.optLong("size", 0));
                call.resolve(out);
            } catch (Exception e) {
                call.reject("Could not reach the model download: " + e.getMessage());
            }
        }).start();
    }

    /** Starts the download in the background; status() reports progress. */
    @PluginMethod
    public void download(PluginCall call) {
        if (downloading) { call.resolve(); return; }
        downloading = true;
        cancelled = false;
        done = 0;
        total = 0;
        error = null;
        File model = modelFile();
        new Thread(() -> {
            File part = new File(model.getParentFile(), "model.task.part");
            try {
                model.getParentFile().mkdirs();
                JSONObject file = pickFile();
                total = file.optLong("size", 0);
                URL url = new URL("https://huggingface.co/" + REPO + "/resolve/main/" + file.getString("rfilename"));
                HttpURLConnection http = (HttpURLConnection) url.openConnection();
                http.setConnectTimeout(20000);
                http.setReadTimeout(60000);
                if (http.getResponseCode() != 200) throw new Exception("HTTP " + http.getResponseCode());
                if (total <= 0) total = http.getContentLengthLong();
                try (InputStream in = http.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                    byte[] buf = new byte[1 << 16];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        if (cancelled) throw new Exception("cancelled");
                        out.write(buf, 0, n);
                        done += n;
                    }
                }
                if (total > 0 && done < total) throw new Exception("download incomplete");
                if (model.exists()) model.delete();
                if (!part.renameTo(model)) throw new Exception("could not save the model");
                prefs().edit().putLong("size", model.length()).apply();
            } catch (Exception e) {
                part.delete();
                error = cancelled ? null : e.getMessage();
            } finally {
                downloading = false;
            }
        }).start();
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        cancelled = true;
        call.resolve();
    }

    /** Deletes the model to free the space. */
    @PluginMethod
    public void remove(PluginCall call) {
        synchronized (LocalAiPlugin.class) {
            if (engine != null) { engine.close(); engine = null; enginePath = null; }
        }
        modelFile().delete();
        prefs().edit().remove("size").apply();
        call.resolve();
    }

    /** prompt: the full prompt; maxTokens: prompt and answer together. Returns { text }. */
    @PluginMethod
    public void generate(PluginCall call) {
        String prompt = call.getString("prompt", "");
        int maxTokens = call.getInt("maxTokens", 1024);
        File model = modelFile();
        if (!model.exists() || downloading) { call.reject("The AI model isn't downloaded yet."); return; }
        new Thread(() -> {
            try {
                String text;
                synchronized (LocalAiPlugin.class) {
                    if (engine == null || !model.getAbsolutePath().equals(enginePath)) {
                        LlmInference.LlmInferenceOptions options = LlmInference.LlmInferenceOptions.builder()
                            .setModelPath(model.getAbsolutePath())
                            .setMaxTokens(maxTokens)
                            .build();
                        engine = LlmInference.createFromOptions(getContext(), options);
                        enginePath = model.getAbsolutePath();
                    }
                    text = engine.generateResponse(prompt);
                }
                JSObject out = new JSObject();
                out.put("text", text);
                call.resolve(out);
            } catch (Throwable e) {
                call.reject("The AI couldn't run on this phone: " + e.getMessage());
            }
        }).start();
    }

    /** The smallest .task file in the model's repository, with its size. */
    private static JSONObject pickFile() throws Exception {
        HttpURLConnection http = (HttpURLConnection) new URL("https://huggingface.co/api/models/" + REPO + "?blobs=true").openConnection();
        http.setConnectTimeout(20000);
        http.setReadTimeout(30000);
        if (http.getResponseCode() != 200) throw new Exception("HTTP " + http.getResponseCode());
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        try (InputStream in = http.getInputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) body.write(buf, 0, n);
        }
        JSONArray files = new JSONObject(body.toString("UTF-8")).getJSONArray("siblings");
        JSONObject best = null;
        for (int i = 0; i < files.length(); i++) {
            JSONObject f = files.getJSONObject(i);
            if (!f.getString("rfilename").endsWith(".task")) continue;
            if (best == null || f.optLong("size", Long.MAX_VALUE) < best.optLong("size", Long.MAX_VALUE)) best = f;
        }
        if (best == null) throw new Exception("no model file found");
        return best;
    }
}
