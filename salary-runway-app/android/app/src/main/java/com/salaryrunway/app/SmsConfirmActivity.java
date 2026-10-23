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

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

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

        // Paid from: bank account or one of the cards; preset from the SMS.
        Spinner from = findViewById(R.id.confirm_from);
        JSONArray cards = SmsAlertStore.cards(this);
        List<String> fromLabels = new ArrayList<>();
        List<String> fromIds = new ArrayList<>();
        fromLabels.add(getString(R.string.confirm_from_account));
        fromIds.add("account");
        int preset = 0;
        String last4 = item.optString("last4", "");
        for (int i = 0; i < cards.length(); i++) {
            JSONObject c = cards.optJSONObject(i);
            if (c == null) continue;
            fromLabels.add(getString(R.string.confirm_from_card, c.optString("name"), c.optString("last4")));
            fromIds.add(c.optString("id"));
            if (!last4.isEmpty() && last4.equals(c.optString("last4"))) preset = fromIds.size() - 1;
        }
        boolean showFrom = debit && cards.length() > 0;
        findViewById(R.id.confirm_from_label).setVisibility(showFrom ? android.view.View.VISIBLE : android.view.View.GONE);
        from.setVisibility(showFrom ? android.view.View.VISIBLE : android.view.View.GONE);
        ArrayAdapter<String> fromAdapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, fromLabels);
        fromAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        from.setAdapter(fromAdapter);
        from.setSelection(preset);

        findViewById(R.id.confirm_ignore).setOnClickListener(v -> {
            SmsAlertStore.update(this, key, "ignored", null, null, null);
            if (debit) WidgetStore.adjustLeft(this, amount);
            SpendWidgetProvider.updateAll(this);
            done(key, R.string.confirm_ignored);
        });
        findViewById(R.id.confirm_save).setOnClickListener(v -> {
            String cardId = showFrom ? fromIds.get(from.getSelectedItemPosition()) : null;
            SmsAlertStore.update(this, key, "confirmed", (String) category.getSelectedItem(), note.getText().toString().trim(), cardId);
            done(key, R.string.confirm_saved);
        });
    }

    private void done(String key, int message) {
        NotificationManagerCompat.from(this).cancel(SmsReceiver.notificationId(key));
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
        finish();
    }
}
