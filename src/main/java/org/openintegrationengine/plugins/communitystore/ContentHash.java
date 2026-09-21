/* Published under the terms of the Mozilla Public License 2.0. */
package org.openintegrationengine.plugins.communitystore;

import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Node;
import org.xml.sax.InputSource;

/** Content fingerprints. Never normalize whitespace inside code or other leaf text. */
public final class ContentHash {
    public static final int FORMAT_VERSION = 2;
    private ContentHash() {}

    public static String codeHash(String code) {
        return sha256Hex((code == null ? "" : code).getBytes(StandardCharsets.UTF_8));
    }

    /** State token includes revisions: even a change followed by an undo invalidates consent. */
    public static String stateHash(String xml) {
        return codeHash(xml);
    }

    /** Ignore formatting between elements and volatile save metadata, preserving leaf text exactly. */
    public static String normalizedXmlHash(String xml) {
        try {
            DocumentBuilderFactory factory = secureXmlFactory();
            StringBuilder canonical = new StringBuilder();
            append(factory.newDocumentBuilder().parse(new InputSource(new StringReader(xml))).getDocumentElement(), canonical);
            return codeHash(canonical.toString());
        } catch (Exception e) {
            throw new IllegalArgumentException("Cannot fingerprint content XML safely", e);
        }
    }

    static DocumentBuilderFactory secureXmlFactory() throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        factory.setExpandEntityReferences(false);
        factory.setCoalescing(true);
        return factory;
    }

    private static void field(String value, StringBuilder out) {
        out.append(value.length()).append(':').append(value);
    }

    private static void append(Node node, StringBuilder out) {
        if (node.getNodeType() != Node.ELEMENT_NODE) return;
        // These are engine object metadata, not text embedded within code elements.
        if (node.getNodeName().equals("revision") || node.getNodeName().equals("lastModified")) return;
        out.append('E');
        field(node.getNodeName(), out);
        ArrayList<String> attributes = new ArrayList<>();
        for (int i = 0; i < node.getAttributes().getLength(); i++) attributes.add(node.getAttributes().item(i).getNodeName());
        Collections.sort(attributes);
        for (String name : attributes) {
            out.append('A'); field(name, out); field(node.getAttributes().getNamedItem(name).getNodeValue(), out);
        }
        boolean hasElements = false;
        for (Node child = node.getFirstChild(); child != null; child = child.getNextSibling()) {
            if (child.getNodeType() == Node.ELEMENT_NODE) hasElements = true;
        }
        for (Node child = node.getFirstChild(); child != null; child = child.getNextSibling()) {
            if (child.getNodeType() == Node.ELEMENT_NODE) append(child, out);
            else if (child.getNodeType() == Node.TEXT_NODE || child.getNodeType() == Node.CDATA_SECTION_NODE) {
                String text = child.getNodeValue();
                if (!hasElements || !text.isBlank()) { out.append('T'); field(text, out); }
            }
        }
        out.append('X');
    }

    public static String sha256Hex(byte[] data) {
        try {
            return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is not available", e);
        }
    }
}
