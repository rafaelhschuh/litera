# Product Vision and Scope

## Vision

Litera is a self-hosted digital library server that makes a personal collection of books feel like a polished editorial reading service. It should have the operational simplicity of Jellyfin/Ubooquity while investing disproportionately in the quality, performance, and continuity of its own reader.

## Value proposition

Install Litera on a server, point it at book folders, and receive an automatically organized library with enriched metadata, covers, search, user-specific progress, and a high-quality browser reader that works across modern and older devices.

## Primary users

- A self-hosting individual managing a personal digital library.
- Household or small-group users sharing a library with separate accounts and reading progress.
- Users reusing older tablets/phones as dedicated reading devices.

## Core journeys

1. Administrator mounts a book directory and creates a library.
2. Litera scans files, extracts embedded metadata, identifies books, and enriches metadata through providers.
3. User browses/searches the library and opens a book.
4. Reader restores the user's last precise position.
5. User changes reader preferences and continues reading.
6. Progress is persisted and restored on another device.
7. Administrator rescans the library after adding/removing files.

## MVP scope

- Self-hosted web application.
- Docker Compose deployment.
- User authentication and per-user reading state.
- EPUB and PDF as first-class formats.
- Library scanner and persistent catalog.
- Embedded metadata extraction and provider-based metadata enrichment.
- Covers, authors, series, genres, descriptions, publication data where available.
- Search and basic library browsing.
- Continue Reading, recently added, favorites/bookmarks where requirements support it.
- First-class reader with format-aware progress.
- Responsive editorial UI.
- Progressive enhancement and a lightweight compatibility path for older browsers/devices.

## Explicit non-goals for MVP

- Native Android/iOS applications.
- Full offline-first synchronization.
- DRM.
- Social/community features.
- Marketplace or purchasing.
- Audiobook platform.
- AI recommendations or AI-generated metadata.
- Reimplementation of every ebook parsing/rendering primitive from scratch.

## Future constraints

The backend/API and domain model should not prevent a future Android client, iOS client, or richer offline/PWA experience. This does not authorize building those clients in the MVP.

## Success criteria

A new installation can be pointed at a book directory and become useful without manual metadata entry; a user can open an EPUB or PDF, read comfortably on desktop/tablet/mobile, close it, reopen it on another supported device, and resume from the correct position. Core flows must remain usable on the project's legacy-browser reference device.
