# Release signing with SSL.com eSigner

Tagged releases require SSL.com signatures on these plugin-owned JARs:

- `communitystore/communitystore-shared.jar`
- `communitystore/communitystore-client.jar`

The release builds the existing extension ZIP, signs and timestamps only those
JARs, verifies them, and replaces them in the ZIP before checksums, provenance
attestations (where present), and publication. Every other ZIP entry, including
third-party dependencies, web resources, and any bundled WAR, retains its exact
contents. This is JAR code signing, not a signature on the outer ZIP or a
Community Store verification badge.

## One-time setup after certificate issuance

1. Complete SSL.com identity validation, certificate issuance and **eSigner**
   enrollment. Enable automated signing and obtain the certificate's eSigner
   credential ID and **signing TOTP secret** (not a current six-digit OTP and not
   an unrelated account-login 2FA secret).
2. In this repository's **Settings → Secrets and variables → Actions**, add these
   repository secrets. Use the same names in every plugin repository:

   | Secret | Value |
   | --- | --- |
   | `SSL_COM_USERNAME` | SSL.com account username/email with access to the certificate |
   | `SSL_COM_PASSWORD` | That account's password |
   | `SSL_COM_CREDENTIAL_ID` | Explicit eSigner credential ID for this certificate |
   | `SSL_COM_TOTP_SECRET` | Automation TOTP secret for this signing credential |

3. Add the repository **variable** `SSL_COM_CERT_SHA256`: the SHA-256 fingerprint
   of the issued **leaf code-signing certificate**, not its issuer or timestamp
   certificate. Download the public certificate from SSL.com and inspect it with
   `keytool -printcert -file certificate.crt`; copy its SHA256 fingerprint.
   Colon-separated and plain hexadecimal fingerprints are accepted. It is public
   information, not a private key. Update it (and the credential ID if changed)
   when SSL.com reissues or renews the certificate.
4. Merge this change only when ready to require signing for the next release.
   Missing secrets or the fingerprint fail the release before the build. There
   is no unsigned-release fallback. Ordinary PR/build jobs need no SSL.com secrets.
5. For the first new version, inspect the successful signing step and download
   the released ZIP. Extract a plugin JAR and run
   `jarsigner -verify -strict -verbose -certs path/to/plugin.jar` using JDK 17+.

Do not put passwords or TOTP secrets in files, workflow inputs, PRs or comments.
GitHub's secret-entry form is sufficient; there is no private key to upload.
Protect release tags and restrict who can modify release workflows or secrets.

## Operational behavior

- CodeSignTool runs on a separate JDK 11 selected through `CODESIGNTOOL_JAVA`.
  Its JAR implementation uses internal APIs unavailable on newer JDKs. Builds
  and strict signature verification keep their existing JDK 17/21. CI exercises
  the real vendor JAR hashing path without credentials before release signing.
- CodeSignTool 1.3.2 is downloaded from SSL.com's release and checked against a
  pinned SHA-256 before execution. A vendor binary change requires a reviewed
  pin update. Tool credentials use subprocess arguments, never shell expansion;
  tool output and temporary logs are not published and are removed on exit.
- The JDK checks signature integrity, certificate trust, algorithms and usage.
  An additional verifier requires every payload entry to have exactly one
  signer matching the configured leaf certificate and a verified timestamp.
  Merely returning exit code zero or adding an `.SF` file cannot pass.
- A missing, extra, unsigned, untrusted, altered, differently signed or partially
  signed JAR stops publication. If any JAR fails, the original ZIP stays intact.
  A successful batch changes only the selected JAR entries; final ZIP checksums
  and any attestations describe the signed package.
- No automatic signing retries are made: a partial batch may already have used
  signing quota. Rerunning a release builds and signs again and can incur further
  signature usage. Same-tag runs are serialized within this repository;
  different repositories can sign concurrently. If SSL.com rejects overlapping
  requests for the same credential, stagger the releases and rerun the failed job.
- Each signed JAR can count against your plan's signature allowance; batching
  does not imply one billable signature for a whole ZIP.
- Local tests use temporary test certificates and a local timestamp responder.
  They do not contact SSL.com or use production secrets. The first real signing
  run remains necessary to validate account enrollment, quota and the issued chain.

## Development checks

Run `python3 -m unittest discover -s .github/signing -p 'test_*.py' -v` with
Python 3.10+, JDK 17+ and OpenSSL installed. The signing checks workflow runs the
same tests on PRs. Keep `config.json` aligned with the assembly when adding or
renaming plugin modules. These standalone signing helpers are shared by convention
across Web Support, Sentinel, SQS, Community Store, OIDC and TOTP; apply common fixes
to all six copies.

References:

- [SSL.com CodeSignTool commands](https://www.ssl.com/guide/esigner-codesigntool-command-guide/)
- [eSigner automation enrollment](https://www.ssl.com/how-to/automate-esigner-ev-code-signing/)
- [Pinned CodeSignTool release](https://github.com/SSLcom/CodeSignTool/releases/tag/v1.3.2)
