package org.openintegrationengine.plugins.communitystore;

import static org.junit.Assert.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import com.fasterxml.jackson.databind.node.*;
import com.mirth.connect.model.Channel;
import com.mirth.connect.model.codetemplates.*;
import com.mirth.connect.model.converters.ObjectXMLSerializer;
import com.mirth.connect.server.controllers.*;
import org.junit.*;
import org.mockito.MockedStatic;

/** Actual InstallService + engine XML serializer, controlled controller I/O. No database or engine startup. */
public class InstallServiceChecks {
    private MockedStatic<ControllerFactory> factoryStatic;
    private ControllerFactory factory;
    private ChannelController channels;
    private CodeTemplateController templates;
    private GitHubClient download;
    private StoreSettings settings;
    private InstallService service;
    private ObjectXMLSerializer serializer;
    private static boolean initialized;
    private final Map<String, Channel> channelRows = new HashMap<>();
    private final Map<String, CodeTemplate> templateRows = new HashMap<>();
    private final List<CodeTemplateLibrary> libraryRows = new ArrayList<>();

    @Before public void setup() throws Exception {
        factory = mock(ControllerFactory.class);
        factoryStatic = mockStatic(ControllerFactory.class);
        factoryStatic.when(ControllerFactory::getFactory).thenReturn(factory);
        channels = mock(ChannelController.class);
        templates = mock(CodeTemplateController.class);
        when(factory.createChannelController()).thenReturn(channels);
        when(factory.createCodeTemplateController()).thenReturn(templates);
        when(factory.createExtensionController()).thenReturn(mock(ExtensionController.class));
        ConfigurationController config = mock(ConfigurationController.class);
        when(config.getServerId()).thenReturn("test-server");
        when(factory.createConfigurationController()).thenReturn(config);
        when(factory.createEventController()).thenReturn(mock(EventController.class));
        serializer = ObjectXMLSerializer.getInstance();
        if (!initialized) { serializer.init("4.6.0"); initialized = true; }
        when(channels.getChannelById(anyString())).thenAnswer(inv -> channelRows.get(inv.getArgument(0)));
        when(channels.updateChannel(any(), any(), anyBoolean(), any())).thenAnswer(inv -> {
            assertTrue("channel write must hold native monitor",Thread.holdsLock(channels));
            Channel ch = inv.getArgument(0); channelRows.put(ch.getId(),ch); return true;
        });
        when(templates.getCodeTemplateById(anyString())).thenAnswer(inv -> templateRows.get(inv.getArgument(0)));
        when(templates.getLibraries(isNull(), eq(true))).thenAnswer(inv -> new ArrayList<>(libraryRows));
        when(templates.updateCodeTemplate(any(), any(), anyBoolean())).thenAnswer(inv -> {
            assertTrue("template write must hold native monitor",Thread.holdsLock(templates));
            CodeTemplate t = inv.getArgument(0); t.setRevision(t.getRevision()+1); templateRows.put(t.getId(),t); return true;
        });
        when(templates.updateLibraries(anyList(), any(), anyBoolean())).thenAnswer(inv -> {
            assertTrue("library write must hold native monitor",Thread.holdsLock(templates));
            List<CodeTemplateLibrary> list = new ArrayList<>(inv.getArgument(0)); libraryRows.clear(); libraryRows.addAll(list); return true;
        });
        download = mock(GitHubClient.class);
        settings = new StoreSettings();
        service = new InstallService(download, settings);
    }
    @After public void cleanup() { if (factoryStatic != null) factoryStatic.close(); }
    private ObjectNode entry(String type) {
        ObjectNode e = JsonNodeFactory.instance.objectNode();
        e.put("id","sample"); e.put("type",type); e.put("contentId","content-id"); e.put("name","Sample");
        e.put("tag","1.0.0"); e.put("version","1.0.0"); e.put("repo","owner/sample");
        e.put("assetUrl","https://example.invalid/artifact"); e.put("assetName","template.js"); e.put("compatible",true);
        return e;
    }
    private void artifact(String xml) throws Exception { when(download.downloadAsset(anyString())).thenReturn(xml.getBytes(StandardCharsets.UTF_8)); }
    private CodeTemplate template(String id, String code) {
        CodeTemplate t = new CodeTemplate(id); t.setName("Template " + id); t.setRevision(1);
        t.setProperties(new BasicCodeTemplateProperties(CodeTemplateProperties.CodeTemplateType.FUNCTION, code)); return t;
    }
    private void tracked(ObjectNode e, Object t) {
        ObjectNode record = JsonNodeFactory.instance.objectNode();
        record.put("hashFormat", ContentHash.FORMAT_VERSION);
        record.put("type",e.path("type").asText()); record.put("contentId",e.path("contentId").asText());
        record.put("version","1.0.0"); record.put("installedAt",System.currentTimeMillis());
        record.put("pristineHash", ContentHash.normalizedXmlHash(serializer.serialize(t)));
        settings.recordInstall(e.path("id").asText(),record);
        e.put("expectedContentHash",ContentHash.stateHash(serializer.serialize(t)));
    }
    @Test public void channelInstallReplayCannotOverwriteButCopyWorks() throws Exception {
        Channel channel = new Channel(); channel.setId("content-id"); channel.setName("Snapshot");
        artifact(serializer.serialize(channel)); ObjectNode e=entry("channel");
        service.install(e,1);
        assertThrows(IOException.class, () -> service.install(e,1));
        assertEquals(1,channelRows.size());
        e.put("mode","copy"); service.install(e,1); assertEquals(2,channelRows.size());
        assertEquals("Snapshot",channelRows.get("content-id").getName());
    }
    @Test public void channelUpgradeIsRejectedEvenWithConsent() throws Exception {
        Channel channel = new Channel(); channel.setId("content-id"); channel.setName("Snapshot");
        artifact(serializer.serialize(channel)); ObjectNode e=entry("channel"); e.put("mode","upgrade"); e.put("overwrite",true);
        assertThrows(IOException.class, () -> service.install(e,1));
        verify(channels,never()).updateChannel(any(),any(),anyBoolean(),any());
    }
    @Test public void freshTemplateValidatesDestinationBeforeWrite() throws Exception {
        artifact("return 1;"); ObjectNode e=entry("code-template"); e.put("targetLibraryId","deleted");
        assertThrows(IOException.class, () -> service.install(e,1));
        verify(templates,never()).updateCodeTemplate(any(),any(),anyBoolean());
    }
    @Test public void templateInstallReplayCannotOverwrite() throws Exception {
        artifact("return 1;"); ObjectNode e=entry("code-template"); e.put("newLibrary","Library");
        service.install(e,1);
        assertThrows(IOException.class, () -> service.install(e,1));
        assertEquals(1,templateRows.size()); assertEquals(1,libraryRows.size());
        assertEquals(ContentHash.FORMAT_VERSION,settings.getInstallLedger().path("sample").path("hashFormat").asInt());
    }
    @Test public void staleUpgradeAndStaleOverwriteWriteNothing() throws Exception {
        CodeTemplate t=template("content-id","return 1;"); templateRows.put(t.getId(),t);
        ObjectNode e=entry("code-template"); tracked(e,t); e.put("mode","upgrade");
        t.setName("A native edit after confirmation"); artifact("return 2;");
        assertThrows(IOException.class, () -> service.install(e,1));
        e.put("overwrite",true); assertThrows(IOException.class, () -> service.install(e,1));
        verify(templates,never()).updateCodeTemplate(any(),any(),anyBoolean());
        assertEquals("return 1;",t.getCode());
    }
    @Test public void currentExplicitOverwriteSucceedsAndRecordsNewBaseline() throws Exception {
        CodeTemplate t=template("content-id","return 1;"); templateRows.put(t.getId(),t);
        ObjectNode e=entry("code-template"); tracked(e,t); t.setName("My name");
        e.put("expectedContentHash",ContentHash.stateHash(serializer.serialize(t))); e.put("mode","upgrade"); artifact("return 2;");
        assertThrows(IOException.class, () -> service.install(e,1));
        e.put("overwrite",true); service.install(e,1);
        assertEquals("My name",templateRows.get(t.getId()).getName()); assertEquals("return 2;",templateRows.get(t.getId()).getCode());
        assertEquals(ContentHash.normalizedXmlHash(serializer.serialize(templateRows.get(t.getId()))),settings.getInstallLedger().path("sample").path("pristineHash").asText());
    }
    @Test public void legacyHashRequiresExplicitConsent() throws Exception {
        CodeTemplate t=template("content-id","return 1;"); templateRows.put(t.getId(),t);
        ObjectNode e=entry("code-template"); tracked(e,t); settings.getInstallLedger().withObject("/sample").remove("hashFormat");
        e.put("mode","upgrade"); artifact("return 2;");
        assertThrows(IOException.class, () -> service.install(e,1));
        e.put("overwrite",true); service.install(e,1);
    }
    @Test public void libraryCannotCaptureForeignTemplate() throws Exception {
        CodeTemplate foreign=template("foreign","return 'mine';"); templateRows.put(foreign.getId(),foreign);
        CodeTemplateLibrary library=new CodeTemplateLibrary(); library.setId("content-id"); library.setName("Incoming");
        library.setCodeTemplates(new ArrayList<>(List.of(template("foreign","return 'theirs';"))));
        artifact(serializer.serialize(library));
        assertThrows(IOException.class, () -> service.install(entry("code-template-library"),1));
        verify(templates,never()).updateCodeTemplate(any(),any(),anyBoolean());
    }
    @Test public void binaryChecksumAndPreflightFailuresNeverReachExtractor() throws Exception {
        ObjectNode e=entry("plugin"); e.put("assetName","sample.zip");
        byte[] bad=ExtensionPreflightTest.zip("other/plugin.xml",ExtensionPreflightTest.descriptor("pluginMetaData","other","1.0.0"));
        when(download.downloadAsset(anyString())).thenReturn(bad);
        e.put("sha256","0".repeat(64)); assertThrows(IOException.class, () -> service.install(e,1));
        e.put("sha256",ContentHash.sha256Hex(bad)); assertThrows(IOException.class, () -> service.install(e,1));
        verify(factory.createExtensionController(),never()).extractExtension(any());
    }
    @Test public void validBinaryStagesThroughEngineAndRecordsLedger() throws Exception {
        ObjectNode e=entry("plugin"); e.put("assetName","sample.zip");
        byte[] bytes=ExtensionPreflightTest.zip("sample/plugin.xml",ExtensionPreflightTest.plugin());
        when(download.downloadAsset(anyString())).thenReturn(bytes); e.put("sha256",ContentHash.sha256Hex(bytes));
        ExtensionController.InstallationResult result=mock(ExtensionController.InstallationResult.class);
        when(factory.createExtensionController().extractExtension(any())).thenReturn(result);
        assertTrue(service.install(e,1).path("restartRequired").asBoolean());
        assertEquals("1.0.0",settings.getInstallLedger().path("sample").path("version").asText());
        verify(factory.createExtensionController(),times(1)).extractExtension(any());
    }
    @Test public void deployedEngineWriteMethodsUseTheMonitorsWeHold() throws Exception {
        assertTrue(java.lang.reflect.Modifier.isSynchronized(DefaultCodeTemplateController.class.getMethod("updateCodeTemplate", CodeTemplate.class, com.mirth.connect.model.ServerEventContext.class, boolean.class).getModifiers()));
        assertTrue(java.lang.reflect.Modifier.isSynchronized(DefaultCodeTemplateController.class.getMethod("updateLibraries", List.class, com.mirth.connect.model.ServerEventContext.class, boolean.class).getModifiers()));
        assertTrue(java.lang.reflect.Modifier.isSynchronized(DefaultChannelController.class.getMethod("updateChannel", Channel.class, com.mirth.connect.model.ServerEventContext.class, boolean.class, Calendar.class).getModifiers()));
    }
    @Test public void editDuringDownloadInvalidatesConfirmation() throws Exception {
        CodeTemplate t=template("content-id","return 1;"); templateRows.put(t.getId(),t);
        ObjectNode e=entry("code-template"); tracked(e,t); e.put("mode","upgrade");
        when(download.downloadAsset(anyString())).thenAnswer(inv -> { t.setName("Edited while downloading"); return "return 2;".getBytes(StandardCharsets.UTF_8); });
        assertThrows(IOException.class, () -> service.install(e,1));
        verify(templates,never()).updateCodeTemplate(any(),any(),anyBoolean());
    }
    @Test public void libraryLiteralEditIsDetectedAndCopyKeepsOriginal() throws Exception {
        CodeTemplate original=template("member","return 'a  b';"); templateRows.put(original.getId(),original);
        CodeTemplateLibrary library=new CodeTemplateLibrary(); library.setId("content-id"); library.setName("Library");
        library.setCodeTemplates(new ArrayList<>(List.of(original))); libraryRows.add(library);
        ObjectNode e=entry("code-template-library"); tracked(e,library); e.put("mode","upgrade");
        String published=serializer.serialize(library);
        ((BasicCodeTemplateProperties)original.getProperties()).setCode("return 'a b';");
        e.put("expectedContentHash",ContentHash.stateHash(serializer.serialize(library)));
        artifact(published);
        assertThrows(IOException.class, () -> service.install(e,1));
        verify(templates,never()).updateCodeTemplate(any(),any(),anyBoolean());
        e.put("mode","copy"); service.install(e,1);
        assertEquals("return 'a b';",templateRows.get("member").getCode());
        assertEquals(2,libraryRows.size()); assertEquals(2,templateRows.size());
    }
    @Test public void catalogConsentTokenRoundTripsIntoUpgrade() throws Exception {
        CodeTemplate t=template("content-id","return 1;"); templateRows.put(t.getId(),t);
        ObjectNode e=entry("code-template"); tracked(e,t);
        when(templates.getCodeTemplates(isNull())).thenReturn(new ArrayList<>(List.of(t)));
        CatalogService catalog=new CatalogService(download,settings);
        ObjectNode cache=JsonNodeFactory.instance.objectNode(); cache.putArray("entries").add(e); cache.putArray("errors");
        java.lang.reflect.Field cached=CatalogService.class.getDeclaredField("cachedCatalog"); cached.setAccessible(true); cached.set(catalog,cache);
        java.lang.reflect.Field time=CatalogService.class.getDeclaredField("cachedAtMillis"); time.setAccessible(true); time.set(catalog,System.currentTimeMillis());
        ObjectNode offered=catalog.findEntry("sample");
        assertFalse(offered.path("modified").asBoolean());
        assertTrue(offered.path("driftTracked").asBoolean());
        assertEquals(ContentHash.stateHash(serializer.serialize(t)),offered.path("expectedContentHash").asText());
        offered.put("mode","upgrade"); artifact("return 2;"); service.install(offered,1);
        assertEquals("return 2;",templateRows.get("content-id").getCode());
    }
    @Test public void nativeEditorCannotEnterBetweenChannelCheckAndWrite() throws Exception {
        Channel ch=new Channel(); ch.setId("content-id"); ch.setName("Snapshot"); artifact(serializer.serialize(ch));
        CountDownLatch attempted=new CountDownLatch(1); AtomicBoolean entered=new AtomicBoolean(false);
        Thread editor=new Thread(() -> { attempted.countDown(); synchronized(channels) { entered.set(true); } });
        doAnswer(inv -> {
            assertTrue(Thread.holdsLock(channels)); editor.start(); assertTrue(attempted.await(2,TimeUnit.SECONDS));
            assertFalse("native writer entered while store holds check/write monitor",entered.get()); return true;
        }).when(channels).updateChannel(any(),any(),anyBoolean(),any());
        try { service.install(entry("channel"),1); }
        finally { editor.join(2000); }
        assertTrue(entered.get()); assertFalse(editor.isAlive());
    }
}
