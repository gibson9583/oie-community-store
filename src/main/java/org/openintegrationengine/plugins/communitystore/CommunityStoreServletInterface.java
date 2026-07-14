/*
 * OIE Community Store
 *
 * Published under the terms of the Mozilla Public License 2.0.
 */

package org.openintegrationengine.plugins.communitystore;

import javax.ws.rs.Consumes;
import javax.ws.rs.GET;
import javax.ws.rs.POST;
import javax.ws.rs.PUT;
import javax.ws.rs.Path;
import javax.ws.rs.PathParam;
import javax.ws.rs.Produces;
import javax.ws.rs.QueryParam;
import javax.ws.rs.core.MediaType;

import com.mirth.connect.client.core.ClientException;
import com.mirth.connect.client.core.api.BaseServletInterface;
import com.mirth.connect.client.core.api.MirthOperation;
import com.mirth.connect.client.core.api.Param;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

/**
 * REST surface for the Community Store, reachable at /api/extensions/communitystore.
 *
 * Operations are gated by the store's OWN extension permissions (declared via
 * {@code CommunityStoreServicePlugin.getExtensionPermissions()}): browse paths by
 * {@link #PERMISSION_VIEW}, everything that changes engine state or store
 * configuration by {@link #PERMISSION_MANAGE}. Without an authorization plugin
 * (e.g. RBAC) the engine's default controller permits everything, so behavior is
 * unchanged. NOTE: content installs (channels, code templates) run through the
 * engine's controllers server-side, so {@link #PERMISSION_MANAGE} is sufficient
 * for them — it is NOT additionally gated by manageChannels/manageCodeTemplates.
 * Grant it accordingly.
 *
 * Requests and responses are raw JSON strings (Jackson-produced) rather than typed model
 * classes. This is deliberate: it keeps third-party classes out of the engine's XStream
 * serialization pipeline and its security allowlist, and gives the web frontend clean JSON
 * without the single-element-list quirk of the XML-derived converters.
 */
@Path("/extensions/communitystore")
@Tag(name = "Extension Services")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public interface CommunityStoreServletInterface extends BaseServletInterface {

    public static final String PLUGIN_POINT = CommunityStoreServicePlugin.PLUGIN_POINT;

    /** Browse the catalog and read publisher docs. */
    public static final String PERMISSION_VIEW = "View Community Store";

    /** Install/update/remove store content and edit store settings. */
    public static final String PERMISSION_MANAGE = "Manage Community Store";

    @GET
    @Path("/catalog")
    @Operation(summary = "Returns the resolved store catalog with installed and update state.")
    @MirthOperation(name = "getCommunityStoreCatalog", display = "Get Community Store catalog", permission = PERMISSION_VIEW, auditable = false)
    public String getCatalog(@Param("refresh") @QueryParam("refresh") boolean refresh) throws ClientException;

    @GET
    @Path("/catalog/{id}/docs")
    @Operation(summary = "Returns the publisher documentation (store.md, docs/store.md, or README.md) for a catalog entry, read at its release tag.")
    @MirthOperation(name = "getCommunityStoreDocs", display = "Get Community Store extension documentation", permission = PERMISSION_VIEW, auditable = false)
    public String getDocs(@Param("id") @PathParam("id") String id) throws ClientException;

    @GET
    @Path("/settings")
    @Operation(summary = "Returns Community Store settings. The GitHub token is never included.")
    @MirthOperation(name = "getCommunityStoreSettings", display = "Get Community Store settings", permission = PERMISSION_MANAGE, auditable = false)
    public String getSettings() throws ClientException;

    @PUT
    @Path("/settings")
    @Operation(summary = "Updates Community Store settings (custom sources, local blocklist, beta channel, GitHub token).")
    @MirthOperation(name = "setCommunityStoreSettings", display = "Update Community Store settings", permission = PERMISSION_MANAGE)
    public String setSettings(@Param("settings") String settingsJson) throws ClientException;

    @POST
    @Path("/_removeContent")
    @Operation(summary = "Removes imported content (channel, code template, or code template library) and its install record. Deployed channels are refused.")
    @MirthOperation(name = "removeCommunityStoreContent", display = "Remove content installed from Community Store", permission = PERMISSION_MANAGE)
    public String removeContent(@Param("request") String requestJson) throws ClientException;

    @POST
    @Path("/_install")
    @Operation(summary = "Downloads, verifies, and installs a catalog entry — extensions through the engine's extension installer, content through its controllers. For content the request may carry a \"mode\": \"install\" (default), \"upgrade\" (in-place, refused for channels), or \"copy\" (fresh engine id, untracked).")
    @MirthOperation(name = "installCommunityStoreExtension", display = "Install extension from Community Store", permission = PERMISSION_MANAGE)
    public String install(@Param("request") String requestJson) throws ClientException;

}
