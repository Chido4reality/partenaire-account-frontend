package com.partenaire.monpartenaire;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // MP-BT-THERMAL: register the in-repo Classic-Bluetooth ESC/POS plugin
        // BEFORE super.onCreate so the bridge exposes it to the WebView.
        registerPlugin(BluetoothPrinterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
