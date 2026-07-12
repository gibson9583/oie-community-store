/*
 * OIE Community Store
 *
 * Published under the terms of the Mozilla Public License 2.0.
 */

package org.openintegrationengine.plugins.communitystore;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * Drift-detection hashing shared by the install path (which records the pristine hash in the
 * install ledger) and the catalog resolve (which compares the live engine object against it to
 * flag content as "modified"). Both sides MUST hash identically or every install would read as
 * modified:
 *
 * Code templates hash the code string alone — name, context, and type are user-adjustable
 * metadata that in-place upgrades deliberately preserve, so they must not count as drift.
 *
 * Channels and code template libraries hash their engine XML normalized by stripping the
 * volatile {@code <revision>} and {@code <lastModified>} elements (the engine bumps those on
 * every save — including our own import) and collapsing whitespace.
 */
public final class ContentHash {

    private ContentHash() {
    }

    /** Hash of a code template's code string (null-safe: a missing body hashes as empty). */
    public static String codeHash(String code) {
        return sha256Hex((code == null ? "" : code).getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Hash of engine XML with the save-counter noise removed. The element strip is a global
     * regex on purpose: a library's XML nests each member template's own revision/lastModified,
     * and all of them are volatile. Neither element ever nests one of its own name.
     */
    public static String normalizedXmlHash(String xml) {
        String normalized = xml
                .replaceAll("(?s)<revision>.*?</revision>", "")
                .replaceAll("(?s)<lastModified>.*?</lastModified>", "")
                .replaceAll("\\s+", " ")
                .trim();
        return sha256Hex(normalized.getBytes(StandardCharsets.UTF_8));
    }

    public static String sha256Hex(byte[] data) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(data);
            StringBuilder hex = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            // Every conforming JRE ships SHA-256; this is unreachable in practice.
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }
}
