# Community Store safety fixes and redesign

Validated locally on September 21, 2026. Scope: the five high-severity findings in the implementation review and the web administrator redesign. No deployment or release has been performed.

## Implemented behavior

- Remove has an explicit operation callback and invokes only the removal endpoint.
- Default content installation is create-only. Existing channels require copy mode; upgrades are rejected server-side.
- Template/library replacements require the catalog's `expectedContentHash`. Explicit overwrite consent is required for modified/unknown content. Both web and Swing clients send the reviewed token. The check occurs after download under the same controller monitor used by native writes.
- Fingerprint format 2 preserves exact code text, includes template metadata, and ignores only XML element-formatting whitespace and save metadata. Old hashes are treated as unknown instead of silently trusted. State tokens include revision changes, so change-and-undo also invalidates consent.
- ZIP validation requires a single matching root and validates every plugin/connector descriptor's identity and version. Traversal, duplicate/case-alias paths, nested descriptors, oversized descriptors, and excessive decompressed data are rejected before extraction.
- Web: full-width package table, status/type grouping and sorting, type filtering, wide package details modal, separate Discover/Installed/Updates views, scrolling table with fixed controls, OIE theme tokens and native controls, accessible selection/dialogs, explicit action errors, duplicate-submit protection, source-failure notices, and restart-pending results for installs staged in the current view session.

Destination validation now precedes fresh standalone-template writes. Incoming libraries cannot overwrite member IDs belonging to other content. These checks are necessary to keep the content replacement boundary intact.

## Validation matrix

| Scenario | Result / validation |
|---|---|
| Web Remove click, including real event dispatch | React DOM test: `_removeContent` only |
| Pristine update | React sends token without overwrite; service accepts matching state |
| Modified update | No write without explicit consent; current explicit overwrite succeeds |
| Stale upgrade / stale explicit overwrite | Service rejects both before any write |
| Edit during artifact download | Service rejects at the post-download state check |
| Catalog token → install service | Round-trip tested using real OIE XML serializer |
| Legacy hash / missing token | Fail closed; legacy baseline requires explicit overwrite |
| First channel install / repeat install | First succeeds, repeated install rejected |
| Installed channel upgrade / copy | Upgrade rejected, copy preserves original |
| Template default-install replay | Rejected without overwriting existing template |
| Library string literal / newline edits | Distinct drift fingerprints |
| Library copy with local changes | Original IDs and edited code preserved |
| Incoming library captures another template | Rejected before member writes |
| Deleted target library | No template write occurs |
| Concurrent native writer | Controlled thread cannot enter the monitor during check/write |
| Engine synchronization contract | Reflected actual engine controller methods are synchronized |
| Bad checksum / bad ZIP | Service never calls engine extraction |
| Valid extension ZIP | Service stages through engine API and records ledger |
| Connector source/destination pair | Accepted when both identities and versions match |
| Extra root / nested descriptor / version mismatch | Rejected |
| Traversal / case aliases / decompression limits | Rejected |
| Duplicate web confirmation | Exactly one request while pending |
| Stale server rejection | Error remains in dialog; consent token not silently refreshed |
| Copy flow | Sends copy mode and selected/new library, no overwrite token |
| Keyboard Escape | Cancels without mutation and restores focus |
| View-only / incompatible package | Mutation controls unavailable |
| Revoked installed package (web) | Remains visible in Installed |
| Staged extension (current web view session) | Persistent pending state; repeat action hidden |
| Cards / Updates | Selection and filtering operate on same catalog data |
| Publisher markdown | Existing web and Swing suites pass |
| Host styling | Actual plugin rendered with compiled OIE stylesheet in light/dark |
| Narrow windows | 375px and 768px single-column layout, no horizontal page overflow |
| Extension packaging | Maven package succeeds, includes both jars and generated web module |

Executed: 13 Maven safety tests, 15 service/controller checks, 14 React DOM tests, and existing web/Swing markdown suites. Service tests use the real OIE XML serializer and controlled controller I/O; they do not boot an engine or write a database. Build and release workflows now execute these suites.

## Review limits and remaining work

This is not a clean bill of health for the whole store. Medium-severity findings outside this scope remain, including multi-step database rollback/retry idempotence, Swing revocation visibility, source/beta-policy parity, and text-download limits. The UI redesign improves keyboard controls and modal behavior, and the stale-target-library precondition is fixed, but it does not make all multi-step operations transactional.

Runtime restart activation, real database failure recovery, deployed RBAC integration, and Swing interaction were not exercised against a booted engine. Native writer exclusion relies on the tested default OIE controller synchronization contract, not a cross-process/distributed lock. Previous fingerprint records prompt for explicit consent on first replacement. The development ZIP retains the current project version; version stamping belongs to the release workflow.

No isolated engines or databases were created. Test temporary browser/DOM resources were closed and temporary test bundles removed. The shared compile-time engine tree was read-only and retained.

## Table layout revision

Verified type filtering, type sorting, grouping, modal documentation, row focus restoration, confirmation cancellation, and existing mutation flows. Browser fixture checks with compiled OIE CSS confirmed a full-width table (1221px at 1280px viewport), a 998px details modal, no page horizontal overflow, and rendered publisher documentation. The table scrolls horizontally within its own area at narrow widths to preserve all comparison columns. No live engine mutations were used for validation.

## All-version download counts

Checkpoint redesign: d94938f on feature/community-store-redesign-downloads.

| Behavior | Validation |
| --- | --- |
| Historical releases and asset pages | Paginated fixture test; deduplicated release/asset IDs |
| Unrelated assets | Checksums and source variants excluded |
| Prereleases and drafts | Prereleases included; drafts excluded |
| Zero vs unavailable | Java and rendered UI tests distinguish 0 from — |
| API failure after partial progress | No partial count returned; UI actions remain available |
| Cache and concurrency | Synchronized bounded cache; repeated lookups reuse totals; success TTL 1h, failure TTL 5m |
| Refresh ordering | Effect cancellation ignores late responses from prior catalog |
| Permission | New endpoint uses View Community Store and is registered in extension permissions |
| Historical naming / external hosts | Documented exclusions; unsupported hosts unavailable |

17 Maven tests, 16 React DOM tests, and existing service and markdown checks passed. Browser fixture validation confirmed the table column and modal display 1,234 without page overflow. No live API-count accuracy or live-engine installation was claimed; package staged for user restart. Swing remains unchanged and does not display download statistics.
