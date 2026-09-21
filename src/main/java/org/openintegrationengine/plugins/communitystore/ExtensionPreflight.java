/* Published under the terms of the Mozilla Public License 2.0. */
package org.openintegrationengine.plugins.communitystore;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.HashSet;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.w3c.dom.Element;

/** Validates the entire archive before the engine installer sees any bytes. */
final class ExtensionPreflight {
    static final long MAX_INFLATED_BYTES = 512L * 1024 * 1024;
    static final int MAX_DESCRIPTOR_BYTES = 1024 * 1024;
    static final int MAX_ENTRIES = 10000;
    private ExtensionPreflight() {}

    static void validate(byte[] artifact, String id, String version) throws Exception {
        validate(artifact, id, version, MAX_INFLATED_BYTES);
    }

    static void validate(byte[] artifact, String id, String version, long maxInflatedBytes) throws Exception {
        if (id == null || !id.matches("[A-Za-z0-9_-][A-Za-z0-9_.-]*") || id.equals(".") || id.equals("..")) {
            throw new IOException("Invalid extension package id.");
        }
        Set<String> paths = new HashSet<>();
        Set<String> descriptors = new HashSet<>();
        long total = 0;
        int count = 0;
        byte[] buffer = new byte[16384];
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(artifact))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (++count > MAX_ENTRIES) throw new IOException("Extension archive has too many entries.");
                String path = entry.getName();
                if (!path.startsWith(id + "/") || path.indexOf('\\') >= 0 || path.indexOf(':') >= 0 || path.indexOf('\0') >= 0) {
                    throw new IOException("Every archive entry must be inside '" + id + "/': " + path);
                }
                String key = entry.isDirectory() ? path.substring(0, path.length() - 1) : path;
                for (String segment : key.split("/", -1)) {
                    if (segment.isEmpty() || segment.equals(".") || segment.equals("..") || segment.endsWith(".") || segment.endsWith(" ")) {
                        throw new IOException("Unsafe archive path: " + path);
                    }
                }
                // Case-insensitive filesystems must not reinterpret distinct ZIP entries as one file.
                if (!paths.add(key.toLowerCase(java.util.Locale.ROOT))) throw new IOException("Duplicate archive path: " + path);
                String base = path.substring(path.lastIndexOf('/') + 1);
                boolean descriptor = path.endsWith("plugin.xml") || path.endsWith("source.xml") || path.endsWith("destination.xml");
                if (descriptor && (entry.isDirectory() || !Set.of("plugin.xml", "source.xml", "destination.xml").contains(base)
                        || !path.equals(id + "/" + base))) {
                    throw new IOException("Unexpected extension descriptor: " + path);
                }
                ByteArrayOutputStream bytes = descriptor ? new ByteArrayOutputStream() : null;
                int n;
                while ((n = zip.read(buffer)) != -1) {
                    total += n;
                    if (total > maxInflatedBytes) throw new IOException("Extension archive exceeds inflated size limit.");
                    if (descriptor) {
                        if (bytes.size() + n > MAX_DESCRIPTOR_BYTES) throw new IOException("Extension descriptor exceeds size limit.");
                        bytes.write(buffer, 0, n);
                    }
                }
                if (descriptor) {
                    validateDescriptor(bytes.toByteArray(), base, id, version);
                    descriptors.add(base);
                }
            }
        }
        if (descriptors.isEmpty()) throw new IOException("No extension descriptor at the package root.");
    }

    private static void validateDescriptor(byte[] xml, String file, String id, String version) throws Exception {
        Element root = ContentHash.secureXmlFactory().newDocumentBuilder().parse(new ByteArrayInputStream(xml)).getDocumentElement();
        String kind = file.equals("plugin.xml") ? "pluginMetaData" : "connectorMetaData";
        if (!kind.equals(root.getTagName()) || !id.equals(root.getAttribute("path"))) {
            throw new IOException("Descriptor identity does not match package '" + id + "': " + file);
        }
        var versions = root.getElementsByTagName("pluginVersion");
        if (version == null || version.isBlank() || versions.getLength() != 1
                || !version.replaceFirst("^[vV]", "").equals(versions.item(0).getTextContent().trim().replaceFirst("^[vV]", ""))) {
            throw new IOException("Descriptor version does not match offered version: " + file);
        }
    }
}
