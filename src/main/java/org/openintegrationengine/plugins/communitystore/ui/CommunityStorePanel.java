/*
 * OIE Community Store — Swing Administrator client.
 *
 * Published under the terms of the Mozilla Public License 2.0.
 */

package org.openintegrationengine.plugins.communitystore.ui;

import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.util.ArrayList;
import java.util.List;

import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JComboBox;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JSplitPane;
import javax.swing.JTextField;
import javax.swing.ListSelectionModel;
import javax.swing.SwingWorker;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;

import com.fasterxml.jackson.databind.JsonNode;

import org.jdesktop.swingx.decorator.HighlighterFactory;

import com.mirth.connect.client.ui.AbstractSettingsPanel;
import com.mirth.connect.client.ui.PlatformUI;
import com.mirth.connect.client.ui.UIConstants;
import com.mirth.connect.client.ui.components.MirthTable;

/**
 * The Community Store browse panel, hosted as a Settings-area tab. Lists catalog entries in a
 * table (left), shows publisher documentation and a details block (right), and offers
 * Install / Update / Install as Copy / Remove actions in a bottom button bar.
 *
 * <p>All engine calls go through {@link StoreServletClient} off the EDT ({@link SwingWorker});
 * UI mutations happen only in {@code done()}. The shared-contract UI surface filter
 * ({@link SurfaceFilter#SWING}) is applied first, before search / type / installed filters, so
 * swing-excluded entries never leak into the table, the type dropdown, or the counts.
 */
class CommunityStorePanel extends AbstractSettingsPanel {

    private static final String ALL_TYPES = "All types";

    private final StoreServletClient client = new StoreServletClient();

    private MirthTable table;
    private StoreEntryTableModel model;
    private StoreDocsPanel docsPanel;
    private DetailsPanel detailsPanel;

    private JTextField searchField;
    private JComboBox<String> typeCombo;
    private JCheckBox installedOnly;
    private JLabel countLabel;

    private JButton installButton;
    private JButton updateButton;
    private JButton copyButton;
    private JButton removeButton;
    private JButton settingsButton;

    /** All swing-visible entries from the last refresh; every filter/count derives from this. */
    private List<StoreEntry> masterList = new ArrayList<>();

    CommunityStorePanel(String tabName) {
        super(tabName);
        initComponents();
    }

    private void initComponents() {
        setLayout(new BorderLayout());

        add(buildToolbar(), BorderLayout.NORTH);
        add(buildCenter(), BorderLayout.CENTER);
        add(buildButtonBar(), BorderLayout.SOUTH);

        updateButtonStates();
    }

    private JPanel buildToolbar() {
        JPanel toolbar = new JPanel(new FlowLayout(FlowLayout.LEFT));

        toolbar.add(new JLabel("Filter:"));
        searchField = new JTextField(18);
        searchField.getDocument().addDocumentListener(new DocumentListener() {
            @Override public void insertUpdate(DocumentEvent e) { applyFilter(); }
            @Override public void removeUpdate(DocumentEvent e) { applyFilter(); }
            @Override public void changedUpdate(DocumentEvent e) { applyFilter(); }
        });
        toolbar.add(searchField);

        toolbar.add(new JLabel("  Type:"));
        typeCombo = new JComboBox<>();
        typeCombo.addItem(ALL_TYPES);
        typeCombo.addActionListener(e -> applyFilter());
        toolbar.add(typeCombo);

        installedOnly = new JCheckBox("Installed only");
        installedOnly.addActionListener(e -> applyFilter());
        toolbar.add(installedOnly);

        countLabel = new JLabel();
        toolbar.add(countLabel);

        return toolbar;
    }

    private JSplitPane buildCenter() {
        table = new MirthTable();
        table.setHighlighters(HighlighterFactory.createAlternateStriping(
                UIConstants.HIGHLIGHTER_COLOR, UIConstants.BACKGROUND_COLOR));
        table.setSortable(true);
        table.setRowSelectionAllowed(true);
        table.setColumnSelectionAllowed(false);
        table.setSelectionMode(ListSelectionModel.SINGLE_SELECTION);

        model = new StoreEntryTableModel(new ArrayList<>());
        table.setModel(model);

        table.getSelectionModel().addListSelectionListener(e -> {
            if (!e.getValueIsAdjusting()) {
                StoreEntry entry = selectedEntry();
                docsPanel.load(entry);
                detailsPanel.show(entry);
                updateButtonStates();
            }
        });

        JScrollPane tableScroll = new JScrollPane(table);
        tableScroll.setPreferredSize(new Dimension(560, 400));

        docsPanel = new StoreDocsPanel(client);
        detailsPanel = new DetailsPanel();

        JPanel right = new JPanel(new BorderLayout());
        right.add(detailsPanel, BorderLayout.NORTH);
        right.add(docsPanel, BorderLayout.CENTER);

        JSplitPane split = new JSplitPane(JSplitPane.HORIZONTAL_SPLIT, tableScroll, right);
        split.setResizeWeight(0.6);
        split.setDividerLocation(560);
        return split;
    }

