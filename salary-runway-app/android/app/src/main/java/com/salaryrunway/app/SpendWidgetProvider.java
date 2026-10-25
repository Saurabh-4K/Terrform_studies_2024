package com.salaryrunway.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.util.SizeF;
import android.view.View;
import android.widget.RemoteViews;

import java.util.HashMap;
import java.util.Map;

/**
 * Home-screen widget: the app's logo and name, what's left to spend today
 * with a bar for how much of today's amount remains, days to payday, and a
 * button to add an expense. Two rows by default; one row shows a compact version.
 * Its colour and sign follow today's zone: green, careful (amber) or red.
 * With the app lock's "hide amounts" on, it shows the zone but no rupees.
 */
public class SpendWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        for (int id : widgetIds) manager.updateAppWidget(id, views(context, manager, id));
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        // Resized: before Android 12 the layout is picked here.
        manager.updateAppWidget(id, views(context, manager, id));
    }

    static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, SpendWidgetProvider.class));
        for (int id : ids) manager.updateAppWidget(id, views(context, manager, id));
    }

    private static RemoteViews views(Context context, AppWidgetManager manager, int id) {
        RemoteViews large = build(context, true);
        RemoteViews small = build(context, false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Android 12+: the launcher picks the layout that fits.
            Map<SizeF, RemoteViews> sizes = new HashMap<>();
            sizes.put(new SizeF(180f, 40f), small);
            sizes.put(new SizeF(180f, 100f), large);
            return new RemoteViews(sizes);
        }
        int height = manager.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        return height == 0 || height >= 100 ? large : small;
    }

    private static RemoteViews build(Context context, boolean large) {
        RemoteViews views = new RemoteViews(context.getPackageName(), large ? R.layout.widget_spend : R.layout.widget_spend_small);
        Context text = Lang.wrap(context);
        views.setTextViewText(R.id.widget_add, text.getString(R.string.widget_add));
        Long left = WidgetStore.leftToday(context);
        String zone = WidgetStore.zone(context);
        boolean hidden = WidgetStore.hideAmounts(context);
        // Amber is light: dark text on it. Teal, green and red keep white text.
        boolean light = "amber".equals(zone);
        int strong = light ? 0xFF2A1A00 : 0xFFFFFFFF;
        int soft = light ? 0xCC2A1A00 : 0xD9FFFFFF;
        views.setInt(R.id.widget_root, "setBackgroundResource",
            "green".equals(zone) ? R.drawable.widget_bg_green
                : "amber".equals(zone) ? R.drawable.widget_bg_amber
                : "red".equals(zone) ? R.drawable.widget_bg_red
                : R.drawable.widget_bg);
        String zoneText = "green".equals(zone) ? text.getString(R.string.widget_zone_green)
            : "amber".equals(zone) ? text.getString(R.string.widget_zone_amber)
            : "red".equals(zone) ? text.getString(R.string.widget_zone_red) : null;
        if (large) {
            views.setTextViewText(R.id.widget_brand, zoneText != null ? zoneText : text.getString(R.string.app_name));
            views.setTextColor(R.id.widget_brand, strong);
            views.setTextColor(R.id.widget_payday, strong);
        }
        views.setTextColor(R.id.widget_amount, strong);
        if (hidden) {
            views.setTextViewText(R.id.widget_amount, "🔒 " + text.getString(R.string.widget_locked));
            views.setTextViewText(R.id.widget_label, zoneText != null && !large ? zoneText : text.getString(R.string.widget_locked_hint));
            views.setTextColor(R.id.widget_label, soft);
            if (large) {
                views.setViewVisibility(R.id.widget_bar, View.GONE);
                views.setViewVisibility(R.id.widget_payday, View.GONE);
            }
        } else if (left == null) {
            views.setTextViewText(R.id.widget_amount, text.getString(R.string.widget_open_app));
            views.setTextViewText(R.id.widget_label, text.getString(R.string.widget_open_app_hint));
        } else if (left >= 0) {
            views.setTextViewText(R.id.widget_amount, WidgetStore.rupees(left));
            views.setTextViewText(R.id.widget_label, text.getString(R.string.widget_left_today));
        } else {
            // Over today's amount: show what that does to tomorrow, in amber.
            views.setTextViewText(R.id.widget_amount, text.getString(R.string.widget_over, WidgetStore.rupees(-left)));
            Long tomorrow = WidgetStore.tomorrow(context);
            views.setTextViewText(R.id.widget_label, tomorrow == null
                ? text.getString(R.string.widget_over_hint)
                : text.getString(R.string.widget_tomorrow_drops, WidgetStore.rupees(tomorrow)));
            views.setTextColor(R.id.widget_label, light ? 0xFF7A2C12 : 0xFFFFDCA8);
        }
        if (!hidden && (left == null || left >= 0)) views.setTextColor(R.id.widget_label, soft);
        // One row has no room for the zone line: its sign goes before the label.
        if (!hidden && !large && zoneText != null && left != null && left >= 0) {
            views.setTextViewText(R.id.widget_label, zoneText);
        }

        if (large && !hidden) {
            // How much of today's amount is still there.
            Integer pct = WidgetStore.leftPercent(context);
            views.setViewVisibility(R.id.widget_bar, pct == null ? View.GONE : View.VISIBLE);
            if (pct != null) views.setProgressBar(R.id.widget_bar, 100, pct, false);
            Integer days = WidgetStore.daysToPayday(context);
            views.setViewVisibility(R.id.widget_payday, days == null ? View.GONE : View.VISIBLE);
            if (days != null) {
                views.setTextViewText(R.id.widget_payday, days <= 1
                    ? text.getString(R.string.widget_payday_tomorrow)
                    : text.getString(R.string.widget_payday_in, days));
            }
        }

        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        Intent open = new Intent(context, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        views.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(context, 0, open, flags));
        Intent add = new Intent(context, QuickAddActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        views.setOnClickPendingIntent(R.id.widget_add, PendingIntent.getActivity(context, 1, add, flags));
        return views;
    }
}
