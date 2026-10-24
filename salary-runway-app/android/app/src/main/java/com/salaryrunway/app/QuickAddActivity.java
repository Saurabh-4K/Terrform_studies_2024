package com.salaryrunway.app;

import android.content.Context;
import android.os.Bundle;
import android.view.WindowManager;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import java.util.Arrays;

/**
 * The small "Add an expense" window opened from the widget. It saves the
 * expense for the app to pick up next time it opens, without opening the app.
 */
public class QuickAddActivity extends AppCompatActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_quick_add);
        setFinishOnTouchOutside(true);
        // Labels in the app's language (the layout's own text follows the phone).
        Context text = Lang.wrap(this);
        ((TextView) findViewById(R.id.quick_title)).setText(text.getString(R.string.quick_title));
        ((TextView) findViewById(R.id.quick_cancel)).setText(text.getString(R.string.quick_cancel));
        ((TextView) findViewById(R.id.quick_save)).setText(text.getString(R.string.quick_save));

        EditText amount = findViewById(R.id.quick_amount);
        Spinner category = findViewById(R.id.quick_category);
        EditText note = findViewById(R.id.quick_note);
        TextView left = findViewById(R.id.quick_left);
        amount.setHint(text.getString(R.string.quick_amount));
        note.setHint(text.getString(R.string.quick_note));

        String[] categories = WidgetStore.categories(this);
        ArrayAdapter<String> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, WidgetStore.categoryLabels(this));
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        category.setAdapter(adapter);
        int food = Arrays.asList(categories).indexOf("Food & dining");
        if (food >= 0) category.setSelection(food);

        Long leftToday = WidgetStore.leftToday(this);
        if (leftToday == null) {
            left.setText("");
        } else if (leftToday >= 0) {
            left.setText(text.getString(R.string.quick_left, WidgetStore.rupees(leftToday)));
        } else {
            left.setText(text.getString(R.string.quick_over, WidgetStore.rupees(-leftToday)));
        }

        findViewById(R.id.quick_cancel).setOnClickListener(v -> finish());
        findViewById(R.id.quick_save).setOnClickListener(v -> {
            long value;
            try {
                value = Math.round(Double.parseDouble(amount.getText().toString().trim()));
            } catch (NumberFormatException e) {
                value = 0;
            }
            if (value <= 0) {
                amount.setError(text.getString(R.string.quick_amount_error));
                return;
            }
            WidgetStore.queueExpense(this, value, categories[category.getSelectedItemPosition()], note.getText().toString().trim());
            SpendWidgetProvider.updateAll(this);
            Toast.makeText(this, text.getString(R.string.quick_added, WidgetStore.rupees(value)), Toast.LENGTH_SHORT).show();
            finish();
        });

        amount.requestFocus();
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
    }
}