    private JPanel buildButtonBar() {
        JPanel bar = new JPanel(new BorderLayout());

        // Settings is panel-scoped and always enabled, unlike the selection-scoped actions
        // on the right, so it sits alone on the left and updateButtonStates() never touches it.
        JPanel left = new JPanel(new FlowLayout(FlowLayout.LEFT));
        settingsButton = new JButton("Settings…");
        settingsButton.addActionListener(e -> openSettings());
        left.add(settingsButton);
        bar.add(left, BorderLayout.WEST);

        JPanel right = new JPanel(new FlowLayout(FlowLayout.RIGHT));

        installButton = new JButton("Install");
        installButton.setEnabled(false);
        installButton.addActionListener(e -> installSelected());
        right.add(installButton);

        updateButton = new JButton("Update");
        updateButton.setEnabled(false);
        updateButton.addActionListener(e -> updateSelected());
        right.add(updateButton);

        copyButton = new JButton("Install as Copy");
        copyButton.setEnabled(false);
        copyButton.addActionListener(e -> installChannelCopy());
        right.add(copyButton);

        removeButton = new JButton("Remove");
        removeButton.setEnabled(false);
        removeButton.addActionListener(e -> remove());
        right.add(removeButton);

        bar.add(right, BorderLayout.EAST);

        return bar;
    }

    // ---------------------------------------------------------------------
    // Load / filter
    // ---------------------------------------------------------------------

    @Override
    public void doRefresh() {
        doRefresh(false);
    }

    /** Reloads the catalog; {@code force} bypasses the engine's sync TTL (used after a settings save). */
    private void doRefresh(boolean force) {
        new SwingWorker<JsonNode, Void>() {
            @Override
            protected JsonNode doInBackground() throws Exception {
                return client.catalog(force);
            }

            @Override
            protected void done() {
                try {
                    rebuild(get());
                } catch (Exception e) {
                    PlatformUI.MIRTH_FRAME.alertThrowable(CommunityStorePanel.this, StoreServletClient.unwrap(e));
                }
            }
        }.execute();
    }

    @Override
    public boolean doSave() {
        // Browse panel has nothing to persist; installs happen through the action buttons.
        return true;
    }

    /** Rebuilds the master list from a fresh catalog, applying the Swing surface filter FIRST. */
    private void rebuild(JsonNode catalog) {
        List<StoreEntry> all = new ArrayList<>();
        JsonNode entries = catalog.path("entries");
        if (entries.isArray()) {
            for (JsonNode node : entries) {
                // Shared-contract filter: hide entries whose non-empty ui excludes "swing";
                // show ui-less entries and content always. (Separate from engine compat.)
                if (!SurfaceFilter.isVisibleForSurface(node, SurfaceFilter.SWING)) {
                    continue;
                }
                all.add(StoreEntry.from(node));
            }
        }
        this.masterList = all;

        // Rebuild the type dropdown off the visible set only.
        String previousType = (String) typeCombo.getSelectedItem();
        typeCombo.removeAllItems();
        typeCombo.addItem(ALL_TYPES);
        for (String type : StoreEntryTableModel.TYPE_ORDER) {
            for (StoreEntry e : all) {
                if (type.equals(e.type)) {
                    typeCombo.addItem(StoreEntryTableModel.label(type));
                    break;
                }
            }
        }
        if (previousType != null) {
            typeCombo.setSelectedItem(previousType);
        }

        applyFilter();
    }

    private void applyFilter() {
        String search = searchField.getText().trim().toLowerCase();
        String typeLabel = (String) typeCombo.getSelectedItem();
        boolean onlyInstalled = installedOnly.isSelected();

        List<StoreEntry> filtered = new ArrayList<>();
        for (StoreEntry e : masterList) {
            if (e.revoked) {
                continue; // revoked entries are not browseable
            }
            if (onlyInstalled && !e.isInstalled()) {
                continue;
            }
            if (typeLabel != null && !ALL_TYPES.equals(typeLabel)
                    && !typeLabel.equals(StoreEntryTableModel.label(e.type))) {
                continue;
            }
            if (!search.isEmpty() && !matchesSearch(e, search)) {
                continue;
            }
            filtered.add(e);
        }

        model.setEntries(filtered);
        countLabel.setText("   " + filtered.size() + " of " + masterList.size() + " item(s)");
        docsPanel.clear();
        detailsPanel.show(null);
        updateButtonStates();
    }

