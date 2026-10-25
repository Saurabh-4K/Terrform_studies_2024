package com.salaryrunway.app;

import android.os.Bundle;
import android.view.WindowManager;

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
    }
}
