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
import com.mirth.connect.client.core.Permissions;
import com.mirth.connect.client.core.api.BaseServletInterface;
import com.mirth.connect.client.core.api.MirthOperation;
import com.mirth.connect.client.core.api.Param;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;

/**
 * REST surface for the Community Store, reachable at /api/extensions/communitystore.
 *
 * Every operation, including read paths, is gated by the engine's existing
 * {@link Permissions#EXTENSIONS_MANAGE} permission: store access is extension-install access,
 * nothing more and nothing less.
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

    @GET
    @Path("/catalog")
    @Operation(summary = "Returns the resolved store catalog with installed and update state.")
    @MirthOperation(name = "getCommunityStoreCatalog", display = "Get Community Store catalog", permission = Permissions.EXTENSIONS_MANAGE, auditable = false)
    public String getCatalog(@Param("refresh") @QueryParam("refresh") boolean refresh) throws ClientException;

    @GET
    @Path("/catalog/{id}/docs")
    @Operation(summary = "Returns the publisher documentation (store.md, docs/store.md, or README.md) for a catalog entry, read at its release tag.")
    @MirthOperation(name = "getCommunityStoreDocs", display = "Get Community Store extension documentation", permission = Permissions.EXTENSIONS_MANAGE, auditable = false)
    public String getDocs(@Param("id") @PathParam("id") String id) throws ClientException;

    @GET
    @Path("/settings")
    @Operation(summary = "Returns Community Store settings. The GitHub token is never included.")
    @MirthOperation(name = "getCommunityStoreSettings", display = "Get Community Store settings", permission = Permissions.EXTENSIONS_MANAGE, auditable = false)
    public String getSettings() throws ClientException;

    @PUT
    @Path("/settings")
    @Operation(summary = "Updates Community Store settings (custom sources, local blocklist, beta channel, GitHub token).")
    @MirthOperation(name = "setCommunityStoreSettings", display = "Update Community Store settings", permission = Permissions.EXTENSIONS_MANAGE)
    public String setSettings(@Param("settings") String settingsJson) throws ClientException;

    @POST
    @Path("/_install")
    @Operation(summary = "Downloads, verifies, and installs a catalog entry through the engine's extension installer.")
    @MirthOperation(name = "installCommunityStoreExtension", display = "Install extension from Community Store", permission = Permissions.EXTENSIONS_MANAGE)
    public String install(@Param("request") String requestJson) throws ClientException;

    @POST
    @Path("/_uninstall")
    @Operation(summary = "Marks a store-tracked extension for uninstallation on next restart.")
    @MirthOperation(name = "uninstallCommunityStoreExtension", display = "Uninstall extension from Community Store", permission = Permissions.EXTENSIONS_MANAGE)
    public String uninstall(@Param("request") String requestJson) throws ClientException;
}
