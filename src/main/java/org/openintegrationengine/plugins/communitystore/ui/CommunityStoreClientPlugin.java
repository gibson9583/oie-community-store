/*
 * OIE Community Store — Swing Administrator client.
 *
 * Published under the terms of the Mozilla Public License 2.0.
 */

package org.openintegrationengine.plugins.communitystore.ui;

import com.mirth.connect.client.ui.AbstractSettingsPanel;
import com.mirth.connect.plugins.SettingsPanelPlugin;

import org.openintegrationengine.plugins.communitystore.CommunityStoreServletInterface;

/**
 * Registration entry point for the Community Store's Swing Administrator UI. Adds a
 * "Community Store" tab to the Administrator's Settings area, hosting {@link CommunityStorePanel}.
 *
 * <p>This is the Swing counterpart of the web frontend's top-level nav item. Mirth instantiates
 * client plugins reflectively via a single-{@code String} constructor, so this class is public
 * and named in {@code plugin.xml}'s {@code <clientClasses>} — the marker the catalog builder
 * keys on to derive {@code "swing"} into this package's {@code ui} array.
 */
public class CommunityStoreClientPlugin extends SettingsPanelPlugin {

    public CommunityStoreClientPlugin(String name) {
        super(CommunityStoreServletInterface.PLUGIN_POINT);
    }

    @Override
    public String getPluginPointName() {
        return CommunityStoreServletInterface.PLUGIN_POINT;
    }

    @Override
    public AbstractSettingsPanel getSettingsPanel() {
        return new CommunityStorePanel(CommunityStoreServletInterface.PLUGIN_POINT);
    }

    @Override
    public void start() {
    }

    @Override
    public void stop() {
    }

    @Override
    public void reset() {
    }
}
