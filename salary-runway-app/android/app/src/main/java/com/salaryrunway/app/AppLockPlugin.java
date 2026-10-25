package com.salaryrunway.app;

import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.provider.Settings;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.security.keystore.UserNotAuthenticatedException;
import android.util.Base64;
import android.view.WindowManager;

import androidx.annotation.NonNull;
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
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * App lock: fingerprint, face or the phone's own screen lock, through
 * Android's biometric prompt. No separate app password.
 *
 * The app's data on the phone is encrypted (in the web layer) with a random
 * data key. That data key is kept here only in wrapped form: encrypted by a
 * key in the Android Keystore that can be used only within 30 seconds of the
 * user unlocking with fingerprint, face or the screen lock. So the data can't
 * be read without unlocking, even from a copy of the app's storage.
 *
 * Turning the lock on tests the whole round trip (wrap, unlock, unwrap) before
 * the app encrypts anything. If the phone's screen lock is ever removed,
 * Android destroys the Keystore key and only a backup file can bring the data back.
 */
@CapacitorPlugin(name = "AppLock")
public class AppLockPlugin extends Plugin {
    private static final String ALIAS = "hisab_se_data_key";
    private static final String PREFS = "app_lock";
    private static final int AUTH_SECONDS = 30;

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Erase everything: the wrapped key, the Keystore key and the settings. */
    static void forget(Context context) {
        prefs(context).edit().clear().commit();
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS);
        } catch (Exception ignored) {
            // Nothing to delete.
        }
    }

    /** Applied when the app starts, before the web page loads. */
    static boolean secureWindow(Context context) {
        return prefs(context).getBoolean("secure", false);
    }

    private static int authenticators() {
        // Android 11+: strong biometrics or the screen lock. Before that, the
        // library only allows the screen lock alongside "weak" biometrics.
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
            ? BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL
            : BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
    }

    /** available: the phone has a screen lock; biometric: fingerprint or face is set up; on: a wrapped key exists. */
    @PluginMethod
    public void status(PluginCall call) {
        Context context = getContext();
        KeyguardManager km = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
        boolean secure = km != null && km.isDeviceSecure();
        int bio = BiometricManager.from(context).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        JSObject r = new JSObject();
        r.put("available", secure);
        r.put("biometric", bio == BiometricManager.BIOMETRIC_SUCCESS);
        r.put("on", prefs(context).contains("wrapped"));
        call.resolve(r);
    }

    /** Opens the phone's security settings, to set a screen lock. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_SECURITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    /** on: hide the app's screen in recent apps and screenshots. */
    @PluginMethod
    public void setSecure(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        prefs(getContext()).edit().putBoolean("secure", on).apply();
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            call.resolve();
        });
    }

    /**
     * key: the data key (base64). Creates the Keystore key, asks the user to
     * unlock, wraps the data key, then unwraps it again and checks it matches.
     * Only then is it kept. title/subtitle: the prompt's text.
     */
    @PluginMethod
    public void enable(PluginCall call) {
        final byte[] dataKey;
        try {
            dataKey = Base64.decode(call.getString("key", ""), Base64.NO_WRAP);
            if (dataKey.length != 32) throw new IllegalArgumentException("bad key");
            createKey();
        } catch (Exception e) {
            call.reject("Couldn't set up the lock: " + e.getMessage(), "setup");
            return;
        }
        prompt(call, () -> {
            try {
                Cipher enc = Cipher.getInstance("AES/GCM/NoPadding");
                enc.init(Cipher.ENCRYPT_MODE, key());
                byte[] iv = enc.getIV();
                byte[] wrapped = enc.doFinal(dataKey);
                // The round trip, before anything depends on it.
                Cipher dec = Cipher.getInstance("AES/GCM/NoPadding");
                dec.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
                if (!Arrays.equals(dec.doFinal(wrapped), dataKey)) throw new IllegalStateException("check failed");
                prefs(getContext()).edit()
                    .putString("wrapped", Base64.encodeToString(wrapped, Base64.NO_WRAP))
                    .putString("iv", Base64.encodeToString(iv, Base64.NO_WRAP))
                    .commit();
                call.resolve();
            } catch (Exception e) {
                forget(getContext());
                call.reject("The lock check failed: " + e.getMessage(), "check");
            }
        });
    }

    /** Asks the user to unlock; resolves with the data key (base64). */
    @PluginMethod
    public void unlock(PluginCall call) {
        SharedPreferences p = prefs(getContext());
        if (!p.contains("wrapped")) {
            call.reject("No lock", "none");
            return;
        }
        try {
            // Removing the phone's screen lock deletes the Keystore key: say so before asking to unlock.
            if (key() == null) {
                call.reject("The phone's screen lock was removed, so the key is gone.", "lost");
                return;
            }
        } catch (Exception e) {
            call.reject("Couldn't open the key store: " + e.getMessage(), "error");
            return;
        }
        prompt(call, () -> {
            try {
                Cipher dec = Cipher.getInstance("AES/GCM/NoPadding");
                dec.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(p.getString("iv", ""), Base64.NO_WRAP)));
                byte[] dataKey = dec.doFinal(Base64.decode(p.getString("wrapped", ""), Base64.NO_WRAP));
                JSObject r = new JSObject();
                r.put("key", Base64.encodeToString(dataKey, Base64.NO_WRAP));
                call.resolve(r);
            } catch (KeyPermanentlyInvalidatedException e) {
                call.reject("The phone's screen lock was removed, so the key is gone.", "lost");
            } catch (UserNotAuthenticatedException e) {
                call.reject("Unlock again.", "auth");
            } catch (Exception e) {
                call.reject("Couldn't open the data: " + e.getMessage(), "error");
            }
        });
    }

    /** Turns the lock off: the app has already written its data back unencrypted. */
    @PluginMethod
    public void disable(PluginCall call) {
        forget(getContext());
        getActivity().runOnUiThread(() -> {
            getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            call.resolve();
        });
    }

    private void createKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS);
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            // A new fingerprint shouldn't lock the owner out of their own data.
            .setInvalidatedByBiometricEnrollment(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            spec.setUserAuthenticationParameters(AUTH_SECONDS, KeyProperties.AUTH_BIOMETRIC_STRONG | KeyProperties.AUTH_DEVICE_CREDENTIAL);
        } else {
            spec.setUserAuthenticationValidityDurationSeconds(AUTH_SECONDS);
        }
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        gen.init(spec.build());
        gen.generateKey();
    }

    private SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        return (SecretKey) ks.getKey(ALIAS, null);
    }

    /** Shows Android's prompt; runs `then` after a successful unlock. */
    private void prompt(PluginCall call, Runnable then) {
        FragmentActivity activity = getActivity();
        activity.runOnUiThread(() -> {
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle(call.getString("title", "Unlock Hisab Se"))
                .setSubtitle(call.getString("subtitle", ""))
                .setAllowedAuthenticators(authenticators())
                .build();
            BiometricPrompt bp = new BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), new BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                    then.run();
                }

                @Override
                public void onAuthenticationError(int code, @NonNull CharSequence message) {
                    call.reject(message.toString(), code == BiometricPrompt.ERROR_USER_CANCELED || code == BiometricPrompt.ERROR_NEGATIVE_BUTTON || code == BiometricPrompt.ERROR_CANCELED ? "cancel" : "auth");
                }
            });
            bp.authenticate(info);
        });
    }
}
