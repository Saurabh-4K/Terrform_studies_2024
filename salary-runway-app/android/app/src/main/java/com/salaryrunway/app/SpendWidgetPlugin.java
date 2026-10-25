package com.salaryrunway.app;

import android.content.Context;
import android.media.AudioManager;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Lets the app update the widget and collect expenses added from it. */
@CapacitorPlugin(name = "SpendWidget")
public class SpendWidgetPlugin extends Plugin {

    /** left: rupees left today (negative when over), allowance: today's amount, date: yyyy-MM-dd, categories: budget names (with labels), lang. */
    @PluginMethod
    public void update(PluginCall call) {
        double left = call.getDouble("left", 0.0);
        double allowance = call.getDouble("allowance", 0.0);
        String date = call.getString("date", WidgetStore.today());
        JSArray categories = call.getArray("categories", new JSArray());
        JSArray labels = call.getArray("categoryLabels", new JSArray());
        double pool = call.getDouble("tomorrowPool", 0.0);
        int daysAfter = call.getInt("daysAfter", 0);
        Lang.set(getContext(), call.getString("lang"));
        WidgetStore.setSummary(getContext(), Math.round(left), Math.round(allowance), date, categories, labels, Math.round(pool), daysAfter);
        SpendWidgetProvider.updateAll(getContext());
        call.resolve();
    }

    /**
     * "Erase everything": the widget's numbers and queue, bank SMS alerts,
     * the saved language, shared files in the cache and any notifications.
     * The web app clears its own storage.
     */
    @PluginMethod
    public void eraseAll(PluginCall call) {
        Context context = getContext();
        for (String name : new String[] {"spend_widget", "sms_alerts", "salary_runway_lang"}) {
            context.getSharedPreferences(name, Context.MODE_PRIVATE).edit().clear().commit();
        }
        deleteTree(context.getCacheDir());
        android.app.NotificationManager nm = (android.app.NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancelAll();
        SpendWidgetProvider.updateAll(context);
        call.resolve();
    }

    private static void deleteTree(java.io.File dir) {
        java.io.File[] files = dir.listFiles();
        if (files == null) return;
        for (java.io.File f : files) {
            if (f.isDirectory()) deleteTree(f);
            f.delete();
        }
    }

    @PluginMethod
    public void getQueued(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("entries", new JSArray(WidgetStore.queued(getContext()).toString()));
            call.resolve(result);
        } catch (JSONException e) {
            call.reject("Could not read widget entries: " + e.getMessage());
        }
    }

    /** ids: entries the app has saved, so they aren't added twice. */
    @PluginMethod
    public void removeQueued(PluginCall call) {
        try {
            List<String> ids = call.getArray("ids", new JSArray()).toList();
            Set<String> set = new HashSet<>(ids);
            WidgetStore.removeQueued(getContext(), set);
            call.resolve();
        } catch (JSONException e) {
            call.reject("Could not clear widget entries: " + e.getMessage());
        }
    }

    /** The phone's ring mode, so the app's sounds stay quiet on silent or vibrate: { mode: normal | vibrate | silent }. */
    @PluginMethod
    public void ringerMode(PluginCall call) {
        AudioManager audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        int mode = audio != null ? audio.getRingerMode() : AudioManager.RINGER_MODE_NORMAL;
        JSObject out = new JSObject();
        out.put("mode", mode == AudioManager.RINGER_MODE_NORMAL ? "normal" : mode == AudioManager.RINGER_MODE_VIBRATE ? "vibrate" : "silent");
        call.resolve(out);
    }
}
