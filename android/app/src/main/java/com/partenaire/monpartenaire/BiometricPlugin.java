package com.partenaire.monpartenaire;

import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

/**
 * APP LOCK (2026-10-21) — fingerprint / face unlock for the app lock, BIOMETRIC_STRONG only.
 *
 * Each user who turns biometric unlock on gets an Android Keystore key (alias from JS, one per user)
 * that can only be USED after a strong biometric check, and that Android cancels when a new finger or
 * face is enrolled (setInvalidatedByBiometricEnrollment). Unlocking = BiometricPrompt with that key as
 * its CryptoObject, then one encryption with the unlocked key: a prompt that was not really passed
 * cannot produce it. So someone who adds their own finger in Android settings gets "invalidated" and
 * must type the password.
 *   - BIOMETRIC_STRONG only: weak face unlock is refused; the phone's PIN (DEVICE_CREDENTIAL) is never
 *     offered — on a shared tablet everyone knows it.
 *   - Android below 7.0 (API 24) has no enrolment invalidation → reported unavailable (password only).
 *   - No fingerprint/face ever reaches the app; Android only says yes or no.
 *
 * status()                       → { available, reason, sdk }
 * hasKey({ alias })              → { exists }
 * createKey({ alias })           → { ok }   (replaces an existing key)
 * authenticate({ alias, title, subtitle, cancel }) → { ok } | { ok:false, code: no_key|invalidated|cancelled|lockout|lockout_permanent|error }
 * deleteKey({ alias })           → { ok }
 * Every call resolves (never rejects) except a malformed alias.
 */
@CapacitorPlugin(name = "AppLockBiometric")
public class BiometricPlugin extends Plugin {

    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String TRANSFORM = "AES/GCM/NoPadding";
    private static final int STRONG = BiometricManager.Authenticators.BIOMETRIC_STRONG;

    private static boolean goodAlias(String a) {
        return a != null && a.matches("^[A-Za-z0-9_-]{1,80}$");
    }

    private String aliasOf(PluginCall call) {
        String a = call.getString("alias");
        if (!goodAlias(a)) { call.reject("bad alias", "bad_alias"); return null; }
        return "mp_applock_" + a;
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("sdk", Build.VERSION.SDK_INT);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            r.put("available", false); r.put("reason", "old_android");
            call.resolve(r); return;
        }
        int can = BiometricManager.from(getContext()).canAuthenticate(STRONG);
        String reason;
        switch (can) {
            case BiometricManager.BIOMETRIC_SUCCESS: reason = "ok"; break;
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE: reason = "no_hardware"; break;
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED: reason = "none_enrolled"; break;
            case BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED: reason = "security_update"; break;
            case BiometricManager.BIOMETRIC_ERROR_UNSUPPORTED: reason = "unsupported"; break;
            default: reason = "unavailable";
        }
        r.put("available", can == BiometricManager.BIOMETRIC_SUCCESS);
        r.put("reason", reason);
        call.resolve(r);
    }

    @PluginMethod
    public void hasKey(PluginCall call) {
        String alias = aliasOf(call); if (alias == null) return;
        JSObject r = new JSObject();
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE); ks.load(null);
            r.put("exists", ks.containsAlias(alias));
        } catch (Exception e) { r.put("exists", false); }
        call.resolve(r);
    }

    @PluginMethod
    public void createKey(PluginCall call) {
        String alias = aliasOf(call); if (alias == null) return;
        JSObject r = new JSObject();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) { r.put("ok", false); r.put("code", "old_android"); call.resolve(r); return; }
        try {
            deleteQuietly(alias);
            KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(alias,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(true)
                .setInvalidatedByBiometricEnrollment(true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                // every use needs a fresh STRONG biometric (no time window, no device PIN)
                b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
            }
            KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
            kg.init(b.build());
            kg.generateKey();
            r.put("ok", true);
        } catch (Exception e) {
            r.put("ok", false); r.put("code", "error"); r.put("message", String.valueOf(e.getMessage()));
        }
        call.resolve(r);
    }

    @PluginMethod
    public void deleteKey(PluginCall call) {
        String alias = aliasOf(call); if (alias == null) return;
        deleteQuietly(alias);
        JSObject r = new JSObject(); r.put("ok", true);
        call.resolve(r);
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        final String alias = aliasOf(call); if (alias == null) return;
        final String title = call.getString("title", "Stenamo Book");
        final String subtitle = call.getString("subtitle", "");
        final String cancel = call.getString("cancel", "Mot de passe / Password");
        final Cipher cipher;
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE); ks.load(null);
            if (!ks.containsAlias(alias)) { fail(call, "no_key", null); return; }
            SecretKey key = (SecretKey) ks.getKey(alias, null);
            cipher = Cipher.getInstance(TRANSFORM);
            cipher.init(Cipher.ENCRYPT_MODE, key);
        } catch (KeyPermanentlyInvalidatedException e) {
            // a new finger/face was enrolled (or all were removed): this key can never be used again
            deleteQuietly(alias);
            fail(call, "invalidated", null); return;
        } catch (Exception e) {
            fail(call, "error", e.getMessage()); return;
        }
        final FragmentActivity activity = getActivity();
        if (activity == null) { fail(call, "error", "no activity"); return; }
        activity.runOnUiThread(() -> {
            BiometricPrompt prompt = new BiometricPrompt(activity, ContextCompat.getMainExecutor(activity),
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        try {
                            BiometricPrompt.CryptoObject co = result.getCryptoObject();
                            Cipher c = co != null ? co.getCipher() : null;
                            if (c == null) { fail(call, "error", "no cipher"); return; }
                            byte[] probe = new byte[16];
                            new SecureRandom().nextBytes(probe);
                            c.doFinal(probe);   // only an unlocked key can do this
                            JSObject r = new JSObject(); r.put("ok", true);
                            call.resolve(r);
                        } catch (Exception e) { fail(call, "error", e.getMessage()); }
                    }
                    @Override
                    public void onAuthenticationError(int code, CharSequence msg) {
                        String c;
                        switch (code) {
                            case BiometricPrompt.ERROR_NEGATIVE_BUTTON:
                            case BiometricPrompt.ERROR_USER_CANCELED:
                            case BiometricPrompt.ERROR_CANCELED: c = "cancelled"; break;
                            case BiometricPrompt.ERROR_LOCKOUT: c = "lockout"; break;
                            case BiometricPrompt.ERROR_LOCKOUT_PERMANENT: c = "lockout_permanent"; break;
                            default: c = "error";
                        }
                        fail(call, c, msg != null ? msg.toString() : null);
                    }
                    // onAuthenticationFailed (a finger that does not match): the prompt stays up and
                    // Android counts it; nothing to do here.
                });
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle(subtitle)
                .setNegativeButtonText(cancel)
                .setAllowedAuthenticators(STRONG)
                .setConfirmationRequired(false)
                .build();
            try { prompt.authenticate(info, new BiometricPrompt.CryptoObject(cipher)); }
            catch (Exception e) { fail(call, "error", e.getMessage()); }
        });
    }

    private static void fail(PluginCall call, String code, String message) {
        JSObject r = new JSObject();
        r.put("ok", false); r.put("code", code);
        if (message != null) r.put("message", message);
        call.resolve(r);
    }

    private static void deleteQuietly(String alias) {
        try {
            KeyStore ks = KeyStore.getInstance(KEYSTORE); ks.load(null);
            if (ks.containsAlias(alias)) ks.deleteEntry(alias);
        } catch (Exception ignored) { /* nothing to delete */ }
    }
}
