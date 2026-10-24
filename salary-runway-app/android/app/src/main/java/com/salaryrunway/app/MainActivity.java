package com.salaryrunway.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmsInboxPlugin.class);
        registerPlugin(SpendWidgetPlugin.class);
        registerPlugin(LocalAiPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
