/*
 * OIE Community Store — Swing Administrator client.
 *
 * Published under the terms of the Mozilla Public License 2.0.
 */

package org.openintegrationengine.plugins.communitystore.ui;

import java.awt.BorderLayout;
import java.awt.FlowLayout;
import java.awt.Frame;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.awt.event.ActionEvent;
import java.awt.event.KeyEvent;
import java.util.ArrayList;
import java.util.List;

import javax.swing.AbstractAction;
import javax.swing.ButtonGroup;
import javax.swing.JButton;
import javax.swing.JComboBox;
import javax.swing.JComponent;
import javax.swing.JDialog;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JRadioButton;
import javax.swing.JTextField;
import javax.swing.KeyStroke;

import com.mirth.connect.client.ui.PlatformUI;
import com.mirth.connect.model.codetemplates.CodeTemplateLibrary;

/**
 * Modal picker shown only for a fresh, standalone {@code code-template} install: a standalone
 * template must live in a Code Template Library, so the publisher chooses an existing library
 * ({@code targetLibraryId}) or names a new one ({@code newLibrary}).
 *
 * <p>Cancel / Escape leaves {@link #isConfirmed()} false. On update / re-import the caller
 * skips this dialog entirely (membership is preserved server-side).
 */
class InstallDialog extends JDialog {

    private final JRadioButton newRadio = new JRadioButton("Create new library:");
    private final JRadioButton existingRadio = new JRadioButton("Add to existing library:");
    private final JTextField newLibraryField = new JTextField(20);
    private final JComboBox<LibraryItem> existingCombo = new JComboBox<>();

    private boolean confirmed;

    InstallDialog(Frame parent, String packageName) {
        super(parent, "Install Code Template", true);

        List<LibraryItem> libraries = loadLibraries();
        for (LibraryItem item : libraries) {
            existingCombo.addItem(item);
        }

        newLibraryField.setText(packageName == null || packageName.isEmpty() ? "Community Store" : packageName);

        boolean hasExisting = !libraries.isEmpty();
        existingRadio.setEnabled(hasExisting);
        existingCombo.setEnabled(false);

        ButtonGroup group = new ButtonGroup();
        group.add(newRadio);
        group.add(existingRadio);
        newRadio.setSelected(true);

        newRadio.addActionListener(e -> syncEnabled());
        existingRadio.addActionListener(e -> syncEnabled());

        setLayout(new BorderLayout());
        add(buildForm(), BorderLayout.CENTER);
        add(buildButtons(), BorderLayout.SOUTH);

        installEscapeToCancel();
        pack();
        setLocationRelativeTo(parent);
    }

    private JPanel buildForm() {
        JPanel form = new JPanel(new GridBagLayout());
        GridBagConstraints c = new GridBagConstraints();
        c.insets = new Insets(6, 8, 6, 8);
        c.anchor = GridBagConstraints.WEST;
        c.fill = GridBagConstraints.HORIZONTAL;

        c.gridx = 0;
        c.gridy = 0;
        c.gridwidth = 2;
        form.add(new JLabel("A standalone code template must belong to a library."), c);

        c.gridwidth = 1;
        c.gridy = 1;
        c.gridx = 0;
        form.add(newRadio, c);
        c.gridx = 1;
        form.add(newLibraryField, c);

        c.gridy = 2;
        c.gridx = 0;
        form.add(existingRadio, c);
        c.gridx = 1;
        form.add(existingCombo, c);

        return form;
    }

    private JPanel buildButtons() {
        JPanel buttons = new JPanel(new FlowLayout(FlowLayout.RIGHT));
        JButton ok = new JButton("Install");
        ok.addActionListener(e -> {
            confirmed = true;
            dispose();
        });
        JButton cancel = new JButton("Cancel");
        cancel.addActionListener(e -> dispose());
        buttons.add(ok);
        buttons.add(cancel);
        return buttons;
    }

    private void syncEnabled() {
        newLibraryField.setEnabled(newRadio.isSelected());
        existingCombo.setEnabled(existingRadio.isSelected());
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

    private static List<LibraryItem> loadLibraries() {
        List<LibraryItem> items = new ArrayList<>();
        try {
            List<CodeTemplateLibrary> libraries =
                    PlatformUI.MIRTH_FRAME.mirthClient.getAllCodeTemplateLibraries(false);
            if (libraries != null) {
                for (CodeTemplateLibrary library : libraries) {
                    items.add(new LibraryItem(library.getId(), library.getName()));
                }
            }
        } catch (Exception ex) {
            // Fall back to create-new only; the servlet still enforces a valid target.
        }
        return items;
    }

    boolean isConfirmed() {
        return confirmed;
    }

    /** The new library name to create, or {@code null} when an existing library was chosen. */
    String getNewLibrary() {
        if (newRadio.isSelected()) {
            String name = newLibraryField.getText().trim();
            return name.isEmpty() ? "Community Store" : name;
        }
        return null;
    }

    /** The chosen existing library id, or {@code null} when creating a new library. */
    String getTargetLibraryId() {
        if (existingRadio.isSelected()) {
            LibraryItem item = (LibraryItem) existingCombo.getSelectedItem();
            return item == null ? null : item.id;
        }
        return null;
    }

    private static final class LibraryItem {
        final String id;
        final String name;

        LibraryItem(String id, String name) {
            this.id = id;
            this.name = name;
        }

        @Override
        public String toString() {
            return name;
        }
    }
}
