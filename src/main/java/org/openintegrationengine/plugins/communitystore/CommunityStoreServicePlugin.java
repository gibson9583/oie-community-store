/*
 * OIE Community Store
 *
 * Published under the terms of the Mozilla Public License 2.0.
 */

package org.openintegrationengine.plugins.communitystore;

import java.util.Properties;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import com.mirth.connect.model.ExtensionPermission;
import com.mirth.connect.plugins.ServicePlugin;
import com.mirth.connect.server.controllers.ConfigurationController;

/**
 * Engine-side service plugin for the Community Store. Owns the settings, the GitHub client, and
 * the catalog/install services consumed by {@link CommunityStoreServlet}. The store deliberately
 * declares no permissions of its own: every operation is gated by the engine's existing
 * "manage extensions" permission, so store access is exactly extension-install access.
 */
public class CommunityStoreServicePlugin implements ServicePlugin {

    public static final String PLUGIN_POINT = "Community Store";

    private static final Logger logger = LogManager.getLogger(CommunityStoreServicePlugin.class);

    private final StoreSettings settings = new StoreSettings();
    private final GitHubClient gitHub = new GitHubClient(this::decryptedToken);
    private final CatalogService catalogService = new CatalogService(gitHub, settings);
    private final InstallService installService = new InstallService(gitHub, settings);

    @Override
    public String getPluginPointName() {
        return PLUGIN_POINT;
    }

    @Override
    public void init(Properties properties) {
        settings.loadBundled();
        settings.apply(properties);
        logger.info("Community Store initialized with " + settings.getEffectiveSources().size() + " source(s).");
    }

    @Override
    public void update(Properties properties) {
        settings.apply(properties);
    }

    @Override
    public Properties getDefaultProperties() {
        Properties defaults = new Properties();
        defaults.setProperty(StoreSettings.PROP_CUSTOM_SOURCES, "[]");
        defaults.setProperty(StoreSettings.PROP_LOCAL_BLOCKLIST, "[]");
        defaults.setProperty(StoreSettings.PROP_BETA_CHANNEL, "false");
        defaults.setProperty(StoreSettings.PROP_GITHUB_TOKEN_ENC, "");
        defaults.setProperty(StoreSettings.PROP_SYNC_TTL_MINUTES, "15");
        defaults.setProperty(StoreSettings.PROP_INSTALL_LEDGER, "{}");
        return defaults;
    }

    @Override
    public ExtensionPermission[] getExtensionPermissions() {
        // Dedicated store permissions, enforced by an authorization plugin (e.g.
        // RBAC) and surfaced in its role editor under this plugin's header. The
        // engine's default controller ignores these — without RBAC installed,
        // everything stays visible and permitted. operationNames must match the
        // @MirthOperation names in CommunityStoreServletInterface; taskNames gate
        // the UIs (web nav + buttons) through the extension task-permission merge.
        return new ExtensionPermission[] {
                new ExtensionPermission(PLUGIN_POINT,
                        CommunityStoreServletInterface.PERMISSION_VIEW,
                        "Browse the Community Store catalog and read publisher documentation.",
                        new String[] { "getCommunityStoreCatalog", "getCommunityStoreDocs" },
                        new String[] { "doShowCommunityStore" }),
                new ExtensionPermission(PLUGIN_POINT,
                        CommunityStoreServletInterface.PERMISSION_MANAGE,
                        "Install, update, and remove Community Store content and edit store settings."
                                + " Content installs (channels, code templates) run through the engine's"
                                + " controllers, so this permission alone authorizes them.",
                        new String[] { "getCommunityStoreSettings", "setCommunityStoreSettings",
                                "removeCommunityStoreContent", "installCommunityStoreExtension" },
                        new String[] { "doInstallStoreItem", "doRemoveStoreContent", "doEditStoreSettings" })
        };
    }

    @Override
    public void start() {}

    @Override
    public void stop() {}

    private String decryptedToken() {
        String encrypted = settings.getEncryptedToken();
        if (encrypted == null || encrypted.isBlank()) {
            return null;
        }
        try {
            return ConfigurationController.getInstance().getEncryptor().decrypt(encrypted);
        } catch (Exception e) {
            logger.warn("Community Store: failed to decrypt the stored GitHub token; proceeding unauthenticated.");
            return null;
        }
    }

    public StoreSettings getSettings() {
        return settings;
    }

    public GitHubClient getGitHub() {
        return gitHub;
    }

    public CatalogService getCatalogService() {
        return catalogService;
    }

    public InstallService getInstallService() {
        return installService;
    }
}
