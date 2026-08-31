# Implementation Roadmap

Implementation is deliberately vertical. Each stage must evolve product UI, API/backend, persistence, reader, admin and deployment together enough to keep Litera runnable.

## Stage 1 — MVP

Goal: a new self-hosted installation can authenticate, configure a library, scan EPUB/PDF files, browse/search the resulting catalog, open a book, read it, persist progress, resume it, and use the core flow through `/legacy` when enabled.

MVP quality is allowed to be simple, but it must use real persistence and real application paths. No demo-only backend or frontend-only prototype qualifies.

## Stage 2 — Beta

Goal: turn the MVP into a credible daily-use multi-user library: stronger reconciliation, metadata enrichment, job visibility, reader UX, admin controls, concurrency handling, robust states, compatibility, tests and security.

Beta may still contain documented release blockers, but no known blocker may make ordinary core reading unsafe or routinely unreliable.

## Stage 3 — 1.0 Release Candidate

Goal: harden, optimize, document and package the complete 1.0 scope. Resolve known release blockers, stabilize migrations/config/API behavior, complete compatibility/security/accessibility/performance checks, and produce reproducible deployment artifacts.

RC is not a feature-prototype milestone. It should be a version that could become 1.0 without architectural rewrites.
