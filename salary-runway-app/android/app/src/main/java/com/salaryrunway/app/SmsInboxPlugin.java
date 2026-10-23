package com.salaryrunway.app;

import android.Manifest;
import android.database.Cursor;
import android.provider.Telephony;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Reads SMS from the phone's inbox so bank and UPI alerts can be turned into
 * payments. Messages are handed to the app's own page and never leave the phone.
 */
@CapacitorPlugin(
    name = "SmsInbox",
    permissions = { @Permission(alias = "sms", strings = { Manifest.permission.READ_SMS }) }
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
