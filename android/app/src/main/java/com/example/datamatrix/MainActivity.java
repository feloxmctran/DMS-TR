package com.example.datamatrix;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Özel pluginimizi önce kaydediyoruz
        registerPlugin(FastStockScannerPlugin.class);

        // Sonra Bridge'i başlatıyoruz
        super.onCreate(savedInstanceState);
    }
}
