/*
 * OIE Community Store — Swing Administrator client.
 *
 * Published under the terms of the Mozilla Public License 2.0.
 */

package org.openintegrationengine.plugins.communitystore.ui;

import java.awt.BorderLayout;
import java.awt.Desktop;
import java.awt.FlowLayout;
import java.net.URI;

import javax.swing.JButton;
import javax.swing.JEditorPane;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.SwingWorker;
import javax.swing.event.HyperlinkEvent;
import javax.swing.text.html.HTMLEditorKit;
import javax.swing.text.html.StyleSheet;

import com.fasterxml.jackson.databind.JsonNode;

import com.mirth.connect.client.ui.PlatformUI;

/**
 * Publisher documentation panel. Loads {@code getDocs(id)} off the EDT on selection change
 * and renders the returned markdown as sanitized HTML 3.2 via {@link DocsMarkdown}: raw HTML
 * is escaped, link targets are allowlisted to http/https, and images are stripped to
 * "[image: alt]" text (data-URI images do not render reliably in Swing text components, and
 * fetching remote images from the admin is undesirable). Links open in the system browser;
 * an "Open in browser" button jumps to the entry's documentation / homepage / release page.
 */
class StoreDocsPanel extends JPanel {

    private final StoreServletClient client;
    private final JEditorPane text;
    private final JButton openButton;
    private final JLabel header;

    private StoreEntry current;

    StoreDocsPanel(StoreServletClient client) {
        super(new BorderLayout());
        this.client = client;

        text = new JEditorPane();
        text.setEditable(false);

        // Instance-scoped stylesheet: HTMLEditorKit.setStyleSheet mutates a JVM-wide default,
        // so build a kit whose getStyleSheet() returns our own sheet cascading from it.
        StyleSheet styles = new StyleSheet();
        styles.addStyleSheet(new HTMLEditorKit().getStyleSheet());
        styles.addRule("body { font-family: sans-serif; font-size: 12pt; margin: 8px; }");
        styles.addRule("code, pre { font-family: monospaced; font-size: 11pt; }");
        styles.addRule("pre { background-color: #f0f0f0; margin: 6px 0; }");
        styles.addRule("blockquote { margin-left: 16px; }");
        styles.addRule("h1 { font-size: 18pt; margin: 10px 0 4px 0; }");
        styles.addRule("h2 { font-size: 16pt; margin: 10px 0 4px 0; }");
        styles.addRule("h3 { font-size: 14pt; margin: 8px 0 4px 0; }");
        styles.addRule("h4 { font-size: 12pt; margin: 8px 0 4px 0; }");
        styles.addRule("td { padding: 2px 6px; }");
        styles.addRule("a { color: #1a5dab; }");
        HTMLEditorKit kit = new HTMLEditorKit() {
            @Override
            public StyleSheet getStyleSheet() {
                return styles;
            }
        };
        text.setEditorKit(kit);
        text.putClientProperty(JEditorPane.HONOR_DISPLAY_PROPERTIES, Boolean.TRUE);
        text.addHyperlinkListener(e -> {
            if (e.getEventType() == HyperlinkEvent.EventType.ACTIVATED) {
                // getDescription() is the raw href — getURL() is null without a document
                // base — and DocsMarkdown has already allowlisted hrefs to http/https.
                try {
                    Desktop.getDesktop().browse(new URI(e.getDescription()));
                } catch (Exception ex) {
                    PlatformUI.MIRTH_FRAME.alertThrowable(this, ex);
                }
            }
        });
        setPlain("Select an item to view its documentation.");

        header = new JLabel("Documentation");
        openButton = new JButton("Open in browser");
        openButton.setEnabled(false);
        openButton.addActionListener(e -> openInBrowser());

        JPanel top = new JPanel(new FlowLayout(FlowLayout.LEFT));
        top.add(header);
        top.add(openButton);

        add(top, BorderLayout.NORTH);
        add(new JScrollPane(text), BorderLayout.CENTER);
    }

    void clear() {
        current = null;
        header.setText("Documentation");
        openButton.setEnabled(false);
        setPlain("Select an item to view its documentation.");
    }

    void load(StoreEntry entry) {
        current = entry;
        if (entry == null) {
            clear();
            return;
        }
        header.setText("Documentation — " + entry.name);
        openButton.setEnabled(hasLink(entry));
        setPlain("Loading documentation…");

        final String id = entry.id;
        new SwingWorker<JsonNode, Void>() {
            @Override
            protected JsonNode doInBackground() throws Exception {
                return client.docs(id);
            }

            @Override
            protected void done() {
                // A newer selection may already have replaced this request — ignore stale results.
                if (current == null || !id.equals(current.id)) {
                    return;
                }
                try {
                    render(get());
                } catch (Exception ex) {
                    setPlain("Could not load documentation: " + StoreServletClient.messageOf(ex));
                }
            }
        }.execute();
    }

    private void render(JsonNode docs) {
        if (docs.path("found").asBoolean(false)) {
            StringBuilder sb = new StringBuilder("<html><body>");
            String path = docs.path("path").asText("");
            String tag = docs.path("tag").asText("");
            if (!path.isEmpty()) {
                String provenance = tag.isEmpty() ? path : path + " @ " + tag;
                sb.append("<p><i>").append(DocsMarkdown.escapeHtml(provenance)).append("</i></p>");
            }
            sb.append(DocsMarkdown.toBodyHtml(docs.path("markdown").asText("")));
            if (docs.path("truncated").asBoolean(false)) {
                sb.append("<p><i>[Documentation truncated — see the repository for the full file.]</i></p>");
            }
            sb.append("</body></html>");
            text.setText(sb.toString());
        } else {
            text.setText("<html><body><p>"
                    + DocsMarkdown.escapeHtml("This publisher provides no store documentation.")
                    + "</p><p>"
                    + DocsMarkdown.escapeHtml("Publishers can add a store.md (or README.md) to their repository; "
                            + "it is shown here, pinned to the release tag.")
                    + "</p></body></html>");
        }
        text.setCaretPosition(0);
    }

    /** Shows an app-authored plaintext message (loading / empty / error states), escaped and scrolled to top. */
    private void setPlain(String message) {
        text.setText("<html><body><p>" + DocsMarkdown.escapeHtml(message) + "</p></body></html>");
        text.setCaretPosition(0);
    }

    private void openInBrowser() {
        if (current == null) {
            return;
        }
        String url = firstNonEmpty(current.documentation, current.homepage, current.releaseUrl);
        if (url == null) {
            return;
        }
        try {
            Desktop.getDesktop().browse(new URI(url));
        } catch (Exception ex) {
            PlatformUI.MIRTH_FRAME.alertThrowable(this, ex);
        }
    }

    private static boolean hasLink(StoreEntry e) {
        return firstNonEmpty(e.documentation, e.homepage, e.releaseUrl) != null;
    }

    private static String firstNonEmpty(String... values) {
        for (String v : values) {
            if (v != null && !v.isEmpty()) {
                return v;
            }
        }
        return null;
    }
}
