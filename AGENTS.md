# Litera Agent Contract

1. Read `README.md`, `docs/product/requirements.md`, `docs/frontend/frontend-foundation.md`, `docs/frontend/ui-ux-technical-spec.md`, `docs/architecture/overview.md`, and `docs/development/definition-of-ready-and-done.md` before implementing features.
2. Treat requirements and acceptance criteria as authoritative product behavior.
3. Before adding a UI component, search for an existing primitive/pattern and reuse or extend it when semantically correct.
4. Do not introduce arbitrary colors, radii, shadows, spacing, typography, interaction patterns, or loading states outside the frontend foundation.
5. Preserve progressive enhancement and the legacy-browser strategy. Do not make modern browser APIs a hard dependency for core library and reading flows without an explicit compatibility decision.
6. Keep reader state and progress semantics format-aware. Do not reduce EPUB/PDF progress to a single percentage.
7. Library scanning must be idempotent and must not modify source book files unless a future requirement explicitly authorizes it.
8. Metadata providers are integrations behind a stable internal provider boundary; provider failure must not make a local library unreadable.
9. Do not store secrets in source, images, fixtures, or documentation.
10. New architectural decisions with meaningful alternatives belong in an ADR.
11. Tests must cover acceptance criteria, especially reader state restoration, library rescans, metadata matching, authorization, and legacy-compatible paths.
12. Prefer small coherent changes and avoid speculative abstractions.

13. Treat `/legacy` as a dedicated conservative client over the same API/domain semantics, not as a second backend. Follow `docs/decisions/ADR-0003-legacy-client.md`.
14. Work in vertical slices: when a feature requires UI, API, persistence, authorization, tests and deployment changes, integrate those layers together rather than leaving one side as long-lived scaffolding.
15. For staged Codex implementation, follow the exit gates in `CODEX_PROMPTS.md`; do not declare a stage complete while its required end-to-end flows still depend on mocks or TODOs.
