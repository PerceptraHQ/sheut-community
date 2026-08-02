# Changelog

All notable changes to Sheut Community will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and releases follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0-alpha] - 2026-08-02

Initial public alpha of the local-first Sheut Community desktop application.

### Added

- Initial Tauri 2, React, and Rust Community application foundation.
- Architecture, data-protection, and repository contracts.
- Reproducible linting, tests, commit hooks, CI, and dependency policy.
- Desktop-only application icons generated from the canonical white-on-black
  Sheut mark with platform-appropriate rounded silhouettes and transparent
  breathing room for macOS, Windows, and Linux.
- Revision-safe investigation documents with tables, Sheut callouts, links,
  indicator defanging, and Rust-derived safe output.
- A higher-contrast Base UI document toolbar using Button/Toggle/ToggleGroup
  composition, a contextual table-editing strip, direct document-creation
  commands, closable document tabs, collapsible explorers, row context menus,
  and alert-dialog deletion for investigations, analyst notes, and reports.
- Bounded H1–H3, highlight, subscript, superscript, task-list, and
  left/center/right/justify authoring with matching Rust validation and derived
  output.
- Rust-owned offline HTML, DOCX, and Typst PDF publication through one validated
  intermediate representation for freeform documents and guided reports.
- Revisioned guided reports with Threat Actor Profile, Intrusion Analysis,
  Campaign Report, Executive Report, Blank Guided Report, and a complete
  21-section Illicit Ecosystem Report; typed fields, Tiptap narratives,
  repeatable tables, optional/manual sections, project-data references,
  encrypted custom templates, and exact historical template-revision loading.
- Rust-owned project-local Report IDs with stable template prefixes, encrypted
  monotonic sequences, and non-reuse after recoverable deletion.
- Revisioned project-local Brand Profiles with organization identity, logo,
  compact mark, cover artwork, contrast-checked colors, bundled typography,
  A4/Letter defaults, visual treatments, page furniture, and representative
  preview.
- Immutable publication snapshots and history recording format, paper size,
  orientation, Brand Profile revision, TLP marking, page furniture, included
  sections/appendices, version/status, and output name for deterministic
  reproduction.
- FIRST TLP 2.0 RED, AMBER+STRICT, AMBER, GREEN, and CLEAR project defaults and
  per-publication overrides with matching colored cover and page furniture.
- Encrypted project evidence for supported images, video, documents, and inert
  archives, plus image insertion, evidence links, and deterministic Appendix A,
  B, ..., Z, AA figure numbering across HTML, DOCX, and PDF.
- Encrypted, bounded PNG/JPEG/WebP freeform image attachments referenced by
  opaque document-local IDs. Export files embed validated bytes and require no
  source-file path.
- Explicit Tauri command ACLs scoped to the main desktop window, IPC isolation,
  a restrictive CSP, and automated manifest/capability drift checks.
- Locked-project deletion with exact-name Base UI confirmation, canonical
  Rust-owned path resolution, fail-closed device-credential cleanup, and
  preservation when the operating-system credential prompt is denied.
- A reproducible production-bundle editor latency measurement with a 500 ms
  editable-state budget.
- Revision-safe encrypted graph workspaces with named tabs, recoverable
  deletion, unavailable placeholders, semantic/reference/visual edges,
  high-DPI Canvas rendering, deterministic worker layout, accessible navigation,
  Build/View modes, and explicit visual-link-to-STIX-draft conversion.
- A custom desktop title bar with Base UI layout controls for activity-bar and
  sidebar visibility/position, centered layout, Zen mode, fullscreen, and
  protected native window actions.
- Self-hosted Geist and Geist Mono variable fonts, a readable compact type
  scale, stronger text contrast, and explicit deep/base/raised workbench
  surfaces throughout the application.
- A lazy local command palette built from `cmdk` inside a Base UI dialog,
  including Cmd/Ctrl+K navigation and bounded search across documents, STIX
  objects and drafts, and graph workspaces.
- An application Settings workspace for layout preferences, local-data and
  security boundaries, application information, and complete third-party
  notices, plus reusable Base UI context menus for workspace quick actions.
- Offline Settings guides for investigations, analyst notes, and every guided
  report, with field-by-field examples and contextual project/STIX source
  guidance for Illicit Ecosystem reporting.
- A native File/Edit/View/Window/Help menu routed through bounded action IDs and
  the same workspace commands as application shortcuts.
- Current SHA-pinned GitHub Actions with weekly automated update checks and a
  broader ignore policy for editor, cache, test, local-database, and OS files.
- A SHA-pinned weekly RustSec advisory gate, plus a locally licensed
  `citationberg` compatibility patch that moves Typst's citation parser from
  vulnerable `quick-xml` 0.38 to the patched 0.41 line without changing the
  exact Typst 0.15.1 publication pin.
