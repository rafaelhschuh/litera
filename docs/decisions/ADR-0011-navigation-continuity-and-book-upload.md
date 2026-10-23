# ADR-0011 — Screen continuity and administrative book uploads

- Status: Accepted
- Date: 2026-10-23

## Context

A SPA still feels discontinuous when every refresh removes the current content, every return recreates filters/results, and pages change without a visual transition. Administrative users also need to add books directly to a configured library whose source mount was previously read-only.

## Decision

Retain the modern catalog shell across reader visits and at most 12 catalog/detail screens using Vue KeepAlive. Preserve document scroll positions separately (bounded to 60 routes) and scope all retained screens to the current account and role. The reader and administrative forms are never retained: reader disposal, saving and format-aware restoration continue to own their existing lifecycle. Page resources revalidate on activation/connectivity changes, keep successful content during refresh, discard out-of-order responses, and remove stale content on authorization or not-found errors. Route imports can be prefetched on pointer/focus intent; this is optional. Vue/CSS transitions use existing motion tokens and respect both reduced-motion settings. No View Transitions API is required. Startup CSS is linked from HTML for immediate activity feedback. Login optionally prepares Home and its first two covers/details with a 2.5 second deadline; cards prepare upcoming detail snapshots and browser-cached covers using guarded IntersectionObserver and link intent. Two concurrent tasks, a queue of 12 and 24 snapshots with a 30-second lifetime bound work/memory. Account/connectivity changes clear preparation; detail views still revalidate authorization. Full book content is never implicitly downloaded.

Uploads use an administrator-only endpoint on a specific library: `POST /api/v1/admin/libraries/:id/upload?filename=...`, with an `application/octet-stream` body and optional modern account header. Raw streaming avoids multipart dependencies and whole-request memory buffers; one request uploads one file, and the UI sequences multiple files. The server stages bytes in the data directory, enforces the configured size even without Content-Length, validates EPUB/PDF contents, and publishes a new file inside the allowed library root. A hidden temporary copy on the destination filesystem followed by an exclusive hard link publishes complete content without overwriting an existing path (including symlinks). Destination volumes must support hard links and be writable. Error messages explain read-only mounts, collisions and unsupported filesystems. Temporary files are removed on success, failure and interrupted requests; crashes can leave hidden staging files for operator cleanup, never visible source books.

A persistent scan job discovers the uploaded file through the existing ingestion/provider boundary. A running scan gets a queued successor, and jobs for one library run serially. This avoids missing uploads added after a running scan captured its file list. The upload response confirms storage and the job id; the UI separately observes cataloging success/failure. No database migration or second ingestion pipeline is introduced.

Compose mounts permit writing new files. Existing read-only installations continue browsing/reading and explicitly reject uploads. The scanner remains read-only toward source books. Backups must include the books folder as well as the database volume.

## Alternatives and consequences

- A shared query cache alone would preserve data but not in-memory forms and exact rendered screen state. Bounded component retention is sufficient for this application; the reading engine is excluded to control memory and preserve its lifecycle.
- Keeping entire readers alive would retain heavy documents, input listeners and progress sessions. Reader state continues to be restored from format-specific locators instead.
- Managed uploads in a separate storage tree would preserve read-only mounts but require an additional source-location model, scan reconciliation and content resolution in every reader/legacy/offline path. New files in the existing library preserve current domain and authorization semantics.
- A direct write to the final filename could expose partial files to scans. Renaming a temporary file could overwrite an existing destination. Exclusive hard-link publication requires a supporting filesystem but gives atomic visibility and collision protection.
- Uploads are unavailable offline and in `/legacy`. Legacy reading and catalog semantics are unchanged.
