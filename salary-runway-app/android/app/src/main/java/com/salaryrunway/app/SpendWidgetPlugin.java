package com.salaryrunway.app;

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

    /** left: rupees left today (negative when over), date: yyyy-MM-dd, categories: budget names (with labels), lang. */
    @PluginMethod
    public void update(PluginCall call) {
        double left = call.getDouble("left", 0.0);
        String date = call.getString("date", WidgetStore.today());
        JSArray categories = call.getArray("categories", new JSArray());
        JSArray labels = call.getArray("categoryLabels", new JSArray());
        double pool = call.getDouble("tomorrowPool", 0.0);
        int daysAfter = call.getInt("daysAfter", 0);
        Lang.set(getContext(), call.getString("lang"));
        WidgetStore.setSummary(getContext(), Math.round(left), date, categories, labels, Math.round(pool), daysAfter);
        SpendWidgetProvider.updateAll(getContext());
        call.resolve();
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
}
