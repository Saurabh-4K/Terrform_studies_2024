package com.salaryrunway.app;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Saves or shares a text file (the encrypted backup).
 * save: Android's own save screen (Downloads, Drive or any folder); resolves
 *   only once the file is written, with saved: false if the person cancels.
 * share: Android's share menu (Drive, WhatsApp, email). The file is written to
 *   the app's cache and shared through the FileProvider; nothing is sent until
 *   the user picks an app, and Android doesn't say whether that app kept it.
 */
@CapacitorPlugin(name = "ShareFile")
public class ShareFilePlugin extends Plugin {

    /** name: the suggested file name, text: its contents, mime: the file type. Resolves { saved, name }. */
    @PluginMethod
    public void save(PluginCall call) {
        String name = call.getString("name", "backup.json").replaceAll("[^A-Za-z0-9._-]", "_");
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mime", "application/json"));
        intent.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, intent, "saveResult");
    }

    @ActivityCallback
    private void saveResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject r = new JSObject();
        Uri uri = result.getData() != null ? result.getData().getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            r.put("saved", false);
            call.resolve(r);
            return;
        }
        try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (out == null) throw new IllegalStateException("no output");
            out.write(call.getString("text", "").getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            call.reject("Couldn't save the file: " + e.getMessage());
            return;
        }
        String shown = call.getString("name", "");
        try (Cursor c = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) shown = c.getString(0);
        } catch (Exception ignored) {
            // The suggested name is close enough.
        }
        r.put("saved", true);
        r.put("name", shown);
        call.resolve(r);
    }

    /** text: a message (a reminder to a friend), title: the share menu's title. Nothing is sent until the person sends it in the app they pick. */
    @PluginMethod
    public void shareText(PluginCall call) {
        try {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_TEXT, call.getString("text", ""));
            Intent chooser = Intent.createChooser(send, call.getString("title", ""));
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't share: " + e.getMessage());
        }
    }

    /** name: file name, text: its contents, title: the share menu's title, mime: the file type (text/plain if left out). */
    @PluginMethod
    public void share(PluginCall call) {
        String name = call.getString("name", "report.txt").replaceAll("[^A-Za-z0-9._-]", "_");
        String text = call.getString("text", "");
        try {
            File dir = new File(getContext().getCacheDir(), "reports");
            dir.mkdirs();
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) f.delete();
            File file = new File(dir, name);
            try (OutputStream out = new FileOutputStream(file)) {
                out.write(text.getBytes(StandardCharsets.UTF_8));
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(call.getString("mime", "text/plain"));
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_SUBJECT, name);
            send.setClipData(ClipData.newRawUri(name, uri));
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, call.getString("title", name));
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't share the file: " + e.getMessage());
        }
    }
}
