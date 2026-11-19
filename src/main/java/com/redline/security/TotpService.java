package com.redline.security;

import java.nio.ByteBuffer;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Server-side TOTP verifier for a future Java API. */
public final class TotpService {
    private TotpService() {}

    public static boolean verify(String secret, String code, long epochSeconds) {
        if (secret == null || code == null || !code.matches("\\d{6}")) return false;
        byte[] key = base32ToBytes(secret);
        long counter = epochSeconds / 30;
        for (long offset = -1; offset <= 1; offset++) {
            try {
                Mac mac = Mac.getInstance("HmacSHA1");
                mac.init(new SecretKeySpec(key, "HmacSHA1"));
                ByteBuffer buffer = ByteBuffer.allocate(8);
                buffer.putLong(counter + offset);
                byte[] digest = mac.doFinal(buffer.array());
                int start = digest[digest.length - 1] & 15;
                int number = ((digest[start] & 127) << 24) | ((digest[start + 1] & 255) << 16)
                        | ((digest[start + 2] & 255) << 8) | (digest[start + 3] & 255);
                if (String.format("%06d", number % 1_000_000).equals(code)) return true;
            } catch (Exception ignored) { return false; }
        }
        return false;
    }

    private static byte[] base32ToBytes(String value) {
        String sanitized = value.trim().replace(" ", "").toUpperCase();
        sanitized = sanitized.replace("=", "");
        String alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        StringBuilder bits = new StringBuilder();

        for (char character : sanitized.toCharArray()) {
            int index = alphabet.indexOf(character);
            if (index < 0) throw new IllegalArgumentException("Secret inválida para Base32.");
            bits.append(String.format("%5s", Integer.toBinaryString(index)).replace(' ', '0'));
        }

        int bytesCount = (int) Math.floor(bits.length() / 8);
        byte[] bytes = new byte[bytesCount];
        for (int i = 0; i < bytesCount; i++) {
            bytes[i] = (byte) Integer.parseInt(bits.substring(i * 8, (i + 1) * 8), 2);
        }
        return bytes;
    }
}