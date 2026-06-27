package com.partenaire.monpartenaire;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.OutputStream;
import java.util.Set;
import java.util.UUID;

/**
 * MP-BT-THERMAL — thin in-repo Capacitor plugin for CLASSIC Bluetooth (SPP/RFCOMM)
 * ESC/POS thermal printing. Cheap market printers (Xprinter / Goojprt / etc.) are
 * Bluetooth Classic SPP, not BLE — so this uses BluetoothSocket + the SPP UUID,
 * the same transport the popular DantSu ESC/POS library uses. ESC/POS bytes are
 * built in JS (src/utils/escpos.js) and passed here base64-encoded; this layer
 * only handles permissions, the bonded-device list, and the socket write.
 *
 * Android 12+ (API 31) runtime BLUETOOTH_CONNECT/SCAN are requested via the
 * Capacitor permission flow; on older versions BLUETOOTH/BLUETOOTH_ADMIN are
 * install-time and granted automatically.
 */
@CapacitorPlugin(
    name = "BluetoothPrinter",
    permissions = {
        @Permission(
            alias = "bluetooth",
            strings = {
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.BLUETOOTH_SCAN
            }
        )
    }
)
public class BluetoothPrinterPlugin extends Plugin {

    // Serial Port Profile UUID — what ESC/POS thermal printers expose.
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private boolean needsRuntimePerm() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S; // Android 12+
    }

    private boolean hasPerm() {
        if (!needsRuntimePerm()) return true;
        return getPermissionState("bluetooth") == PermissionState.GRANTED;
    }

    private BluetoothAdapter adapter() {
        return BluetoothAdapter.getDefaultAdapter();
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        BluetoothAdapter a = adapter();
        JSObject r = new JSObject();
        r.put("available", a != null);
        r.put("enabled", a != null && a.isEnabled());
        call.resolve(r);
    }

    // ── List bonded (paired) printers ─────────────────────────────────────────
    @PluginMethod
    public void listPaired(PluginCall call) {
        if (needsRuntimePerm() && !hasPerm()) {
            requestPermissionForAlias("bluetooth", call, "permThenList");
            return;
        }
        doListPaired(call);
    }

    @PermissionCallback
    private void permThenList(PluginCall call) {
        if (!hasPerm()) { call.reject("Bluetooth permission denied", "PERM_DENIED"); return; }
        doListPaired(call);
    }

    private void doListPaired(PluginCall call) {
        BluetoothAdapter a = adapter();
        if (a == null) { call.reject("Bluetooth not supported on this device", "NO_BT"); return; }
        if (!a.isEnabled()) { call.reject("Bluetooth is off — turn it on", "BT_OFF"); return; }
        JSArray devices = new JSArray();
        try {
            Set<BluetoothDevice> bonded = a.getBondedDevices();
            if (bonded != null) {
                for (BluetoothDevice d : bonded) {
                    JSObject o = new JSObject();
                    o.put("name", d.getName());
                    o.put("id", d.getAddress());
                    devices.put(o);
                }
            }
        } catch (SecurityException e) {
            call.reject("Bluetooth permission denied", "PERM_DENIED");
            return;
        }
        JSObject r = new JSObject();
        r.put("devices", devices);
        call.resolve(r);
    }

    // ── Print raw (base64) ESC/POS bytes to a paired printer ──────────────────
    @PluginMethod
    public void print(PluginCall call) {
        if (needsRuntimePerm() && !hasPerm()) {
            requestPermissionForAlias("bluetooth", call, "permThenPrint");
            return;
        }
        doPrint(call);
    }

    @PermissionCallback
    private void permThenPrint(PluginCall call) {
        if (!hasPerm()) { call.reject("Bluetooth permission denied", "PERM_DENIED"); return; }
        doPrint(call);
    }

    private void doPrint(final PluginCall call) {
        final String address = call.getString("address");
        final String dataB64 = call.getString("data");
        if (address == null || dataB64 == null) {
            call.reject("address and data are required", "BAD_ARGS");
            return;
        }
        final BluetoothAdapter a = adapter();
        if (a == null) { call.reject("Bluetooth not supported on this device", "NO_BT"); return; }
        if (!a.isEnabled()) { call.reject("Bluetooth is off — turn it on", "BT_OFF"); return; }

        // Socket connect + write block — keep OFF the WebView/UI thread.
        new Thread(new Runnable() {
            @Override
            public void run() {
                BluetoothSocket socket = null;
                try {
                    BluetoothDevice device = a.getRemoteDevice(address);
                    try { a.cancelDiscovery(); } catch (SecurityException ignored) {}
                    socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                    socket.connect();
                    OutputStream out = socket.getOutputStream();
                    byte[] bytes = Base64.decode(dataB64, Base64.DEFAULT);
                    // Chunk so small printer buffers don't overflow.
                    int chunk = 512;
                    for (int i = 0; i < bytes.length; i += chunk) {
                        int len = Math.min(chunk, bytes.length - i);
                        out.write(bytes, i, len);
                        out.flush();
                        try { Thread.sleep(20); } catch (InterruptedException ignored) {}
                    }
                    out.flush();
                    try { Thread.sleep(150); } catch (InterruptedException ignored) {}
                    JSObject r = new JSObject();
                    r.put("ok", true);
                    call.resolve(r);
                } catch (SecurityException e) {
                    call.reject("Bluetooth permission denied", "PERM_DENIED");
                } catch (Exception e) {
                    call.reject("Could not reach the printer. Check it is on, paired and in range.", "CONNECT_FAILED", e);
                } finally {
                    if (socket != null) {
                        try { socket.close(); } catch (Exception ignored) {}
                    }
                }
            }
        }).start();
    }
}
