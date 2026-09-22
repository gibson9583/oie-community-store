package org.openintegrationengine.plugins.communitystore;

import static org.junit.Assert.*;
import java.io.IOException;
import org.junit.Test;

public class ContentSafetyTest {
    private static String hash(String code) { return ContentHash.normalizedXmlHash("<library><code>" + code + "</code></library>"); }
    @Test public void preservesLiteralSpacesAndNewlines() {
        assertNotEquals(hash("return 'a  b'"), hash("return 'a b'"));
        assertNotEquals(hash("return\nvalue"), hash("return value"));
        assertNotEquals(hash(" "), hash(""));
    }
    @Test public void ignoresOnlySaveMetadataAndElementIndentation() {
        assertEquals(ContentHash.normalizedXmlHash("<library><revision>1</revision><code>x  y</code></library>"),
            ContentHash.normalizedXmlHash("<library>\n <revision>2</revision>\n <code>x  y</code>\n</library>"));
        assertNotEquals(ContentHash.stateHash("<revision>1</revision>"), ContentHash.stateHash("<revision>2</revision>"));
    }
    @Test public void preservesMetadataEditsAndEscapedCode() {
        assertNotEquals(ContentHash.normalizedXmlHash("<template><name>A</name><code>x</code></template>"),
            ContentHash.normalizedXmlHash("<template><name>B</name><code>x</code></template>"));
        assertNotEquals(hash("'&lt;revision&gt;a&lt;/revision&gt;'"), hash("'&lt;revision&gt;b&lt;/revision&gt;'"));
    }
    @Test public void rejectsUnsafeOrMalformedXml() {
        assertThrows(IllegalArgumentException.class, () -> ContentHash.normalizedXmlHash("<!DOCTYPE x [<!ENTITY y SYSTEM 'file:///etc/passwd'>]><x>&y;</x>"));
        assertThrows(IllegalArgumentException.class, () -> ContentHash.normalizedXmlHash("<broken>"));
    }
    @Test public void channelInstallIsCreateOnly() throws Exception {
        ContentMutationGuard.check("channel", "install", null, "", false, false);
        assertThrows(IOException.class, () -> ContentMutationGuard.check("channel", "install", "present", "", false, true));
        assertThrows(IOException.class, () -> ContentMutationGuard.check("channel", "upgrade", "present", "present", false, true));
        ContentMutationGuard.check("channel", "copy", "present", "", true, false);
    }
    @Test public void updateRequiresCurrentConsentEvenForExplicitOverwrite() throws Exception {
        ContentMutationGuard.check("code-template", "upgrade", "now", "now", false, false);
        ContentMutationGuard.check("code-template", "upgrade", "now", "now", true, true);
        for (boolean overwrite : new boolean[]{false,true}) {
            assertThrows(IOException.class, () -> ContentMutationGuard.check("code-template", "upgrade", "now", "before", true, overwrite));
            assertThrows(IOException.class, () -> ContentMutationGuard.check("code-template", "upgrade", "now", "", false, overwrite));
        }
        assertThrows(IOException.class, () -> ContentMutationGuard.check("code-template-library", "upgrade", "now", "now", true, false));
        assertThrows(IOException.class, () -> ContentMutationGuard.check("code-template", "upgrade", null, "before", false, true));
    }
    @Test public void legacyInstallCannotBypassUpdateGuard() {
        assertThrows(IOException.class, () -> ContentMutationGuard.check("code-template", "install", "now", "now", false, true));
        assertThrows(IOException.class, () -> ContentMutationGuard.check("code-template", "remove", "now", "now", false, true));
    }
}
