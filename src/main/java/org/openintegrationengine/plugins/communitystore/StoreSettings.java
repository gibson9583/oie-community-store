/*
 * OIE Community Store
 *
 * Published under the terms of the Mozilla Public License 2.0.
 */

package org.openintegrationengine.plugins.communitystore;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Properties;
import java.util.Set;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * Store configuration. The bundled sources.json (shipped inside the plugin jar) provides the
 * default source list and project blocklist; administrator-added sources, a local blocklist,
 * the beta channel flag, and the encrypted PAT persist through the engine's plugin properties.
 * The bundled blocklist always applies and cannot be removed at runtime.
 */
public class StoreSettings {

    public static final String PROP_CUSTOM_SOURCES = "customSources";
    public static final String PROP_LOCAL_BLOCKLIST = "localBlocklist";
    public static final String PROP_BETA_CHANNEL = "betaChannel";
    public static final String PROP_GITHUB_TOKEN_ENC = "githubTokenEncrypted";
    public static final String PROP_SYNC_TTL_MINUTES = "syncTtlMinutes";
    public static final String PROP_INSTALL_LEDGER = "installLedger";

    private static final ObjectMapper MAPPER = new ObjectMapper();

    public static class SourceDef {
        public final String kind;   // "repo" | "org" | "catalog"
        public final String repo;   // owner/name, for kind=repo
        public final String org;    // org login, for kind=org
        public final String topic;  // topic filter, for kind=org
        public final String url;    // index.json URL, for kind=catalog

        public SourceDef(String kind, String repo, String org, String topic) {
            this(kind, repo, org, topic, null);
        }

        public SourceDef(String kind, String repo, String org, String topic, String url) {
            this.kind = kind;
            this.repo = repo;
            this.org = org;
            this.topic = topic;
            this.url = url;
        }

        public String describe() {
            if ("catalog".equals(kind)) {
                return "catalog:" + url;
            }
            return "org".equals(kind) ? "org:" + org + " (topic: " + topic + ")" : "repo:" + repo;
        }

        public ObjectNode toJson() {
            ObjectNode node = MAPPER.createObjectNode();
            node.put("kind", kind);
            if ("catalog".equals(kind)) {
                node.put("url", url);
            } else if ("org".equals(kind)) {
                node.put("org", org);
                node.put("topic", topic);
            } else {
                node.put("repo", repo);
            }
            return node;
        }

        // GitHub owner/org logins and repository names: alphanumerics plus hyphen, dot, and
        // underscore, with no "." or ".." segment (those would alter the fetch path once
        // interpolated into a raw.githubusercontent.com / api.github.com URL). Topics are
        // lowercase alphanumerics and hyphens.
        private static final java.util.regex.Pattern OWNER = java.util.regex.Pattern.compile("[\\w-]+");
        private static final java.util.regex.Pattern NAME = java.util.regex.Pattern.compile("[\\w.-]+");
        private static final java.util.regex.Pattern TOPIC = java.util.regex.Pattern.compile("[a-z0-9][a-z0-9-]*");

        private static boolean isDotSegment(String value) {
            return value.equals(".") || value.equals("..");
        }

