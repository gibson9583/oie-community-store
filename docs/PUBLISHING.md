# Publishing to the OIE Community Store

This guide is everything a plugin author needs to make an extension installable
through the OIE Community Store. There is no project-hosted infrastructure and no
account to register: the store reads directly from **your GitHub repository and its
Releases**. You publish an extension by tagging a release with the right assets and
a small manifest; the store discovers it, verifies it, and installs it through the
engine's own extension installer.

- Manifest reference: [`oie.schema.json`](./oie.schema.json)
- Worked examples: [`examples/oie.json`](../examples/oie.json),
  [`examples/store.md`](../examples/store.md),
  [`examples/release.yml`](../examples/release.yml)

---

## How it works (the 30-second version)

1. Your repository is **listed** — either it lives in a listed GitHub organization
   and carries the store topic, or it is added by PR to this repo's source list, or
   an administrator adds it at runtime.
2. The store reads your repository's **GitHub Releases**, newest first, and for each
   release reads **`oie.json`** at the release tag.
3. It offers the **newest release compatible** with the running engine.
4. On install, the engine downloads the release's **`.zip` asset**, verifies it
   against the published **`.sha256`** sidecar, pre-flights the zip, and installs it
   through the same code path as a manual extension install.

The browser never talks to GitHub; the engine backend does all of it, gated by the
engine's existing **manage-extensions** permission.

---

## Quick-start checklist

- [ ] Your extension builds into a normal engine extension **`.zip`** (single
      top-level folder containing `plugin.xml`).
