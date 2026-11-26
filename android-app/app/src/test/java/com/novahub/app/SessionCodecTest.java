package com.novahub.app;

import java.nio.charset.StandardCharsets;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import org.junit.Test;
import static org.junit.Assert.*;

public class SessionCodecTest {
    private SecretKey key() throws Exception {
        KeyGenerator generator = KeyGenerator.getInstance("AES");
        generator.init(256);
        return generator.generateKey();
    }
    @Test public void encryptedSessionCanBeReadAfterCodecRecreation() throws Exception {
        SecretKey key = key();
        byte[] plain = "{\"token\":\"fixture-session\"}".getBytes(StandardCharsets.UTF_8);
        byte[] sealed = SessionCodec.encrypt(key, plain);
        assertArrayEquals(plain, SessionCodec.decrypt(key, sealed));
        assertFalse(new String(sealed, StandardCharsets.UTF_8).contains("fixture-session"));
    }
    @Test public void tamperedSessionCannotBeRestored() throws Exception {
        SecretKey key = key();
        byte[] sealed = SessionCodec.encrypt(key, "session".getBytes(StandardCharsets.UTF_8));
        sealed[sealed.length-1] ^= 1;
        assertThrows(Exception.class, () -> SessionCodec.decrypt(key, sealed));
    }
    @Test public void anotherInstallKeyCannotReadSession() throws Exception {
        byte[] sealed = SessionCodec.encrypt(key(), "session".getBytes(StandardCharsets.UTF_8));
        assertThrows(Exception.class, () -> SessionCodec.decrypt(key(), sealed));
    }
    @Test public void truncatedEnvelopeIsRejected() throws Exception {
        SecretKey key = key();
        assertThrows(Exception.class, () -> SessionCodec.decrypt(key, new byte[]{1,2,3}));
    }
}
