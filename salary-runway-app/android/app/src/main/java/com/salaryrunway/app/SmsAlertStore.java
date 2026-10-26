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

    /** Category names are stored in English; the labels are how the app shows them, in its language. */
    static void setLists(Context context, JSONArray categories, JSONArray incomeCategories, JSONArray categoryLabels,
                         JSONArray incomeCategoryLabels, JSONObject rules, JSONArray cards) {
        prefs(context).edit()
            .putString("categories", categories.toString())
            .putString("incomeCategories", incomeCategories.toString())
            .putString("categoryLabels", categoryLabels.toString())
            .putString("incomeCategoryLabels", incomeCategoryLabels.toString())
            .putString("rules", rules.toString())
            .putString("cards", cards.toString())
            .apply();
    }

    /** Words or phrases the user chose: an SMS containing one is never recorded or shown. */
    static void setSkipText(Context context, JSONArray words) {
        prefs(context).edit().putString("skipText", words.toString()).apply();
    }

    static boolean skipped(Context context, String body) {
        String text = body == null ? "" : body.toLowerCase(java.util.Locale.ROOT);
        try {
            JSONArray words = new JSONArray(prefs(context).getString("skipText", "[]"));
            for (int i = 0; i < words.length(); i++) {
                String w = words.optString(i, "").trim().toLowerCase(java.util.Locale.ROOT);
                if (!w.isEmpty() && text.contains(w)) return true;
            }
        } catch (JSONException ignored) {
            // Nothing skipped.
        }
        return false;
    }

    /** The user's credit cards: id, name, last4. */
    static JSONArray cards(Context context) {
        try {
            return new JSONArray(prefs(context).getString("cards", "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    /** The card with these last 4 digits, or null. */
    static JSONObject cardFor(Context context, String last4) {
        if (last4 == null) return null;
        JSONArray cards = cards(context);
        for (int i = 0; i < cards.length(); i++) {
            JSONObject c = cards.optJSONObject(i);
            if (c != null && last4.equals(c.optString("last4"))) return c;
        }
        return null;
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

    /** Labels for categories(): the same order and length, falling back to the names. */
    static String[] labels(Context context, boolean income) {
        String[] names = categories(context, income);
        try {
            JSONArray list = new JSONArray(prefs(context).getString(income ? "incomeCategoryLabels" : "categoryLabels", "[]"));
            if (list.length() != names.length) return names;
            String[] out = new String[names.length];
            for (int i = 0; i < names.length; i++) out[i] = list.getString(i);
            return out;
        } catch (JSONException e) {
            return names;
        }
    }

    /** How a category name is shown, in the app's language. */
    static String label(Context context, String name) {
        for (boolean income : new boolean[] { false, true }) {
            String[] names = categories(context, income);
            int i = java.util.Arrays.asList(names).indexOf(name);
            if (i >= 0) return labels(context, income)[i];
        }
        return name;
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
            item.put("paidFrom", r.paidFrom == null ? JSONObject.NULL : r.paidFrom);
            item.put("last4", r.last4 == null ? JSONObject.NULL : r.last4);
            // Card statements and bill payments need no check: the app records them as they are.
            boolean cardNotice = "statement".equals(r.type) || "cardpayment".equals(r.type) || r.salary;
            item.put("salary", r.salary);
            item.put("status", cardNotice ? "confirmed" : "new");
            items.put(item);
            save(context, items);
            return true;
        } catch (JSONException e) {
            return false;
        }
    }

    static synchronized void update(Context context, String key, String status, String category, String note, String cardId) {
        JSONArray items = all(context);
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            if (item == null || !key.equals(item.optString("key"))) continue;
            try {
                item.put("status", status);
                if (category != null) item.put("category", category);
                if (note != null) item.put("note", note);
                if (cardId != null) item.put("cardId", cardId);
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
