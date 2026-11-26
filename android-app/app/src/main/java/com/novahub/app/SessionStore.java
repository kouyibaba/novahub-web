package com.novahub.app;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import org.json.JSONObject;

/** Device-bound session recovery. No password, plaintext token, or cloud backup. */
final class SessionStore {
    private static final String KEY_ALIAS = "novahub-session-v1";
    private final AtomicFile file;

    SessionStore(Context context) {
        file = new AtomicFile(new File(context.getNoBackupFilesDir(), "session-v1.enc"));
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return (SecretKey) store.getKey(KEY_ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }

    synchronized JSONObject read() {
        try {
            if (file.getBaseFile().length() > 16413) throw new IllegalArgumentException("Session too large");
            return normalized(new JSONObject(new String(SessionCodec.decrypt(key(), file.readFully()), StandardCharsets.UTF_8)));
        } catch (Exception error) {
            file.delete();
            return new JSONObject();
        }
    }

    private JSONObject normalized(JSONObject input) throws Exception {
        String token = input.optString("token", "");
        if (!token.matches("[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+") || token.length() > 8192) {
            throw new IllegalArgumentException("Invalid session");
        }
        JSONObject user = input.getJSONObject("user");
        if (user.getLong("id") < 1) throw new IllegalArgumentException("Invalid user");
        JSONObject safeUser = new JSONObject();
        for (String name : new String[]{"id", "username", "is_pro", "vip_expire_at", "remain_days"}) {
            if (user.has(name)) safeUser.put(name, user.get(name));
        }
        return new JSONObject().put("token", token).put("user", safeUser);
    }

    synchronized void save(String payload) throws Exception {
        if (payload == null || payload.length() > 16384) throw new IllegalArgumentException("Session too large");
        JSONObject input = new JSONObject(payload);
        if (input.optString("token", "").isEmpty()) { file.delete(); return; }
        byte[] sealed = SessionCodec.encrypt(key(), normalized(input).toString().getBytes(StandardCharsets.UTF_8));
        FileOutputStream output = null;
        try {
            output = file.startWrite();
            output.write(sealed);
            file.finishWrite(output);
        } catch (Exception error) {
            if (output != null) file.failWrite(output);
            throw error;
        }
    }
}