- [ ] The **`path`** attribute in `plugin.xml` is a stable id (e.g. `sqs-connector`).
- [ ] **`oie.json`** exists at the repository root; its **`id`** equals that `path`.
- [ ] Repository has the **`oie-plugin`** topic (for organization discovery), or you
      arrange listing another way (see [Getting listed](#getting-listed)).
- [ ] Each **GitHub Release** attaches the `.zip` **and** a `<name>.zip.sha256`.
- [ ] The release **tag** matches `oie.json` `version` (a leading `v` is fine).
- [ ] `minEngineVersion` / `maxEngineVersion` describe the engines you support.

Automate the release parts with the sample workflow in
[`examples/release.yml`](../examples/release.yml).

---

## 1. The `oie.json` manifest

Place `oie.json` at the **root** of your repository. It is read **at each release
tag**, so its contents are version-specific — bump `version` (and the engine range,
if it changed) in the same commit you tag.

```json
{
    "schemaVersion": 1,
    "id": "sqs-connector",
    "name": "SQS Source Connector",
    "description": "Consume messages from Amazon SQS queues as a channel source.",
    "type": "connector",
    "version": "1.4.0",
    "minEngineVersion": "4.5.0",
    "maxEngineVersion": null,
    "filename": "sqs-connector-{version}.zip",
    "restartRequired": true,
    "homepage": "https://github.com/acme-health/oie-sqs-connector",
    "documentation": "https://github.com/acme-health/oie-sqs-connector/wiki",
    "storeDocs": "docs/store.md",
    "license": "MPL-2.0",
    "authors": ["Acme Health Integration Team"],
    "keywords": ["aws", "sqs", "queue", "source"],
    "deprecated": false
}
```

### Field reference

| Field | Required | Notes |
|-------|:---:|-------|
| `schemaVersion` | ✓ | Always `1`. |
| `id` | ✓ | **Must equal the `path` attribute in your `plugin.xml`.** This is the join key: it ties the store listing to the engine's installed inventory for update detection, and the installer refuses an artifact whose descriptor `path` disagrees. Keep it stable across versions. |
| `name` | ✓ | Display name in the store. |
| `description` |  | One or two sentences. |
| `type` | ✓ | `connector`, `plugin`, `datatype`, `code-template-library`, or `channel`. See [Types](#types). |
| `version` | ✓ | **Must equal the release tag**, minus an optional leading `v` (tag `v1.4.0` → `1.4.0`). Must be semver-comparable so the store can detect updates. |
| `minEngineVersion` |  | Lowest engine version supported (inclusive). Omit or `null` for no lower bound. |
| `maxEngineVersion` |  | Highest engine version supported (inclusive). Omit or `null` for no upper bound. |
| `filename` |  | Which release asset to install. Optional — see [Assets](#3-release-assets). Supports `{version}`. |
| `restartRequired` |  | Defaults to `true` for installable types. |
| `homepage` |  | Defaults to the GitHub repo URL. |
| `documentation` |  | External docs URL (rendered as a button). |
| `storeDocs` |  | Repo-relative path to in-store markdown. See [Store documentation](#4-store-documentation). Must be relative (no leading `/`, no `..`). |
| `license` |  | SPDX id, e.g. `MPL-2.0`. |
| `authors` |  | Array of names. |
| `keywords` |  | Array of search terms. |
| `deprecated` |  | Shows a **Deprecated** badge when `true`. |
| `deprecationMessage` |  | Explanation shown when deprecated (e.g. a replacement). |

Validate your manifest against [`oie.schema.json`](./oie.schema.json) in CI or your
editor.

### Types

`connector`, `plugin`, and `datatype` are **installable through the store today**.
`code-template-library` and `channel` are accepted in the manifest and will appear
in the catalog, but are **not yet installable** through the store — install those
manually for now.

---

## 2. The extension zip

Build your extension into a standard engine extension zip — the exact same artifact
a user would install manually through **Extensions**. Requirements the store's
pre-flight enforces before anything touches the extensions directory:

- A **single top-level folder** containing a descriptor at depth ≤ 1: `plugin.xml`
  (plugins/data types) or `source.xml` / `destination.xml` (connectors).
- The descriptor's **`path` attribute equals `oie.json` `id`**. A mismatch is
  rejected.
- **No path traversal**: entries may not be absolute, contain a `..`/`.` path
  segment, or use drive/UNC paths.
- Uncompressed download is capped at **200 MB**.

```
sqs-connector/
├── plugin.xml            <!-- path="sqs-connector" -->
├── sqs-connector.jar
└── ...
```

Installing runs the extension's code in the engine. The store performs **no code
review**; verification proves transport integrity (the bytes match the publisher's
checksum), not that the code is safe. Users are told this at the install prompt.

---

## 3. Release assets

Publish a **GitHub Release** for each version. The store scans the newest **15**
releases per repository.

Each release must attach **two** assets:

1. **The extension zip.** By default the store installs the release's *single* `.zip`
   asset. If a release has more than one `.zip`, declare which one in `oie.json`
   `filename` (with optional `{version}` substitution, e.g.
   `sqs-connector-{version}.zip`) — otherwise the release is ambiguous and won't
   install.
2. **A checksum sidecar** named exactly `<asset-name>.sha256`, e.g.
   `sqs-connector-1.4.0.zip.sha256`. Missing or mismatched checksums abort the
   install. Any of these formats parse:
   - bare hex — `9f86d0818...` (64 hex chars)
   - `sha256sum` output — `9f86d0818...  sqs-connector-1.4.0.zip`
   - BSD tag — `SHA256 (sqs-connector-1.4.0.zip) = 9f86d0818...`

Generate the sidecar in CI with `sha256sum "$ASSET" > "$ASSET.sha256"` (see the
[example workflow](../examples/release.yml)).

### Tags, versions, and pre-releases

- The release **tag** is the version. `oie.json` `version` must match it (a leading
  `v` is stripped for comparison).
- **Draft** releases are ignored.
- **Pre-releases** (e.g. `v1.4.0-rc1`) are hidden unless a store administrator has
  enabled the **beta channel** in Settings.

---

## 4. Store documentation

The store's detail view renders publisher markdown, read **at the release tag** so
docs are versioned with the artifact. It looks, in order, for:

1. the `storeDocs` path from `oie.json`, then
2. `store.md`, then
3. `docs/store.md`, then
4. `README.md`.

Authoring notes:

- **Relative links** resolve to your repository at the release tag (GitHub *blob*
  view). Relative paths are resolved from the **repository root**, not the doc's
  folder — a `docs/store.md` that shows a screenshot in the same folder must
  reference it as `docs/screenshot.png`.
- **Relative images** are fetched by the engine at the release tag and inlined, so
  they render inside the administrator (which cannot load external image hosts).
  Use **raster** formats — `.png`, `.jpg`, `.gif`, `.webp`; **SVG is not inlined**.
  Keep images reasonably sized (each ≤ 5 MB, ≤ 25 images, ≤ 12 MB total per page).
- Rendering is **sanitized**: raw HTML in your markdown is escaped (not executed),
  and only `http`, `https`, `mailto`, and in-page `#` link targets are allowed —
  `javascript:`/`data:` and similar are dropped. Write plain GitHub-flavored
  markdown; embedded HTML will show as text.
- Documentation is capped at **512 KB**; longer files are truncated in the store
  (the full file stays in your repo).

See [`examples/store.md`](../examples/store.md).

---

## 5. Getting listed

A repository becomes visible in the store in any of three ways:

1. **Account + topic (self-service).** If your repository lives under an account
   listed as an `org` source — a GitHub **organization or a personal user account**
   (the default list includes `OpenIntegrationEngine`) — simply add the
   **`oie-plugin`** topic to the repository and cut a release. These sources
   enumerate every public, non-archived repo under the account carrying the topic —
   no registry change needed. (Up to 300 repos per account are scanned.)
2. **Add your repo to the bundled source list.** Open a PR to this repository adding
   a `repo` entry to [`src/main/resources/sources.json`](../src/main/resources/sources.json):
   ```json
   { "kind": "repo", "repo": "acme-health/oie-sqs-connector" }
   ```
3. **Administrator custom source.** An administrator can add your org or repo at
   runtime under the store's **Settings** tab (persists on their engine only).

---

## How resolution works

For each listed repository the store:

1. reads the newest 15 releases, skipping drafts (and pre-releases unless the beta
   channel is on);
2. reads `oie.json` at each release tag (a release with no `oie.json` is skipped);
3. offers the **newest release whose `minEngineVersion`/`maxEngineVersion` window
   contains the running engine version** ("newest compatible" — it keeps walking to
   older releases to find a compatible one);
4. if nothing is compatible, lists the newest release as **Incompatible** so users
   can see why.

**Updates** are detected by matching your `id` to an installed extension's path and
comparing versions with semver: an update is offered when the store's compatible
version is greater than what's installed.

---

## Troubleshooting — "why isn't my plugin showing up?"

| Symptom | Likely cause |
|---------|--------------|
| Not listed at all | Repo isn't discovered: missing `oie-plugin` topic, repo is archived/private, or the org/repo isn't a listed source. Refresh the catalog. |
| Listed but **Incompatible** | `minEngineVersion`/`maxEngineVersion` in the offered release don't include the running engine version. |
| Listed but **not installable** / "no unambiguous .zip asset" | The release has zero or multiple `.zip` assets and no `filename` in `oie.json`. |
| Install fails: **missing checksum** | No `<asset-name>.zip.sha256` on the release. |
| Install fails: **checksum verification FAILED** | The sidecar doesn't match the uploaded zip (regenerate it from the exact asset). |
| Install fails: **descriptor path does not match** | `plugin.xml` `path` ≠ `oie.json` `id`. |
| A newer version isn't offered as an update | The newer release is a pre-release (beta channel off), outside the newest 15 releases, incompatible with the engine, or its `version` isn't semver-greater. |
| Docs panel empty | No `storeDocs`/`store.md`/`docs/store.md`/`README.md` at the release tag. |

Rate-limited discovery (HTTP 403/429) usually means the engine is calling GitHub
unauthenticated — an administrator can add a GitHub personal access token in
Settings to raise the limit.

---

## Constraints at a glance

| Limit | Value |
|-------|-------|
| Releases scanned per repo | newest 15 |
| Repos scanned per org | 300 |
| Max artifact size | 200 MB |
| Max rendered docs | 512 KB |
| Allowed doc link schemes | `http`, `https`, `mailto`, `#` |
| Installable types | `connector`, `plugin`, `datatype` |
