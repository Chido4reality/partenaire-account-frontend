package com.partenaire.monpartenaire;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * MP-PUSH-ASK (vc114) — what the push plugin cannot tell us, and the one screen it cannot open.
 *
 * getStatus(): @capacitor/push-notifications answers checkPermissions with "granted" on
 * Android 12 and below unconditionally, and on every version it says nothing about our
 * "mp_alerts" channel. A user can switch the app's notifications off in Settings, or switch
 * off just "Alertes / Alerts", and the app would carry on believing alerts work. This reads
 * the real state:
 *   enabled         NotificationManagerCompat.areNotificationsEnabled() — app-level, all versions
 *   channelExists   the mp_alerts channel has been created (push.js creates it on registration)
 *   channelBlocked  mp_alerts importance is NONE (the user turned off just our channel)
 *
 * openSettings({ target }): opens this app's notification settings directly, so the user is
 * not left hunting through menus that differ by phone brand. target "channel" opens the
 * mp_alerts channel page (Android 8+). Falls back to the app-details page, which exists on
 * every version (minSdk 22). Resolves { opened } with what was actually opened.
 */
@CapacitorPlugin(name = "NotificationSettings")
public class NotificationSettingsPlugin extends Plugin {

    static final String CHANNEL_ID = "mp_alerts";

    @PluginMethod
    public void getStatus(PluginCall call) {
        Context ctx = getContext();
        JSObject r = new JSObject();
        r.put("enabled", NotificationManagerCompat.from(ctx).areNotificationsEnabled());
        r.put("sdk", Build.VERSION.SDK_INT);
        boolean exists = false, blocked = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationChannel ch = nm != null ? nm.getNotificationChannel(CHANNEL_ID) : null;
            exists = ch != null;
            blocked = ch != null && ch.getImportance() == NotificationManager.IMPORTANCE_NONE;
        }
        r.put("channelExists", exists);
        r.put("channelBlocked", blocked);
        call.resolve(r);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Context ctx = getContext();
        String target = call.getString("target", "app");
        String pkg = ctx.getPackageName();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent i;
            String opened;
            if ("channel".equals(target)) {
                i = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, pkg)
                    .putExtra(Settings.EXTRA_CHANNEL_ID, CHANNEL_ID);
                opened = "channel";
            } else {
                i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
                opened = "app_notifications";
            }
            if (start(i)) { resolveOpened(call, opened); return; }
        }

        Intent details = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", pkg, null));
        if (start(details)) { resolveOpened(call, "app_details"); return; }
        call.reject("Could not open the notification settings", "NO_SETTINGS_SCREEN");
    }

    private boolean start(Intent i) {
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
    }

    private void resolveOpened(PluginCall call, String opened) {
        JSObject r = new JSObject();
        r.put("opened", opened);
        call.resolve(r);
    }
}
