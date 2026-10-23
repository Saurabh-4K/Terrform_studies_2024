package com.salaryrunway.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/** Home-screen widget: today's spending amount and a button to add an expense. */
public class SpendWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        for (int id : widgetIds) manager.updateAppWidget(id, views(context));
    }

    static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, SpendWidgetProvider.class));
        for (int id : ids) manager.updateAppWidget(id, views(context));
    }

    private static RemoteViews views(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_spend);
        Long left = WidgetStore.leftToday(context);
        if (left == null) {
            views.setTextViewText(R.id.widget_amount, context.getString(R.string.widget_open_app));
            views.setTextViewText(R.id.widget_label, context.getString(R.string.widget_open_app_hint));
        } else if (left >= 0) {
            views.setTextViewText(R.id.widget_amount, WidgetStore.rupees(left));
            views.setTextViewText(R.id.widget_label, context.getString(R.string.widget_left_today));
        } else {
            views.setTextViewText(R.id.widget_amount, context.getString(R.string.widget_over, WidgetStore.rupees(-left)));
            views.setTextViewText(R.id.widget_label, context.getString(R.string.widget_over_hint));
        }

        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        Intent open = new Intent(context, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        views.setOnClickPendingIntent(R.id.widget_summary, PendingIntent.getActivity(context, 0, open, flags));
        Intent add = new Intent(context, QuickAddActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        views.setOnClickPendingIntent(R.id.widget_add, PendingIntent.getActivity(context, 1, add, flags));
        return views;
    }
}
