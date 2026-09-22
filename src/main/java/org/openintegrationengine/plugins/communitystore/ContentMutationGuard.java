/* Published under the terms of the Mozilla Public License 2.0. */
package org.openintegrationengine.plugins.communitystore;

import java.io.IOException;

/** Must run while holding the same engine-controller monitor used by native writes. */
final class ContentMutationGuard {
    private ContentMutationGuard() {}

    static void check(String type, String mode, String liveState, String expectedState,
            boolean modified, boolean overwrite) throws IOException {
        if (!java.util.Set.of("install", "upgrade", "copy").contains(mode)) throw new IOException("Unknown content operation.");
        if ("channel".equals(type) && "upgrade".equals(mode)) throw new IOException("Channels are snapshot-only. Install as a copy instead.");
        if ("copy".equals(mode)) return;
        if ("install".equals(mode)) {
            if (liveState != null) throw new IOException("This content is already installed. Refresh and review an update, or install as a copy.");
            return;
        }
        if (liveState == null) throw new IOException("This content is no longer installed. Refresh and install it again.");
        if (expectedState == null || expectedState.isBlank() || !expectedState.equals(liveState)) {
            throw new IOException("Content changed since you reviewed it. Refresh the store and confirm again. Nothing was overwritten.");
        }
        if (modified && !overwrite) throw new IOException("Local changes are present or unknown. Refresh and explicitly choose Overwrite or Install as copy.");
    }
}
