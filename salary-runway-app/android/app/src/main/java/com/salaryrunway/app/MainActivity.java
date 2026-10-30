package com.salaryrunway.app;

import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmsInboxPlugin.class);
        registerPlugin(SpendWidgetPlugin.class);
        registerPlugin(ShareFilePlugin.class);
        registerPlugin(AppLockPlugin.class);
        super.onCreate(savedInstanceState);
        // App lock's "hide in recent apps": set before anything is drawn.
        if (AppLockPlugin.secureWindow(this)) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        // The phone's back button works like the app's back: the app closes what's open
        // (a pop-up, a page, Profile, another tab). Only on Runway with nothing open does it leave.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = getBridge() != null ? getBridge().getWebView() : null;
                if (web == null) {
                    leave(this);
                    return;
                }
                web.evaluateJavascript("(function(){try{return !!(window.hisabBack&&window.hisabBack());}catch(e){return false;}})()", (handled) -> {
                    if (!"true".equals(handled)) leave(this);
                });
            }
        });
    }

    // Android's own back: this callback steps aside for one press.
    private void leave(OnBackPressedCallback callback) {
        callback.setEnabled(false);
        getOnBackPressedDispatcher().onBackPressed();
        callback.setEnabled(true);
    }
}
