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

Reader controls live in `src/web/reader-controls.css`. EPUB, original PDF and adapted PDF share one toolbar and the `UiDialog` modal pattern, including focus containment and Escape. Reading settings reuse `UiButton` and `UiSwitch`; mobile search remains available from those settings. Keep format-specific rendering and locators separate from these controls.

`--reader-page`, `--reader-text-background` and `--reader-text-color` describe the active light/sepia/dark reading surface. The original PDF uses `--reader-canvas`. Browser/PWA `theme-color` and `color-scheme` follow that surface while reading, and return to the application theme when leaving the reader. The OS still controls its notification shade.

Automatic progress saves and successful synchronization stay silent. Pending queue counts do not create reader overlays or live announcements. Storage failures, expired sessions and progress conflicts remain actionable; conflicts require an explicit server-position choice.

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

## Android native interface and shared visual tokens

The [Android client](../../android/README.md) follows [ADR-0010](../decisions/ADR-0010-native-android-client.md), with Kotlin Views for application screens and native reader controls. [`src/web/styles.css`](../../src/web/styles.css) remains the reference for semantic colors/spacing/type. Native resources mirror those tokens with explicit light/dark/sepia roles; changes update both sources. Platform accessibility dimensions and system insets follow Android conventions where required.

Use shared native primitives for forms, cards, errors/retry and navigation rather than an independent design language. Paint behind system bars, apply cutout/IME insets and maintain icon contrast. Reader controls expose only supported engine capabilities. The adaptive launcher icon preserves the Litera symbol inside the safe area, with separate background/foreground and monochrome layer; a cropped web icon is not an acceptable substitute.

Appearance is native state, not a JavaScript bridge polling the site. Web/PWA and legacy remain independent clients. Changes to native presentation boundaries update Android architecture/security/testing docs; physical-device evidence remains separate from APK assembly.
