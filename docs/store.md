# Community Store

A community plugin store for Open Integration Engine, modeled on the HACS approach:
no project-hosted infrastructure, just git. Publisher repositories and organizations
are listed in a bundled source file; each publisher describes releases with an
`oie.json` manifest, ships the extension as a `.zip` on GitHub Releases, and the
engine downloads, sha256-verifies, and installs it through its own extension
installer.

![Browsing the Community Store catalog](docs/images/browse.png)

## Features

- **Browse** community connectors, plugins, and data types from GitHub Releases.
- **Install / update / uninstall** through the engine's own extension installer,
  gated by the existing manage-extensions permission.
- **sha256 verification** of every artifact before anything touches the engine.
- **Self-aware updates** — the store lists itself, so a newer release shows up as an
  update like any other extension.
- **Settings** for custom sources, a local blocklist, the beta channel, sync
  interval, and an optional (encrypted) GitHub token.

## How it works

The browser never talks to GitHub. A Java service plugin running inside the engine
does all GitHub communication, verification, and installation; the web administrator
only calls its REST endpoints.

## Installing

Install through Extensions in either administrator, restart the engine, and the
**Community Store** appears in the web administrator navigation. After the first
install it can update itself from the store.

See the [project README](https://github.com/gibson9583/oie-community-store#readme)
and the [publishing guide](https://github.com/gibson9583/oie-community-store/blob/main/docs/PUBLISHING.md).
