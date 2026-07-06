/*
 * OIE Community Store
 *
 * Published under the terms of the Mozilla Public License 2.0.
 */

package org.openintegrationengine.plugins.communitystore;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mirth.connect.model.MetaData;
import com.mirth.connect.server.controllers.ConfigurationController;
import com.mirth.connect.server.controllers.ControllerFactory;
import com.mirth.connect.server.controllers.ExtensionController;

/**
 * Builds and caches the store catalog. Sources expand to repositories (org sources enumerate by
 * topic), each repository resolves to its newest engine-compatible release by walking releases
 * newest to oldest and reading the per-tag oie.json manifest, and the result merges against the
 * engine's installed extension inventory to compute installed/update state.
 *
 * The catalog is held as JSON (Jackson ObjectNodes) end to end: the servlet returns it verbatim,
 * which keeps third-party model classes out of the engine's XStream serialization pipeline.
 */
public class CatalogService {

    private static final Logger logger = LogManager.getLogger(CatalogService.class);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final int RELEASES_PER_REPO = 15;
    private static final int MAX_REPOS_PER_ORG = 300;

    private final GitHubClient gitHub;
    private final StoreSettings settings;

    private volatile ObjectNode cachedCatalog;
    private volatile long cachedAtMillis;
    private final Object syncLock = new Object();

    public CatalogService(GitHubClient gitHub, StoreSettings settings) {
        this.gitHub = gitHub;
        this.settings = settings;
    }

    /** Returns the catalog, rebuilding it when forced or when the cache TTL has lapsed. */
    public ObjectNode getCatalog(boolean forceRefresh) {
        ObjectNode cached = cachedCatalog;
        long ttlMillis = settings.getSyncTtlMinutes() * 60_000L;
        if (!forceRefresh && cached != null && (System.currentTimeMillis() - cachedAtMillis) < ttlMillis) {
            return mergeInstalledState(cached);
        }
        synchronized (syncLock) {
            cached = cachedCatalog;
            if (!forceRefresh && cached != null && (System.currentTimeMillis() - cachedAtMillis) < ttlMillis) {
                return mergeInstalledState(cached);
            }
            ObjectNode fresh = buildCatalog();
            cachedCatalog = fresh;
            cachedAtMillis = System.currentTimeMillis();
            return mergeInstalledState(fresh);
        }
    }

    /** Resolves a single catalog entry by id, from cache if warm. */
    public ObjectNode findEntry(String id) {
        ObjectNode catalog = getCatalog(false);
        for (JsonNode entry : catalog.withArray("entries")) {
            if (id.equals(entry.path("id").asText())) {
                return (ObjectNode) entry;
            }
        }
        return null;
    }

    /** Publisher docs are immutable per repo+tag, so cache entries never expire. */
    private final Map<String, ObjectNode> docsCache = new ConcurrentHashMap<>();

    /** Maximum documentation size returned to the browser (characters). */
    private static final int MAX_DOCS_CHARS = 512_000;

    /**
     * Fetches publisher documentation for a catalog entry, read at its release tag so docs are
     * versioned with the artifact. Resolution order: the manifest's optional storeDocs path,
     * then store.md, docs/store.md, and README.md. Returns {found:false} when none exist.
     */
    public ObjectNode getDocs(String id) throws Exception {
        ObjectNode entry = findEntry(id);
        if (entry == null) {
            throw new IOException("No catalog entry found for id '" + id + "'.");
        }
        String repo = entry.path("repo").asText();
        String tag = entry.path("tag").asText();
        String cacheKey = repo + "@" + tag;

        ObjectNode cached = docsCache.get(cacheKey);
        if (cached != null) {
            return cached;
        }

        List<String> candidates = new ArrayList<>();
        String declared = entry.path("storeDocs").asText("");
        if (!declared.isBlank() && !declared.contains("..") && !declared.startsWith("/")) {
            candidates.add(declared.trim());
        }
        candidates.add("store.md");
        candidates.add("docs/store.md");
        candidates.add("README.md");

        ObjectNode result = MAPPER.createObjectNode();
        result.put("found", false);
        result.put("repo", repo);
        result.put("tag", tag);
        for (String path : candidates) {
            String markdown = gitHub.getRawText(GitHubClient.RAW_BASE + "/" + repo + "/" + tag + "/" + path);
            if (markdown != null) {
                boolean truncated = markdown.length() > MAX_DOCS_CHARS;
                String body = truncated ? markdown.substring(0, MAX_DOCS_CHARS) : markdown;
                result.put("found", true);
                result.put("path", path);
                result.put("truncated", truncated);
                result.put("markdown", body);
                // Fetch relative raster images server side and inline them as data: URLs.
                // The browser can't load raw.githubusercontent.com images (the admin's CSP
                // allows img-src 'self' data: only, and the browser has no GitHub credentials),
                // so the engine resolves them — honoring the PAT for private-repo docs.
                inlineDocImages(body, repo, tag, result.putObject("images"));
                break;
            }
        }
        docsCache.put(cacheKey, result);
        return result;
    }

