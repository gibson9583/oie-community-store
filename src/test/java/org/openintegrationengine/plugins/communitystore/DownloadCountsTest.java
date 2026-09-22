package org.openintegrationengine.plugins.communitystore;

import org.junit.Test;
import static org.junit.Assert.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.*;
import java.io.IOException;

public class DownloadCountsTest {
    private static final ObjectMapper J = new ObjectMapper();
    private ObjectNode entry() { return J.createObjectNode().put("assetUrl", "https://github.com/owner/repo/releases/download/v2.0.0/plugin-2.0.0.zip").put("assetName", "plugin-2.0.0.zip").put("version", "2.0.0"); }
    private ObjectNode asset(long id, String name, long count) { return J.createObjectNode().put("id",id).put("name",name).put("download_count",count); }
    @Test public void embeddedReleaseAssetsNeedOnlyOneRequest() throws Exception {
        GitHubClient g=mock(GitHubClient.class);
        ObjectNode release=J.createObjectNode().put("id",1).put("tag_name","v2.0.0");
        release.set("assets",J.createArrayNode().add(asset(1,"plugin-2.0.0.zip",15)));
        when(g.getApiJson(contains("/releases?"))).thenReturn(J.createArrayNode().add(release));
        assertEquals(15,new DownloadCounts(g).get(entry()).path("count").asLong());
        verify(g,times(1)).getApiJson(anyString());
    }
    @Test public void rateLimitIsExplainedAndCachedWithoutPartialCount() throws Exception {
        GitHubClient g=mock(GitHubClient.class);
        when(g.getApiJson(anyString())).thenThrow(new IOException("GitHub rate limit or access denied (HTTP 403)"));
        DownloadCounts counts=new DownloadCounts(g);
        assertEquals("rate_limit_or_access_denied",counts.get(entry()).path("reason").asText());
        assertFalse(counts.get(entry()).has("count"));
        verify(g,times(1)).getApiJson(anyString());
    }
    @Test public void sumsAllVersionsExcludesChecksumsVariantsAndDraftsAndCaches() throws Exception {
        GitHubClient g=mock(GitHubClient.class);
        when(g.getApiJson(contains("/releases?"))).thenReturn(J.readTree("[{\"id\":1,\"tag_name\":\"v1.0.0\"},{\"id\":2,\"tag_name\":\"v2.0.0\",\"prerelease\":true},{\"id\":3,\"draft\":true}]"));
        when(g.getApiJson(contains("/1/assets?"))).thenReturn(J.createArrayNode().add(asset(1,"plugin-1.0.0.zip",12)).add(asset(2,"plugin-1.0.0.zip.sha256",50)).add(asset(3,"plugin-1.0.0-sources.zip",70)));
        when(g.getApiJson(contains("/2/assets?"))).thenReturn(J.createArrayNode().add(asset(4,"plugin-2.0.0.zip",8)));
        DownloadCounts counts=new DownloadCounts(g);
        assertEquals(20,counts.get(entry()).path("count").asLong());
        assertEquals(20,counts.get(entry()).path("count").asLong());
        verify(g,times(3)).getApiJson(anyString());
    }
    @Test public void partialFailureNeverPublishesPartialCount() throws Exception {
        GitHubClient g=mock(GitHubClient.class);
        when(g.getApiJson(contains("/releases?"))).thenReturn(J.readTree("[{\"id\":1,\"tag_name\":\"v2.0.0\"},{\"id\":2}]"));
        when(g.getApiJson(contains("/1/assets?"))).thenReturn(J.createArrayNode().add(asset(1,"plugin-2.0.0.zip",12)));
        when(g.getApiJson(contains("/2/assets?"))).thenThrow(new IOException("rate limited"));
        assertFalse(new DownloadCounts(g).get(entry()).has("count"));
    }
    @Test public void zeroIsAvailableAndUnsupportedHostDoesNotFetch() throws Exception {
        GitHubClient g=mock(GitHubClient.class);
        when(g.getApiJson(contains("/releases?"))).thenReturn(J.readTree("[{\"id\":1,\"tag_name\":\"v2.0.0\"}]"));
        when(g.getApiJson(contains("/assets?"))).thenReturn(J.createArrayNode().add(asset(1,"plugin-2.0.0.zip",0)));
        DownloadCounts counts=new DownloadCounts(g);
        assertEquals(0,counts.get(entry()).path("count").asLong(-1));
        assertFalse(counts.get(entry().put("assetUrl","https://elsewhere.test/file.zip")).has("count"));
        verify(g,times(2)).getApiJson(anyString());
    }
    @Test public void paginatesReleasesAndAssetsAndDeduplicates() throws Exception {
        GitHubClient g=mock(GitHubClient.class); ArrayNode releases=J.createArrayNode(), assets=J.createArrayNode();
        for(int i=0;i<100;i++){releases.add(J.createObjectNode().put("id",1).put("tag_name","v2.0.0"));assets.add(asset(1,"plugin-2.0.0.zip",3));}
        when(g.getApiJson(contains("/releases?per_page=100&page=1"))).thenReturn(releases);
        when(g.getApiJson(contains("/releases?per_page=100&page=2"))).thenReturn(J.createArrayNode());
        when(g.getApiJson(contains("/assets?per_page=100&page=1"))).thenReturn(assets);
        when(g.getApiJson(contains("/assets?per_page=100&page=2"))).thenReturn(J.createArrayNode().add(asset(2,"plugin-2.0.0.zip",4)));
        assertEquals(7,new DownloadCounts(g).get(entry()).path("count").asLong());
        verify(g,times(4)).getApiJson(anyString());
    }
}
