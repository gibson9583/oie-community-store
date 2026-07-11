/*
 * OIE Community Store — Swing Administrator client.
 *
 * Published under the terms of the Mozilla Public License 2.0.
 */

package org.openintegrationengine.plugins.communitystore.ui;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Shared-contract UI surface filter, applied client-side against a catalog entry's
 * offered-version {@code ui} array.
 *
 * <p>An entry is HIDDEN iff its {@code ui} is present AND non-empty AND does not include
 * the client's surface. Content (no {@code ui}) and server-only / ui-less extensions
 * (empty {@code ui}) are always shown. This is orthogonal to engine min/max-version
 * compatibility, which is a separate, unchanged filter.
 */
final class SurfaceFilter {

    /** This client's surface. The web frontend uses {@code "web"}. */
    static final String SWING = "swing";

    private SurfaceFilter() {
    }

    static boolean isVisibleForSurface(JsonNode entry, String surface) {
        JsonNode ui = entry.get("ui");
        if (ui == null || !ui.isArray() || ui.size() == 0) {
            // absent or [] -> content / server-only -> always show
            return true;
        }
        for (JsonNode s : ui) {
            if (surface.equals(s.asText())) {
                return true;
            }
        }
        // present & non-empty & excludes our surface -> HIDE
        return false;
    }
}
