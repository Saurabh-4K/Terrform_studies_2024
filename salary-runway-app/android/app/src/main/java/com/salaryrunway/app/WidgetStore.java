package com.salaryrunway.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.text.NumberFormat;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.Set;

/**
 * What the home-screen widget shows, and expenses added from the widget that
 * the app hasn't picked up yet. Kept in the app's private storage on the phone.
 */
final class WidgetStore {
    private static final String PREFS = "spend_widget";
    private static final String[] DEFAULT_CATEGORIES = {
        "Groceries", "Food & dining", "Travel", "Shopping", "Entertainment", "Health", "Personal care", "Misc"
    };

    private WidgetStore() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    /**
     * left: rupees left today (negative when over). pool and daysAfter work out
     * tomorrow's safe amount: pool / daysAfter, lowered by spending added later.
     */
    static void setSummary(Context context, long left, long allowance, String date, JSONArray categories, JSONArray categoryLabels, long pool, int daysAfter) {
        prefs(context).edit()
            .putLong("left", left)
            .putLong("allowance", allowance)
            .putString("date", date)
            .putString("categories", categories.toString())
            .putString("categoryLabels", categoryLabels.toString())
            .putLong("pool", pool)
            .putInt("daysAfter", daysAfter)
            .apply();
    }

    /** Tomorrow's safe amount, or null if unknown (not today's numbers, or payday is tomorrow). */
    static Long tomorrow(Context context) {
        SharedPreferences p = prefs(context);
        if (!today().equals(p.getString("date", ""))) return null;
        int days = p.getInt("daysAfter", 0);
        if (days <= 0) return null;
        return Math.max(0, p.getLong("pool", 0)) / days;
    }

    /** How much of today's amount is left, 0–100, or null if not known today. */
    static Integer leftPercent(Context context) {
        Long left = leftToday(context);
        long allowance = prefs(context).getLong("allowance", 0);
        if (left == null || allowance <= 0) return null;
        return (int) Math.max(0, Math.min(100, Math.round(left * 100.0 / allowance)));
    }

    /** Days until payday (1 = tomorrow), or null if not known today. */
    static Integer daysToPayday(Context context) {
        SharedPreferences p = prefs(context);
        if (!today().equals(p.getString("date", ""))) return null;
        return p.getInt("daysAfter", 0) + 1;
    }

    /** Rupees left to spend today (negative when over), or null if the app hasn't worked it out today. */
    static Long leftToday(Context context) {
        SharedPreferences p = prefs(context);
        if (!today().equals(p.getString("date", ""))) return null;
        return p.getLong("left", 0);
    }

    /** Labels for categories(), in the app's language: the same order, falling back to the names. */
    static String[] categoryLabels(Context context) {
        String[] names = categories(context);
        try {
            JSONArray list = new JSONArray(prefs(context).getString("categoryLabels", "[]"));
            if (list.length() != names.length) return names;
            String[] out = new String[names.length];
            for (int i = 0; i < names.length; i++) out[i] = list.getString(i);
            return out;
        } catch (JSONException e) {
            return names;
        }
    }

    static String[] categories(Context context) {
        try {
            JSONArray list = new JSONArray(prefs(context).getString("categories", "[]"));
            if (list.length() == 0) return DEFAULT_CATEGORIES;
            String[] out = new String[list.length()];
            for (int i = 0; i < list.length(); i++) out[i] = list.getString(i);
            return out;
        } catch (JSONException e) {
            return DEFAULT_CATEGORIES;
        }
    }

    /** Saves an expense for the app to pick up, and lowers today's amount on the widget straight away. */
    static synchronized void queueExpense(Context context, long amount, String category, String note) {
        SharedPreferences p = prefs(context);
        try {
            JSONArray queue = new JSONArray(p.getString("queue", "[]"));
            JSONObject expense = new JSONObject();
            expense.put("id", "w" + System.currentTimeMillis());
            expense.put("date", today());
            expense.put("amount", amount);
            expense.put("category", category);
            expense.put("note", note);
            queue.put(expense);
            SharedPreferences.Editor edit = p.edit().putString("queue", queue.toString());
            Long left = leftToday(context);
            if (left != null) {
                edit.putLong("left", left - amount);
                edit.putLong("pool", p.getLong("pool", 0) - Math.max(0, amount - Math.max(0, left)));
            }
            edit.apply();
        } catch (JSONException ignored) {
            // A JSON error here means a broken queue; the expense is not saved.
        }
    }

    /** Changes today's amount on the widget, e.g. when a bank SMS shows a payment. */
    static synchronized void adjustLeft(Context context, long change) {
        Long left = leftToday(context);
        if (left == null) return;
        // Only spending beyond today's amount eats into the days ahead.
        long over = Math.max(0, -(left + change)) - Math.max(0, -left);
        prefs(context).edit().putLong("left", left + change).putLong("pool", prefs(context).getLong("pool", 0) - over).apply();
    }

    static synchronized JSONArray queued(Context context) {
        try {
            return new JSONArray(prefs(context).getString("queue", "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    /** Removes expenses the app has saved, by id. */
    static synchronized void removeQueued(Context context, Set<String> ids) {
        JSONArray queue = queued(context);
        JSONArray keep = new JSONArray();
        for (int i = 0; i < queue.length(); i++) {
            JSONObject item = queue.optJSONObject(i);
            if (item != null && !ids.contains(item.optString("id"))) keep.put(item);
        }
        prefs(context).edit().putString("queue", keep.toString()).apply();
    }

    static String rupees(long amount) {
        return "₹" + NumberFormat.getIntegerInstance(Locale.forLanguageTag("en-IN")).format(amount);
    }
}
