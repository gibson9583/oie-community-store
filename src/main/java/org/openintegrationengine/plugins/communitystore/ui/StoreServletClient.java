/*
 * OIE Community Store — Swing Administrator client.
 *
 * Published under the terms of the Mozilla Public License 2.0.
 */

package org.openintegrationengine.plugins.communitystore.ui;

import java.util.concurrent.ExecutionException;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import com.mirth.connect.client.ui.PlatformUI;

import org.openintegrationengine.plugins.communitystore.CommunityStoreServletInterface;

/**
 * Thin client wrapper around the Community Store servlet. Lazily resolves a dynamic proxy
 * of the shared {@link CommunityStoreServletInterface} from the connected {@code mirthClient}
 * and centralises the Jackson parsing of the raw JSON strings each operation returns.
 *
 * <p>All engine calls are gated by {@code Permissions.EXTENSIONS_MANAGE} server-side and must
 * be invoked off the EDT (callers wrap them in {@code SwingWorker}).
 */
class StoreServletClient {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private CommunityStoreServletInterface servlet;

    private CommunityStoreServletInterface svc() {
        if (servlet == null) {
            servlet = PlatformUI.MIRTH_FRAME.mirthClient.getServlet(CommunityStoreServletInterface.class);
        }
        return servlet;
    }

    JsonNode catalog(boolean refresh) throws Exception {
        return MAPPER.readTree(svc().getCatalog(refresh));
    }

    JsonNode docs(String id) throws Exception {
        return MAPPER.readTree(svc().getDocs(id));
    }

    JsonNode getSettings() throws Exception {
        return MAPPER.readTree(svc().getSettings());
    }

    JsonNode setSettings(String settingsJson) throws Exception {
        return MAPPER.readTree(svc().setSettings(settingsJson));
    }

    /**
     * Install (extensions) or import (content). {@code newLibrary}/{@code targetLibraryId}
     * apply only to a fresh standalone code-template install and are omitted otherwise.
     */
    JsonNode install(String id, String tag, String newLibrary, String targetLibraryId) throws Exception {
        ObjectNode req = MAPPER.createObjectNode();
        req.put("id", id);
        if (tag != null && !tag.isEmpty()) {
            req.put("tag", tag);
        }
        if (newLibrary != null && !newLibrary.isEmpty()) {
            req.put("newLibrary", newLibrary);
        }
        if (targetLibraryId != null && !targetLibraryId.isEmpty()) {
            req.put("targetLibraryId", targetLibraryId);
        }
        return MAPPER.readTree(svc().install(MAPPER.writeValueAsString(req)));
    }

    JsonNode removeContent(String id) throws Exception {
        ObjectNode req = MAPPER.createObjectNode();
        req.put("id", id);
        return MAPPER.readTree(svc().removeContent(MAPPER.writeValueAsString(req)));
    }

    /**
     * Unwrap a {@link SwingWorker}'s {@link ExecutionException} chain to the underlying cause,
     * so alerts show the engine's human message rather than a wrapper.
     */
    static Throwable unwrap(Throwable t) {
        while (t instanceof ExecutionException && t.getCause() != null) {
            t = t.getCause();
        }
        return t;
    }

    static String messageOf(Throwable t) {
        Throwable cause = unwrap(t);
        String m = cause.getMessage();
        return (m != null && !m.isEmpty()) ? m : cause.toString();
    }
}
