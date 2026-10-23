package com.salaryrunway.app;

import android.Manifest;
import android.database.Cursor;
import android.os.Build;
import android.provider.Telephony;

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

    @PluginMethod
    public void disableAlerts(PluginCall call) {
        SmsAlertStore.setEnabled(getContext(), false);
        call.resolve();
    }

    /** categories, incomeCategories: names for the pop-up; rules: learned shop categories. */
    @PluginMethod
    public void syncAlerts(PluginCall call) {
        JSObject rules = call.getObject("rules", new JSObject());
        SmsAlertStore.setLists(getContext(),
            call.getArray("categories", new JSArray()),
            call.getArray("incomeCategories", new JSArray()),
            rules == null ? new JSObject() : rules,
            call.getArray("cards", new JSArray()));
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
