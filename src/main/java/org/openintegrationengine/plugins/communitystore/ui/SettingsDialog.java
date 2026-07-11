/*
 * OIE Community Store — Swing Administrator client.
 *
 * Published under the terms of the Mozilla Public License 2.0.
 */

package org.openintegrationengine.plugins.communitystore.ui;

import java.awt.BorderLayout;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Frame;
import java.awt.event.ActionEvent;
import java.awt.event.KeyEvent;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

import javax.swing.AbstractAction;
import javax.swing.BorderFactory;
import javax.swing.BoxLayout;
import javax.swing.DefaultListModel;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JComboBox;
import javax.swing.JComponent;
import javax.swing.JDialog;
import javax.swing.JLabel;
import javax.swing.JList;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JPasswordField;
import javax.swing.JScrollPane;
import javax.swing.JTabbedPane;
import javax.swing.JTextField;
import javax.swing.KeyStroke;
import javax.swing.ListSelectionModel;
import javax.swing.SwingWorker;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import javax.swing.table.AbstractTableModel;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import org.jdesktop.swingx.decorator.HighlighterFactory;

import com.mirth.connect.client.ui.PlatformUI;
import com.mirth.connect.client.ui.UIConstants;
import com.mirth.connect.client.ui.components.MirthTable;

/**
 * Modal Settings dialog for the Community Store, at parity with the web administrator's
 * Settings tab: custom sources (add repo / org / catalog, remove), the local blocklist,
 * the beta channel flag, and the GitHub personal access token. Bundled sources and the
 * bundled blocklist are shown read-only — they ship with the store and cannot be removed.
 *
 * <p>The caller pre-fetches the settings JSON off the EDT and passes it in; all edits are
 * in-memory until Save, which PUTs {@code {customSources, localBlocklist, betaChannel}}
 * (plus {@code token} only when the field was touched — absent = unchanged, empty = clear,
 * value = replace) through {@link StoreServletClient} in a {@link SwingWorker}. Cancel /
 * Escape leaves {@link #isSaved()} false; on true the panel forces a catalog re-sync,
 * mirroring the web UI's post-save {@code refresh(true)}.
 */
class SettingsDialog extends JDialog {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    // Client-side mirrors of StoreSettings.SourceDef.fromJson / the servlet's blocklist
    // filter, so invalid entries warn here instead of being silently dropped server-side.
    private static final Pattern OWNER = Pattern.compile("[\\w-]+");
    private static final Pattern NAME = Pattern.compile("[\\w.-]+");
    private static final Pattern TOPIC = Pattern.compile("[a-z0-9][a-z0-9-]*");
    private static final Pattern BLOCK_ENTRY = Pattern.compile("[\\w.-]+/[\\w.-]+");

    private final StoreServletClient client;

    // In-memory editing state; nothing persists until Save.
    private final List<ObjectNode> bundledSources = new ArrayList<>();
    private final List<ObjectNode> customSources = new ArrayList<>();
    private final List<String> bundledBlocklist = new ArrayList<>();
    private final List<String> localBlocklist = new ArrayList<>();

    private SourceTableModel sourceModel;
    private MirthTable sourceTable;
    private JButton removeSourceButton;
    private JComboBox<String> kindCombo;
    private JTextField valueField;
    private JTextField topicField;

    private DefaultListModel<String> blockListModel;
    private JList<String> blockList;
    private JButton removeBlockButton;
    private JTextField blockField;

    private JCheckBox betaCheckBox;
    private JPasswordField tokenField;
    private JLabel tokenSetTag;
    /** False until the token field is first edited; only then does Save include "token". */
    private boolean tokenTouched;

    private JButton saveButton;
    private boolean saved;

    SettingsDialog(Frame parent, StoreServletClient client, JsonNode settings) {
        super(parent, "Community Store Settings", true);
        this.client = client;

        for (JsonNode node : settings.path("bundledSources")) {
            if (node.isObject()) {
                bundledSources.add(((ObjectNode) node).deepCopy());
            }
        }
        for (JsonNode node : settings.path("customSources")) {
            if (node.isObject()) {
                customSources.add(((ObjectNode) node).deepCopy());
            }
        }
        for (JsonNode node : settings.path("bundledBlocklist")) {
            bundledBlocklist.add(node.asText());
        }
        for (JsonNode node : settings.path("localBlocklist")) {
            localBlocklist.add(node.asText());
        }

        boolean tokenSet = settings.path("tokenSet").asBoolean(false);

        JTabbedPane tabs = new JTabbedPane();
        tabs.addTab("Sources", buildSourcesTab());
        tabs.addTab("Blocklist", buildBlocklistTab());
        tabs.addTab("GitHub access", buildGitHubTab(settings.path("betaChannel").asBoolean(false),
                tokenSet, settings.path("rateLimitRemaining").asText("")));

        setLayout(new BorderLayout());
        add(tabs, BorderLayout.CENTER);
        add(buildButtons(), BorderLayout.SOUTH);

        installEscapeToCancel();
        pack();
        setLocationRelativeTo(parent);
    }