    private static boolean matchesSearch(StoreEntry e, String needle) {
        StringBuilder sb = new StringBuilder();
        sb.append(e.name).append(' ').append(e.description).append(' ').append(e.repo);
        for (String k : e.keywords) {
            sb.append(' ').append(k);
        }
        return sb.toString().toLowerCase().contains(needle);
    }

    private StoreEntry selectedEntry() {
        int row = table.getSelectedRow();
        if (row < 0) {
            return null;
        }
        return model.getEntryAt(table.convertRowIndexToModel(row));
    }

    private void updateButtonStates() {
        StoreEntry e = selectedEntry();
        if (e == null) {
            installButton.setText("Install");
            installButton.setEnabled(false);
            updateButton.setEnabled(false);
            copyButton.setEnabled(false);
            removeButton.setEnabled(false);
            return;
        }
        // Installed content (never channels — snapshot-only) with no newer version can be
        // re-imported through the drift gate; the button relabels so the affordance
        // matches the web details pane exactly.
        boolean reimport = e.isContent() && e.isInstalled() && !"channel".equals(e.type) && !e.updateAvailable;
        installButton.setText(reimport ? "Re-import" : "Install");
        installButton.setEnabled(e.installable && e.compatible && (!e.isInstalled() || reimport));
        // Channels are snapshot-only: the server already forces updateAvailable=false for
        // them, but the gate is explicit so Update can never appear for a channel.
        updateButton.setEnabled(e.updateAvailable && !"channel".equals(e.type));
        // A newer channel snapshot can only be brought in as an untracked copy.
        copyButton.setEnabled("channel".equals(e.type) && !e.newerSnapshot.isEmpty());
        // Only installed content can be removed store-side; extensions go through the
        // engine's native Extensions page, exactly as the web UI does.
        removeButton.setEnabled(e.isContent() && e.isInstalled());
    }

    // ---------------------------------------------------------------------
    // Actions
    // ---------------------------------------------------------------------

    /**
     * Install-button flow: a fresh entry installs; installed content re-imports through
     * the same drift gate as Update, mirroring the web details pane exactly. Channels
     * never get here installed (the button stays disabled for them — snapshot-only).
     */
    private void installSelected() {
        final StoreEntry e = selectedEntry();
        if (e == null) {
            return;
        }
        if (e.isContent() && e.isInstalled() && !"channel".equals(e.type)) {
            confirmContentReplace(e);
            return;
        }
        install(false);
    }

    private void install(boolean update) {
        final StoreEntry e = selectedEntry();
        if (e == null) {
            return;
        }

        // A fresh standalone code-template must be placed in a library; ask which one.
        // Updates / re-imports keep their existing membership, so skip the dialog.
        String newLibrary = null;
        String targetLibraryId = null;
        if (!update && "code-template".equals(e.type) && !e.isInstalled()) {
            InstallDialog dialog = new InstallDialog(PlatformUI.MIRTH_FRAME, e.name);
            dialog.setVisible(true);
            if (!dialog.isConfirmed()) {
                return;
            }
            newLibrary = dialog.getNewLibrary();
            targetLibraryId = dialog.getTargetLibraryId();
        }

        runInstall(e, null, newLibrary, targetLibraryId,
                "Imported " + e.name + ". It's available now.");
    }

    /**
     * Update flow for the selected entry. Extensions keep the plain reinstall behavior
     * (the web UI routes them identically); content — code templates and libraries —
     * shares the drift-aware Re-import gate. Channels never reach here (Update is never
     * enabled for them).
     */
    private void updateSelected() {
        final StoreEntry e = selectedEntry();
        if (e == null || !e.updateAvailable || "channel".equals(e.type)) {
            return;
        }

        if (!e.isContent()) {
            install(true);
            return;
        }

        confirmContentReplace(e);
    }

