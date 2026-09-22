/*
 * OIE Community Store
 *
 * Published under the terms of the Mozilla Public License 2.0.
 */

package org.openintegrationengine.plugins.communitystore;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;
import java.util.List;
import java.util.Map;
import java.util.UUID;


import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mirth.connect.model.Channel;
import com.mirth.connect.model.ServerEvent;
import com.mirth.connect.model.ServerEventContext;
import com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties;
import com.mirth.connect.model.codetemplates.CodeTemplate;
import com.mirth.connect.model.codetemplates.CodeTemplateContextSet;
import com.mirth.connect.model.codetemplates.CodeTemplateLibrary;
import com.mirth.connect.model.codetemplates.CodeTemplateProperties.CodeTemplateType;
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

    /**
     * Builds a ledger record for an install (or in-place upgrade — {@code recordInstall}
     * overwrites by id, which is exactly how an upgrade refreshes version + pristineHash).
     * {@code pristineHash} is the as-published content hash used for drift detection (see
     * {@link ContentHash}); null for extensions, which never get one.
     */
    private ObjectNode ledgerRecord(ObjectNode entry, String pristineHash) {
        ObjectNode record = com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode();
        record.put("name", entry.path("name").asText(""));
        record.put("type", entry.path("type").asText(""));
        record.put("version", entry.path("version").asText(""));
        record.put("repo", entry.path("repo").asText(""));
        record.put("repoUrl", entry.path("repoUrl").asText(""));
        record.put("contentId", entry.path("contentId").asText(""));
        if (pristineHash != null && !pristineHash.isEmpty()) {
            record.put("pristineHash", pristineHash);
            record.put("hashFormat", ContentHash.FORMAT_VERSION);
        }
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
            String actual = ContentHash.sha256Hex(artifact);
            if (!actual.equalsIgnoreCase(expected)) {
                throw new IOException("Checksum verification FAILED for " + assetName + ": expected " + expected + " but computed " + actual + ". The artifact was not installed.");
            }

            ExtensionPreflight.validate(artifact, id, entry.path("version").asText(""));

            ExtensionController extensionController = ControllerFactory.getFactory().createExtensionController();
            InstallationResult result = extensionController.extractExtension(new ByteArrayInputStream(artifact));
            if (result.getCause() != null) {
                throw new IOException("Engine installer rejected the extension: " + result.getCause().getMessage(), result.getCause());
            }

            dispatchEvent(EVENT_INSTALL, userId, Map.of("extension", id, "repo", repo, "tag", tag, "sha256", actual), ServerEvent.Outcome.SUCCESS);
            updateLedger(id, ledgerRecord(entry, null));

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

    /** Download outside the controller monitor; validate consent and mutate under its native write lock. */
    private ObjectNode installContent(ObjectNode entry, String type, String id, String repo, String tag,
            String assetUrl, String checksumUrl, Integer userId) throws Exception {
        byte[] artifact = gitHub.downloadAsset(assetUrl);
        String actual = ContentHash.sha256Hex(artifact);
        String inline = entry.path("sha256").asText("");
        String expected = !inline.isEmpty() ? inline : (!checksumUrl.isEmpty()
                ? parseChecksum(new String(gitHub.downloadAsset(checksumUrl), StandardCharsets.UTF_8)) : "");
        if (!expected.isEmpty() && !actual.equalsIgnoreCase(expected)) {
            throw new IOException("Checksum verification FAILED for " + id + ". Nothing was imported.");
        }
        ObjectXMLSerializer serializer = ObjectXMLSerializer.getInstance();
        String xml = new String(artifact, StandardCharsets.UTF_8);
        String mode = entry.path("mode").asText("install");
        boolean copy = "copy".equals(mode);
        String contentId = entry.path("contentId").asText("");
        String imported;
        String pristineHash = null;
        // Default engine controllers synchronize native writes on these exact singleton objects.
        // Holding that monitor across check + write also excludes native editor saves, not just store requests.
        Object monitor = "channel".equals(type)
                ? ControllerFactory.getFactory().createChannelController()
                : ControllerFactory.getFactory().createCodeTemplateController();
        synchronized (monitor) {
            if ("channel".equals(type)) {
                ChannelController controller = (ChannelController) monitor;
                Channel channel = serializer.deserialize(xml, Channel.class);
                if (!copy) requireContentIdMatch(contentId, channel.getId(), "channel");
                Channel existing = controller.getChannelById(channel.getId());
                ContentMutationGuard.check(type, mode, existing == null ? null : "present", "", false, false);
                if (copy) {
                    channel.setId(UUID.randomUUID().toString());
                    channel.setName(channel.getName() + " - copy");
                }
                if (!controller.updateChannel(channel, ServerEventContext.SYSTEM_USER_EVENT_CONTEXT, true, null)) {
                    throw new IOException("The engine refused the channel import.");
                }
                imported = "channel \"" + channel.getName() + "\"";
            } else {
                CodeTemplateController controller = (CodeTemplateController) monitor;
                if ("code-template-library".equals(type)) {
                    CodeTemplateLibrary library = serializer.deserialize(xml, CodeTemplateLibrary.class);
                    if (!copy) requireContentIdMatch(contentId, library.getId(), "library");
                    List<CodeTemplateLibrary> libraries = new ArrayList<>(controller.getLibraries(null, true));
                    CodeTemplateLibrary existing = null;
                    for (CodeTemplateLibrary candidate : libraries) if (candidate.getId().equals(library.getId())) existing = candidate;
                    checkContentConsent(entry, type, mode, existing, serializer);
                    Set<String> ownedMembers = new HashSet<>();
                    if (existing != null && existing.getCodeTemplates() != null) {
                        for (CodeTemplate member : existing.getCodeTemplates()) ownedMembers.add(member.getId());
                    }
                    if (copy) {
                        library.setId(UUID.randomUUID().toString());
                        library.setName(library.getName() + " - copy");
                    }
                    // Validate every member before writing any: an incoming library cannot seize
                    // templates outside the exact library state the user reviewed.
                    Set<String> members = new HashSet<>();
                    Set<String> names = new HashSet<>();
                    if (library.getCodeTemplates() == null) library.setCodeTemplates(new ArrayList<>());
                    for (CodeTemplate template : library.getCodeTemplates()) {
                        if (copy) template.setId(UUID.randomUUID().toString());
                        if (template.getId() == null || template.getId().isBlank() || !members.add(template.getId())
                                || !names.add(template.getName())) throw new IOException("Duplicate or missing library template identity/name.");
                        if (controller.getCodeTemplateById(template.getId()) != null && (copy || !ownedMembers.contains(template.getId()))) {
                            throw new IOException("An incoming template already exists outside this library. Install as a copy instead.");
                        }
                    }
                    for (CodeTemplateLibrary candidate : libraries) {
                        if (!candidate.getId().equals(library.getId()) && candidate.getName().equals(library.getName())) {
                            throw new IOException("A library with that name already exists. Choose another name in Code Templates.");
                        }
                    }
                    for (CodeTemplate template : library.getCodeTemplates()) {
                        if (!controller.updateCodeTemplate(template, ServerEventContext.SYSTEM_USER_EVENT_CONTEXT, true)) {
                            throw new IOException("The engine refused a library template write.");
                        }
                    }
                    libraries.removeIf(candidate -> candidate.getId().equals(library.getId()));
                    libraries.add(library);
                    if (!controller.updateLibraries(libraries, ServerEventContext.SYSTEM_USER_EVENT_CONTEXT, true)) {
                        throw new IOException("The engine refused the library import.");
                    }
                    if (!copy) {
                        for (CodeTemplateLibrary stored : controller.getLibraries(null, true)) {
                            if (stored.getId().equals(library.getId())) pristineHash = ContentHash.normalizedXmlHash(serializer.serialize(stored));
                        }
                    }
                    imported = "code template library \"" + library.getName() + "\"";
                } else if ("code-template".equals(type)) {
                    boolean rawJs = entry.path("assetName").asText("").endsWith(".js");
                    CodeTemplate template = rawJs ? wrapRawJsTemplate(contentId, entry.path("name").asText(id), xml)
                            : serializer.deserialize(xml, CodeTemplate.class);
                    if (!copy) requireContentIdMatch(contentId, template.getId(), "code template");
                    CodeTemplate existing = controller.getCodeTemplateById(template.getId());
                    checkContentConsent(entry, type, mode, existing, serializer);
                    if (copy) {
                        template.setId(UUID.randomUUID().toString());
                        template.setName(template.getName() + " - copy");
                    } else if ("upgrade".equals(mode) && rawJs) {
                        // Work on a detached copy; a rejected write must not mutate a cached object.
                        existing = serializer.deserialize(serializer.serialize(existing), CodeTemplate.class);
                        // Keep the user's name, context, and type when replacing plain JavaScript.
                        if (existing.getProperties() instanceof BasicCodeTemplateProperties) {
                            ((BasicCodeTemplateProperties) existing.getProperties()).setCode(xml);
                        } else {
                            existing.setProperties(new BasicCodeTemplateProperties(existing.getProperties() != null
                                    ? existing.getProperties().getType() : CodeTemplateType.FUNCTION, xml));
                        }
                        template = existing;
                    }
                    if ("upgrade".equals(mode)) {
                        if (!controller.updateCodeTemplate(template, ServerEventContext.SYSTEM_USER_EVENT_CONTEXT, true)) {
                            throw new IOException("The engine refused the template update.");
                        }
                    } else {
                        List<CodeTemplateLibrary> libraries = new ArrayList<>(controller.getLibraries(null, true));
                        String targetId = entry.path("targetLibraryId").asText("");
                        CodeTemplateLibrary target = null;
                        for (CodeTemplateLibrary candidate : libraries) if (candidate.getId().equals(targetId)) target = candidate;
                        if (target == null) {
                            if (!targetId.isEmpty()) throw new IOException("The selected library no longer exists. Refresh and choose again.");
                            String name = entry.path("newLibrary").asText("").trim();
                            if (name.isEmpty()) name = "Community Store";
                            for (CodeTemplateLibrary candidate : libraries) if (name.equals(candidate.getName())) {
                                throw new IOException("A library with that name already exists. Choose the existing library or a new name.");
                            }
                            target = new CodeTemplateLibrary();
                            target.setId(UUID.randomUUID().toString());
                            target.setName(name);
                            target.setCodeTemplates(new ArrayList<>());
                            libraries.add(target);
                        }
                        if (target.getCodeTemplates() == null) target.setCodeTemplates(new ArrayList<>());
                        for (CodeTemplate member : target.getCodeTemplates()) {
                            if (member.getId().equals(template.getId()) || member.getName().equals(template.getName())) {
                                throw new IOException("The target library already contains this template identity or name.");
                            }
                        }
                        // Destination validation precedes persistence, avoiding an orphan on a stale picker.
                        if (!controller.updateCodeTemplate(template, ServerEventContext.SYSTEM_USER_EVENT_CONTEXT, true)) {
                            throw new IOException("The engine refused the template import.");
                        }
                        target.getCodeTemplates().add(template);
                        if (!controller.updateLibraries(libraries, ServerEventContext.SYSTEM_USER_EVENT_CONTEXT, true)) {
                            throw new IOException("The engine refused library membership.");
                        }
                    }
                    if (!copy) pristineHash = ContentHash.normalizedXmlHash(serializer.serialize(controller.getCodeTemplateById(template.getId())));
                    imported = "code template \"" + template.getName() + "\"";
                } else {
                    throw new IOException("Unsupported content type: " + type);
                }
            }
            if (!copy) updateLedger(id, ledgerRecord(entry, pristineHash));
        }
        dispatchEvent(EVENT_INSTALL, userId, Map.of("extension", id, "repo", repo, "tag", tag, "sha256", actual), ServerEvent.Outcome.SUCCESS);
        ObjectNode response = entry.objectNode();
        response.put("installed", true);
        response.put("id", id);
        response.put("tag", tag);
        response.put("sha256", actual);
        response.put("restartRequired", false);
        response.put("imported", imported);
        return response;
    }

    private void checkContentConsent(ObjectNode entry, String type, String mode, Object existing,
            ObjectXMLSerializer serializer) throws IOException {
        if ("copy".equals(mode)) return; // Copies never replace existing content or require overwrite consent.
        String state = existing == null ? null : ContentHash.stateHash(serializer.serialize(existing));
        com.fasterxml.jackson.databind.JsonNode record = settings.getInstallLedger().get(entry.path("id").asText());
        boolean modified = existing != null && (record == null
                || record.path("hashFormat").asInt(0) != ContentHash.FORMAT_VERSION
                || !ContentHash.normalizedXmlHash(serializer.serialize(existing)).equals(record.path("pristineHash").asText("")));
        ContentMutationGuard.check(type, mode, state, entry.path("expectedContentHash").asText(""),
                modified, entry.path("overwrite").asBoolean(false));
    }

    /**
     * Removes imported content from the engine — the content counterpart of removing an
     * extension from the Extensions page. Per type:
     * code-template: deletes the template record and drops its library membership;
     * code-template-library: deletes the library AND its current member templates (the same
     * semantics as deleting a library in the Code Templates view);
     * channel: REFUSED — channels are a snapshot gallery the store imports but never
     * deletes. Deleting a channel (and its message history) is an explicit decision made
     * in the Channels view, where deployment state is in front of the operator.
     * Always clears the install ledger record (channels excepted — they are never removed,
     * and the ledger record keeps powering newer-snapshot detection).
     */
    public ObjectNode removeContent(String id, String type, String contentId, Integer userId) throws Exception {
        if ("channel".equals(type)) {
            // Rejected server-side so the two UIs can never diverge on this rule.
            throw new IOException("Channels are removed from the Channels view (undeploy first), not from the store.");
        }
        if (contentId == null || contentId.isEmpty()) {
            throw new IOException("No engine id is known for '" + id + "', so the store cannot remove it. Delete it from its native view instead.");
        }
        String removed;
        if ("code-template-library".equals(type)) {
            CodeTemplateController controller = ControllerFactory.getFactory().createCodeTemplateController();
            synchronized (controller) {
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
            synchronized (controller) {
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
            throw new IOException("Only code templates and code template libraries can be removed through the store.");
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
        if (declared.isBlank() || actual == null || !declared.equals(actual)) {
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

    /**
     * Wraps a raw .js artifact into a code template. Identity is constructed rather than read
     * from the artifact: the id is the manifest's contentId and the name is the catalog name.
     * The file contents become the code verbatim — the engine itself derives the description
     * from the leading JSDoc block (CodeTemplateUtil) — with the engine's default FUNCTION
     * type and connector context set, matching CodeTemplate.getDefaultCodeTemplate.
     */
    private static CodeTemplate wrapRawJsTemplate(String contentId, String name, String code) throws IOException {
        if (contentId.isEmpty()) {
            throw new IOException("A raw .js code template artifact requires a contentId in its manifest — it becomes the template's engine id.");
        }
        CodeTemplate template = new CodeTemplate(contentId);
        template.setName(name);
        template.setRevision(1);
        template.setContextSet(CodeTemplateContextSet.getConnectorContextSet());
        template.setProperties(new BasicCodeTemplateProperties(CodeTemplateType.FUNCTION, code));
        return template;
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
