/*
 * OIE Community Store
 *
 * Published under the terms of the Mozilla Public License 2.0.
 */

package org.openintegrationengine.plugins.communitystore;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import javax.xml.parsers.DocumentBuilderFactory;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.w3c.dom.Document;

import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mirth.connect.model.ServerEvent;
import com.mirth.connect.server.controllers.ConfigurationController;
import com.mirth.connect.server.controllers.ControllerFactory;
import com.mirth.connect.server.controllers.EventController;
import com.mirth.connect.server.controllers.ExtensionController;
import com.mirth.connect.server.controllers.ExtensionController.InstallationResult;

/**
 * Executes an install: download the release asset server side, verify it against the published
 * sha256 sidecar, pre-flight the zip (descriptor present, extension path matches the manifest id,
 * declared engine compatibility), then hand the verified bytes to the engine's own extension
 * installer. Uninstall delegates to the engine's prepare-for-uninstallation path. Both dispatch
 * server events so the audit log answers who installed what from where.
 */
public class InstallService {

    private static final Logger logger = LogManager.getLogger(InstallService.class);

    public static final String EVENT_INSTALL = "Community Store: extension installed";
    public static final String EVENT_UNINSTALL = "Community Store: extension marked for uninstall";
    public static final String EVENT_FAILURE = "Community Store: install failed";

    private final GitHubClient gitHub;

    public InstallService(GitHubClient gitHub) {
        this.gitHub = gitHub;
    }

    /**
     * Installs the given resolved catalog entry. Returns a result JSON payload; throws on any
     * verification or installation failure after dispatching a failure event.
     */
    public ObjectNode install(ObjectNode entry, Integer userId) throws Exception {
        String id = entry.path("id").asText();
        String repo = entry.path("repo").asText();
        String tag = entry.path("tag").asText();
        String assetUrl = entry.path("assetUrl").asText("");
        String checksumUrl = entry.path("checksumUrl").asText("");
        String assetName = entry.path("assetName").asText("");

        try {
            if (!CatalogService.isBinaryType(entry.path("type").asText())) {
                throw new IOException("Type '" + entry.path("type").asText() + "' is not installable through the store yet.");
            }
            if (!entry.path("compatible").asBoolean(false)) {
                throw new IOException("Release " + tag + " is not compatible with this engine version.");
            }
            if (assetUrl.isEmpty()) {
                throw new IOException("Release " + tag + " of " + repo + " has no unambiguous .zip asset. Publishers must attach exactly one zip or declare 'filename' in oie.json.");
            }
            if (checksumUrl.isEmpty()) {
                throw new IOException("Release " + tag + " of " + repo + " is missing the required " + assetName + ".sha256 checksum asset.");
            }

            byte[] artifact = gitHub.downloadAsset(assetUrl);
            String expected = parseChecksum(new String(gitHub.downloadAsset(checksumUrl), StandardCharsets.UTF_8));
            String actual = sha256Hex(artifact);
            if (!actual.equalsIgnoreCase(expected)) {
                throw new IOException("Checksum verification FAILED for " + assetName + ": expected " + expected + " but computed " + actual + ". The artifact was not installed.");
            }

            preflight(artifact, id);

            ExtensionController extensionController = ControllerFactory.getFactory().createExtensionController();
            InstallationResult result = extensionController.extractExtension(new ByteArrayInputStream(artifact));
            if (result.getCause() != null) {
                throw new IOException("Engine installer rejected the extension: " + result.getCause().getMessage(), result.getCause());
            }

            dispatchEvent(EVENT_INSTALL, userId, Map.of("extension", id, "repo", repo, "tag", tag, "sha256", actual), ServerEvent.Outcome.SUCCESS);

            ObjectNode response = entry.objectNode();
            response.put("installed", true);
            response.put("id", id);
            response.put("tag", tag);
            response.put("sha256", actual);
            response.put("restartRequired", true);
            return response;
        } catch (Exception e) {
            dispatchEvent(EVENT_FAILURE, userId, Map.of("extension", id, "repo", repo, "tag", tag, "error", String.valueOf(e.getMessage())), ServerEvent.Outcome.FAILURE);
            throw e;
        }
    }

