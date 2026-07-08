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
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import javax.xml.parsers.DocumentBuilderFactory;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;
import org.w3c.dom.Document;

import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mirth.connect.model.Channel;
import com.mirth.connect.model.ServerEvent;
import com.mirth.connect.model.ServerEventContext;
import com.mirth.connect.model.codetemplates.CodeTemplate;
import com.mirth.connect.model.codetemplates.CodeTemplateLibrary;
import com.mirth.connect.model.converters.ObjectXMLSerializer;
import com.mirth.connect.server.controllers.ChannelController;
import com.mirth.connect.server.controllers.CodeTemplateController;
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
    public static final String EVENT_FAILURE = "Community Store: install failed";
    public static final String EVENT_REMOVE = "Community Store: content removed";

    private final GitHubClient gitHub;
    private final StoreSettings settings;

    /**
     * Serializes every read-modify-write of the code template library SET. Both content
     * paths below load ALL libraries, mutate the list, and write it back — two concurrent
     * installs would otherwise each write their own snapshot and the last writer would
     * silently erase the other's changes (an entire library could vanish).
     */
    private static final Object LIBRARY_WRITE_LOCK = new Object();

    public InstallService(GitHubClient gitHub, StoreSettings settings) {
        this.gitHub = gitHub;
        this.settings = settings;
    }

    /**
     * Records what this store installed (or removes the record on uninstall) so the
     * catalog sync can flag installed packages whose source has since removed or
     * blocked them (revocation). Best-effort: a ledger failure never fails the install.
     */
    private void updateLedger(String id, ObjectNode record) {
        try {
            if (record == null) {
                settings.removeInstall(id);
            } else {
                settings.recordInstall(id, record);
            }
            ControllerFactory.getFactory().createExtensionController()
                    .setPluginProperties(CommunityStoreServicePlugin.PLUGIN_POINT, settings.toProperties());
        } catch (Exception e) {
            logger.warn("Community Store: could not persist the install ledger", e);
        }
    }

    private ObjectNode ledgerRecord(ObjectNode entry) {
        ObjectNode record = com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode();
        record.put("name", entry.path("name").asText(""));
        record.put("type", entry.path("type").asText(""));
        record.put("version", entry.path("version").asText(""));
        record.put("repo", entry.path("repo").asText(""));
        record.put("repoUrl", entry.path("repoUrl").asText(""));
        record.put("contentId", entry.path("contentId").asText(""));
        record.put("installedAt", System.currentTimeMillis());
        return record;
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

        String type = entry.path("type").asText("");
        try {
            if (!entry.path("compatible").asBoolean(false)) {
                throw new IOException("Release " + tag + " is not compatible with this engine version.");
            }
            if (assetUrl.isEmpty()) {
                throw new IOException("Release " + tag + " of " + repo + " has no installable artifact.");
            }

            // Channels and code templates aren't extensions — they're imported through the
            // engine's controllers, take effect without a restart, and don't touch the
            // extensions directory.
            if (CatalogService.isContentType(type)) {
                return installContent(entry, type, id, repo, tag, assetUrl, checksumUrl, userId);
            }
            if (!CatalogService.isBinaryType(type)) {
                throw new IOException("Type '" + type + "' is not installable through the store.");
            }
            // Catalog-index entries carry the digest inline; crawled release entries publish a
            // .sha256 sidecar asset. Either satisfies the mandatory-verification rule.
            String inlineSha256 = entry.path("sha256").asText("");
            if (inlineSha256.isEmpty() && checksumUrl.isEmpty()) {
                throw new IOException("Release " + tag + " of " + repo + " is missing the required " + assetName + ".sha256 checksum asset.");
            }

            byte[] artifact = gitHub.downloadAsset(assetUrl);
            String expected = inlineSha256.isEmpty()
                    ? parseChecksum(new String(gitHub.downloadAsset(checksumUrl), StandardCharsets.UTF_8))
                    : inlineSha256;
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
            updateLedger(id, ledgerRecord(entry));

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

    /**
     * Imports a content artifact — a channel, code template library, or standalone code template —
     * through the engine's controllers (not the extension installer). These take effect immediately
     * (no restart) and live in the channel / code-template stores. For a standalone code template
     * the caller supplies a target library on the entry: {@code targetLibraryId} to add to an
     * existing library, or {@code newLibrary} to create one. A checksum is verified when present.
     */
    private ObjectNode installContent(ObjectNode entry, String type, String id, String repo, String tag,
            String assetUrl, String checksumUrl, Integer userId) throws Exception {
        byte[] artifact = gitHub.downloadAsset(assetUrl);
        String actual = sha256Hex(artifact);
        String inlineSha256 = entry.path("sha256").asText("");
        String expected = !inlineSha256.isEmpty() ? inlineSha256
                : (!checksumUrl.isEmpty() ? parseChecksum(new String(gitHub.downloadAsset(checksumUrl), StandardCharsets.UTF_8)) : "");
        if (!expected.isEmpty() && !actual.equalsIgnoreCase(expected)) {
            throw new IOException("Checksum verification FAILED for " + id + ": expected " + expected + " but computed " + actual + ". Nothing was imported.");
        }
        String xml = new String(artifact, StandardCharsets.UTF_8);
        ObjectXMLSerializer serializer = ObjectXMLSerializer.getInstance();
        String imported;

        String declaredContentId = entry.path("contentId").asText("");
        if ("channel".equals(type)) {
            Channel channel = serializer.deserialize(xml, Channel.class);
            requireContentIdMatch(declaredContentId, channel.getId(), "channel");
            ChannelController controller = ControllerFactory.getFactory().createChannelController();
            controller.updateChannel(channel, ServerEventContext.SYSTEM_USER_EVENT_CONTEXT, true, null);
            imported = "channel \"" + channel.getName() + "\"";
        } else if ("code-template-library".equals(type)) {
            CodeTemplateLibrary library = serializer.deserialize(xml, CodeTemplateLibrary.class);
            requireContentIdMatch(declaredContentId, library.getId(), "code template library");
            CodeTemplateController controller = ControllerFactory.getFactory().createCodeTemplateController();
            // Persist each member template's content, then merge the library into the existing set.
            if (library.getCodeTemplates() != null) {
                for (CodeTemplate template : library.getCodeTemplates()) {
                    controller.updateCodeTemplate(template, ServerEventContext.SYSTEM_USER_EVENT_CONTEXT, true);
                }
            }
            synchronized (LIBRARY_WRITE_LOCK) {
                List<CodeTemplateLibrary> libraries = new ArrayList<>(controller.getLibraries(null, true));
                libraries.removeIf(existing -> existing.getId().equals(library.getId()));
                libraries.add(library);
                controller.updateLibraries(libraries, ServerEventContext.SYSTEM_USER_EVENT_CONTEXT, true);
            }
            imported = "code template library \"" + library.getName() + "\"";
        } else if ("code-template".equals(type)) {
            CodeTemplateController controller = ControllerFactory.getFactory().createCodeTemplateController();
            CodeTemplate template = serializer.deserialize(xml, CodeTemplate.class);
            requireContentIdMatch(declaredContentId, template.getId(), "code template");

            // A standalone template must belong to a library — the one the user chose. If it
            // already belongs to one (an update / re-import), leave membership alone: no
            // library prompt applies and it must not be duplicated into a second library.
            CodeTemplateLibrary target;
            synchronized (LIBRARY_WRITE_LOCK) {
                List<CodeTemplateLibrary> libraries = new ArrayList<>(controller.getLibraries(null, true));
                CodeTemplateLibrary existingHome = null;
                for (CodeTemplateLibrary lib : libraries) {
                    if (lib.getCodeTemplates() != null) {
                        for (CodeTemplate member : lib.getCodeTemplates()) {
                            if (member.getId().equals(template.getId())) {
                                existingHome = lib;
                                break;
                            }
                        }
                    }
                    if (existingHome != null) {
                        break;
                    }
                }
                controller.updateCodeTemplate(template, ServerEventContext.SYSTEM_USER_EVENT_CONTEXT, true);
                if (existingHome != null) {
                    imported = "code template \"" + template.getName() + "\" (updated in library \"" + existingHome.getName() + "\")";
                    target = null;
                } else {
                String targetLibraryId = entry.path("targetLibraryId").asText("");
                String newLibraryName = entry.path("newLibrary").asText("").trim();
                target = null;
                for (CodeTemplateLibrary lib : libraries) {
                    if (lib.getId().equals(targetLibraryId)) {
                        target = lib;
                        break;
                    }
                }
                if (target == null) {
                    if (!targetLibraryId.isEmpty()) {
                        throw new IOException("The selected code template library no longer exists. Refresh and choose again.");
                    }
                    target = new CodeTemplateLibrary();
                    target.setId(UUID.randomUUID().toString());
                    target.setName(newLibraryName.isEmpty() ? "Community Store" : newLibraryName);
                    target.setCodeTemplates(new ArrayList<>());
                    libraries.add(target);
                }
                List<CodeTemplate> members = target.getCodeTemplates();
                if (members == null) {
                    members = new ArrayList<>();
                    target.setCodeTemplates(members);
                }
                boolean present = false;
                for (CodeTemplate member : members) {
                    if (member.getId().equals(template.getId())) {
                        present = true;
                        break;
                    }
                }
                if (!present) {
                    members.add(template);
                }
                controller.updateLibraries(libraries, ServerEventContext.SYSTEM_USER_EVENT_CONTEXT, true);
                imported = "code template \"" + template.getName() + "\" into library \"" + target.getName() + "\"";
                }
            }
        } else {
            throw new IOException("Unsupported content type: " + type);
        }

        dispatchEvent(EVENT_INSTALL, userId, Map.of("extension", id, "repo", repo, "tag", tag, "sha256", actual), ServerEvent.Outcome.SUCCESS);
        updateLedger(id, ledgerRecord(entry));

        ObjectNode response = entry.objectNode();
        response.put("installed", true);
        response.put("id", id);
        response.put("tag", tag);
        response.put("sha256", actual);
        response.put("restartRequired", false);
        response.put("imported", imported);
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

    /**
     * The manifest's contentId is how the store detects that content is installed — a
     * mismatch with the artifact's real engine id would silently break installed-state
     * tracking, so refuse it with an actionable error instead.
     */
    /**
     * Removes imported content from the engine — the content counterpart of removing an
     * extension from the Extensions page. Per type:
     * code-template: deletes the template record and drops its library membership;
     * code-template-library: deletes the library AND its current member templates (the same
     * semantics as deleting a library in the Code Templates view);
     * channel: deletes the channel and its message history — REFUSED while deployed, because
     * stopping live traffic must be an explicit decision made in the Channels view.
     * Always clears the install ledger record.
     */
    public ObjectNode removeContent(String id, String type, String contentId, Integer userId) throws Exception {
        if (contentId == null || contentId.isEmpty()) {
            throw new IOException("No engine id is known for '" + id + "', so the store cannot remove it. Delete it from its native view instead.");
        }
        String removed;
        if ("channel".equals(type)) {
            ChannelController channelController = ControllerFactory.getFactory().createChannelController();
            Channel channel = channelController.getChannelById(contentId);
            if (channel == null) {
                throw new IOException("The channel is not on this engine.");
            }
            if (channelController.getDeployedChannelById(contentId) != null) {
                throw new IOException("Channel \"" + channel.getName() + "\" is deployed. Undeploy it in the Channels view first, then remove it.");
            }
            channelController.removeChannel(channel, ServerEventContext.SYSTEM_USER_EVENT_CONTEXT);
            removed = "channel \"" + channel.getName() + "\"";
        } else if ("code-template-library".equals(type)) {
            CodeTemplateController controller = ControllerFactory.getFactory().createCodeTemplateController();
            synchronized (LIBRARY_WRITE_LOCK) {
                List<CodeTemplateLibrary> libraries = new ArrayList<>(controller.getLibraries(null, true));
                CodeTemplateLibrary target = null;
                for (CodeTemplateLibrary lib : libraries) {
                    if (contentId.equals(lib.getId())) {
                        target = lib;
                        break;
                    }
                }
                if (target == null) {
                    throw new IOException("The code template library is not on this engine.");
                }
                List<String> memberIds = new ArrayList<>();
                if (target.getCodeTemplates() != null) {
                    for (CodeTemplate member : target.getCodeTemplates()) {
                        memberIds.add(member.getId());
                    }
                }
                libraries.remove(target);
                controller.updateLibraries(libraries, ServerEventContext.SYSTEM_USER_EVENT_CONTEXT, true);
                for (String memberId : memberIds) {
                    controller.removeCodeTemplate(memberId, ServerEventContext.SYSTEM_USER_EVENT_CONTEXT);
                }
                removed = "library \"" + target.getName() + "\" and its " + memberIds.size() + " code template(s)";
            }
        } else if ("code-template".equals(type)) {
            CodeTemplateController controller = ControllerFactory.getFactory().createCodeTemplateController();
            String removedFrom = null;
            synchronized (LIBRARY_WRITE_LOCK) {
                List<CodeTemplateLibrary> libraries = new ArrayList<>(controller.getLibraries(null, true));
                boolean membershipChanged = false;
                for (CodeTemplateLibrary lib : libraries) {
                    List<CodeTemplate> members = lib.getCodeTemplates();
                    if (members != null && members.removeIf(member -> contentId.equals(member.getId()))) {
                        membershipChanged = true;
                        removedFrom = lib.getName();
                    }
                }
                if (membershipChanged) {
                    controller.updateLibraries(libraries, ServerEventContext.SYSTEM_USER_EVENT_CONTEXT, true);
                }
                controller.removeCodeTemplate(contentId, ServerEventContext.SYSTEM_USER_EVENT_CONTEXT);
            }
            removed = "code template" + (removedFrom == null ? "" : " (from library \"" + removedFrom + "\")");
        } else {
            throw new IOException("Only channels, code templates, and code template libraries can be removed through the store.");
        }
        dispatchEvent(EVENT_REMOVE, userId, Map.of("package", id, "contentId", contentId, "removed", removed), ServerEvent.Outcome.SUCCESS);
        updateLedger(id, null);

        ObjectNode response = com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode();
        response.put("removed", true);
        response.put("id", id);
        response.put("detail", removed);
        return response;
    }

    private static void requireContentIdMatch(String declared, String actual, String what) throws IOException {
        if (!declared.isEmpty() && actual != null && !declared.equalsIgnoreCase(actual)) {
            throw new IOException("The " + what + " artifact's id (" + actual + ") does not match the manifest's contentId ("
                    + declared + "). Installed-state tracking would break — the publisher should correct the manifest.");
        }
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