    /**
     * Drift-aware replace gate for installed content (code templates and libraries),
     * shared by Update and Re-import so both UIs behave identically (see
     * {@code webadmin/web/plugin.jsx}): pristine gets one confirm and an in-place
     * {@code mode=upgrade} (membership kept, pristine hash refreshed); modified offers
     * Overwrite / Install as new copy / Cancel. A pre-tracking install
     * ({@code driftTracked=false}) reports modified — the store cannot tell — and the
     * dialog wording says so.
     */
    private void confirmContentReplace(StoreEntry e) {
        boolean sameVersion = !e.updateAvailable;
        String noun = "code-template-library".equals(e.type) ? "library" : "template";
        String successMessage = sameVersion
                ? "Re-imported " + e.name + "."
                : "Upgraded " + e.name + " to v" + e.version + ".";

        if (!e.modified) {
            int confirm = JOptionPane.showConfirmDialog(this,
                    sameVersion
                            ? "Re-import \"" + e.name + "\" v" + e.version + "?"
                            : "Upgrade \"" + e.name + "\" to v" + e.version + "?",
                    sameVersion ? "Confirm Re-import" : "Confirm Upgrade",
                    JOptionPane.YES_NO_OPTION,
                    JOptionPane.QUESTION_MESSAGE);
            if (confirm == JOptionPane.YES_OPTION) {
                runInstall(e, "upgrade", null, null, successMessage);
            }
            return;
        }

        Object[] options = {"Overwrite", "Install as new copy", "Cancel"};
        String message = (e.driftTracked
                ? "You've modified this " + noun + " since installing it.\n"
                : "This " + noun + " was installed before change tracking — the store\n"
                        + "can't tell whether you've modified it.\n")
                + "Overwrite replaces " + (e.driftTracked ? "your changes" : "whatever is there")
                + " with v" + e.version + ";\n"
                + "Install as new copy keeps " + (e.driftTracked ? "yours." : "what's installed.");
        int choice = JOptionPane.showOptionDialog(this,
                message,
                e.driftTracked ? "Modified Since Install" : "Possibly Modified",
                JOptionPane.YES_NO_CANCEL_OPTION,
                JOptionPane.WARNING_MESSAGE,
                null, options, options[2]);
        if (choice == 0) {
            runInstall(e, "upgrade", null, null, successMessage);
        } else if (choice == 1) {
            installContentCopy(e);
        }
    }

    /**
     * Imports the offered version of a content entry as an untracked copy
     * ({@code mode=copy}): a standalone code-template needs library placement, so the
     * install dialog asks; libraries and channels copy without further input.
     */
    private void installContentCopy(StoreEntry e) {
        String newLibrary = null;
        String targetLibraryId = null;
        if ("code-template".equals(e.type)) {
            InstallDialog dialog = new InstallDialog(PlatformUI.MIRTH_FRAME, e.name);
            dialog.setVisible(true);
            if (!dialog.isConfirmed()) {
                return;
            }
            newLibrary = dialog.getNewLibrary();
            targetLibraryId = dialog.getTargetLibraryId();
        }
        runInstall(e, "copy", newLibrary, targetLibraryId,
                "Imported " + e.name + " as a copy.");
    }

    /**
     * "Install as Copy" for a channel with a newer snapshot: confirm, then import the
     * offered snapshot under a fresh id. The installed channel is never touched.
     */
    private void installChannelCopy() {
        final StoreEntry e = selectedEntry();
        if (e == null || !"channel".equals(e.type) || e.newerSnapshot.isEmpty()) {
            return;
        }
        int confirm = JOptionPane.showConfirmDialog(this,
                "Import \"" + e.name + "\" v" + e.newerSnapshot + " as a new copy?\n"
                        + "The installed channel is not changed.",
                "Install as Copy",
                JOptionPane.YES_NO_OPTION,
                JOptionPane.QUESTION_MESSAGE);
        if (confirm == JOptionPane.YES_OPTION) {
            installContentCopy(e);
        }
    }

    /**
     * Runs the servlet install off the EDT. {@code mode} is null for the servlet default
     * ("install"); {@code contentMessage} is shown for content that needs no restart.
     */
    private void runInstall(StoreEntry e, String mode, String newLibrary, String targetLibraryId,
            String contentMessage) {
        final boolean content = e.isContent();
        new SwingWorker<JsonNode, Void>() {
            @Override
            protected JsonNode doInBackground() throws Exception {
                return client.install(e.id, e.tag, mode, newLibrary, targetLibraryId);
            }

            @Override
            protected void done() {
                try {
                    JsonNode result = get();
                    boolean restart = result.path("restartRequired").asBoolean(e.restartRequired);
                    if (content && !restart) {
                        PlatformUI.MIRTH_FRAME.alertInformation(CommunityStorePanel.this, contentMessage);
                    } else {
                        PlatformUI.MIRTH_FRAME.alertInformation(CommunityStorePanel.this,
                                "Installed " + e.name + " " + e.version
                                        + ". Restart the engine to activate it.");
                    }
                    doRefresh();
                } catch (Exception ex) {
                    PlatformUI.MIRTH_FRAME.alertThrowable(CommunityStorePanel.this, StoreServletClient.unwrap(ex));
                }
            }
        }.execute();
    }

