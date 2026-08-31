# Frontend Foundation

> Detailed implementation contract: [`ui-ux-technical-spec.md`](./ui-ux-technical-spec.md). Use it as the central screen, component, token, responsive, admin, reader, and legacy UI guideline.

## Stack

- TypeScript
- Vue.js
- npm
- Web application packaged/deployed with Docker

## Core principle

The reader and library must remain usable as browser capabilities decrease. Progressive enhancement is an architectural rule, not a late optimization.

## UI layers

```text
Feature UI
  -> shared patterns
    -> domain-agnostic components
      -> primitives
        -> semantic design tokens
```

## Responsive modes

### Desktop / notebook

Sidebar/navigation where useful, generous library grid, reader centered with optional multi-page presentation, keyboard shortcuts, richer metadata panels.

### Tablet

Touch-first controls, adaptive grid, reader optimized for portrait/landscape, optional two-page mode when viewport and device permit.

### Mobile

Compact navigation, single-column reading, thumb-friendly controls, minimal persistent chrome.

### Reduced-capability / legacy

Same information architecture and identity, but fewer effects, smaller bundles, conservative CSS/JS, simpler navigation, optimized image sizes, and incremental rendering. Detection should prefer capability/feature tests and a small explicit compatibility profile rather than user-agent-only assumptions.

## Reader UX

The reader is a product subsystem with its own state model. It must support:

- chapter/TOC navigation;
- previous/next navigation;
- typography and layout controls appropriate to EPUB;
- PDF page navigation;
- bookmarks/annotations only where implemented by the corresponding feature spec;
- in-book search where supported;
- automatic progress persistence;
- restore of the last semantic location;
- touch and keyboard interaction;
- fullscreen/focus mode;
- reduced-motion behavior.

Do not render an entire large EPUB as one uncontrolled DOM tree. Prefer chapter-level/incremental rendering.

## Shared component expectations

Start with a small semantic set: Button, IconButton, Input, SearchInput, Dialog, Drawer, Popover, Badge, Toast, Skeleton, EmptyState, ErrorState, ProgressIndicator, BookCard, BookGrid, ReaderToolbar, ReaderSettings, MetadataPanel.

Only create components that are actually needed. Reuse existing primitives before creating new ones.

## States

Every asynchronous shared pattern must define loading, loaded, empty, filtered-empty, error, disabled/read-only where applicable, and offline/partial states only where relevant.

## Accessibility

Use semantic HTML, visible focus, keyboard navigation, sufficient contrast, accessible labels, touch targets appropriate to device context, and `prefers-reduced-motion`.

## Legacy rules

- Do not make optional effects a prerequisite for navigation or reading.
- Avoid shipping unnecessary polyfills to modern clients while retaining a compatibility path.
- Avoid APIs unavailable in the compatibility baseline in core execution paths, or isolate them behind capability checks.
- Keep the initial JavaScript payload appropriate for older hardware.
- Prefer progressive server-rendered/HTML-compatible foundations where this materially improves compatibility.

## Anti-drift rule

Before creating a visual component, search this foundation and the existing codebase for an equivalent. Reuse or extend it when semantically correct. Do not add arbitrary colors, radii, shadows, spacing scales, form patterns, modal behavior, or feedback patterns without a documented semantic reason.
