package com.salaryrunway.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;

import java.util.Locale;

/**
 * The language chosen in the app (en, mr or hi), for text shown outside it:
 * the widget, bank SMS notifications and the small pop-up windows. Until the
 * app has sent one, the phone's language is used.
 */
final class Lang {
    private Lang() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences("salary_runway_lang", Context.MODE_PRIVATE);
    }

    static void set(Context context, String lang) {
        if (lang == null || !lang.matches("en|mr|hi")) return;
        prefs(context).edit().putString("lang", lang).apply();
    }

    /** A context whose strings are in the app's language. */
    static Context wrap(Context context) {
        String lang = prefs(context).getString("lang", "");
        if (lang.isEmpty()) return context;
        Configuration config = new Configuration(context.getResources().getConfiguration());
        config.setLocale(new Locale(lang));
        return context.createConfigurationContext(config);
    }
}
