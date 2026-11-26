package com.novahub.app;

import java.security.GeneralSecurityException;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Versioned authenticated envelope; key management belongs to SessionStore. */
final class SessionCodec {
    static byte[] encrypt(SecretKey key, byte[] plain) throws GeneralSecurityException {
        if (plain.length > 16384) throw new GeneralSecurityException("Session too large");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key);
        byte[] iv = cipher.getIV();
        if (iv.length != 12) throw new GeneralSecurityException("Unsupported IV");
        byte[] sealed = cipher.doFinal(plain);
        byte[] output = new byte[13 + sealed.length];
        output[0] = 1;
        System.arraycopy(iv, 0, output, 1, 12);
        System.arraycopy(sealed, 0, output, 13, sealed.length);
        return output;
    }

    static byte[] decrypt(SecretKey key, byte[] envelope) throws GeneralSecurityException {
        if (envelope.length < 29 || envelope.length > 16413 || envelope[0] != 1) {
            throw new GeneralSecurityException("Invalid session envelope");
        }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, Arrays.copyOfRange(envelope, 1, 13)));
        return cipher.doFinal(envelope, 13, envelope.length - 13);
    }
}