    // ---------------------------------------------------------------------
    // Sources tab
    // ---------------------------------------------------------------------

    private JPanel buildSourcesTab() {
        JPanel tab = new JPanel(new BorderLayout(0, 6));
        tab.setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));

        tab.add(hint("Bundled sources ship with the store and update with store releases. "
                + "Custom sources are additive and stored on this engine."), BorderLayout.NORTH);

        sourceModel = new SourceTableModel();
        sourceTable = new MirthTable();
        sourceTable.setModel(sourceModel);
        sourceTable.setHighlighters(HighlighterFactory.createAlternateStriping(
                UIConstants.HIGHLIGHTER_COLOR, UIConstants.BACKGROUND_COLOR));
        sourceTable.setSortable(false); // ordering is bundled-first; the row index maps to the lists
        sourceTable.setRowSelectionAllowed(true);
        sourceTable.setColumnSelectionAllowed(false);
        sourceTable.setSelectionMode(ListSelectionModel.SINGLE_SELECTION);
        sourceTable.getColumnModel().getColumn(1).setMaxWidth(90);
        sourceTable.getSelectionModel().addListSelectionListener(e -> {
            if (!e.getValueIsAdjusting()) {
                // Only custom rows (after the bundled block) are removable.
                removeSourceButton.setEnabled(sourceTable.getSelectedRow() >= bundledSources.size());
            }
        });

        JScrollPane scroll = new JScrollPane(sourceTable);
        scroll.setPreferredSize(new Dimension(640, 180));
        tab.add(scroll, BorderLayout.CENTER);

        JPanel south = new JPanel();
        south.setLayout(new BoxLayout(south, BoxLayout.Y_AXIS));

        JPanel removeRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 0, 2));
        removeSourceButton = new JButton("Remove");
        removeSourceButton.setEnabled(false);
        removeSourceButton.addActionListener(e -> removeSelectedSource());
        removeRow.add(removeSourceButton);
        south.add(removeRow);

        JPanel addRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 2));
        kindCombo = new JComboBox<>(new String[] {"repo", "org", "catalog"});
        kindCombo.addActionListener(e -> syncAddControls());
        addRow.add(kindCombo);
        valueField = new JTextField(24);
        addRow.add(valueField);
        topicField = new JTextField("oie-plugin", 10);
        topicField.setToolTipText("topic filter");
        addRow.add(topicField);
        JButton addButton = new JButton("Add source");
        addButton.addActionListener(e -> addSource());
        addRow.add(addButton);
        south.add(addRow);

        tab.add(south, BorderLayout.SOUTH);
        syncAddControls();
        return tab;
    }

    /** The topic filter only applies to org sources; the value tooltip tracks the kind. */
    private void syncAddControls() {
        String kind = (String) kindCombo.getSelectedItem();
        valueField.setToolTipText("catalog".equals(kind) ? "https://…/index.json"
                : "org".equals(kind) ? "organization or user login" : "owner/repository");
        topicField.setEnabled("org".equals(kind));
    }

    private void removeSelectedSource() {
        int row = sourceTable.getSelectedRow();
        int customIndex = row - bundledSources.size();
        if (customIndex < 0 || customIndex >= customSources.size()) {
            return;
        }
        customSources.remove(customIndex);
        sourceModel.fireTableRowsDeleted(row, row);
        removeSourceButton.setEnabled(false);
    }

    private void addSource() {
        String value = valueField.getText().trim();
        if (value.isEmpty()) {
            return;
        }

        String kind = (String) kindCombo.getSelectedItem();
        ObjectNode source = MAPPER.createObjectNode();
        source.put("kind", kind);
        if ("catalog".equals(kind)) {
            if (!isHttpsUrl(value)) {
                warn("A catalog source must be an https URL (e.g. https://…/index.json).");
                return;
            }
            source.put("url", value);
        } else if ("org".equals(kind)) {
            if (!OWNER.matcher(value).matches()) {
                warn("An org source must be a GitHub organization or user login.");
                return;
            }
            String topic = topicField.getText().trim().toLowerCase();
            if (topic.isEmpty()) {
                topic = "oie-plugin";
            }
            if (!TOPIC.matcher(topic).matches()) {
                warn("The topic filter must be lowercase letters, digits, and hyphens.");
                return;
            }
            source.put("org", value);
            source.put("topic", topic);
        } else {
            if (!isValidRepo(value)) {
                warn("A repo source must be owner/repository.");
                return;
            }
            source.put("repo", value);
        }

        customSources.add(source);
        int row = bundledSources.size() + customSources.size() - 1;
        sourceModel.fireTableRowsInserted(row, row);
        valueField.setText("");
    }

    // ---------------------------------------------------------------------
    // Blocklist tab
    // ---------------------------------------------------------------------

    private JPanel buildBlocklistTab() {
        JPanel tab = new JPanel(new BorderLayout(0, 6));
        tab.setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));

        tab.add(hint("Blocked repositories never appear in the catalog. "
                + "The bundled blocklist cannot be removed here."), BorderLayout.NORTH);

        blockListModel = new DefaultListModel<>();
        rebuildBlockListModel();
        blockList = new JList<>(blockListModel);
        blockList.setSelectionMode(ListSelectionModel.SINGLE_SELECTION);
        blockList.addListSelectionListener(e -> {
            if (!e.getValueIsAdjusting()) {
                // Bundled entries sit first and are not removable.
                removeBlockButton.setEnabled(blockList.getSelectedIndex() >= bundledBlocklist.size());
            }
        });

        JScrollPane scroll = new JScrollPane(blockList);
        scroll.setPreferredSize(new Dimension(640, 150));
        tab.add(scroll, BorderLayout.CENTER);

        JPanel south = new JPanel();
        south.setLayout(new BoxLayout(south, BoxLayout.Y_AXIS));

        JPanel removeRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 0, 2));
        removeBlockButton = new JButton("Remove");
        removeBlockButton.setEnabled(false);
        removeBlockButton.addActionListener(e -> removeSelectedBlock());
        removeRow.add(removeBlockButton);
        south.add(removeRow);

        JPanel addRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 2));
        blockField = new JTextField(24);
        blockField.setToolTipText("owner/repository");
        addRow.add(blockField);
        JButton blockButton = new JButton("Block");
        blockButton.addActionListener(e -> addBlock());
        addRow.add(blockButton);
        south.add(addRow);

        tab.add(south, BorderLayout.SOUTH);
        return tab;
    }

    private void rebuildBlockListModel() {
        blockListModel.clear();
        for (String entry : bundledBlocklist) {
            blockListModel.addElement(entry + "  (bundled)");
        }
        for (String entry : localBlocklist) {
            blockListModel.addElement(entry);
        }
    }

    private void removeSelectedBlock() {
        int index = blockList.getSelectedIndex() - bundledBlocklist.size();
        if (index < 0 || index >= localBlocklist.size()) {
            return;
        }
        localBlocklist.remove(index);
        rebuildBlockListModel();
        removeBlockButton.setEnabled(false);
    }

    private void addBlock() {
        String value = blockField.getText().trim().toLowerCase();
        if (value.isEmpty()) {
            return;
        }
        if (!BLOCK_ENTRY.matcher(value).matches()) {
            warn("A blocklist entry must be owner/repository.");
            return;
        }
        localBlocklist.add(value);
        rebuildBlockListModel();
        blockField.setText("");
    }

    // ---------------------------------------------------------------------
    // GitHub access tab
    // ---------------------------------------------------------------------

    private JPanel buildGitHubTab(boolean betaChannel, boolean tokenSet, String rateLimitRemaining) {
        JPanel tab = new JPanel();
        tab.setLayout(new BoxLayout(tab, BoxLayout.Y_AXIS));
        tab.setBorder(BorderFactory.createEmptyBorder(8, 8, 8, 8));

        JPanel betaRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 0, 2));
        betaCheckBox = new JCheckBox("Include pre-releases (beta channel)", betaChannel);
        betaRow.add(betaCheckBox);
        tab.add(betaRow);

        JPanel labelRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 0, 2));
        labelRow.add(new JLabel(tokenSet
                ? "Token configured (leave blank to keep, save empty to clear)"
                : "Personal access token (optional)"));
        tab.add(labelRow);

        JPanel tokenRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 6, 2));
        tokenField = new JPasswordField(28);
        tokenField.getDocument().addDocumentListener(new DocumentListener() {
            @Override public void insertUpdate(DocumentEvent e) { touchToken(); }
            @Override public void removeUpdate(DocumentEvent e) { touchToken(); }
            @Override public void changedUpdate(DocumentEvent e) { touchToken(); }
        });
        tokenRow.add(tokenField);
        tokenSetTag = new JLabel("(set)");
        tokenSetTag.setVisible(tokenSet);
        tokenRow.add(tokenSetTag);
        tab.add(tokenRow);

        String hintText = "A token raises the GitHub API rate limit and enables private sources. "
                + "It is stored encrypted on the engine and never returned to the browser.";
        if (rateLimitRemaining != null && !rateLimitRemaining.isEmpty()) {
            hintText += " Rate limit remaining: " + rateLimitRemaining + ".";
        }
        JPanel hintRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 0, 2));
        hintRow.add(hint(hintText));
        tab.add(hintRow);

        return tab;
    }

    private void touchToken() {
        tokenTouched = true;
        tokenSetTag.setVisible(false);
    }

    // ---------------------------------------------------------------------
    // Save / Cancel
    // ---------------------------------------------------------------------

    private JPanel buildButtons() {
        JPanel buttons = new JPanel(new FlowLayout(FlowLayout.RIGHT));
        saveButton = new JButton("Save");
        saveButton.addActionListener(e -> save());
        JButton cancel = new JButton("Cancel");
        cancel.addActionListener(e -> dispose());
        buttons.add(saveButton);
        buttons.add(cancel);
        return buttons;
    }

    /** PUTs the edited settings off the EDT; the token key is sent only when touched. */
    private void save() {
        final ObjectNode body = MAPPER.createObjectNode();
        ArrayNode sources = body.putArray("customSources");
        for (ObjectNode source : customSources) {
            sources.add(source);
        }
        ArrayNode block = body.putArray("localBlocklist");
        for (String entry : localBlocklist) {
            block.add(entry);
        }
        body.put("betaChannel", betaCheckBox.isSelected());
        if (tokenTouched) {
            // Absent = unchanged, empty = clear, value = replace (encrypted server-side).
            body.put("token", new String(tokenField.getPassword()));
        }

        saveButton.setEnabled(false);
        saveButton.setText("Saving…");

        new SwingWorker<JsonNode, Void>() {
            @Override
            protected JsonNode doInBackground() throws Exception {
                return client.setSettings(MAPPER.writeValueAsString(body));
            }

            @Override
            protected void done() {
                try {
                    get();
                    saved = true;
                    dispose();
                } catch (Exception ex) {
                    saveButton.setEnabled(true);
                    saveButton.setText("Save");
                    PlatformUI.MIRTH_FRAME.alertThrowable(SettingsDialog.this, StoreServletClient.unwrap(ex));
                }
            }
        }.execute();
    }

    private void installEscapeToCancel() {
        getRootPane().getInputMap(JComponent.WHEN_IN_FOCUSED_WINDOW).put(
                KeyStroke.getKeyStroke(KeyEvent.VK_ESCAPE, 0), "cancel");
        getRootPane().getActionMap().put("cancel", new AbstractAction() {
            @Override
            public void actionPerformed(ActionEvent e) {
                dispose();
            }
        });
    }

    boolean isSaved() {
        return saved;
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    /** Same row text as the web UI's describeSource. */
    private static String describe(JsonNode source) {
        String kind = source.path("kind").asText("repo");
        if ("catalog".equals(kind)) {
            return "catalog: " + source.path("url").asText("");
        }
        if ("org".equals(kind)) {
            return "org: " + source.path("org").asText("")
                    + " (topic: " + source.path("topic").asText("") + ")";
        }
        return "repo: " + source.path("repo").asText("");
    }

    private static boolean isValidRepo(String repo) {
        String[] parts = repo.split("/", -1);
        return parts.length == 2 && OWNER.matcher(parts[0]).matches() && NAME.matcher(parts[1]).matches()
                && !isDotSegment(parts[0]) && !isDotSegment(parts[1]);
    }

    private static boolean isDotSegment(String value) {
        return value.equals(".") || value.equals("..");
    }

    private static boolean isHttpsUrl(String url) {
        try {
            URI uri = URI.create(url);
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null;
        } catch (Exception e) {
            return false;
        }
    }

    private static JLabel hint(String text) {
        return new JLabel("<html><i>" + text + "</i></html>");
    }

    private void warn(String message) {
        JOptionPane.showMessageDialog(this, message, "Invalid Value", JOptionPane.WARNING_MESSAGE);
    }

    /** Bundled rows first (read-only), then the editable custom rows. */
    private final class SourceTableModel extends AbstractTableModel {

        private final String[] columns = {"Source", "Origin"};

        @Override
        public int getRowCount() {
            return bundledSources.size() + customSources.size();
        }

        @Override
        public int getColumnCount() {
            return columns.length;
        }

        @Override
        public String getColumnName(int column) {
            return columns[column];
        }

        @Override
        public boolean isCellEditable(int row, int column) {
            return false;
        }

        @Override
        public Object getValueAt(int row, int column) {
            boolean bundled = row < bundledSources.size();
            ObjectNode source = bundled
                    ? bundledSources.get(row)
                    : customSources.get(row - bundledSources.size());
            return column == 0 ? describe(source) : (bundled ? "bundled" : "custom");
        }
    }
}
