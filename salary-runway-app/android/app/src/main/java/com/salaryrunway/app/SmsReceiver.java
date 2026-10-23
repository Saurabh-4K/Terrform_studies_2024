package com.salaryrunway.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * Catches bank and UPI SMS as they arrive (when the user has turned this on),
 * saves the payment for the app and shows a notification to check its category.
 */
public class SmsReceiver extends BroadcastReceiver {
    static final String CHANNEL = "bank_sms";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        if (!SmsAlertStore.enabled(context)) return;
        SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (parts == null || parts.length == 0) return;

        // Bank alerts come from named senders (VM-HDFCBK); skip phone numbers.
        String sender = parts[0].getDisplayOriginatingAddress();
        if (sender == null || !sender.matches(".*[A-Za-z].*")) return;
        StringBuilder text = new StringBuilder();
        for (SmsMessage part : parts) {
            String piece = part.getDisplayMessageBody();
            if (piece != null) text.append(piece);
        }
        String body = text.toString();

        SmsParser.Result r = SmsParser.parse(body, SmsAlertStore.rules(context));
        if (r == null || r.salary) return;
        String key = SmsParser.key(body);
        if (!SmsAlertStore.add(context, key, r, body)) return;
        if ("cardpayment".equals(r.type)) return; // recorded quietly when the app opens
        if ("debit".equals(r.type)) WidgetStore.adjustLeft(context, -r.amount);
        SpendWidgetProvider.updateAll(context);
        notify(context, key, r);
    }

    static int notificationId(String key) {
        return key.hashCode();
    }

    private static void notify(Context context, String key, SmsParser.Result r) {
        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        if (!manager.areNotificationsEnabled()) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL, context.getString(R.string.sms_channel), NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription(context.getString(R.string.sms_channel_description));
            context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }

        boolean statement = "statement".equals(r.type);
        boolean debit = "debit".equals(r.type);
        org.json.JSONObject card = SmsAlertStore.cardFor(context, r.last4);
        String cardName = card != null ? card.optString("name") : context.getString(R.string.sms_a_card);
        String title;
        String text;
        if (statement) {
            title = context.getString(R.string.sms_title_statement, cardName, WidgetStore.rupees(r.amount));
            text = context.getString(R.string.sms_text_statement);
        } else if (debit && "card".equals(r.paidFrom)) {
            title = context.getString(R.string.sms_title_card, WidgetStore.rupees(r.amount), cardName, r.merchant);
            text = context.getString(R.string.sms_text_card);
        } else {
            title = context.getString(debit ? R.string.sms_title_paid : R.string.sms_title_received,
                WidgetStore.rupees(r.amount), r.merchant);
            text = debit
                ? context.getString(R.string.sms_text_paid, r.category)
                : context.getString(R.string.sms_text_received);
        }

        // A statement opens the app (its card plan); a payment opens the "check this payment" window.
        Intent open = statement
            ? new Intent(context, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            : new Intent(context, SmsConfirmActivity.class)
                .putExtra(SmsConfirmActivity.EXTRA_KEY, key)
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        PendingIntent tap = PendingIntent.getActivity(context, notificationId(key), open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder n = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_runway)
            .setColor(0xFF0D6B58)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        try {
            manager.notify(notificationId(key), n.build());
        } catch (SecurityException ignored) {
            // Notification permission was taken away; the entry still waits in the app.
        }
    }
}
