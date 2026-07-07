/*
 * OIE Community Store
 *
 * Published under the terms of the Mozilla Public License 2.0.
 */

package org.openintegrationengine.plugins.communitystore;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Thin GitHub client over java.net.http. All API GETs use conditional requests with an
 * in-memory ETag cache. NOTE GitHub's documented behavior: a 304 revalidation is free of the
 * primary rate limit ONLY on authenticated requests — unauthenticated requests count against
 * the 60/hour cap whether or not they return 304. A PAT (supplied lazily so settings changes
 * apply without re-wiring) is therefore what makes steady-state sync viable beyond a handful
 * of crawled sources; it also enables private sources.
 */
public class GitHubClient {

    public static final String API_BASE = "https://api.github.com";
    public static final String RAW_BASE = "https://raw.githubusercontent.com";

    /** Hard cap on downloaded artifact size. */
    public static final long MAX_ASSET_BYTES = 200L * 1024 * 1024;

    /** Redirect hops followed manually for asset downloads before giving up. */
    private static final int MAX_REDIRECTS = 5;

    private final HttpClient http;
    private final HttpClient assetHttp;
    private final ObjectMapper mapper = new ObjectMapper();
    private final Supplier<String> tokenSupplier;
    private final Map<String, CachedResponse> etagCache = new ConcurrentHashMap<>();

    private volatile String rateLimitRemaining = "";
    private volatile String rateLimitReset = "";

    private static class CachedResponse {
        final String etag;
        final String body;

        CachedResponse(String etag, String body) {
            this.etag = etag;
            this.body = body;
        }
    }

