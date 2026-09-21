import java.io.OutputStream;
import java.security.CodeSigner;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Locale;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

/** Complements jarsigner -verify -strict with signer, timestamp and coverage checks. */
class VerifyJar {
    private static boolean signatureMetadata(String name) {
        name = name.toUpperCase(Locale.ROOT);
        if (!name.startsWith("META-INF/") || name.indexOf('/', 9) != -1) {
            return false;
        }
        String leaf = name.substring(9);
        return leaf.equals("MANIFEST.MF") || leaf.startsWith("SIG-")
                || leaf.endsWith(".SF") || leaf.endsWith(".RSA")
                || leaf.endsWith(".DSA") || leaf.endsWith(".EC");
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 2 || !args[1].matches("[0-9a-f]{64}")) {
            throw new IllegalArgumentException("Expected JAR path and SHA-256 certificate fingerprint");
        }
        int checked = 0;
        try (JarFile jar = new JarFile(args[0], true)) {
            var entries = jar.entries();
            while (entries.hasMoreElements()) {
                JarEntry entry = entries.nextElement();
                if (entry.isDirectory()) {
                    continue;
                }
                // Reading every byte forces Java to verify the entry's signature.
                try (var stream = jar.getInputStream(entry)) {
                    stream.transferTo(OutputStream.nullOutputStream());
                }
                if (signatureMetadata(entry.getName())) {
                    continue;
                }
                CodeSigner[] signers = entry.getCodeSigners();
                if (signers == null || signers.length != 1) {
                    throw new SecurityException("Expected one signer for " + entry.getName());
                }
                CodeSigner signer = signers[0];
                byte[] cert = signer.getSignerCertPath().getCertificates().get(0).getEncoded();
                String digest = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(cert));
                if (!digest.equals(args[1])) {
                    throw new SecurityException("Unexpected signing certificate for " + entry.getName());
                }
                if (signer.getTimestamp() == null) {
                    throw new SecurityException("Missing trusted timestamp for " + entry.getName());
                }
                checked++;
            }
        }
        if (checked == 0) {
            throw new SecurityException("JAR has no signed payload entries");
        }
        System.out.println("Verified signer and timestamp for " + checked + " JAR entries");
    }
}
