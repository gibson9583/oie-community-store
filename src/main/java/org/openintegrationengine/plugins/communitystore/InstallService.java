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

            preflight(artifact, id);

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

    /**
     * Imports a content artifact — a channel, code template library, or standalone code template —
     * through the engine's controllers (not the extension installer). These take effect immediately
     * (no restart) and live in the channel / code-template stores. For a standalone code template
     * the caller supplies a target library on the entry: {@code targetLibraryId} to add to an
     * existing library, or {@code newLibrary} to create one. A checksum is verified when present.
     *
     * The optional {@code mode} on the entry selects the operation — the decision logic lives
     * here so the web and Swing UIs behave identically:
     * "install" (default) — first install / re-import under the manifest's contentId;
     * "upgrade" — in-place update of the installed object(s) with the manifest contentId,
     * library membership untouched, no library param; REFUSED for channels (snapshot-only);
     * "copy" — import under fresh engine id(s) with the name suffixed " (copy)", leaving the
     * canonical installed content alone. A copy is untracked user content: no ledger record.
     *
     * A code template whose artifact is a raw .js file (rather than engine XML) is wrapped into
     * a CodeTemplate server-side — see {@link #wrapRawJsTemplate}.
     */
    private ObjectNode installContent(ObjectNode entry, String type, String id, String repo, String tag,
            String assetUrl, String checksumUrl, Integer userId) throws Exception {
        String mode = entry.path("mode").asText("install");
        if (!"install".equals(mode) && !"upgrade".equals(mode) && !"copy".equals(mode)) {
            throw new IOException("Unknown install mode '" + mode + "'. Expected install, upgrade, or copy.");
        }
        if ("upgrade".equals(mode) && "channel".equals(type)) {
            throw new IOException("Channels are snapshot-only and cannot be upgraded in place — the installed channel may carry local changes the store cannot merge. Install the newer snapshot as a copy instead.");
        }
        boolean copy = "copy".equals(mode);
        boolean upgrade = "upgrade".equals(mode);

        byte[] artifact = gitHub.downloadAsset(assetUrl);
        String actual = ContentHash.sha256Hex(artifact);
        String inlineSha256 = entry.path("sha256").asText("");
        String expected = !inlineSha256.isEmpty() ? inlineSha256
                : (!checksumUrl.isEmpty() ? parseChecksum(new String(gitHub.downloadAsset(checksumUrl), StandardCharsets.UTF_8)) : "");
        if (!expected.isEmpty() && !actual.equalsIgnoreCase(expected)) {
            throw new IOException("Checksum verification FAILED for " + id + ": expected " + expected + " but computed " + actual + ". Nothing was imported.");
        }
        String xml = new String(artifact, StandardCharsets.UTF_8);
        ObjectXMLSerializer serializer = ObjectXMLSerializer.getInstance();
        String imported;
        // The as-published content hash, recorded in the ledger so the catalog can detect local
        // drift ("modified") later. Stays null for copies — they are untracked by design.
        String pristineHash = null;

        String declaredContentId = entry.path("contentId").asText("");
        if ("channel".equals(type)) {
            Channel channel = serializer.deserialize(xml, Channel.class);
            ChannelController controller = ControllerFactory.getFactory().createChannelController();
            if (copy) {
                // Snapshot import alongside the canonical channel: a fresh engine id and a
                // distinguishing name, never touching what's installed. The engine enforces
                // unique channel names, so a second identical copy is rejected there.
                channel.setId(UUID.randomUUID().toString());
                channel.setName(channel.getName() + " (copy)");
            } else {
                requireContentIdMatch(declaredContentId, channel.getId(), "channel");
            }
            controller.updateChannel(channel, ServerEventContext.SYSTEM_USER_EVENT_CONTEXT, true, null);
            if (!copy) {
                // Hash what the engine actually STORED, not the artifact bytes: updateChannel
                // strips <exportData> (its metadata/tags move into server config) and the
                // resolve-time live hash serializes with THIS engine's version stamp — hashing
                // the artifact would flag every real-world export as "modified" from the first
                // resolve. Reading the channel back makes the two hashes match by construction.
                Channel stored = controller.getChannelById(channel.getId());
                pristineHash = ContentHash.normalizedXmlHash(serializer.serialize(stored != null ? stored : channel));
            }
            imported = "channel \"" + channel.getName() + "\"";
        } else if ("code-template-library".equals(type)) {
            CodeTemplateLibrary library = serializer.deserialize(xml, CodeTemplateLibrary.class);
            if (copy) {
                // Fresh ids all the way down — the library AND its member templates — so the
                // copy can never overwrite the canonical installed templates. The engine
                // enforces unique library names, hence the suffix.
                library.setId(UUID.randomUUID().toString());
                library.setName(library.getName() + " (copy)");
                if (library.getCodeTemplates() != null) {
                    for (CodeTemplate template : library.getCodeTemplates()) {
                        template.setId(UUID.randomUUID().toString());
                    }
                }
            } else {
                // "upgrade" and "install" are the same in-place merge here: the library object
                // IS the content, and replacing it by id is what both modes mean.
                requireContentIdMatch(declaredContentId, library.getId(), "code template library");
            }
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
                if (!copy) {
                    // As with channels: hash the library as the STORE returns it (member
                    // templates swapped in from the template store, THIS engine's version
                    // stamp), not the artifact bytes — the resolve-time drift check hashes
                    // exactly this shape. Not found degrades to no hash = legacy pristine.
                    for (CodeTemplateLibrary stored : controller.getLibraries(null, true)) {
                        if (stored.getId().equals(library.getId())) {
                            pristineHash = ContentHash.normalizedXmlHash(serializer.serialize(stored));
                            break;
                        }
                    }
                }
            }
            imported = "code template library \"" + library.getName() + "\"";
        } else if ("code-template".equals(type) && upgrade) {
            CodeTemplate template = upgradeCodeTemplate(declaredContentId, entry.path("assetName").asText("").endsWith(".js"), xml, serializer);
            pristineHash = ContentHash.codeHash(template.getCode());
            imported = "code template \"" + template.getName() + "\" (upgraded in place)";
        } else if ("code-template".equals(type)) {
            CodeTemplateController controller = ControllerFactory.getFactory().createCodeTemplateController();
            CodeTemplate template;
            if (entry.path("assetName").asText("").endsWith(".js")) {
                // Raw JavaScript artifact: identity is constructed from the manifest, so the
                // XML id-match check does not apply.
                template = wrapRawJsTemplate(declaredContentId, entry.path("name").asText(id), xml);
            } else {
                template = serializer.deserialize(xml, CodeTemplate.class);
                if (!copy) {
                    requireContentIdMatch(declaredContentId, template.getId(), "code template");
                }
            }
            if (copy) {
                // Fresh identity, canonical template untouched. The engine rejects a duplicate
                // name only within one library, but a copy usually lands next to its original —
                // the suffix keeps the advertised "install as new copy" flow working there too.
                template.setId(UUID.randomUUID().toString());
                template.setName(template.getName() + " (copy)");
            } else {
                pristineHash = ContentHash.codeHash(template.getCode());
            }

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
        // A copy is deliberately untracked: it belongs to the user, not to the store's
        // installed-state, drift, or revocation bookkeeping.
        if (!copy) {
            updateLedger(id, ledgerRecord(entry, pristineHash));
        }

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

    /**
     * In-place upgrade of an installed standalone code template: the object with the manifest
     * contentId is replaced by the artifact's — or, for a raw .js artifact, ONLY its code, so
     * the user's name / context / type adjustments survive. Library membership is deliberately
     * untouched: no library prompt applies, and the template must not move or duplicate.
     */
    private CodeTemplate upgradeCodeTemplate(String contentId, boolean rawJs, String artifactText,
            ObjectXMLSerializer serializer) throws Exception {
        CodeTemplateController controller = ControllerFactory.getFactory().createCodeTemplateController();
        CodeTemplate existing = contentId.isEmpty() ? null : controller.getCodeTemplateById(contentId);
        if (existing == null) {
            throw new IOException("The code template is not installed on this engine, so there is nothing to upgrade. Install it instead.");
        }
        CodeTemplate template;
        if (rawJs) {
            if (existing.getProperties() instanceof BasicCodeTemplateProperties) {
                ((BasicCodeTemplateProperties) existing.getProperties()).setCode(artifactText);
            } else {
                existing.setProperties(new BasicCodeTemplateProperties(
                        existing.getProperties() != null ? existing.getProperties().getType() : CodeTemplateType.FUNCTION, artifactText));
            }
            template = existing;
        } else {
            template = serializer.deserialize(artifactText, CodeTemplate.class);
            requireContentIdMatch(contentId, template.getId(), "code template");
        }
        controller.updateCodeTemplate(template, ServerEventContext.SYSTEM_USER_EVENT_CONTEXT, true);
        return template;
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