- Provenance-pinned Geist, Geist Mono, and Source Serif variable fonts under
  Rust-owned assets for consistent HTML, DOCX, and PDF publication; README
  banner generator sources are no longer retained.
- Object-scoped STIX Connections for committed objects and local drafts, with
  incoming/outgoing views, readable counterparts, Draft/Committed status,
  unresolved external-reference handling, and directed Relationship draft
  creation without leaving Intelligence.
- Revisioned analyst evidence metadata including title, description,
  source/provenance, collection date, source URL, tags, and analyst notes, plus
  confirmed encrypted-file deletion through a Base UI AlertDialog.

### Changed

- Evidence payload IPC is image-only and revalidates decoded PNG/JPEG/WebP
  against stored media types; generic evidence bytes remain Rust-only.
- Evidence imports now enforce a 1 GiB encrypted-project aggregate budget in
  addition to the existing 100 MiB per-file limit.
- HTML, DOCX, and PDF publication rendering runs on the Tauri blocking pool so
  large reports do not occupy async command workers.
- New publication-oriented reports use guided templates; investigations and
  analyst notes remain freeform structured documents, while existing encrypted
  document rows and revision history are preserved.
- Tauri publication commands accept one validated typed options payload instead
  of long positional argument lists.
- Base UI selects now keep trigger values and option labels in full-width
  horizontal layouts across project, report, publication, Settings, MITRE, and
  STIX workflows; the publication dialog is wider and responsive.
- Evidence images now preserve aspect ratio while fitting page-aware printable
  bounds in HTML, DOCX, and Typst PDF without entering footer furniture.
- Guided reports now use one responsive authoring page with a section
  navigator, completion state, field-level validation and help, semantic date
  and confidence controls, and context-filtered project-data insertion.
- Guided publication now omits whitespace-only fields, all-blank rows, empty
  project references, and the resulting empty sections from publication
  choices, tables of contents, HTML, DOCX, and PDF. Headings remain unnumbered;
  Illicit Ecosystem version and TLP handling come from the immutable
  publication snapshot.
- Guided report failures now use toast notifications rather than expanding the
  bottom of the editor, and section navigation scrolls within the current
  workspace without changing the URL fragment.
- STIX closed vocabularies now use restricted Base UI Combobox controls, while
  Relationship types and object references use searchable open-vocabulary
  Autocomplete controls. Standard values such as `attributed-to` remain
  suggested without blocking valid custom STIX values or external references.
- Evidence cards, project-data insertion, and report rows now use analyst-facing
  evidence titles and metadata while retaining the immutable imported filename
  for traceability.
- Default frontend tests run with one worker to bound browser-test memory;
  Rust tests and Clippy use available Cargo parallelism with debug symbols
  disabled for development/test artifacts, and production helper concurrency
  remains bounded so release-profile artifacts are opt-in during ordinary
  development.
- Repository hygiene now excludes local report output, release packages,
  screenshots, project/database exports, temporary files, regenerated Tauri
  permissions, and one-off review spikes from the initial public history.
- Application, Cargo workspace, lockfile, and Tauri package metadata now use
  `0.1.0-alpha`; release binaries omit debug information and strip symbols.
- Preview packaging is configured for macOS app/DMG, Windows NSIS/MSI, and
  Linux DEB/AppImage artifacts while keeping untested platform packages
  explicitly marked as alpha previews.
- Guided-report narrative editors now use their full authoring surface;
  structured timeline and shared data-source rows use responsive labeled
  controls, multiline prose/citation fields, source-type suggestions, and
  semantic dates instead of cramped generic inputs and unexplained icons.
- The Documents workspace removes its redundant command-row gap, displays
  report title/template/revision without overlap, styles custom-template
  inputs consistently, and supports recoverable guided-report deletion.

### Removed

- The `printpdf` dependency, character-wrapping PDF implementation, and its
  dedicated renderer tests.
- Legacy freeform Report creation and all visible list/open/edit/delete/restore
  surfaces. Pre-existing encrypted rows remain byte-preserved and inaccessible
  rather than being destructively rewritten or deleted.

### Security

- Independent random project keys, SQLCipher storage, restrictive local file
  permissions, device credential-store unlock, and optional Argon2id plus
  XChaCha20-Poly1305 passphrase wrapping protect project data at rest.
- Tauri isolation, explicit command capabilities, restrictive CSP and response
  headers, bounded hostile-input parsing, inert archive storage, and escaped
  publication output preserve the React-to-Rust trust boundary.
- SHA-pinned CodeQL, dependency-review, OpenSSF Scorecard, and weekly RustSec
  cargo-audit workflows enforce dependency and repository security gates.
- Generated reports, project exports, release packages, screenshots, databases,
  signing material, and private planning files are excluded from public Git
  history.

[Unreleased]: https://github.com/PerceptraHQ/sheut-community/compare/v0.1.0-alpha...HEAD
[0.1.0-alpha]: https://github.com/PerceptraHQ/sheut-community/releases/tag/v0.1.0-alpha
