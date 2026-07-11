/*
 * OIE Community Store — Swing Administrator client.
 *
 * Published under the terms of the Mozilla Public License 2.0.
 */

package org.openintegrationengine.plugins.communitystore.ui;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * One catalog entry parsed from the store servlet's JSON. Mirrors the fields the web
 * frontend reads (see {@code webadmin/web/plugin.jsx}); unknown fields are ignored.
 *
 * <p>{@link #ui} is the offered version's UI-surface array, or {@code null} when the
 * catalog omitted it (content). The surface filter keys on this exact field.
 */
class StoreEntry {

    private static final Set<String> CONTENT_TYPES =
            Set.of("channel", "code-template-library", "code-template");

    String id;
    String name;
    String description;
    String type;
    String repo;
    String repoUrl;
    String version;
    String tag;
    String latestTag;
    String minEngineVersion;
    String maxEngineVersion;
    String installedVersion;
    String deprecationMessage;
    String revokedReason;
    String license;
    String homepage;
    String documentation;
    String releaseUrl;
    String source;
    String contentId;

    boolean compatible;
    boolean installable;
    boolean updateAvailable;
    boolean restartRequired;
    boolean deprecated;
    boolean revoked;
    boolean offeredIsLatest;

    final List<String> authors = new ArrayList<>();
    final List<String> keywords = new ArrayList<>();

    /** UI surfaces for the offered version, or {@code null} when absent (content). */
    List<String> ui;

    boolean isContent() {
        return CONTENT_TYPES.contains(type);
    }

    boolean isInstalled() {
        return installedVersion != null && !installedVersion.isEmpty();
    }

    static StoreEntry from(JsonNode n) {
        StoreEntry e = new StoreEntry();
        e.id = str(n, "id");
        e.name = n.hasNonNull("name") ? n.path("name").asText() : e.id;
        e.description = str(n, "description");
        e.type = n.hasNonNull("type") ? n.path("type").asText() : "plugin";
        e.repo = str(n, "repo");
        e.repoUrl = str(n, "repoUrl");
        e.version = str(n, "version");
        e.tag = str(n, "tag");
        e.latestTag = str(n, "latestTag");
        e.minEngineVersion = str(n, "minEngineVersion");
        e.maxEngineVersion = str(n, "maxEngineVersion");
        e.installedVersion = str(n, "installedVersion");
        e.deprecationMessage = str(n, "deprecationMessage");
        e.revokedReason = str(n, "revokedReason");
        e.license = str(n, "license");
        e.homepage = str(n, "homepage");
        e.documentation = str(n, "documentation");
        e.releaseUrl = str(n, "releaseUrl");
        e.source = str(n, "source");
        e.contentId = str(n, "contentId");

        e.compatible = n.path("compatible").asBoolean(false);
        e.installable = n.path("installable").asBoolean(false);
        e.updateAvailable = n.path("updateAvailable").asBoolean(false);
        e.restartRequired = n.path("restartRequired").asBoolean(false);
        e.deprecated = n.path("deprecated").asBoolean(false);
        e.revoked = n.path("revoked").asBoolean(false);
        e.offeredIsLatest = n.path("offeredIsLatest").asBoolean(false);

        JsonNode authors = n.path("authors");
        if (authors.isArray()) {
            for (JsonNode a : authors) {
                e.authors.add(a.asText());
            }
        }
        JsonNode keywords = n.path("keywords");
        if (keywords.isArray()) {
            for (JsonNode k : keywords) {
                e.keywords.add(k.asText());
            }
        }
        JsonNode ui = n.get("ui");
        if (ui != null && ui.isArray()) {
            e.ui = new ArrayList<>();
            for (JsonNode s : ui) {
                e.ui.add(s.asText());
            }
        }
        return e;
    }

    private static String str(JsonNode n, String field) {
        JsonNode v = n.get(field);
        return (v == null || v.isNull()) ? "" : v.asText("");
    }
}