        public static SourceDef fromJson(JsonNode node) {
            String kind = node.path("kind").asText("repo");
            if ("catalog".equals(kind)) {
                // A prebuilt index (index.json) at any https URL — the platform-agnostic source.
                String url = node.path("url").asText("").trim();
                try {
                    java.net.URI uri = java.net.URI.create(url);
                    if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null) {
                        return null;
                    }
                } catch (Exception e) {
                    return null;
                }
                return new SourceDef("catalog", null, null, null, url);
            }
            if ("org".equals(kind)) {
                String org = node.path("org").asText("").trim();
                if (org.isEmpty() || !OWNER.matcher(org).matches()) {
                    return null;
                }
                String topic = node.path("topic").asText("oie-plugin").trim().toLowerCase();
                if (topic.isEmpty() || !TOPIC.matcher(topic).matches()) {
                    topic = "oie-plugin";
                }
                return new SourceDef("org", null, org, topic);
            }
            String repo = node.path("repo").asText("").trim();
            String[] parts = repo.split("/", -1);
            if (parts.length != 2 || !OWNER.matcher(parts[0]).matches() || !NAME.matcher(parts[1]).matches()
                    || isDotSegment(parts[0]) || isDotSegment(parts[1])) {
                return null;
            }
            return new SourceDef("repo", repo, null, null);
        }
    }

    private final List<SourceDef> bundledSources = new ArrayList<>();
    private final Set<String> bundledBlocklist = new HashSet<>();

    private volatile List<SourceDef> customSources = new ArrayList<>();
    private volatile Set<String> localBlocklist = new HashSet<>();
    private volatile boolean betaChannel = false;
    private volatile String encryptedToken = "";
    private volatile int syncTtlMinutes = 15;
    // What THIS store installed (id -> {name,type,version,repo,contentId,installedAt}).
    // The revocation check compares it against what sources currently offer.
    private volatile ObjectNode installLedger = MAPPER.createObjectNode();

    /** Loads the bundled sources.json from the plugin jar. */
    public void loadBundled() {
        try (InputStream in = StoreSettings.class.getResourceAsStream("/sources.json")) {
            if (in == null) {
                return;
            }
            JsonNode root = MAPPER.readTree(new String(in.readAllBytes(), StandardCharsets.UTF_8));
            for (JsonNode node : root.path("sources")) {
                SourceDef def = SourceDef.fromJson(node);
                if (def != null) {
                    bundledSources.add(def);
                }
            }
            for (JsonNode node : root.path("blocklist")) {
                bundledBlocklist.add(node.asText().toLowerCase());
            }
        } catch (Exception e) {
            // A malformed bundled file should not take the plugin down; it just yields an empty catalog.
        }
    }

    /** Applies persisted plugin properties (see ServicePlugin.init/update). */
    public synchronized void apply(Properties properties) {
        try {
            List<SourceDef> custom = new ArrayList<>();
            String sourcesJson = properties.getProperty(PROP_CUSTOM_SOURCES, "[]");
            for (JsonNode node : MAPPER.readTree(sourcesJson)) {
                SourceDef def = SourceDef.fromJson(node);
                if (def != null) {
                    custom.add(def);
                }
            }
            this.customSources = custom;
        } catch (Exception e) {
            this.customSources = new ArrayList<>();
        }
        try {
            Set<String> block = new HashSet<>();
            String blockJson = properties.getProperty(PROP_LOCAL_BLOCKLIST, "[]");
            for (JsonNode node : MAPPER.readTree(blockJson)) {
                block.add(node.asText().toLowerCase());
            }
            this.localBlocklist = block;
        } catch (Exception e) {
            this.localBlocklist = new HashSet<>();
        }
        try {
            JsonNode ledger = MAPPER.readTree(properties.getProperty(PROP_INSTALL_LEDGER, "{}"));
            this.installLedger = ledger instanceof ObjectNode ? (ObjectNode) ledger : MAPPER.createObjectNode();
        } catch (Exception e) {
            this.installLedger = MAPPER.createObjectNode();
        }
        this.betaChannel = Boolean.parseBoolean(properties.getProperty(PROP_BETA_CHANNEL, "false"));
        this.encryptedToken = properties.getProperty(PROP_GITHUB_TOKEN_ENC, "");
        try {
            this.syncTtlMinutes = Math.max(1, Integer.parseInt(properties.getProperty(PROP_SYNC_TTL_MINUTES, "15")));
        } catch (NumberFormatException e) {
            this.syncTtlMinutes = 15;
        }
    }

    /** Serializes the mutable settings back to plugin properties for persistence. */
    public synchronized Properties toProperties() {
        Properties properties = new Properties();
        ArrayNode sources = MAPPER.createArrayNode();
        for (SourceDef def : customSources) {
            sources.add(def.toJson());
        }
        properties.setProperty(PROP_CUSTOM_SOURCES, sources.toString());
        ArrayNode block = MAPPER.createArrayNode();
        for (String entry : localBlocklist) {
            block.add(entry);
        }
        properties.setProperty(PROP_LOCAL_BLOCKLIST, block.toString());
        properties.setProperty(PROP_INSTALL_LEDGER, installLedger.toString());
        properties.setProperty(PROP_BETA_CHANNEL, Boolean.toString(betaChannel));
        properties.setProperty(PROP_GITHUB_TOKEN_ENC, encryptedToken == null ? "" : encryptedToken);
        properties.setProperty(PROP_SYNC_TTL_MINUTES, Integer.toString(syncTtlMinutes));
        return properties;
    }

    /** All effective sources: bundled first, then administrator additions (deduplicated by description). */
    public List<SourceDef> getEffectiveSources() {
        List<SourceDef> all = new ArrayList<>(bundledSources);
        Set<String> seen = new HashSet<>();
        for (SourceDef def : all) {
            seen.add(def.describe());
        }
        for (SourceDef def : customSources) {
            if (seen.add(def.describe())) {
                all.add(def);
            }
        }
        return all;
    }

    public boolean isBlocked(String fullRepoName) {
        String key = fullRepoName.toLowerCase();
        return bundledBlocklist.contains(key) || localBlocklist.contains(key);
    }

    public List<SourceDef> getBundledSources() {
        return bundledSources;
    }

    public Set<String> getBundledBlocklist() {
        return bundledBlocklist;
    }

    public List<SourceDef> getCustomSources() {
        return customSources;
    }

    public void setCustomSources(List<SourceDef> customSources) {
        this.customSources = customSources;
    }

    public Set<String> getLocalBlocklist() {
        return localBlocklist;
    }

    public void setLocalBlocklist(Set<String> localBlocklist) {
        this.localBlocklist = localBlocklist;
    }

    public boolean isBetaChannel() {
        return betaChannel;
    }

    public void setBetaChannel(boolean betaChannel) {
        this.betaChannel = betaChannel;
    }

    public String getEncryptedToken() {
        return encryptedToken;
    }

    public void setEncryptedToken(String encryptedToken) {
        this.encryptedToken = encryptedToken;
    }

    public int getSyncTtlMinutes() {
        return syncTtlMinutes;
    }

    /** The install ledger (live object — callers mutate then persist via the controller). */
    public ObjectNode getInstallLedger() {
        return installLedger;
    }

    public synchronized void recordInstall(String id, ObjectNode record) {
        installLedger.set(id, record);
    }

    public synchronized void removeInstall(String id) {
        installLedger.remove(id);
    }
}
