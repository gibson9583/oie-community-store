/** Exercises the pinned vendor JAR without credentials or a signing request. */
class CheckCodeSignTool {
    public static void main(String[] args) throws Exception {
        if (!"11".equals(System.getProperty("java.specification.version"))) {
            throw new IllegalStateException("CodeSignTool 1.3.2 JAR support requires JDK 11");
        }
        Class<?> type = Class.forName("com.ssl.code.signing.tool.code.JarSignature");
        Object signer = type.getConstructor().newInstance();
        byte[] hash = (byte[]) type.getMethod("getHash", String.class).invoke(signer, args[0]);
        if (hash == null || hash.length != 32) {
            throw new IllegalStateException("CodeSignTool did not return a SHA-256 JAR hash");
        }
    }
}
