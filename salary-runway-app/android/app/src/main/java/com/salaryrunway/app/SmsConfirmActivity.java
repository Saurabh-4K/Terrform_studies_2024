package com.salaryrunway.app;

import android.content.Intent;
import android.os.Bundle;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONObject;

import java.util.Arrays;

/**
 * "Check this payment": opened from a bank SMS notification. The user confirms
 * or changes the category, or marks the message as not a payment.
 */
public class SmsConfirmActivity extends AppCompatActivity {
    static final String EXTRA_KEY = "key";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String key = getIntent().getStringExtra(EXTRA_KEY);
        JSONObject item = key == null ? null : SmsAlertStore.get(this, key);
        if (item == null || !"new".equals(item.optString("status"))) {
            // Already handled (or picked up by the app): open the app instead.
            startActivity(new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            finish();
            return;
        }
        setContentView(R.layout.activity_sms_confirm);
        setFinishOnTouchOutside(true);

        boolean debit = "debit".equals(item.optString("type"));
        long amount = item.optLong("amount");
        String merchant = item.optString("merchant");

        TextView summary = findViewById(R.id.confirm_summary);
        summary.setText(getString(debit ? R.string.sms_title_paid : R.string.sms_title_received,
            WidgetStore.rupees(amount), merchant));
        TextView body = findViewById(R.id.confirm_body);
        body.setText(item.optString("body"));

        Spinner category = findViewById(R.id.confirm_category);
        String[] categories = SmsAlertStore.categories(this, !debit);
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, categories);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        category.setAdapter(adapter);
        int guess = Arrays.asList(categories).indexOf(item.optString("category"));
        if (guess >= 0) category.setSelection(guess);

        EditText note = findViewById(R.id.confirm_note);
        note.setText(item.optString("note"));

        findViewById(R.id.confirm_ignore).setOnClickListener(v -> {
            SmsAlertStore.update(this, key, "ignored", null, null);
            if (debit) WidgetStore.adjustLeft(this, amount);
            SpendWidgetProvider.updateAll(this);
            done(key, R.string.confirm_ignored);
        });
        findViewById(R.id.confirm_save).setOnClickListener(v -> {
            SmsAlertStore.update(this, key, "confirmed", (String) category.getSelectedItem(), note.getText().toString().trim());
            done(key, R.string.confirm_saved);
        });
    }

    private void done(String key, int message) {
        NotificationManagerCompat.from(this).cancel(SmsReceiver.notificationId(key));
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
        finish();
    }
}
