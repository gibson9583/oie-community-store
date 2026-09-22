package org.openintegrationengine.plugins.communitystore;

import java.net.URI;
import java.util.HashSet;
import java.util.Set;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** Optional statistics; failures must never affect catalog or installation availability. */
final class DownloadCounts {
    private static final ObjectMapper JSON = new ObjectMapper();
    private final GitHubClient github;
    private final Map<String, ObjectNode> cache = new LinkedHashMap<>();
    DownloadCounts(GitHubClient github) { this.github = github; }

    synchronized ObjectNode get(JsonNode entry) {
        ObjectNode unavailable = JSON.createObjectNode().put("status", "unavailable");
        if (entry == null || entry.path("revoked").asBoolean()) return unavailable;
        String url = entry.path("assetUrl").asText("");
        String version = entry.path("version").asText("");
        String name = entry.path("assetName").asText("");
        String repo;
        try {
            URI uri = URI.create(url);
            String[] parts = uri.getPath().split("/");
            if (!"https".equals(uri.getScheme()) || !"github.com".equalsIgnoreCase(uri.getHost())
                    || parts.length != 7 || !parts[3].equals("releases") || !parts[4].equals("download")
                    || !parts[1].matches("[A-Za-z0-9_.-]+") || !parts[2].matches("[A-Za-z0-9_.-]+")
                    || !parts[6].equals(name) || !name.endsWith(".zip") || version.isEmpty()) return unavailable;
            repo = parts[1] + "/" + parts[2];
        } catch (Exception e) { return unavailable; }
        int at = name.indexOf(version);
        if (at < 0 || name.indexOf(version, at + version.length()) >= 0) return unavailable;
        String prefix = name.substring(0, at), suffix = name.substring(at + version.length());
        if (prefix.isEmpty()) return unavailable; // Cannot attribute generic version-only archives to a package.
        Pattern family = Pattern.compile(Pattern.quote(prefix) + "[0-9]+(?:\\.[0-9]+)+(?:[-+][A-Za-z0-9.-]+)?" + Pattern.quote(suffix));
        String key = repo + ":" + family.pattern();
        long now = System.currentTimeMillis();
        ObjectNode previous = cache.get(key);
        if (previous != null && now - previous.path("checkedAt").asLong() < (previous.has("count") ? 3600000 : 300000)) return previous.deepCopy();
        ObjectNode result = unavailable;
        try {
            long total = 0; int matched = 0; boolean complete = false;
            int requests = 0; long deadline = now + 60000;
            Set<Long> releasesSeen = new HashSet<>(), assetsSeen = new HashSet<>();
            for (int page = 1; page <= 100; page++) {
                if (++requests > 200 || System.currentTimeMillis() > deadline) throw new IllegalStateException("Statistics budget exceeded");
                JsonNode releases = github.getApiJson(GitHubClient.API_BASE + "/repos/" + repo + "/releases?per_page=100&page=" + page);
                if (!releases.isArray()) throw new IllegalStateException("Invalid releases");
                for (JsonNode release : releases) {
                    if (release.path("draft").asBoolean()) continue;
                    long id = release.path("id").asLong(-1);
                    if (id < 0) throw new IllegalStateException("Missing release id");
                    if (!releasesSeen.add(id)) continue;
                    String tagVersion = release.path("tag_name").asText("").replaceFirst("^[vV]", "");
                    String expectedName = prefix + tagVersion + suffix;
                    boolean assetsComplete = false;
                    for (int assetPage = 1; assetPage <= 100; assetPage++) {
                        if (++requests > 200 || System.currentTimeMillis() > deadline) throw new IllegalStateException("Statistics budget exceeded");
                        JsonNode assets = github.getApiJson(GitHubClient.API_BASE + "/repos/" + repo + "/releases/" + id + "/assets?per_page=100&page=" + assetPage);
                        if (!assets.isArray()) throw new IllegalStateException("Invalid assets");
                        for (JsonNode asset : assets) {
                            if (!family.matcher(asset.path("name").asText()).matches()) continue;
                            if (!expectedName.equals(asset.path("name").asText())) {
                                // Could be a renamed/versioned variant: do not count unrelated ZIPs.
                                continue;
                            }
                            long assetId = asset.path("id").asLong(-1);
                            JsonNode count = asset.path("download_count");
                            if (assetId < 0 || !count.isIntegralNumber() || !count.canConvertToLong() || count.asLong() < 0) throw new IllegalStateException("Invalid count");
                            if (assetsSeen.add(assetId)) { total = Math.addExact(total, count.asLong()); matched++; }
                        }
                        if (assets.size() < 100) { assetsComplete = true; break; }
                    }
                    if (!assetsComplete) throw new IllegalStateException("Incomplete assets");
                }
                if (releases.size() < 100) { complete = true; break; }
            }
            if (complete && matched > 0) result = JSON.createObjectNode().put("status", "available").put("count", total).put("assets", matched);
        } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        catch (Exception e) { /* Optional metric: never publish a partial sum as an all-version count. */ }
        result.put("checkedAt", now);
        if (cache.size() >= 500) cache.remove(cache.keySet().iterator().next());
        cache.put(key, result.deepCopy());
        return result;
    }
}
