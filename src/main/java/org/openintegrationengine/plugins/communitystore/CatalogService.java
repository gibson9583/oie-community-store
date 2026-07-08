/*
 * OIE Community Store
 *
 * Published under the terms of the Mozilla Public License 2.0.
 */

package org.openintegrationengine.plugins.communitystore;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
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
import com.mirth.connect.model.codetemplates.CodeTemplate;
import com.mirth.connect.model.codetemplates.CodeTemplateLibrary;
import com.mirth.connect.server.controllers.ChannelController;
import com.mirth.connect.server.controllers.CodeTemplateController;
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
    /** Remote blocklist from the last successful build — used to label revocations. */
    private volatile Set<String> lastRemoteBlock = new HashSet<>();

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
            // Docs at branch-based docsUrls are mutable — drop cached pages whenever the
            // catalog rebuilds so a publisher's doc fix shows up on the next sync.
            docsCache.clear();
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
     * Fetches publisher documentation for a catalog entry. Catalog-index entries carry an
     * absolute docsUrl (any host); crawled entries resolve repo-relative candidates at the
     * release tag: the manifest's optional storeDocs path, then store.md, docs/store.md, and
     * README.md. Returns {found:false} when none exist. The result carries linkBase/imageBase
     * so the client resolves relative links against the right location.
     */
    public ObjectNode getDocs(String id) throws Exception {
        ObjectNode entry = findEntry(id);
        if (entry == null) {
            throw new IOException("No catalog entry found for id '" + id + "'.");
        }
        String repo = entry.path("repo").asText();
        String tag = entry.path("tag").asText();
        String docsUrl = entry.path("docsUrl").asText("");
        String cacheKey = docsUrl.isEmpty() ? repo + "@" + tag : docsUrl;

        ObjectNode cached = docsCache.get(cacheKey);
        if (cached != null) {
            return cached;
        }

        ObjectNode result = MAPPER.createObjectNode();
        result.put("found", false);
        result.put("repo", repo);
        result.put("tag", tag);

        if (!docsUrl.isEmpty()) {
            // Catalog entry: one absolute markdown URL; relative links/images resolve
            // against its directory, wherever it is hosted.
            String base = docsUrl.substring(0, docsUrl.lastIndexOf('/') + 1);
            String markdown = gitHub.getRawText(docsUrl);
            if (markdown != null) {
                fillDocsResult(result, markdown, docsUrl.substring(docsUrl.lastIndexOf('/') + 1), base, base, base, null);
            }
            docsCache.put(cacheKey, result);
            return result;
        }

        List<String> candidates = new ArrayList<>();
        String declared = entry.path("storeDocs").asText("");
        if (!declared.isBlank() && !declared.contains("..") && !declared.startsWith("/")) {
            candidates.add(declared.trim());
        }
        candidates.add("store.md");
        candidates.add("docs/store.md");
        candidates.add("README.md");

        String rawBase = GitHubClient.RAW_BASE + "/" + repo + "/" + tag + "/";
        String blobBase = "https://github.com/" + repo + "/blob/" + tag + "/";
        for (String path : candidates) {
            // Candidate paths are manifest-authored plain paths; encode each segment so
            // folders with spaces (e.g. "Code Templates/…") form a valid URL.
            String markdown = gitHub.getRawText(rawBase + encodePath(path));
            if (markdown != null) {
                // Relative links/images resolve against the DOC'S OWN FOLDER — the same
                // semantics GitHub uses when rendering the file — with a repo-root
                // fallback for images in docs authored to the old root-relative rule.
                String dir = path.contains("/") ? path.substring(0, path.lastIndexOf('/') + 1) : "";
                String docRaw = rawBase + encodePath(dir);
                fillDocsResult(result, markdown, path, docRaw, blobBase + encodePath(dir), docRaw, rawBase);
                break;
            }
        }
        docsCache.put(cacheKey, result);
        return result;
    }

    /**
     * Populates a docs result: truncation, the markdown body, resolution bases for the client,
     * and server-side inlined raster images. The browser can't load images from artifact hosts
     * (the admin's CSP allows img-src 'self' data: only, and the browser holds no credentials),
     * so the engine fetches and inlines them as data: URLs.
     */
    private void fillDocsResult(ObjectNode result, String markdown, String path, String fetchBase, String linkBase, String imageBase, String fallbackBase) {
        boolean truncated = markdown.length() > MAX_DOCS_CHARS;
        String body = truncated ? markdown.substring(0, MAX_DOCS_CHARS) : markdown;
        result.put("found", true);
        result.put("path", path);
        result.put("truncated", truncated);
        result.put("markdown", body);
        result.put("linkBase", linkBase);
        result.put("imageBase", imageBase);
        inlineDocImages(body, fetchBase, fallbackBase, result.putObject("images"));
    }

    /** Markdown image syntax: capture the URL in ![alt](url ...). */
    private static final Pattern MD_IMAGE = Pattern.compile("!\\[[^\\]]*\\]\\(\\s*([^)\\s]+)");
    private static final int MAX_DOC_IMAGES = 25;                    // per docs page
    private static final long MAX_DOC_IMAGE_BYTES = 5L * 1024 * 1024;   // per image
    private static final long MAX_DOC_IMAGE_TOTAL = 12L * 1024 * 1024;  // all images combined

    /**
     * Resolve the relative raster images referenced by a docs page and inline each as a
     * data: URL under its relative path, keyed exactly as written in the markdown (a
     * leading "./" stripped). External URLs, data:/fragment refs, path-traversal, and SVG are
     * skipped — the client leaves those to its own protocol-allowlisting resolver.
     */
    private void inlineDocImages(String markdown, String rawBase, String fallbackBase, ObjectNode images) {
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
                // Keys come verbatim from the markdown; encode only spaces so already
                // percent-encoded references aren't double-encoded.
                byte[] bytes = gitHub.getRawBytes(rawBase + key.replace(" ", "%20"), MAX_DOC_IMAGE_BYTES);
                if (bytes == null && fallbackBase != null) {
                    bytes = gitHub.getRawBytes(fallbackBase + key.replace(" ", "%20"), MAX_DOC_IMAGE_BYTES);
                }
                if (bytes == null || bytes.length == 0 || total + bytes.length > MAX_DOC_IMAGE_TOTAL) {
                    continue;
                }
                total += bytes.length;
                images.put(key, "data:" + mime + ";base64," + Base64.getEncoder().encodeToString(bytes));
            } catch (Exception e) {
                logger.warn("Community Store: could not inline doc image " + key + " from " + rawBase + ": " + e.getMessage());
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

        String engineVersion = ConfigurationController.getInstance().getServerVersion();
        SemVer engine = SemVer.parse(engineVersion);

        // Expand sources. Catalog indexes are resolved first (they also carry a remote
        // blocklist, which then applies to crawled sources too — takedowns propagate in
        // one sync instead of one store release); repo/org sources collect into an
        // ordered, deduplicated repo set.
        List<ObjectNode> indexEntries = new ArrayList<>();
        Set<String> remoteBlock = new HashSet<>();
        Map<String, String> repos = new LinkedHashMap<>(); // full name -> originating source description
        for (StoreSettings.SourceDef source : settings.getEffectiveSources()) {
            try {
                if ("catalog".equals(source.kind)) {
                    entriesFromIndex(source.url, source.describe(), engine, indexEntries, remoteBlock);
                } else if ("repo".equals(source.kind)) {
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

        lastRemoteBlock = remoteBlock;

        // First source wins per package id: bundled sources precede custom ones and the
        // official catalog precedes crawled repos, so a repo cannot squat an id that a
        // higher-priority source already defines.
        Set<String> seenIds = new HashSet<>();
        for (ObjectNode entry : indexEntries) {
            String repoName = entry.path("repo").asText("");
            if (settings.isBlocked(repoName) || remoteBlock.contains(repoName.toLowerCase())) {
                continue;
            }
            if (!seenIds.add(entry.path("id").asText())) {
                logger.info("Community Store: duplicate id '" + entry.path("id").asText() + "' from " + entry.path("source").asText() + " ignored (already defined by an earlier source).");
                continue;
            }
            entries.add(entry);
        }

        for (Map.Entry<String, String> repo : repos.entrySet()) {
            String fullName = repo.getKey();
            if (settings.isBlocked(fullName) || remoteBlock.contains(fullName.toLowerCase())) {
                continue;
            }
            try {
                for (ObjectNode entry : resolveRepo(fullName, engine)) {
                    if (!seenIds.add(entry.path("id").asText())) {
                        logger.info("Community Store: duplicate id '" + entry.path("id").asText() + "' from " + fullName + " ignored (already defined by an earlier source).");
                        continue;
                    }
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

    /** Index schema versions this store understands (see the catalog repo's build-index script). */
    private static final int MAX_INDEX_SCHEMA = 1;

    /**
     * Resolves a prebuilt catalog index (index.json at any https URL) into catalog entries —
     * one conditional GET replaces the whole per-repo release crawl. Each package offers its
     * newest engine-compatible version; the index's blocklist merges into this sync's
     * effective blocklist.
     */
    private void entriesFromIndex(String url, String sourceDescription, SemVer engine, List<ObjectNode> out, Set<String> remoteBlock) throws Exception {
        JsonNode index = gitHub.getIndexJson(url);
        int schema = index.path("schemaVersion").asInt(1);
        if (schema > MAX_INDEX_SCHEMA) {
            throw new IOException("Catalog index declares schemaVersion " + schema + ", but this store supports up to " + MAX_INDEX_SCHEMA + ". Update the Community Store.");
        }
        for (JsonNode blocked : index.path("blocklist")) {
            String value = blocked.asText("").trim().toLowerCase();
            if (value.matches("[\\w.-]+/[\\w.-]+")) {
                remoteBlock.add(value);
            }
        }
        for (JsonNode pkg : index.path("packages")) {
            try {
                ObjectNode entry = entryFromIndexPackage(pkg, engine);
                if (entry != null) {
                    entry.put("source", sourceDescription);
                    out.add(entry);
                }
            } catch (Exception e) {
                logger.warn("Community Store: skipping catalog package '" + pkg.path("id").asText("?") + "': " + e.getMessage());
            }
        }
    }

    /** One catalog entry from an index package: its newest engine-compatible version. */
    private ObjectNode entryFromIndexPackage(JsonNode pkg, SemVer engine) {
        String id = pkg.path("id").asText("");
        String type = pkg.path("type").asText("");
        JsonNode versions = pkg.path("versions");
        if (id.isEmpty() || type.isEmpty() || !versions.isArray() || versions.isEmpty()) {
            return null;
        }

        // Versions are index-sorted newest first; walk for the newest compatible one,
        // falling back to the newest overall as an incompatible listing.
        JsonNode offered = null;
        boolean compatible = false;
        for (JsonNode v : versions) {
            SemVer min = SemVer.parse(v.path("minEngineVersion").asText(null));
            SemVer max = SemVer.parse(v.path("maxEngineVersion").asText(null));
            if (SemVer.inRange(engine, min, max)) {
                offered = v;
                compatible = true;
                break;
            }
        }
        if (offered == null) {
            offered = versions.get(0);
        }
        String latestVersion = versions.get(0).path("version").asText("");
        String version = offered.path("version").asText("");

        String repository = pkg.path("repository").asText("");
        ObjectNode entry = MAPPER.createObjectNode();
        entry.put("id", id);
        entry.put("name", pkg.path("name").asText(id));
        entry.put("description", pkg.path("description").asText(""));
        entry.put("type", type);
        entry.put("repo", displayRepo(repository));
        entry.put("repoUrl", repository);
        entry.put("tag", version);
        entry.put("version", version);
        entry.put("minEngineVersion", offered.path("minEngineVersion").asText(""));
        entry.put("maxEngineVersion", offered.path("maxEngineVersion").asText(""));
        entry.put("compatible", compatible);
        entry.put("homepage", pkg.path("homepage").asText(repository));
        entry.put("documentation", pkg.path("documentation").asText(""));
        entry.put("docsUrl", offered.path("docsUrl").asText(""));
        entry.put("storeDocs", "");
        entry.put("license", pkg.path("license").asText(""));
        entry.put("deprecated", pkg.path("deprecated").asBoolean(false));
        entry.put("deprecationMessage", pkg.path("deprecationMessage").asText(""));
        entry.put("publishedAt", offered.path("publishedAt").asText(""));
        entry.put("releaseUrl", offered.path("releaseNotesUrl").asText(""));
        entry.put("latestTag", latestVersion);
        entry.put("offeredIsLatest", version.equals(latestVersion));
        entry.put("contentId", pkg.path("contentId").asText(""));

        boolean binaryType = isBinaryType(type);
        boolean contentType = isContentType(type);
        entry.put("restartRequired", offered.has("restartRequired") ? offered.path("restartRequired").asBoolean(binaryType) : binaryType);
        entry.put("installable", binaryType || contentType);

        ArrayNode authors = entry.putArray("authors");
        for (JsonNode a : pkg.path("authors")) {
            authors.add(a.asText());
        }
        ArrayNode keywords = entry.putArray("keywords");
        for (JsonNode k : pkg.path("keywords")) {
            keywords.add(k.asText());
        }

        String installerUrl = offered.path("installerUrl").asText("");
        entry.put("assetName", installerUrl.isEmpty() ? "" : installerUrl.substring(installerUrl.lastIndexOf('/') + 1));
        entry.put("assetUrl", installerUrl);
        entry.put("checksumUrl", "");
        entry.put("sha256", offered.path("sha256").asText(""));
        return entry;
    }

    /** "owner/name" for GitHub repository URLs; host+path for anything else. */
    private static String displayRepo(String repositoryUrl) {
        try {
            java.net.URI uri = java.net.URI.create(repositoryUrl);
            String path = uri.getPath() == null ? "" : uri.getPath().replaceAll("^/|/$", "");
            if ("github.com".equalsIgnoreCase(uri.getHost())) {
                return path;
            }
            return uri.getHost() == null ? repositoryUrl : uri.getHost() + (path.isEmpty() ? "" : "/" + path);
        } catch (Exception e) {
            return repositoryUrl;
        }
    }

    private List<String> enumerateOrgRepos(String org, String topic) throws Exception {
        List<String> result = new ArrayList<>();
        String topicLower = topic == null ? "oie-plugin" : topic.toLowerCase();
        // A listed name may be a GitHub organization OR a personal user account. Orgs list
        // their repos under /orgs/{name}/repos, users under /users/{name}/repos; resolve which
        // by the account type so topic-based discovery works for either. /users/{name} returns
        // the profile for both kinds (type "Organization" or "User").
        String reposBase = GitHubClient.API_BASE + "/orgs/" + org + "/repos";
        try {
            String type = gitHub.getApiJson(GitHubClient.API_BASE + "/users/" + org).path("type").asText("");
            if (!"Organization".equalsIgnoreCase(type)) {
                reposBase = GitHubClient.API_BASE + "/users/" + org + "/repos";
            }
        } catch (Exception ignore) {
            // Couldn't resolve the account type — fall back to the org endpoint.
        }
        for (int page = 1; result.size() < MAX_REPOS_PER_ORG; page++) {
            JsonNode repos = gitHub.getApiJson(reposBase + "?per_page=100&page=" + page);
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
     * Resolves a repository to its catalog entries. A single-manifest repo yields one entry (the
     * newest engine-compatible release); a collection manifest — one with an "items" array — yields
     * one entry per item, resolved from the newest usable release (per-item compatibility). Returns
     * an empty list when the repository has no usable release.
     */
    private List<ObjectNode> resolveRepo(String fullName, SemVer engine) throws Exception {
        JsonNode releases = gitHub.getApiJson(GitHubClient.API_BASE + "/repos/" + fullName + "/releases?per_page=" + RELEASES_PER_REPO);
        if (!releases.isArray() || releases.isEmpty()) {
            // No releases — fall back to the default branch. This lets content collections
            // (channels / code templates, whose artifacts are raw repo files) publish with just
            // a push, no tag. Extensions still need a release because they ship a built .zip.
            return resolveFromDefaultBranch(fullName, engine);
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

            // Collection: one entry per declared item, from this (newest usable) release.
            if (manifest.path("items").isArray()) {
                return entriesFromCollection(fullName, tag, release, manifest, engine, latestTag);
            }

            // Single manifest: newest engine-compatible release.
            SemVer min = SemVer.parse(manifest.path("minEngineVersion").asText(null));
            SemVer max = SemVer.parse(manifest.path("maxEngineVersion").asText(null));
            if (!SemVer.inRange(engine, min, max)) {
                continue; // keep walking for an older compatible release
            }
            ObjectNode entry = entryFromManifest(fullName, tag, release, manifest);
            entry.put("compatible", true);
            entry.put("latestTag", latestTag);
            entry.put("offeredIsLatest", tag.equals(latestTag));
            return Collections.singletonList(entry);
        }

        // Nothing compatible: surface the newest single-manifest release as an incompatible listing.
        for (JsonNode release : releases) {
            if (release.path("draft").asBoolean(false) || release.path("prerelease").asBoolean(false)) {
                continue;
            }
            String tag = release.path("tag_name").asText(null);
            if (tag == null) {
                continue;
            }
            JsonNode manifest = fetchManifest(fullName, tag);
            if (manifest == null || manifest.path("items").isArray()) {
                return Collections.emptyList();
            }
            ObjectNode entry = entryFromManifest(fullName, tag, release, manifest);
            entry.put("compatible", false);
            entry.put("latestTag", tag);
            entry.put("offeredIsLatest", true);
            return Collections.singletonList(entry);
        }
        return Collections.emptyList();
    }

    /**
     * Resolves a repository that has no releases from its default branch. Only collection
     * manifests are honored (their artifacts are raw repo files, so the branch tip is enough);
     * single-manifest extensions still require a release since they ship a built .zip asset.
     * Content resolves from the branch tip, so it tracks the branch rather than a pinned tag.
     */
    private List<ObjectNode> resolveFromDefaultBranch(String fullName, SemVer engine) throws Exception {
        JsonNode repo = gitHub.getApiJson(GitHubClient.API_BASE + "/repos/" + fullName);
        String branch = repo.path("default_branch").asText("");
        if (branch.isEmpty()) {
            return Collections.emptyList();
        }
        JsonNode manifest = fetchManifest(fullName, branch);
        if (manifest == null || !manifest.path("items").isArray()) {
            return Collections.emptyList();
        }
        ObjectNode release = MAPPER.createObjectNode();
        release.put("html_url", "https://github.com/" + fullName + "/tree/" + branch);
        release.put("published_at", "");
        return entriesFromCollection(fullName, branch, release, manifest, engine, branch);
    }

    /** Builds one catalog entry per item declared in a collection manifest. */
    private List<ObjectNode> entriesFromCollection(String fullName, String tag, JsonNode release, JsonNode manifest, SemVer engine, String latestTag) {
        List<ObjectNode> out = new ArrayList<>();
        for (JsonNode item : manifest.path("items")) {
            ObjectNode entry = itemEntry(fullName, tag, release, manifest, item, engine, latestTag);
            if (entry != null) {
                out.add(entry);
            }
        }
        return out;
    }

    /**
     * One catalog entry for a collection item. The artifact is a repo-relative path fetched raw at
     * the tag (content is XML — channels and code templates — so there is no zip or sha256 sidecar).
     */
    private ObjectNode itemEntry(String fullName, String tag, JsonNode release, JsonNode manifest, JsonNode item, SemVer engine, String latestTag) {
        String id = item.path("id").asText("");
        String type = item.path("type").asText("");
        if (id.isEmpty() || type.isEmpty()) {
            return null;
        }
        String fallbackVersion = manifest.path("version").asText(tag.replaceFirst("^[vV]", ""));
        String min = item.path("minEngineVersion").asText(manifest.path("minEngineVersion").asText(""));
        String max = item.path("maxEngineVersion").asText(manifest.path("maxEngineVersion").asText(""));

        ObjectNode entry = MAPPER.createObjectNode();
        entry.put("id", id);
        entry.put("name", item.path("name").asText(id));
        entry.put("description", item.path("description").asText(""));
        entry.put("type", type);
        entry.put("repo", fullName);
        entry.put("repoUrl", "https://github.com/" + fullName);
        entry.put("tag", tag);
        entry.put("version", item.path("version").asText(fallbackVersion));
        entry.put("minEngineVersion", min);
        entry.put("maxEngineVersion", max);
        entry.put("compatible", SemVer.inRange(engine, SemVer.parse(min.isEmpty() ? null : min), SemVer.parse(max.isEmpty() ? null : max)));
        entry.put("homepage", item.path("homepage").asText(manifest.path("homepage").asText("https://github.com/" + fullName)));
        entry.put("documentation", item.path("documentation").asText(manifest.path("documentation").asText("")));
        entry.put("storeDocs", item.path("storeDocs").asText(""));
        entry.put("license", item.path("license").asText(manifest.path("license").asText("")));
        entry.put("deprecated", item.path("deprecated").asBoolean(false));
        entry.put("deprecationMessage", item.path("deprecationMessage").asText(""));
        entry.put("publishedAt", release.path("published_at").asText(""));
        entry.put("releaseUrl", release.path("html_url").asText(""));
        entry.put("latestTag", latestTag);
        entry.put("offeredIsLatest", tag.equals(latestTag));
        entry.put("contentId", item.path("contentId").asText(""));

        boolean binaryType = isBinaryType(type);
        boolean contentType = isContentType(type);
        entry.put("restartRequired", item.has("restartRequired") ? item.path("restartRequired").asBoolean(binaryType) : binaryType);
        entry.put("installable", binaryType || contentType);

        ArrayNode authors = entry.putArray("authors");
        for (JsonNode a : (item.has("authors") ? item.path("authors") : manifest.path("authors"))) {
            authors.add(a.asText());
        }
        ArrayNode keywords = entry.putArray("keywords");
        for (JsonNode k : item.path("keywords")) {
            keywords.add(k.asText());
        }

        String artifact = item.path("artifact").asText("");
        String assetUrl = "";
        if (!artifact.isEmpty() && !artifact.contains("..")) {
            assetUrl = GitHubClient.RAW_BASE + "/" + fullName + "/" + tag + "/" + encodePath(artifact);
        }
        entry.put("assetName", artifact.isEmpty() ? "" : artifact.substring(artifact.lastIndexOf('/') + 1));
        entry.put("assetUrl", assetUrl);
        entry.put("checksumUrl", item.path("checksumUrl").asText(""));
        return entry;
    }

    /** Percent-encode each segment of a repo path for a raw.githubusercontent.com URL (space -> %20). */
    private static String encodePath(String path) {
        String[] segments = path.split("/");
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < segments.length; i++) {
            if (i > 0) {
                sb.append('/');
            }
            sb.append(URLEncoder.encode(segments[i], StandardCharsets.UTF_8).replace("+", "%20"));
        }
        return sb.toString();
    }

    /** oie.json schema versions this store understands. */
    private static final int MAX_MANIFEST_SCHEMA = 1;

    private JsonNode fetchManifest(String fullName, String tag) throws Exception {
        String raw = gitHub.getRawText(GitHubClient.RAW_BASE + "/" + fullName + "/" + tag + "/oie.json");
        if (raw == null) {
            return null;
        }
        try {
            JsonNode manifest = MAPPER.readTree(raw);
            // A manifest published for a newer store is skipped (never half-parsed); the
            // release walk continues to older releases, whose manifests may still be readable.
            int schema = manifest.path("schemaVersion").asInt(1);
            if (schema > MAX_MANIFEST_SCHEMA) {
                logger.warn("Community Store: " + fullName + "@" + tag + " declares oie.json schemaVersion " + schema
                        + " (this store supports up to " + MAX_MANIFEST_SCHEMA + ") — skipping this release.");
                return null;
            }
            return manifest;
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
        entry.put("repoUrl", "https://github.com/" + fullName);
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
        boolean contentType = isContentType(entry.path("type").asText());
        // Extensions need a restart; imported content (channels/code templates) takes effect immediately.
        entry.put("restartRequired", manifest.has("restartRequired") ? manifest.path("restartRequired").asBoolean(binaryType) : binaryType);
        entry.put("installable", binaryType || contentType);

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

    /** Content types are imported through the engine's controllers, not the extension installer. */
    public static boolean isContentType(String type) {
        return "channel".equals(type) || "code-template-library".equals(type) || "code-template".equals(type);
    }

    /** Deep-copies the cached catalog and stamps current installed/update state onto each entry. */
    private ObjectNode mergeInstalledState(ObjectNode catalog) {
        ObjectNode result = catalog.deepCopy();
        Map<String, String> installed = installedVersionsByPath();
        Set<String> contentIds = installedContentIds();
        ObjectNode ledgerForVersions = settings.getInstallLedger();
        for (JsonNode node : result.withArray("entries")) {
            ObjectNode entry = (ObjectNode) node;
            if (isContentType(entry.path("type").asText())) {
                // Content is matched by the artifact's engine id (declared as contentId in the
                // manifest). The engine stores no version for content, but the install ledger
                // remembers what version THIS store imported — so ledger-tracked content gets
                // real update detection; content installed outside the store just shows present.
                String contentId = entry.path("contentId").asText("");
                boolean present = !contentId.isEmpty() && contentIds.contains(contentId);
                JsonNode record = ledgerForVersions.get(entry.path("id").asText());
                String ledgerVersion = record != null ? record.path("version").asText("") : "";
                boolean updateAvailable = false;
                if (present && !ledgerVersion.isEmpty()) {
                    SemVer current = SemVer.parse(ledgerVersion);
                    SemVer offered = SemVer.parse(entry.path("version").asText());
                    updateAvailable = current != null && offered != null && offered.compareTo(current) > 0
                            && entry.path("compatible").asBoolean(false);
                }
                entry.put("installedVersion", present ? (!ledgerVersion.isEmpty() ? ledgerVersion : entry.path("version").asText()) : "");
                entry.put("updateAvailable", updateAvailable);
                continue;
            }
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

        // Revocation: a package THIS store installed (see the install ledger) that is still
        // on the engine but no longer offered by any source has been removed — or blocked —
        // upstream. Surface it as a revoked entry so the administrator is told and prompted
        // to uninstall, instead of it silently vanishing from the Installed tab. Suppressed
        // when any source failed to sync: an unreachable source must not read as a takedown.
        if (result.withArray("errors").size() == 0) {
            Set<String> offeredIds = new HashSet<>();
            for (JsonNode node : result.withArray("entries")) {
                offeredIds.add(node.path("id").asText());
            }
            ObjectNode ledger = settings.getInstallLedger();
            List<String> stale = new ArrayList<>();
            java.util.Iterator<String> ids = ledger.fieldNames();
            while (ids.hasNext()) {
                String id = ids.next();
                JsonNode record = ledger.get(id);
                String type = record.path("type").asText("plugin");
                boolean stillInstalled = isContentType(type)
                        ? contentIds.contains(record.path("contentId").asText(""))
                        : installed.containsKey(id);
                if (!stillInstalled) {
                    // Uninstalled outside the store (Extensions page / native views). Prune the
                    // record — but only once it has aged past the freshly-installed window: a
                    // just-installed extension isn't in the engine inventory until the restart,
                    // and must not have its ledger entry reaped in the meantime.
                    if (System.currentTimeMillis() - record.path("installedAt").asLong(0) > LEDGER_PRUNE_AFTER_MILLIS) {
                        stale.add(id);
                    }
                    continue;
                }
                if (offeredIds.contains(id)) {
                    continue;
                }
                String repo = record.path("repo").asText("");
                boolean blocked = settings.isBlocked(repo) || lastRemoteBlock.contains(repo.toLowerCase());
                result.withArray("entries").add(revokedEntry(id, record, type, blocked,
                        isContentType(type) ? record.path("version").asText("") : installed.get(id)));
            }
            if (!stale.isEmpty()) {
                pruneLedger(stale);
            }
        }
        return result;
    }

    /** How long an uninstalled package's ledger record survives before pruning (see above). */
    private static final long LEDGER_PRUNE_AFTER_MILLIS = 7L * 24 * 60 * 60 * 1000;

    /** Removes stale ledger records and persists — best-effort, never fails a catalog read. */
    private void pruneLedger(List<String> ids) {
        try {
            for (String id : ids) {
                settings.removeInstall(id);
            }
            ControllerFactory.getFactory().createExtensionController()
                    .setPluginProperties(CommunityStoreServicePlugin.PLUGIN_POINT, settings.toProperties());
            logger.info("Community Store: pruned " + ids.size() + " ledger record(s) for packages uninstalled outside the store.");
        } catch (Exception e) {
            logger.warn("Community Store: could not prune the install ledger", e);
        }
    }

    /** A synthesized catalog entry for an installed package whose source revoked it. */
    private ObjectNode revokedEntry(String id, JsonNode record, String type, boolean blocked, String installedVersion) {
        ObjectNode entry = MAPPER.createObjectNode();
        entry.put("id", id);
        entry.put("name", record.path("name").asText(id));
        entry.put("description", blocked
                ? "This package was BLOCKED by its catalog after you installed it. Review it and uninstall unless you trust it."
                : "This package is no longer offered by any configured source. It may have been withdrawn by its publisher.");
        entry.put("type", type);
        entry.put("repo", record.path("repo").asText(""));
        entry.put("repoUrl", record.path("repoUrl").asText(""));
        entry.put("tag", "");
        entry.put("version", record.path("version").asText(""));
        entry.put("installedVersion", installedVersion == null || installedVersion.isEmpty()
                ? record.path("version").asText("") : installedVersion);
        entry.put("compatible", false);
        entry.put("installable", false);
        entry.put("updateAvailable", false);
        entry.put("restartRequired", isBinaryType(type));
        entry.put("deprecated", false);
        entry.put("revoked", true);
        entry.put("revokedReason", blocked ? "blocked" : "removed");
        entry.put("source", "(no longer offered)");
        entry.putArray("authors");
        entry.putArray("keywords");
        entry.put("assetName", "");
        entry.put("assetUrl", "");
        entry.put("checksumUrl", "");
        entry.put("contentId", record.path("contentId").asText(""));
        return entry;
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

    /**
     * Ids of installed content the store can detect: channel ids, code template library ids, and
     * code template ids. A content catalog entry is "installed" when its manifest contentId is here.
     */
    private Set<String> installedContentIds() {
        Set<String> ids = new HashSet<>();
        try {
            ids.addAll(ControllerFactory.getFactory().createChannelController().getChannelIds());
        } catch (Exception e) {
            logger.warn("Community Store: could not read installed channel ids: " + e.getMessage());
        }
        try {
            CodeTemplateController controller = ControllerFactory.getFactory().createCodeTemplateController();
            // Library ids come from the library store; template ids come from the TEMPLATE
            // store — NOT from library membership. Membership can dangle: the web admin
            // deletes a template record immediately but commits the membership removal only
            // on Save All, and a dangling member must not read as still installed.
            for (CodeTemplateLibrary library : controller.getLibraries(null, false)) {
                ids.add(library.getId());
            }
            for (CodeTemplate template : controller.getCodeTemplates(null)) {
                ids.add(template.getId());
            }
        } catch (Exception e) {
            logger.warn("Community Store: could not read installed code template ids: " + e.getMessage());
        }
        return ids;
    }

    private ObjectNode sourceError(String source, String message) {
        ObjectNode error = MAPPER.createObjectNode();
        error.put("source", source);
        error.put("message", message == null ? "unknown error" : message);
        return error;
    }
}
