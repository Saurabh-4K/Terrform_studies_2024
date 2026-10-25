package com.salaryrunway.app;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Shares a text file (the monthly report, or an encrypted backup) through
 * Android's share menu: an AI chat app, WhatsApp, Drive or Files. The file is
 * written to the app's cache and shared through the FileProvider; nothing is
 * sent until the user picks an app.
 */
@CapacitorPlugin(name = "ShareFile")
public class ShareFilePlugin extends Plugin {

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
            call.reject("Couldn't share the report: " + e.getMessage());
        }
    }
}
