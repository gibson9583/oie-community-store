package org.openintegrationengine.plugins.communitystore;

import static org.junit.Assert.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.zip.*;
import org.junit.Test;

public class ExtensionPreflightTest {
    static String descriptor(String kind, String id, String version) {
        return "<" + kind + " path=\"" + id + "\"><pluginVersion>" + version + "</pluginVersion></" + kind + ">";
    }
    static byte[] zip(String... pairs) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(out)) {
            for (int i=0;i<pairs.length;i+=2) {
                zip.putNextEntry(new ZipEntry(pairs[i])); zip.write(pairs[i+1].getBytes(StandardCharsets.UTF_8)); zip.closeEntry();
            }
        }
        return out.toByteArray();
    }
    static String plugin() { return descriptor("pluginMetaData","sample","1.0.0"); }
    static void reject(String... pairs) throws Exception {
        byte[] bytes = zip(pairs);
        assertThrows(Exception.class, () -> ExtensionPreflight.validate(bytes,"sample","1.0.0"));
    }
    @Test public void acceptsPluginAndConnectorPair() throws Exception {
        ExtensionPreflight.validate(zip("sample/", "", "sample/plugin.xml", plugin(), "sample/lib/example.jar", "bytes"), "sample", "v1.0.0");
        ExtensionPreflight.validate(zip("sample/source.xml", descriptor("connectorMetaData","sample","1.0.0"),
            "sample/destination.xml", descriptor("connectorMetaData","sample","1.0.0")), "sample", "1.0.0");
    }
    @Test public void rejectsOtherPackagesInEitherOrder() throws Exception {
        reject("other/plugin.xml", descriptor("pluginMetaData","other","1.0.0"),"sample/plugin.xml",plugin());
        reject("sample/plugin.xml",plugin(),"other/plugin.xml",descriptor("pluginMetaData","other","1.0.0"));
    }
    @Test public void validatesEveryDescriptorIdentityAndVersion() throws Exception {
        reject("sample/plugin.xml",plugin(),"sample/source.xml",descriptor("connectorMetaData","other","1.0.0"));
        reject("sample/plugin.xml",plugin(),"sample/source.xml",descriptor("connectorMetaData","sample","2.0.0"));
        reject("sample/plugin.xml",descriptor("pluginMetaData","","1.0.0"));
        reject("sample/source.xml",descriptor("pluginMetaData","sample","1.0.0"));
        reject("sample/plugin.xml","<pluginMetaData path=\"sample\"/>");
    }
    @Test public void rejectsTraversalNestedDescriptorsAndCaseCollisions() throws Exception {
        for (String path : new String[]{"sample/../escape", "sample/./file", "sample//file", "sample/a\\b", "/sample/file", "sample/nested/plugin.xml", "sample/notplugin.xml", "sample/trailing.", "sample/file:ads"}) {
            reject("sample/plugin.xml",plugin(),path,"x");
        }
        reject("sample/plugin.xml",plugin(),"sample/PLUGIN.XML",plugin());
    }
    @Test public void rejectsNoDescriptorAndDoctype() throws Exception {
        reject("sample/file.jar","bytes");
        reject("sample/plugin.xml","<!DOCTYPE x [<!ENTITY y SYSTEM 'file:///etc/passwd'>]>"+plugin());
    }
    @Test public void boundsInflationAndDescriptorSize() throws Exception {
        byte[] bomb = zip("sample/plugin.xml",plugin(),"sample/big","x".repeat(8192));
        assertThrows(IOException.class, () -> ExtensionPreflight.validate(bomb,"sample","1.0.0",4096));
        reject("sample/plugin.xml"," ".repeat(ExtensionPreflight.MAX_DESCRIPTOR_BYTES+1));
    }
}