    private void remove() {
        final StoreEntry e = selectedEntry();
        if (e == null) {
            return;
        }
        int confirm = JOptionPane.showConfirmDialog(this,
                "Remove \"" + e.name + "\" from this engine?",
                "Confirm Remove",
                JOptionPane.YES_NO_OPTION,
                JOptionPane.WARNING_MESSAGE);
        if (confirm != JOptionPane.YES_OPTION) {
            return;
        }

        new SwingWorker<JsonNode, Void>() {
            @Override
            protected JsonNode doInBackground() throws Exception {
                return client.removeContent(e.id);
            }

            @Override
            protected void done() {
                try {
                    get();
                    PlatformUI.MIRTH_FRAME.alertInformation(CommunityStorePanel.this,
                            "Removed " + e.name + " from this engine.");
                    doRefresh();
                } catch (Exception ex) {
                    PlatformUI.MIRTH_FRAME.alertThrowable(CommunityStorePanel.this, StoreServletClient.unwrap(ex));
                }
            }
        }.execute();
    }

    /** Fetches the current settings off the EDT, then opens the modal Settings dialog. */
    private void openSettings() {
        new SwingWorker<JsonNode, Void>() {
            @Override
            protected JsonNode doInBackground() throws Exception {
                return client.getSettings();
            }

            @Override
            protected void done() {
                try {
                    SettingsDialog dialog = new SettingsDialog(PlatformUI.MIRTH_FRAME, client, get());
                    dialog.setVisible(true);
                    if (dialog.isSaved()) {
                        // Mirror the web UI: a settings save forces a catalog re-sync.
                        doRefresh(true);
                    }
                } catch (Exception ex) {
                    PlatformUI.MIRTH_FRAME.alertThrowable(CommunityStorePanel.this, StoreServletClient.unwrap(ex));
                }
            }
        }.execute();
    }

    // ---------------------------------------------------------------------
    // Details block (read-only) shown above the docs panel.
    // ---------------------------------------------------------------------

    private static final class DetailsPanel extends JPanel {

        private final JLabel label = new JLabel();

        DetailsPanel() {
            super(new BorderLayout());
            label.setVerticalAlignment(JLabel.TOP);
            add(label, BorderLayout.CENTER);
            setPreferredSize(new Dimension(320, 120));
            show(null);
        }

        void show(StoreEntry e) {
            if (e == null) {
                label.setText(" ");
                return;
            }
            StringBuilder sb = new StringBuilder("<html>");
            sb.append("<b>").append(escape(e.name)).append("</b><br>");
            sb.append("Type: ").append(escape(StoreEntryTableModel.label(e.type))).append("<br>");
            if (!e.version.isEmpty()) {
                sb.append("Version: ").append(escape(e.version));
                if (!e.offeredIsLatest && !e.latestTag.isEmpty()) {
                    sb.append(" (latest: ").append(escape(e.latestTag)).append(')');
                }
                sb.append("<br>");
            }
            if (e.isInstalled()) {
                sb.append("Installed: ").append(escape(e.installedVersion)).append("<br>");
            }
            if (e.modified) {
                sb.append(e.driftTracked
                        ? "Modified since install<br>"
                        : "Local changes unknown (installed before change tracking)<br>");
            }
            if (!e.newerSnapshot.isEmpty()) {
                sb.append("Newer snapshot available: v").append(escape(e.newerSnapshot)).append("<br>");
            }
            if (!e.repo.isEmpty()) {
                sb.append("Repository: ").append(escape(e.repo)).append("<br>");
            }
            String min = e.minEngineVersion.isEmpty() ? "any" : e.minEngineVersion;
            String max = e.maxEngineVersion.isEmpty() ? "any" : e.maxEngineVersion;
            sb.append("Engine: ").append(escape(min)).append(" – ").append(escape(max)).append("<br>");
            sb.append("Restart required: ").append(e.restartRequired ? "Yes" : "No").append("<br>");
            String status = StoreEntryTableModel.status(e);
            if (!status.isEmpty()) {
                sb.append("Status: ").append(escape(status)).append("<br>");
            }
            sb.append("</html>");
            label.setText(sb.toString());
        }

        private static String escape(String s) {
            if (s == null) {
                return "";
            }
            return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
        }
    }
}
