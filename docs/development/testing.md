# Testing Strategy

## Principles

Tests should trace to requirements and reader behavior. The highest-risk area is the reader/progress boundary, followed by filesystem reconciliation and metadata matching.

## Test layers

### Unit

- EPUB/PDF locator normalization.
- Progress calculations and restore rules.
- Metadata normalization and matching confidence.
- Library identity/reconciliation logic.
- Cover optimization and server-side PDF first-page rendering.
- Authorization policies.

### Integration

- Scan -> catalog -> metadata enrichment.
- Rescan backfill of missing PDF covers without source-file changes.
- Provider timeout/failure handling.
- Progress persistence and concurrent updates.
- Protected library access.

### Browser/E2E

- Login.
- Browse/search/open book.
- EPUB reading and position restore.
- PDF reading and page restore.
- Continue Reading.
- Responsive layouts.
- Reduced-capability/legacy-compatible path.

## Compatibility testing

The project should maintain a practical matrix containing at least one current Chromium/WebKit/Firefox environment and a legacy reference environment representative of the iOS 10.x / old WebKit generation. When exact emulator availability is constrained, keep a documented manual-device acceptance path.

## Acceptance priority

1. Reader can open and resume.
2. Progress survives reload/device changes.
3. Legacy reference can complete the core reading flow.
4. Scanning is idempotent.
5. Metadata enrichment improves results without breaking local use.
6. Authorization boundaries hold.
