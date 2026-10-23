package com.salaryrunway.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;

/**
 * Bank SMS caught as they arrive, waiting for the app to pick them up, plus
 * the settings the app shares with the notification pop-up (whether alerts
 * are on, categories, learned shop categories). Private to the app.
 *
 * Each entry: key, date, amount, type, merchant, category, note, body and
 * status: "new" (not checked yet), "confirmed" or "ignored".
 */
final class SmsAlertStore {
    private static final String PREFS = "sms_alerts";

    private SmsAlertStore() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean enabled(Context context) {
        return prefs(context).getBoolean("enabled", false);
    }

    static void setEnabled(Context context, boolean on) {
        prefs(context).edit().putBoolean("enabled", on).apply();
    }

    static void setLists(Context context, JSONArray categories, JSONArray incomeCategories, JSONObject rules) {
        prefs(context).edit()
            .putString("categories", categories.toString())
            .putString("incomeCategories", incomeCategories.toString())
            .putString("rules", rules.toString())
            .apply();
    }

    static String[] categories(Context context, boolean income) {
        String fallback = income
            ? "[\"Money received\",\"Money returned\",\"From family\",\"Refund\",\"Cashback\",\"Side income\",\"Gift\"]"
            : "[\"Groceries\",\"Food & dining\",\"Travel\",\"Shopping\",\"Entertainment\",\"Health\",\"Personal care\",\"Misc\"]";
        try {
            JSONArray list = new JSONArray(prefs(context).getString(income ? "incomeCategories" : "categories", fallback));
            if (list.length() == 0) list = new JSONArray(fallback);
            String[] out = new String[list.length()];
            for (int i = 0; i < list.length(); i++) out[i] = list.getString(i);
            return out;
        } catch (JSONException e) {
            return new String[] { "Misc" };
        }
    }

    static Map<String, String> rules(Context context) {
        Map<String, String> out = new HashMap<>();
        try {
            JSONObject rules = new JSONObject(prefs(context).getString("rules", "{}"));
            Iterator<String> keys = rules.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                out.put(key, rules.getString(key));
            }
        } catch (JSONException ignored) {
            // No learned categories; keyword matching still works.
        }
        return out;
    }

    static synchronized JSONArray all(Context context) {
        try {
            return new JSONArray(prefs(context).getString("items", "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    private static void save(Context context, JSONArray items) {
        prefs(context).edit().putString("items", items.toString()).apply();
    }

    static synchronized JSONObject get(Context context, String key) {
        JSONArray items = all(context);
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item != null && key.equals(item.optString("key"))) return item;
        }
        return null;
    }

    /** Adds a new entry. Returns false if this message was already caught. */
    static synchronized boolean add(Context context, String key, SmsParser.Result r, String body) {
        if (get(context, key) != null) return false;
        JSONArray items = all(context);
        try {
            JSONObject item = new JSONObject();
            item.put("key", key);
            item.put("date", WidgetStore.today());
            item.put("amount", r.amount);
            item.put("type", r.type);
            item.put("merchant", r.merchant);
            item.put("category", r.category);
            item.put("note", r.merchant);
            item.put("body", body);
            item.put("status", "new");
            items.put(item);
            save(context, items);
            return true;
        } catch (JSONException e) {
            return false;
        }
    }

    static synchronized void update(Context context, String key, String status, String category, String note) {
        JSONArray items = all(context);
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null || !key.equals(item.optString("key"))) continue;
            try {
                item.put("status", status);
                if (category != null) item.put("category", category);
                if (note != null) item.put("note", note);
            } catch (JSONException ignored) {
                // Leaves the entry as it was.
            }
        }
        save(context, items);
    }

    /** Removes entries the app has saved, by key. */
    static synchronized void remove(Context context, Set<String> keys) {
        JSONArray items = all(context);
        JSONArray keep = new JSONArray();
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item != null && !keys.contains(item.optString("key"))) keep.put(item);
        }
        save(context, keep);
    }
}