    /** Markdown image syntax: capture the URL in ![alt](url ...). */
    private static final Pattern MD_IMAGE = Pattern.compile("!\\[[^\\]]*\\]\\(\\s*([^)\\s]+)");
    private static final int MAX_DOC_IMAGES = 25;                    // per docs page
    private static final long MAX_DOC_IMAGE_BYTES = 5L * 1024 * 1024;   // per image
    private static final long MAX_DOC_IMAGE_TOTAL = 12L * 1024 * 1024;  // all images combined

    /**
     * Resolve the relative raster images referenced by a docs page and inline each as a
     * data: URL under its repo-relative path, keyed exactly as written in the markdown (a
     * leading "./" stripped). External URLs, data:/fragment refs, path-traversal, and SVG are
     * skipped — the client leaves those to its own protocol-allowlisting resolver.
     */
    private void inlineDocImages(String markdown, String repo, String tag, ObjectNode images) {
        String rawBase = GitHubClient.RAW_BASE + "/" + repo + "/" + tag + "/";
        Set<String> seen = new HashSet<>();
        long total = 0;
        Matcher matcher = MD_IMAGE.matcher(markdown);
        while (matcher.find() && seen.size() < MAX_DOC_IMAGES) {
            String ref = matcher.group(1).trim();
            if (ref.isEmpty() || ref.contains("..") || ref.startsWith("/") || ref.startsWith("#")
                    || ref.startsWith("//") || ref.matches("(?i)^[a-z][a-z0-9+.-]*:.*")) {
                continue; // relative repo paths only
            }
            String key = ref.replaceFirst("^\\./", "");
            String mime = imageMime(key);
            if (mime == null || !seen.add(key)) {
                continue;
            }
            try {
                byte[] bytes = gitHub.getRawBytes(rawBase + key, MAX_DOC_IMAGE_BYTES);
                if (bytes == null || bytes.length == 0 || total + bytes.length > MAX_DOC_IMAGE_TOTAL) {
                    continue;
                }
                total += bytes.length;
                images.put(key, "data:" + mime + ";base64," + Base64.getEncoder().encodeToString(bytes));
            } catch (Exception e) {
                logger.warn("Community Store: could not inline doc image " + key + " for " + repo + "@" + tag + ": " + e.getMessage());
            }
        }
    }

