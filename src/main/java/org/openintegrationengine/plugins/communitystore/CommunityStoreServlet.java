/*
 * OIE Community Store
 *
 * Published under the terms of the Mozilla Public License 2.0.
 */

package org.openintegrationengine.plugins.communitystore;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Properties;
import java.util.Set;

import javax.servlet.http.HttpServletRequest;
import javax.ws.rs.core.Context;
import javax.ws.rs.core.SecurityContext;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mirth.connect.client.core.ClientException;
import com.mirth.connect.server.api.MirthServlet;
import com.mirth.connect.server.controllers.ConfigurationController;
import com.mirth.connect.server.controllers.ControllerFactory;
import com.mirth.connect.server.controllers.ExtensionController;

public class CommunityStoreServlet extends MirthServlet implements CommunityStoreServletInterface {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /**
     * Resolved lazily (and cached) rather than at class-init: if this servlet class loads
     * before the service plugin registers — plausible mid-restart during a self-update —
     * a static lookup would pin {@code null} forever and NPE every request until another
     * restart. Lazy resolution retries until the plugin is available.
     */
    private static volatile CommunityStoreServicePlugin plugin;

    private static CommunityStoreServicePlugin plugin() throws ClientException {
        CommunityStoreServicePlugin resolved = plugin;
        if (resolved == null) {
            resolved = (CommunityStoreServicePlugin) ControllerFactory.getFactory().createExtensionController().getServicePlugins().get(PLUGIN_POINT);
            if (resolved == null) {
                throw new ClientException("The Community Store service plugin is not loaded yet. If the engine is mid-restart, retry shortly.");
            }
            plugin = resolved;
        }
        return resolved;
    }

    public CommunityStoreServlet(@Context HttpServletRequest request, @Context SecurityContext sc) {
        super(request, sc, PLUGIN_POINT);
    }

    @Override
    public String getCatalog(boolean refresh) throws ClientException {
        try {
            return plugin().getCatalogService().getCatalog(refresh).toString();
        } catch (Exception e) {
            throw new ClientException("Failed to build the Community Store catalog: " + e.getMessage(), e);
        }
    }

    @Override
    public String getDocs(String id) throws ClientException {
        try {
            return plugin().getCatalogService().getDocs(id).toString();
        } catch (Exception e) {
            throw new ClientException("Failed to fetch documentation: " + e.getMessage(), e);
        }
    }

    @Override
    public String getSettings() throws ClientException {
        try {
            StoreSettings settings = plugin().getSettings();
            ObjectNode response = MAPPER.createObjectNode();

            ArrayNode bundled = response.putArray("bundledSources");
            for (StoreSettings.SourceDef def : settings.getBundledSources()) {
                bundled.add(def.toJson());
            }
            ArrayNode custom = response.putArray("customSources");
            for (StoreSettings.SourceDef def : settings.getCustomSources()) {
                custom.add(def.toJson());
            }
            ArrayNode bundledBlock = response.putArray("bundledBlocklist");
            for (String entry : settings.getBundledBlocklist()) {
                bundledBlock.add(entry);
            }
            ArrayNode localBlock = response.putArray("localBlocklist");
            for (String entry : settings.getLocalBlocklist()) {
                localBlock.add(entry);
            }
            response.put("betaChannel", settings.isBetaChannel());
            response.put("syncTtlMinutes", settings.getSyncTtlMinutes());
            response.put("tokenSet", settings.getEncryptedToken() != null && !settings.getEncryptedToken().isBlank());
            response.put("rateLimitRemaining", plugin().getGitHub().getRateLimitRemaining());
            return response.toString();
        } catch (Exception e) {
            throw new ClientException("Failed to read Community Store settings: " + e.getMessage(), e);
        }
    }

    @Override
    public String setSettings(String settingsJson) throws ClientException {
        try {
            JsonNode body = MAPPER.readTree(settingsJson);
            StoreSettings settings = plugin().getSettings();

            if (body.has("customSources")) {
                List<StoreSettings.SourceDef> custom = new ArrayList<>();
                for (JsonNode node : body.path("customSources")) {
                    StoreSettings.SourceDef def = StoreSettings.SourceDef.fromJson(node);
                    if (def != null) {
                        custom.add(def);
                    }
                }
                settings.setCustomSources(custom);
            }
            if (body.has("localBlocklist")) {
                Set<String> block = new HashSet<>();
                for (JsonNode node : body.path("localBlocklist")) {
                    String entry = node.asText().trim().toLowerCase();
                    if (entry.matches("[\\w.-]+/[\\w.-]+")) {
                        block.add(entry);
                    }
                }
                settings.setLocalBlocklist(block);
            }
            if (body.has("betaChannel")) {
                settings.setBetaChannel(body.path("betaChannel").asBoolean(false));
            }
            // Token semantics: absent = unchanged, empty string = clear, value = replace (stored encrypted).
            if (body.has("token")) {
                String token = body.path("token").asText("");
                settings.setEncryptedToken(token.isBlank() ? "" : ConfigurationController.getInstance().getEncryptor().encrypt(token.trim()));
            }

            // Persist to the database AND apply to the running plugin. setPluginProperties writes
            // the properties to durable storage (so they survive a restart); updatePluginProperties
            // only round-trips through ServicePlugin.update() in memory, which alone would be lost
            // on restart.
            Properties props = settings.toProperties();
            ExtensionController extensionController = ControllerFactory.getFactory().createExtensionController();
            extensionController.setPluginProperties(PLUGIN_POINT, props);
            extensionController.updatePluginProperties(PLUGIN_POINT, props);

            return getSettings();
        } catch (ClientException e) {
            throw e;
        } catch (Exception e) {
            throw new ClientException("Failed to update Community Store settings: " + e.getMessage(), e);
        }
    }

    @Override
    public String install(String requestJson) throws ClientException {
        try {
            JsonNode body = MAPPER.readTree(requestJson);
            String id = body.path("id").asText(null);
            if (id == null || id.isBlank()) {
                throw new ClientException("An 'id' is required.");
            }
            ObjectNode entry = plugin().getCatalogService().findEntry(id);
            if (entry == null) {
                throw new ClientException("No catalog entry found for id '" + id + "'. Refresh the catalog and try again.");
            }
            // Optional pin: only proceed when the resolved tag matches what the user confirmed.
            String tag = body.path("tag").asText(null);
            if (tag != null && !tag.isBlank() && !tag.equals(entry.path("tag").asText())) {
                throw new ClientException("The catalog now resolves '" + id + "' to " + entry.path("tag").asText() + " but the request pinned " + tag + ". Refresh and confirm again.");
            }
            // A standalone code template is imported into a library the user chose in the
            // install dialog: an existing library id, or a name for a new one.
            if (body.has("targetLibraryId")) {
                entry.put("targetLibraryId", body.path("targetLibraryId").asText(""));
            }
            if (body.has("newLibrary")) {
                entry.put("newLibrary", body.path("newLibrary").asText(""));
            }
            return plugin().getInstallService().install(entry, getCurrentUserId()).toString();
        } catch (ClientException e) {
            throw e;
        } catch (Exception e) {
            throw new ClientException("Install failed: " + e.getMessage(), e);
        }
    }

}
