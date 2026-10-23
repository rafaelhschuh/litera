# Product Requirements

## Functional requirements

### FR-001 — Create and scan libraries
The administrator must be able to configure one or more filesystem-backed libraries and trigger scanning.

**Acceptance criteria**
- Given a configured readable directory, when a scan runs, supported book files are discovered and cataloged.
- Re-running a scan does not create duplicate logical books for unchanged files.
- Recycled inodes must not attach new uploads to missing unrelated books. Content replacements refresh automatic covers; manual covers/metadata retain priority. A failed ingestion remains an error until successfully read again.

- Removed source files are detected without modifying unrelated files.

### FR-002 — EPUB and PDF ingestion
Litera must ingest EPUB and PDF as first-class reading formats.

**Acceptance criteria**
- Supported files can be opened from the library.
- Unsupported/corrupt files are represented as an actionable ingestion error rather than crashing the scan.

### FR-003 — Metadata extraction and enrichment
Litera must extract embedded metadata and enrich it through pluggable external providers.

**Acceptance criteria**
- Embedded title/author/identifier information is considered before external matching.
- Provider failure does not prevent local reading.
- A matched work can expose title, author, cover, description, genres, series, publication data, language and identifiers when available.
- Metadata updates are idempotent and do not overwrite stronger local evidence blindly.

### FR-004 — Library browsing and search
Users must be able to browse and search their accessible library.

**Acceptance criteria**
- Search can find books by title and author at minimum.
- Empty, filtered-empty, loading, and error states are defined.

### FR-005 — User accounts and authorization
Users must have separate reading state and only access libraries/resources authorized for them.

**Acceptance criteria**
- Authentication is required for protected application flows.
- Reading progress for one user is never exposed as another user's progress.
- Administrative library configuration is restricted to administrators.

### FR-006 — Reader
Litera must provide its own integrated reader experience rather than delegating the main UX to an external application.

**Acceptance criteria**
- EPUB and PDF can be read in-browser.
- Reader controls include navigation, table of contents where available, typography/layout controls appropriate to the format, and search where technically supported.
- Reader remains usable on touch devices and desktop keyboard/mouse input.
- Modern EPUB readers can choose chapter scrolling or viewport-sized pages; the preference persists online/offline and each chapter opens at its beginning when advancing (or at its end when returning from the following chapter).
- Viewport pages show chapter/page position and preserve the same passage through changes in size, type and reading mode; they do not become absolute EPUB page numbers.
- New highlights identify the actual selected text range, including repeated words within one paragraph, reversed selections and inline formatting. Missing/ambiguous old anchors must not silently choose the first occurrence.


### FR-007 — Format-aware reading progress
Progress must be persisted per user and book using a format-aware locator.

**Acceptance criteria**
- EPUB stores a stable semantic locator plus derived progress.
- PDF stores page-based location plus derived progress.
- Reopening the book restores the closest valid saved location.
- A reader configuration change does not arbitrarily reset the saved location.
- Progress updates are debounced/batched sufficiently to avoid excessive writes.

### FR-008 — Continue Reading
Users must see books with active progress and resume them directly.

### FR-009 — Responsive editorial interface
The web UI must support notebook/desktop, tablet, and mobile layouts without making the library or reader unusable.

### FR-010 — Progressive enhancement / legacy compatibility
Core flows must degrade automatically for constrained browsers.

**Acceptance criteria**
- The application has a defined modern and reduced-capability presentation path.
- Core library navigation and reading do not require optional visual effects or nonessential modern APIs.
- The legacy path preserves Litera's visual identity rather than becoming an unrelated application.
- A physical iPad in the iOS 10.x / old WebKit generation is treated as the practical legacy compatibility reference; exact model/version must be recorded when confirmed.
- A dedicated `/legacy` client may provide the reduced-capability path while using the same API/domain contracts as the modern application.
- An administrator can enable or disable the `/legacy` client through server configuration exposed in the admin compatibility screen.

### FR-011 — Docker deployment
A documented Docker Compose deployment must provide persistent configuration, catalog/database data, and access to configured book directories.

### FR-012 — Future client compatibility
The domain/API boundaries must allow a future Android client without coupling reading progress to browser-only state.

### FR-013 — Android WebView host
Android must reuse the complete existing Litera web application through a Kotlin WebView host, with coherent system integration and no duplicate reader/domain implementation.

**Acceptance criteria**
- Native setup validates a canonical server origin; HTTPS is default, HTTP requires explicit consent, and invalid TLS cannot be bypassed.
- The app requires runtime multi-profile support and selects a persistent WebView profile per origin before loading; unsupported providers receive update guidance.
- Catalogue, account, EPUB/PDF, preferences and offline/outbox use the existing web implementation; Chrome/PWA storage is independent.
- System bars follow application/reader themes; cutout, navigation and IME insets keep controls usable. The adaptive icon retains safe margins and theme support.
- Back respects overlays/fullscreen and application history; pause captures progress through existing persistence without a parallel Kotlin queue.
- The restricted appearance bridge validates origin, main frame and trusted top-level document and grants no privileged native capabilities.
- Network errors preserve available offline content; HTTP remote origins do not promise full offline support without secure-context capability.
- Automated Android and relevant web regressions pass, and physical acceptance is recorded separately. The preview PR remains draft without merge until the user tests and explicitly authorizes integration.

## Non-functional requirements

### NFR-001 — Performance
Initial library browsing and reader startup should avoid loading an entire large book into the browser when incremental rendering is possible.

### NFR-002 — Compatibility
Core functionality must use a conservative compatibility baseline and progressive enhancement. Modern-only APIs must be isolated from core flows where feasible.

### NFR-003 — Accessibility
Semantic HTML, keyboard navigation, visible focus, sufficient contrast, touch-friendly controls, and reduced-motion support must be used where applicable.

### NFR-004 — Reliability
Library scans and metadata enrichment must be restartable and idempotent.

### NFR-005 — Privacy
Reading history and progress are user data. External metadata providers must receive only the minimum information needed for matching, with provider behavior documented.

### NFR-006 — Security
Book files are treated as untrusted input. Parsing, metadata extraction, image processing, authentication, authorization, path handling, and external requests require defensive controls.

### FR-013 — Continuous modern navigation

- Returning to a recent catalog screen preserves filters, search, pagination and document scroll while the app remains open, including after leaving a reader.
- Refreshing existing results does not replace them with an empty/loading screen; failures retain usable results with contextual retry except authorization/not-found responses.
- Stale asynchronous responses cannot replace newer results. Retained screens are bounded and isolated by account/role; logout clears them.
- Short optional transitions respect system and application reduced-motion settings. Reader locator/restoration semantics and legacy core flows remain intact.

### FR-014 — Administrative book upload

- An authenticated administrator can send EPUB/PDF files from a specific library's admin detail page; readers, unauthenticated users and mismatched account requests cannot upload.
- Each transfer enforces the configured maximum size, including chunked bodies. Empty/corrupt/protected/unsupported files and path-bearing filenames are rejected.
- Valid new files are published completely within the configured allowed library root, without overwriting any existing file or symlink. Failure/interruption removes request staging files.
- The UI shows actual byte progress, separate validation/cataloging states, cancellation and per-file failures for multiple selection.
- A durable automatic scan catalogs new uploads, including those arriving during another scan. Resulting books use existing catalog, reader, metadata and authorization paths and survive idempotent rescans.
- Read-only/unsupported destinations explain how to enable uploads; normal reading remains usable. Source scans never mutate books. Upload requires an online modern admin client; `/legacy` has no upload UI.