    /** Content type for the raster image extensions we inline; null for anything else (incl. SVG). */
    private static String imageMime(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".gif")) return "image/gif";
        if (p.endsWith(".webp")) return "image/webp";
        return null;
    }

    private ObjectNode buildCatalog() {
        ObjectNode catalog = MAPPER.createObjectNode();
        ArrayNode entries = catalog.putArray("entries");
        ArrayNode errors = catalog.putArray("errors");

        // Expand sources into a deduplicated ordered repo set.
        Map<String, String> repos = new LinkedHashMap<>(); // full name -> originating source description
        for (StoreSettings.SourceDef source : settings.getEffectiveSources()) {
            try {
                if ("repo".equals(source.kind)) {
                    repos.putIfAbsent(source.repo, source.describe());
                } else {
                    for (String fullName : enumerateOrgRepos(source.org, source.topic)) {
                        repos.putIfAbsent(fullName, source.describe());
                    }
                }
            } catch (Exception e) {
                logger.warn("Community Store: failed to expand source " + source.describe(), e);
                errors.add(sourceError(source.describe(), e.getMessage()));
            }
        }

        String engineVersion = ConfigurationController.getInstance().getServerVersion();
        SemVer engine = SemVer.parse(engineVersion);

        for (Map.Entry<String, String> repo : repos.entrySet()) {
            String fullName = repo.getKey();
            if (settings.isBlocked(fullName)) {
                continue;
            }
            try {
                ObjectNode entry = resolveRepo(fullName, engine);
                if (entry != null) {
                    entry.put("source", repo.getValue());
                    entries.add(entry);
                }
            } catch (Exception e) {
                logger.warn("Community Store: failed to resolve " + fullName, e);
                errors.add(sourceError(fullName, e.getMessage()));
            }
        }

        catalog.put("generatedAt", System.currentTimeMillis());
        catalog.put("engineVersion", engineVersion);
        catalog.put("rateLimitRemaining", gitHub.getRateLimitRemaining());
        return catalog;
    }

    private List<String> enumerateOrgRepos(String org, String topic) throws Exception {
        List<String> result = new ArrayList<>();
        String topicLower = topic == null ? "oie-plugin" : topic.toLowerCase();
        for (int page = 1; result.size() < MAX_REPOS_PER_ORG; page++) {
            JsonNode repos = gitHub.getApiJson(GitHubClient.API_BASE + "/orgs/" + org + "/repos?per_page=100&page=" + page);
            if (!repos.isArray() || repos.isEmpty()) {
                break;
            }
            for (JsonNode repo : repos) {
                if (repo.path("archived").asBoolean(false)) {
                    continue;
                }
                for (JsonNode t : repo.path("topics")) {
                    if (topicLower.equals(t.asText().toLowerCase())) {
                        result.add(repo.path("full_name").asText());
                        break;
                    }
                }
            }
            if (repos.size() < 100) {
                break;
            }
        }
        return result;
    }

    /**
     * Walks a repository's releases newest to oldest and returns the newest release whose
     * manifest declares compatibility with the running engine ("newest compatible" resolution).
     * Returns null when the repository has no usable release at all.
     */
    private ObjectNode resolveRepo(String fullName, SemVer engine) throws Exception {
        JsonNode releases = gitHub.getApiJson(GitHubClient.API_BASE + "/repos/" + fullName + "/releases?per_page=" + RELEASES_PER_REPO);
        if (!releases.isArray() || releases.isEmpty()) {
            return null;
        }

        String latestTag = null;
        boolean includeBetas = settings.isBetaChannel();

        for (JsonNode release : releases) {
            if (release.path("draft").asBoolean(false)) {
                continue;
            }
            if (release.path("prerelease").asBoolean(false) && !includeBetas) {
                continue;
            }
            String tag = release.path("tag_name").asText(null);
            if (tag == null) {
                continue;
            }
            if (latestTag == null) {
                latestTag = tag;
            }

            JsonNode manifest = fetchManifest(fullName, tag);
            if (manifest == null) {
                continue;
            }

            SemVer min = SemVer.parse(manifest.path("minEngineVersion").asText(null));
            SemVer max = SemVer.parse(manifest.path("maxEngineVersion").asText(null));
            boolean compatible = SemVer.inRange(engine, min, max);
            if (!compatible) {
                continue; // keep walking for an older compatible release
            }

            ObjectNode entry = entryFromManifest(fullName, tag, release, manifest);
            entry.put("compatible", true);
            entry.put("latestTag", latestTag);
            entry.put("offeredIsLatest", tag.equals(latestTag));
            return entry;
        }

        // Nothing compatible: surface the newest release as an incompatible listing so users see why.
        for (JsonNode release : releases) {
            if (release.path("draft").asBoolean(false) || release.path("prerelease").asBoolean(false)) {
                continue;
            }
            String tag = release.path("tag_name").asText(null);
            if (tag == null) {
                continue;
            }
            JsonNode manifest = fetchManifest(fullName, tag);
            if (manifest == null) {
                return null;
            }
            ObjectNode entry = entryFromManifest(fullName, tag, release, manifest);
            entry.put("compatible", false);
            entry.put("latestTag", tag);
            entry.put("offeredIsLatest", true);
            return entry;
        }
        return null;
    }

    private JsonNode fetchManifest(String fullName, String tag) throws Exception {
        String raw = gitHub.getRawText(GitHubClient.RAW_BASE + "/" + fullName + "/" + tag + "/oie.json");
        if (raw == null) {
            return null;
        }
        try {
            return MAPPER.readTree(raw);
        } catch (Exception e) {
            logger.warn("Community Store: invalid oie.json in " + fullName + " at " + tag);
            return null;
        }
    }

    private ObjectNode entryFromManifest(String fullName, String tag, JsonNode release, JsonNode manifest) {
        ObjectNode entry = MAPPER.createObjectNode();
        entry.put("id", manifest.path("id").asText(fullName.substring(fullName.indexOf('/') + 1)));
        entry.put("name", manifest.path("name").asText(entry.path("id").asText()));
        entry.put("description", manifest.path("description").asText(""));
        entry.put("type", manifest.path("type").asText("plugin"));
        entry.put("repo", fullName);
        entry.put("tag", tag);
        entry.put("version", manifest.path("version").asText(tag.replaceFirst("^[vV]", "")));
        entry.put("minEngineVersion", manifest.path("minEngineVersion").asText(""));
        entry.put("maxEngineVersion", manifest.path("maxEngineVersion").asText(""));
        entry.put("filename", manifest.path("filename").asText(""));
        entry.put("homepage", manifest.path("homepage").asText("https://github.com/" + fullName));
        entry.put("documentation", manifest.path("documentation").asText(""));
        entry.put("storeDocs", manifest.path("storeDocs").asText(""));
        entry.put("license", manifest.path("license").asText(""));
        entry.put("deprecated", manifest.path("deprecated").asBoolean(false));
        entry.put("deprecationMessage", manifest.path("deprecationMessage").asText(""));
        entry.put("publishedAt", release.path("published_at").asText(""));
        entry.put("releaseUrl", release.path("html_url").asText(""));

        boolean binaryType = isBinaryType(entry.path("type").asText());
        entry.put("restartRequired", manifest.has("restartRequired") ? manifest.path("restartRequired").asBoolean(binaryType) : binaryType);
        entry.put("installable", binaryType);

        ArrayNode authors = entry.putArray("authors");
        for (JsonNode author : manifest.path("authors")) {
            authors.add(author.asText());
        }
        ArrayNode keywords = entry.putArray("keywords");
        for (JsonNode keyword : manifest.path("keywords")) {
            keywords.add(keyword.asText());
        }

        // Asset resolution: explicit filename (with {version} substitution) or the single zip asset.
        String filenamePattern = manifest.path("filename").asText("");
        String expectedName = filenamePattern.isEmpty() ? null : filenamePattern.replace("{version}", entry.path("version").asText());
        String assetUrl = null;
        String assetName = null;
        String checksumUrl = null;
        int zipCount = 0;
        for (JsonNode asset : release.path("assets")) {
            String name = asset.path("name").asText("");
            if (name.endsWith(".zip")) {
                zipCount++;
                if (expectedName == null || expectedName.equals(name)) {
                    assetUrl = asset.path("browser_download_url").asText(null);
                    assetName = name;
                }
            }
        }
        if (expectedName == null && zipCount != 1) {
            assetUrl = null; // ambiguous: multiple zips with no filename declared
        }
        if (assetName != null) {
            for (JsonNode asset : release.path("assets")) {
                String name = asset.path("name").asText("");
                if (name.equals(assetName + ".sha256")) {
                    checksumUrl = asset.path("browser_download_url").asText(null);
                }
            }
        }
        entry.put("assetName", assetName == null ? "" : assetName);
        entry.put("assetUrl", assetUrl == null ? "" : assetUrl);
        entry.put("checksumUrl", checksumUrl == null ? "" : checksumUrl);
        return entry;
    }

    public static boolean isBinaryType(String type) {
        return "plugin".equals(type) || "connector".equals(type) || "datatype".equals(type);
    }

    /** Deep-copies the cached catalog and stamps current installed/update state onto each entry. */
    private ObjectNode mergeInstalledState(ObjectNode catalog) {
        ObjectNode result = catalog.deepCopy();
        Map<String, String> installed = installedVersionsByPath();
        for (JsonNode node : result.withArray("entries")) {
            ObjectNode entry = (ObjectNode) node;
            String installedVersion = installed.get(entry.path("id").asText());
            entry.put("installedVersion", installedVersion == null ? "" : installedVersion);
            boolean updateAvailable = false;
            if (installedVersion != null) {
                SemVer current = SemVer.parse(installedVersion);
                SemVer offered = SemVer.parse(entry.path("version").asText());
                updateAvailable = current != null && offered != null && offered.compareTo(current) > 0 && entry.path("compatible").asBoolean(false);
            }
            entry.put("updateAvailable", updateAvailable);
        }
        return result;
    }

    /** Installed extension inventory keyed by extension path (the manifest id contract). */
    private Map<String, String> installedVersionsByPath() {
        Map<String, String> installed = new LinkedHashMap<>();
        ExtensionController extensionController = ControllerFactory.getFactory().createExtensionController();
        for (MetaData metaData : extensionController.getPluginMetaData().values()) {
            if (metaData.getPath() != null) {
                installed.put(metaData.getPath(), metaData.getPluginVersion());
            }
        }
        for (MetaData metaData : extensionController.getConnectorMetaData().values()) {
            if (metaData.getPath() != null) {
                installed.put(metaData.getPath(), metaData.getPluginVersion());
            }
        }
        return installed;
    }

    private ObjectNode sourceError(String source, String message) {
        ObjectNode error = MAPPER.createObjectNode();
        error.put("source", source);
        error.put("message", message == null ? "unknown error" : message);
        return error;
    }
}