    /** Marks an installed extension for uninstallation on next restart, via the engine's own path. */
    public ObjectNode uninstall(String extensionPath, Integer userId) throws Exception {
        ExtensionController extensionController = ControllerFactory.getFactory().createExtensionController();
        extensionController.prepareExtensionForUninstallation(extensionPath);
        dispatchEvent(EVENT_UNINSTALL, userId, Map.of("extension", extensionPath), ServerEvent.Outcome.SUCCESS);
        ObjectNode response = com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode();
        response.put("uninstalled", true);
        response.put("id", extensionPath);
        response.put("restartRequired", true);
        return response;
    }

    /**
     * Pre-flight checks inside the verified zip, before the extensions directory is touched:
     * a descriptor must exist under a single top-level folder, and for plugin descriptors the
     * declared path must equal the manifest id so store records track the installed inventory.
     */
    private void preflight(byte[] artifact, String expectedId) throws Exception {
        Map<String, byte[]> descriptors = new HashMap<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(artifact))) {
            ZipEntry zipEntry;
            while ((zipEntry = zip.getNextEntry()) != null) {
                String name = zipEntry.getName();
                if (isUnsafeEntryName(name)) {
                    throw new IOException("Zip contains an illegal path traversal entry: " + name);
                }
                String base = name.substring(name.lastIndexOf('/') + 1);
                if (!zipEntry.isDirectory() && (base.equals("plugin.xml") || base.equals("source.xml") || base.equals("destination.xml")) && name.chars().filter(c -> c == '/').count() <= 1) {
                    descriptors.put(base, zip.readAllBytes());
                }
            }
        }
        if (descriptors.isEmpty()) {
            throw new IOException("The artifact does not look like an engine extension: no plugin.xml, source.xml, or destination.xml descriptor found at the extension root.");
        }
        byte[] pluginXml = descriptors.get("plugin.xml");
        if (pluginXml != null) {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            Document document = factory.newDocumentBuilder().parse(new ByteArrayInputStream(pluginXml));
            String path = document.getDocumentElement().getAttribute("path");
            if (path != null && !path.isEmpty() && !path.equals(expectedId)) {
                throw new IOException("Descriptor path '" + path + "' does not match the store manifest id '" + expectedId + "'. Refusing to install a mismatched artifact.");
            }
        }
    }

    /**
     * True when a zip entry name is unsafe to extract: an absolute path, a Windows drive/UNC
     * path, or one whose segments include a "." or ".." traversal component. Matching whole
     * segments (rather than a substring "..") avoids false-positives on legitimate names like
     * "my..plugin.jar" while still catching "../", "..\", and "a/../b".
     */
    private static boolean isUnsafeEntryName(String name) {
        if (name == null || name.isEmpty()) {
            return false;
        }
        String normalized = name.replace('\\', '/');
        if (normalized.startsWith("/") || normalized.matches("^[A-Za-z]:.*")) {
            return true;
        }
        for (String segment : normalized.split("/")) {
            if (segment.equals("..") || segment.equals(".")) {
                return true;
            }
        }
        return false;
    }

    private static String parseChecksum(String sidecar) throws IOException {
        // Accept "HEX", "HEX  filename" (sha256sum format), or "SHA256 (file) = HEX".
        for (String token : sidecar.trim().split("[\\s=()]+")) {
            if (token.matches("[0-9a-fA-F]{64}")) {
                return token;
            }
        }
        throw new IOException("Could not parse a sha256 digest from the checksum sidecar.");
    }

    private static String sha256Hex(byte[] data) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(data);
        StringBuilder hex = new StringBuilder(digest.length * 2);
        for (byte b : digest) {
            hex.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
        }
        return hex.toString();
    }

    private void dispatchEvent(String name, Integer userId, Map<String, String> attributes, ServerEvent.Outcome outcome) {
        try {
            EventController eventController = ControllerFactory.getFactory().createEventController();
            ServerEvent event = new ServerEvent(ConfigurationController.getInstance().getServerId(), name);
            event.setOutcome(outcome);
            if (userId != null) {
                event.setUserId(userId);
            }
            for (Map.Entry<String, String> attribute : attributes.entrySet()) {
                event.addAttribute(attribute.getKey(), attribute.getValue());
            }
            eventController.dispatchEvent(event);
        } catch (Exception e) {
            logger.warn("Community Store: failed to dispatch server event", e);
        }
    }
}
