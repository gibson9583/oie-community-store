/*
 * OIE Community Store — Swing Administrator client.
 *
 * Published under the terms of the Mozilla Public License 2.0.
 */

package org.openintegrationengine.plugins.communitystore.ui;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import javax.swing.table.AbstractTableModel;

/**
 * Table model backing the store's catalog table. Columns: Name, Type, Version, Repository,
 * Status. The Status column condenses the same signals the web {@code Badges} renders.
 */
class StoreEntryTableModel extends AbstractTableModel {

    /** Human labels per package type, keyed by the catalog's raw type string. */
    static final Map<String, String> TYPE_LABELS = new LinkedHashMap<>();
    /** Stable ordering for the type filter, matching the web frontend's TYPE_ORDER. */
    static final String[] TYPE_ORDER = {
            "connector", "plugin", "datatype", "channel", "code-template-library", "code-template"
    };

    static {
        TYPE_LABELS.put("connector", "Connector");
        TYPE_LABELS.put("plugin", "Plugin");
        TYPE_LABELS.put("datatype", "Data Type");
        TYPE_LABELS.put("channel", "Channel");
        TYPE_LABELS.put("code-template-library", "Code Template Library");
        TYPE_LABELS.put("code-template", "Code Template");
    }

    private static final String[] COLUMN_NAMES = {"Name", "Type", "Version", "Repository", "Status"};

    private List<StoreEntry> entries;

    StoreEntryTableModel(List<StoreEntry> entries) {
        this.entries = entries;
    }

    void setEntries(List<StoreEntry> entries) {
        this.entries = entries;
        fireTableDataChanged();
    }

    StoreEntry getEntryAt(int row) {
        return entries.get(row);
    }

    @Override
    public int getRowCount() {
        return entries.size();
    }

    @Override
    public int getColumnCount() {
        return COLUMN_NAMES.length;
    }

    @Override
    public String getColumnName(int column) {
        return COLUMN_NAMES[column];
    }

    @Override
    public Object getValueAt(int rowIndex, int columnIndex) {
        StoreEntry e = entries.get(rowIndex);
        return switch (columnIndex) {
            case 0 -> e.name;
            case 1 -> label(e.type);
            case 2 -> e.version;
            case 3 -> e.repo;
            case 4 -> status(e);
            default -> "";
        };
    }

    static String label(String type) {
        return TYPE_LABELS.getOrDefault(type, type);
    }

    static String status(StoreEntry e) {
        if (e.revoked) {
            return "blocked".equals(e.revokedReason) ? "Blocked by source" : "Removed from source";
        }
        if (e.isInstalled()) {
            return e.updateAvailable ? "Update ↑ (" + e.version + ")" : "Installed " + e.installedVersion;
        }
        if (!e.compatible) {
            return "Incompatible";
        }
        if (e.deprecated) {
            return "Deprecated";
        }
        return "";
    }
}
