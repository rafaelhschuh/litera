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

## Android host boundary

The [Android host](../../android/README.md) displays this same web UI in a top-level WebView. Keep components, reader controls, dialogs, theme tokens and offline behavior shared. Kotlin handles server setup and window integration, not a parallel design system. Follow [ADR-0010](../decisions/ADR-0010-android-webview-host.md) and [android/AGENTS.md](../../android/AGENTS.md) when changing host appearance, pause or Back behavior.

`theme-color` and active reader/application CSS tokens are the appearance authority for native bars and contrast. Native insets handle camera/system bars and IME; avoid double safe-area padding. The declarative host bridge is optional for browsers and grants no privileged capabilities. Core web/PWA/legacy flows must continue without it. Successful synchronization remains silent in the APK as on the web.

## Screen continuity

Modern catalog screens may retain up to 12 recent instances per account/role. Preserve filters, search, pagination and scroll on return, including from the reader. Revalidate on activation without replacing loaded content with a skeleton; show a delayed, nonblocking activity indicator and contextual retry on refresh failure. Initial catalog loading extends `AppState` with a cover-grid skeleton matching the catalog geometry. Authorization/not-found failures clear stale content; logout/account changes destroy private retained screens. Readers and administrative forms are not retained.

Screen entry uses `motion-normal` with opacity and a `space-2` vertical offset; previous screens leave immediately so navigation has no blank exit interval. Menus and dialogs use existing motion tokens. Cover images reserve their aspect ratio and fade in after load. Both OS and saved reduced-motion preferences remove optional movement from initialization onward. Route-code prefetch on link intent is optional; core navigation needs no modern transition API. These are modern-client enhancements; `/legacy` keeps its existing conservative behavior.

The library-detail admin page reuses `UiField`, `UiButton`, alerts and native progress for multiple book uploads. Transfer percentage reflects bytes, followed by explicit validation/cataloging states; it never reports a book ready before the real scan finishes.

Startup uses a directly linked `startup.css` so its shared loading spinner can animate before the JavaScript application initializes. The spinner uses existing surface/accent/spacing tokens with matching startup fallbacks and a `motion-loading` 800 ms activity cycle; reduced motion leaves a static indicator and status text. Login disables duplicate submissions, announces connection/preparation, and prepares Home plus the first two books with a 2.5 second deadline. Preparation failure never turns successful authentication into failure.

Book cards optionally prepare covers and complete detail/highlight snapshots when within 240 px of the viewport or on pointer/focus intent. Preparation runs at most two book tasks concurrently, queues at most 12 and retains at most 24 snapshots for 30 seconds, cleared on account/connectivity changes. A prepared detail is immediately visible while the ordinary API revalidates it. Optional preparation never downloads entire EPUB/PDF files or marks a book available offline. Without IntersectionObserver, navigation and intent preparation continue normally.

## 0.7 mobile navigation and reading motion

Phones below 640px use a solid floating bottom navigation bar, with Favorites, Library, Home, Search and More in that order. Desktop keeps the sidebar and tablets keep the existing drawer. The shared selection uses the accent/contrast tokens, `radius-pill`, `motion-slow` and the standard easing; its position moves between equal-width touch targets. The bar uses `surface-elevated`, existing border/shadow/spacing tokens and safe-area insets, without blur or transparency. Content and notices reserve space above it. It is absent from the fullscreen reader. More extends `UiDialog` with a bottom sheet variant, existing modal focus/Escape semantics and a `space-6` slide using `motion-slow`. Secondary destinations retain More selection; administration is only shown to administrators.

Reader turns slide two disposable opaque surfaces across one viewport, with `motion-slow` and standard easing; neither the live EPUB iframe nor its pagination is transformed. Forward moves left, backward moves right. OS and saved reduced motion skip snapshots/animation. This applies to EPUB screen/chapter turns and both PDF modes. Navigation and semantic progress require no animation APIs. Adjacent preparation is bounded and optional; failures fall back to normal loading.
