package com.salaryrunway.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.provider.Telephony;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONException;

import java.util.HashSet;
import java.util.List;

/**
 * Reads SMS from the phone's inbox so bank and UPI alerts can be turned into
 * payments, and manages alerts for new bank SMS (see SmsReceiver). Messages are
 * handed to the app's own page and never leave the phone.
 */
@CapacitorPlugin(
    name = "SmsInbox",
    permissions = {
        @Permission(alias = "sms", strings = { Manifest.permission.READ_SMS }),
        @Permission(alias = "receive", strings = { Manifest.permission.RECEIVE_SMS }),
        @Permission(alias = "notify", strings = { Manifest.permission.POST_NOTIFICATIONS }),
    }
)
public class SmsInboxPlugin extends Plugin {

    @PluginMethod
    public void read(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            requestPermissionForAlias("sms", call, "smsPermissionCallback");
            return;
        }
        readInbox(call);
    }

    @PermissionCallback
    private void smsPermissionCallback(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED) {
            readInbox(call);
        } else {
            call.reject("SMS permission was not given", "PERMISSION_DENIED");
        }
    }

    // ---------- alerts for new bank SMS ----------

    @PluginMethod
    public void enableAlerts(PluginCall call) {
        String[] aliases = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            ? new String[] { "receive", "notify" }
            : new String[] { "receive" };
        requestPermissionForAliases(aliases, call, "alertsPermissionCallback");
    }

    @PermissionCallback
    private void alertsPermissionCallback(PluginCall call) {
        if (getPermissionState("receive") != PermissionState.GRANTED) {
            call.reject("SMS permission was not given", "PERMISSION_DENIED");
            return;
        }
        SmsAlertStore.setEnabled(getContext(), true);
        JSObject result = new JSObject();
        result.put("enabled", true);
        result.put("notifications", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        call.resolve(result);
    }

    /**
     * Why a payment notification might not come: alerts off in the app, the
     * permission for new SMS missing, or notifications blocked for the app or
     * its bank SMS channel. Each one fails silently otherwise.
     */
    @PluginMethod
    public void alertsStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("enabled", SmsAlertStore.enabled(getContext()));
        result.put("receive", getPermissionState("receive") == PermissionState.GRANTED);
        boolean notify = NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
        if (notify && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getContext().getSystemService(NotificationManager.class);
            NotificationChannel channel = manager != null ? manager.getNotificationChannel(SmsReceiver.CHANNEL) : null;
            if (channel != null && channel.getImportance() == NotificationManager.IMPORTANCE_NONE) notify = false;
        }
        result.put("notifications", notify);
        call.resolve(result);
    }

    /** Opens Android's notification settings for this app. */
    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent intent = new Intent();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent.setAction(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        } else {
            intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    /** title, text: shown on the bank SMS channel, to check notifications reach the phone. */
    @PluginMethod
    public void testNotification(PluginCall call) {
        NotificationManagerCompat manager = NotificationManagerCompat.from(getContext());
        if (!manager.areNotificationsEnabled()) {
            call.reject("Notifications are off for this app", "NOTIFICATIONS_OFF");
            return;
        }
        SmsReceiver.ensureChannel(getContext());
        Intent open = new Intent(getContext(), MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent tap = PendingIntent.getActivity(getContext(), 7001, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder n = new NotificationCompat.Builder(getContext(), SmsReceiver.CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_runway)
            .setColor(0xFF0C3B3D)
            .setContentTitle(call.getString("title", "Hisab Se"))
            .setContentText(call.getString("text", ""))
            .setContentIntent(tap)
            .setAutoCancel(true);
        try {
            manager.notify(7001, n.build());
            call.resolve();
        } catch (SecurityException e) {
            call.reject("Notifications are off for this app", "NOTIFICATIONS_OFF");
        }
    }

    @PluginMethod
    public void disableAlerts(PluginCall call) {
        SmsAlertStore.setEnabled(getContext(), false);
        call.resolve();
    }

    /** categories, incomeCategories: names for the pop-up, with labels in the app's language; rules: learned shop categories. */
    @PluginMethod
    public void syncAlerts(PluginCall call) {
        JSObject rules = call.getObject("rules", new JSObject());
        SmsAlertStore.setLists(getContext(),
            call.getArray("categories", new JSArray()),
            call.getArray("incomeCategories", new JSArray()),
            call.getArray("categoryLabels", new JSArray()),
            call.getArray("incomeCategoryLabels", new JSArray()),
            rules == null ? new JSObject() : rules,
            call.getArray("cards", new JSArray()));
        SmsAlertStore.setSkipText(getContext(), call.getArray("skipText", new JSArray()));
        Lang.set(getContext(), call.getString("lang"));
        call.resolve();
    }

    @PluginMethod
    public void getAlerts(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("enabled", SmsAlertStore.enabled(getContext()));
            result.put("items", new JSArray(SmsAlertStore.all(getContext()).toString()));
            call.resolve(result);
        } catch (JSONException e) {
            call.reject("Could not read caught messages: " + e.getMessage());
        }
    }

    /** keys: entries the app has saved. Their notifications are cleared too. */
    @PluginMethod
    public void removeAlerts(PluginCall call) {
        try {
            List<String> keys = call.getArray("keys", new JSArray()).toList();
            NotificationManagerCompat notifications = NotificationManagerCompat.from(getContext());
            for (String key : keys) notifications.cancel(SmsReceiver.notificationId(key));
            SmsAlertStore.remove(getContext(), new HashSet<>(keys));
            call.resolve();
        } catch (JSONException e) {
            call.reject("Could not clear caught messages: " + e.getMessage());
        }
    }

    // ---------- inbox ----------

    private void readInbox(PluginCall call) {
        // `since` is a timestamp in milliseconds; only newer messages are returned.
        long since = call.getDouble("since", 0.0).longValue();
        int limit = call.getInt("limit", 500);
        String[] columns = { Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE };
        JSArray messages = new JSArray();
        try (Cursor cursor = getContext().getContentResolver().query(
                Telephony.Sms.Inbox.CONTENT_URI,
                columns,
                Telephony.Sms.DATE + " > ?",
                new String[] { String.valueOf(since) },
                Telephony.Sms.DATE + " DESC")) {
            if (cursor != null) {
                while (cursor.moveToNext() && messages.length() < limit) {
                    // Bank and UPI alerts come from named senders (VM-HDFCBK). Messages from
                    // phone numbers (friends, family) are skipped here and never reach the app.
                    String address = cursor.getString(0);
                    if (address == null || !address.matches(".*[A-Za-z].*")) continue;
                    JSObject message = new JSObject();
                    message.put("address", cursor.getString(0));
                    message.put("body", cursor.getString(1));
                    message.put("date", cursor.getLong(2));
                    messages.put(message);
                }
            }
        } catch (Exception e) {
            call.reject("Could not read messages: " + e.getMessage());
            return;
        }
        JSObject result = new JSObject();
        result.put("messages", messages);
        call.resolve(result);
    }
}
