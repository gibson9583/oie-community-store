# Publishing to the OIE Community Store

This guide is everything an author needs to make a package installable through the
OIE Community Store. There is no project-hosted infrastructure and no account to
register, and there are **two ways to publish**:

* **The community catalog (recommended).** PR a small manifest — your artifact's URL
  (on **any** https host) plus its sha256 — to the
  [community catalog](https://github.com/gibson9583/oie-community-catalog). CI
  digest-verifies it before merge; every store picks it up on the next sync. Fully
  platform-agnostic.
* **Direct GitHub crawl (zero-setup on-ramp).** The store reads your GitHub
  repository and its Releases directly: tag a release with the right assets and an
  `oie.json` manifest, and you appear in any store that lists your repo/org — no
  registry change at all. This guide's remaining sections describe this path.

Either way the engine downloads, sha256-verifies, and installs everything itself.

- Manifest reference: [`oie.schema.json`](./oie.schema.json)
- Worked examples: [`examples/oie.json`](../examples/oie.json),
  [`examples/store.md`](../examples/store.md),
  [`examples/release.yml`](../examples/release.yml)

---

## How the GitHub crawl works (the 30-second version)

1. Your repository is **listed** — either it lives under a listed GitHub organization
   or user account and carries the store topic, or it is added by PR to this repo's
   source list, or an administrator adds it at runtime.
2. The store reads your repository's **GitHub Releases**, newest first, and for each
   release reads **`oie.json`** at the release tag. (Content collections with no
   releases resolve from the default branch — see
   [Content collections](#content-collections).)
3. It offers the **newest release compatible** with the running engine.
4. On install, the engine downloads the artifact, verifies it (the `.zip`'s
   **`.sha256`** sidecar for extensions), pre-flights, and installs — extensions
   through the engine's own extension installer, content through the engine's
   import APIs.

The browser never talks to GitHub; the engine backend does all of it, gated by the
store's own permissions (**View Community Store** for browsing, **Manage Community
Store** for installs and settings) when an authorization plugin such as RBAC is
installed — otherwise everything is permitted, as before.

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
    "ui": ["web", "swing"],
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
| `type` | ✓ | `connector`, `plugin`, `datatype`, `channel`, `code-template`, or `code-template-library`. See [Types](#types). |
| `ui` |  | UI surfaces the package ships: `["web"]`, `["swing"]`, `["web", "swing"]`, or `[]` for a server-only package with no UI. Omit it to be shown in both stores. |
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

All six types install through the store, by two different mechanisms:

* **Extensions** — `connector`, `plugin`, `datatype`: a built `.zip` installed through
  the engine's extension installer; an engine **restart** activates them.
* **Content** — `channel`, `code-template`, `code-template-library`: XML exports
  **imported** through the engine's own APIs; they take effect **immediately**, no
  restart. A standalone `code-template` prompts the user to add it to a new or
  existing library at install time, and can be published as a plain **`.js` file**
  instead of an XML export (see
  [Code templates as raw JS files](#code-templates-as-raw-js-files)). Content is
  published via a **collection manifest** (see
  [Content collections](#content-collections)) and installs as a snapshot the user
  owns from then on (see [Content is a snapshot](#content-is-a-snapshot)).

---

## Content collections

One repository can publish many pieces of content — channels, code templates, and
code template libraries — through a single `oie.json` with an **`items`** array
(see [connect-examples](https://github.com/gibson9583/connect-examples) for a
complete worked example):

```json
{
    "schemaVersion": 1,
    "name": "My Examples",
    "publisher": "Acme Health",
    "license": "MPL-2.0",
    "items": [
        {
            "id": "example-adt-router",
            "type": "channel",
            "name": "ADT Router",
            "description": "Routes ADT messages by event type.",
            "minEngineVersion": "4.0.0",
            "contentId": "6de4dab6-cbb8-4840-87bb-31a85fab9101",
            "artifact": "Channels/ADT Router/ADT Router.xml",
            "storeDocs": "Channels/ADT Router/README.md"
        }
    ]
}
```

Per item:

* **`id`** — stable, store-wide unique id for the item.
* **`type`** — `channel`, `code-template`, or `code-template-library` (extension
  types are allowed too, but usually belong in single manifests).
* **`artifact`** — repo-relative path of the installable file — an engine XML
  export, or a `.js` file for code templates (see
  [Code templates as raw JS files](#code-templates-as-raw-js-files)) — written as a
  plain path (spaces are fine; the store URL-encodes it). Fetched raw at the
  release tag.
* **`contentId`** — the engine id (UUID) inside the artifact. This is how the store
  detects the item is installed and how code-template upgrades find the object to
  update; content items should always declare it and keep it stable across
  versions.
* **`storeDocs`** — repo-relative markdown rendered in the item's detail view.
  Convention: a `README.md` in the same folder as the artifact.
* `name`, `description`, `minEngineVersion`/`maxEngineVersion`, `documentation`,
  `keywords`, `deprecated` — as in single manifests; unset fields inherit from the
  collection's top level.

**No release required.** When a repository has no GitHub releases, the store resolves
a collection manifest from the **default branch tip** — publishing is just a push.
(Repositories *with* releases are read at the newest usable release tag, which pins
content to that tag.) Since branch content is mutable, prefer submitting content to
the [community catalog](https://github.com/gibson9583/oie-community-catalog), where
each version carries a `sha256` that the engine verifies before import.

### Content is a snapshot

Installing content **imports a copy** into the user's engine. From that moment the
copy is theirs to edit, and the store never modifies or deletes it without asking.
The two kinds of content behave differently:

**Channels are a snapshot gallery.** A user imports your channel once; every install
after that — including when you publish a newer version, which the store announces as
"newer snapshot available" — lands as a **separate copy** alongside whatever they
have. The store never upgrades a channel in place and **never deletes one**: users
delete channels from the Channels view (undeploying first), like any other channel.

**Code templates and libraries** offer an in-place upgrade, with modification
protection: a user who has edited their installed copy is warned before anything is
overwritten and can take the new version as a copy instead. These can also be
removed through the store's Installed tab.

### Code templates as raw JS files

A code template does not have to be an engine XML export — you can publish the
function itself as a single **`.js` file**, and the store wraps it into a code
template at install time.

```js
/**
	Formats an HL7 TS value (YYYYMMDDHHMMSS) as ISO-8601.

	@param {String} ts - The HL7 timestamp to convert.
	@return {String} The ISO-8601 representation.
*/
function formatHl7Timestamp(ts) {
    // ...
}
```

Declare it as a normal content item whose artifact ends in `.js`:

```json
{
    "id": "format-hl7-timestamp",
    "type": "code-template",
    "name": "Format HL7 Timestamp",
    "description": "Formats HL7 TS values as ISO-8601.",
    "contentId": "0b9e2f43-6a4e-45c1-9f6d-2f6d3c1a7e58",
    "artifact": "CodeTemplates/format-hl7-timestamp-{version}.js"
}
```

Rules:

* **`type`** must be `code-template`; one function file per item.
* **`contentId`** is a UUID you generate **once** (e.g. with `uuidgen`) and never
  change — it is the template's identity across versions, letting the store see
  that the template is installed and offer upgrades. Changing it makes the next
  version look like a brand-new template.
* The artifact's filename must end in **`.js`** (after `{version}` substitution, so
  `my-fn-{version}.js` works).
* Start the file with a **JSDoc block** — the engine parses it into the template's
  description, shown in the administrators and in code auto-completion.
* At install, the file's contents become the template code verbatim, the manifest
  `name` becomes the template name, and the result is a standard **function**
  template the user can use like any other. When you publish a new version, the
  upgrade replaces **only the code**, so a user's local adjustments (name, context
  settings) survive.

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

- **Relative links and images resolve against the doc's own folder** — the same
  semantics GitHub uses when rendering the file. A `docs/store.md` showing a
  screenshot in the same folder references it as `screenshot.png`. (For images the
  store also falls back to the repository root, for docs written to the older
  root-relative rule.)
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

A repository becomes visible in the store in any of these ways (the first is the
recommended, platform-agnostic path):

1. **Submit to the community catalog (recommended).** Open a PR to the
   [community catalog](https://github.com/gibson9583/oie-community-catalog) adding a
   small manifest with your artifact's URL and sha256 — the artifact itself can live
   on **any** https host, not just GitHub. CI verifies the digest before merge, and
   every connected store picks the package up on its next sync. See the catalog
   README for the manifest shape.

   If your artifact is a GitHub release asset, you can **automate this**: the
   catalog hosts a reusable workflow that files the PR for you on every release —
   copy one caller file and add one secret. See
   ["Publishing automatically"](https://github.com/gibson9583/oie-community-catalog#publishing-automatically-reusable-workflow)
   in the catalog README.

2. **Account + topic (self-service).** If your repository lives under an account
   listed as an `org` source — a GitHub **organization or a personal user account**
   (the default list includes `OpenIntegrationEngine`) — simply add the
   **`oie-plugin`** topic to the repository and cut a release. These sources
   enumerate every public, non-archived repo under the account carrying the topic —
   no registry change needed. (Up to 300 repos per account are scanned.)
3. **Add your repo to the bundled source list.** Open a PR to this repository adding
   a `repo` entry to [`src/main/resources/sources.json`](../src/main/resources/sources.json):
   ```json
   { "kind": "repo", "repo": "acme-health/oie-sqs-connector" }
   ```
4. **Administrator custom source.** An administrator can add your org or repo at
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
| Installable types | `connector`, `plugin`, `datatype` (extensions — restart required) · `channel`, `code-template`, `code-template-library` (content — imported, no restart) |
