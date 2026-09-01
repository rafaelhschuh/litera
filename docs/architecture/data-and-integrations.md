# Data and Integrations

## Core entities

- User
- Library
- BookFile
- Work/Book
- Author
- Series
- Genre
- Identifier
- MetadataSource/ProviderResult
- ReadingProgress
- ReaderPreference

## Ownership

- Library scanner owns BookFile discovery/reconciliation.
- Library scanner owns derived cover generation: embedded EPUB covers and the first PDF page are normalized into bounded web JPEGs under persistent data storage; source books remain read-only.
- Catalog owns normalized book/work metadata.
- Metadata engine owns provider responses and matching provenance.
- Reading domain owns ReadingProgress and reader-specific preferences.
- User/auth domain owns identity and authorization state.

## ReadingProgress conceptual model

```text
ReadingProgress
- userId
- bookId
- format
- progressRatio
- locatorType
- locatorPayload
- currentChapter/page (derived where useful)
- lastReadAt
- completed
- revision/version
```

The locator is format-specific. EPUB should use a stable semantic location (for example an EPUB CFI or equivalent adapter-defined locator); PDF should use page/position information. The ratio is derived/display-oriented, not the sole restoration key.

## Library identity

A file identity should be based on stable filesystem/file characteristics sufficient to reconcile renames and rescans without trusting filename alone. The domain model should preserve the distinction between a physical file and a logical work.

Rescans remain idempotent, but an unchanged PDF with no usable stored cover is intentionally reprocessed once to backfill the derived cover. Catalog clients consume the cover endpoint and never open full PDF content merely to render a thumbnail.

## Metadata provider boundary

Providers implement a common adapter contract conceptually equivalent to:

```text
search(criteria) -> candidates
getDetails(candidate) -> normalized metadata
```

The provider layer must support timeouts, bounded retries, rate-limit handling, provenance, and graceful degradation. External provider outages must not block local reading.

The MVP should use open/public sources after current official documentation and licensing are verified. Provider selection is deliberately a boundary, not a hard-coded catalog assumption.

## Security-sensitive data

Reading history, progress, account identifiers, and authentication material are private. Provider requests should minimize transmitted data and should not send the full book content merely to identify metadata.

## API direction

Keep a versionable application API so future Android/iOS clients can consume library and progress semantics. Do not generate a detailed OpenAPI contract until endpoint semantics and authentication details are implemented and reviewed.
