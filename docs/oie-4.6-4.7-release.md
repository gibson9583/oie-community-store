# 0.8.2 release preparation

- Plugin version: 0.8.1 → 0.8.2.
- Declared engine support is limited to OIE 4.6.0 and 4.7.0, in every supplied engine descriptor.
- Compile-time engine baseline: 4.6.0. Compilation and declared runtime support are separate.
- Catalog engine bounds: 4.6.0 through 4.7.0, inclusive. Publishing workflows retain both bounds from the tagged manifest.
- Maven, engine descriptor, catalog, and Web Administrator package versions are synchronized where supplied. Web Administrator API requirements are independent of engine release numbers and remain unchanged.

This is release preparation. Runtime compatibility on the final OIE 4.7.0 tag is pending. Before publishing, build one ZIP and test that exact ZIP on each declared engine: installation, restart/loading, functionality, permissions/error paths, and upgrade from 0.8.1. Include Swing/Web Administrator and source/destination surfaces where supplied. Retain existing database and cluster upgrade instructions.