    public GitHubClient(Supplier<String> tokenSupplier) {
        this.tokenSupplier = tokenSupplier;
        this.http = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NORMAL).connectTimeout(Duration.ofSeconds(15)).build();
        // Asset downloads follow redirects manually (see downloadAsset) so the PAT is
        // never forwarded to a redirect target on a different host than the origin.
        this.assetHttp = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).connectTimeout(Duration.ofSeconds(15)).build();
    }

    /**
     * The configured PAT is a GitHub credential — attach it ONLY to GitHub-family hosts.
     * Catalog indexes and installer artifacts may live on any https host; sending the token
     * there would leak it to a third party.
     */
    private static boolean isGitHubHost(String host) {
        String h = host == null ? "" : host.toLowerCase();
        return h.equals("github.com") || h.equals("api.github.com")
                || h.endsWith(".github.com") || h.equals("raw.githubusercontent.com")
                || h.endsWith(".githubusercontent.com");
    }

    private void attachAuth(HttpRequest.Builder builder, String url) {
        if (!isGitHubHost(hostOf(url))) {
            return;
        }
        String token = tokenSupplier.get();
        if (token != null && !token.isBlank()) {
            builder.header("Authorization", "Bearer " + token.trim());
        }
    }

    /** GET a GitHub REST API URL as parsed JSON, using the ETag cache. */
    public JsonNode getApiJson(String url) throws IOException, InterruptedException {
        CachedResponse cached = etagCache.get(url);

        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(30)).header("Accept", "application/vnd.github+json").header("X-GitHub-Api-Version", "2022-11-28").header("User-Agent", "oie-community-store");
        attachAuth(builder, url);
        if (cached != null && cached.etag != null) {
            builder.header("If-None-Match", cached.etag);
        }

        HttpResponse<String> response = http.send(builder.GET().build(), HttpResponse.BodyHandlers.ofString());
        response.headers().firstValue("x-ratelimit-remaining").ifPresent(v -> rateLimitRemaining = v);
        response.headers().firstValue("x-ratelimit-reset").ifPresent(v -> rateLimitReset = v);

        int status = response.statusCode();
        if (status == 304 && cached != null) {
            return mapper.readTree(cached.body);
        }
        if (status == 200) {
            String etag = response.headers().firstValue("etag").orElse(null);
            if (etag != null) {
                etagCache.put(url, new CachedResponse(etag, response.body()));
            }
            return mapper.readTree(response.body());
        }
        if (status == 403 || status == 429) {
            throw new IOException("GitHub rate limit or access denied (HTTP " + status + ") for " + url + ". Remaining: " + rateLimitRemaining + ". Consider configuring a personal access token in Community Store settings.");
        }
        if (status == 404) {
            throw new IOException("Not found (HTTP 404): " + url);
        }
        throw new IOException("GitHub request failed (HTTP " + status + "): " + url);
    }

    /**
     * GET any https URL as text, or null on 404. Used for oie.json manifests, sha256 sidecars,
     * and catalog docs pages. Auth is attached only for GitHub-family hosts (see attachAuth).
     */
    public String getRawText(String url) throws IOException, InterruptedException {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(30)).header("User-Agent", "oie-community-store");
        attachAuth(builder, url);
        HttpResponse<String> response = http.send(builder.GET().build(), HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() == 404) {
            return null;
        }
        if (response.statusCode() != 200) {
            throw new IOException("Raw fetch failed (HTTP " + response.statusCode() + "): " + url);
        }
        return response.body();
    }

    /**
     * GET a prebuilt catalog index (index.json) from any https host as parsed JSON, with ETag
     * conditional caching. Sends no GitHub-specific headers; auth only for GitHub-family hosts,
     * so a token never leaks to third-party index hosting (S3, GitLab, a plain web server).
     */
    public JsonNode getIndexJson(String url) throws IOException, InterruptedException {
        CachedResponse cached = etagCache.get(url);
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(30)).header("Accept", "application/json").header("User-Agent", "oie-community-store");
        attachAuth(builder, url);
        if (cached != null && cached.etag != null) {
            builder.header("If-None-Match", cached.etag);
        }
        HttpResponse<String> response = http.send(builder.GET().build(), HttpResponse.BodyHandlers.ofString());
        int status = response.statusCode();
        if (status == 304 && cached != null) {
            return mapper.readTree(cached.body);
        }
        if (status == 200) {
            String etag = response.headers().firstValue("etag").orElse(null);
            if (etag != null) {
                etagCache.put(url, new CachedResponse(etag, response.body()));
            }
            return mapper.readTree(response.body());
        }
        throw new IOException("Catalog index fetch failed (HTTP " + status + "): " + url);
    }

    /**
     * Download a release asset (or its sidecar). Asset downloads hit the CDN and do not consume
     * API rate limit. Redirects are followed manually so the PAT is presented only to the
     * originating GitHub host and never leaks to a redirect target on another host (github.com
     * bounces asset downloads to a separate CDN host). The body is streamed and capped at
     * {@link #MAX_ASSET_BYTES} instead of being buffered whole before the size is checked.
     */
    public byte[] downloadAsset(String url) throws IOException, InterruptedException {
        String currentUrl = url;
        String originHost = hostOf(url);
        for (int hop = 0; hop < MAX_REDIRECTS; hop++) {
            HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(currentUrl)).timeout(Duration.ofMinutes(5)).header("Accept", "application/octet-stream").header("User-Agent", "oie-community-store");
            // Auth: GitHub-family hosts only, and never across a redirect to a different host.
            if (originHost.equalsIgnoreCase(hostOf(currentUrl))) {
                attachAuth(builder, currentUrl);
            }
            HttpResponse<InputStream> response = assetHttp.send(builder.GET().build(), HttpResponse.BodyHandlers.ofInputStream());
            int status = response.statusCode();
            if (status >= 300 && status < 400) {
                String location = response.headers().firstValue("location").orElseThrow(() -> new IOException("Redirect without a Location header while downloading " + url));
                try (InputStream drain = response.body()) { /* release the connection */ }
                currentUrl = URI.create(currentUrl).resolve(location).toString();
                continue;
            }
            if (status != 200) {
                try (InputStream drain = response.body()) { /* release the connection */ }
                throw new IOException("Asset download failed (HTTP " + status + "): " + url);
            }
            try (InputStream in = response.body()) {
                return readCapped(in, MAX_ASSET_BYTES, url);
            }
        }
        throw new IOException("Too many redirects while downloading: " + url);
    }

    private static String hostOf(String url) {
        String host = URI.create(url).getHost();
        return host == null ? "" : host;
    }

    /**
     * GET any https URL as bytes (used for documentation images), or null on 404. Streamed and
     * capped at maxBytes; auth attaches only for GitHub-family hosts (private-repo docs still
     * resolve, and the token never leaks elsewhere). Fetched server side so the browser never
     * talks to the artifact host.
     */
    public byte[] getRawBytes(String url, long maxBytes) throws IOException, InterruptedException {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(30)).header("User-Agent", "oie-community-store");
        attachAuth(builder, url);
        HttpResponse<InputStream> response = http.send(builder.GET().build(), HttpResponse.BodyHandlers.ofInputStream());
        int status = response.statusCode();
        if (status == 404) {
            try (InputStream drain = response.body()) { /* release the connection */ }
            return null;
        }
        if (status != 200) {
            try (InputStream drain = response.body()) { /* release the connection */ }
            throw new IOException("Raw fetch failed (HTTP " + status + "): " + url);
        }
        try (InputStream in = response.body()) {
            return readCapped(in, maxBytes, url);
        }
    }

    /** Reads a stream fully into memory, aborting as soon as the byte cap is exceeded. */
    private static byte[] readCapped(InputStream in, long maxBytes, String url) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[65536];
        long total = 0;
        int read;
        while ((read = in.read(buffer)) != -1) {
            total += read;
            if (total > maxBytes) {
                throw new IOException("Download exceeds the maximum allowed size (" + maxBytes + " bytes): " + url);
            }
            out.write(buffer, 0, read);
        }
        return out.toByteArray();
    }

    public String getRateLimitRemaining() {
        return rateLimitRemaining;
    }

    public String getRateLimitReset() {
        return rateLimitReset;
    }
}
