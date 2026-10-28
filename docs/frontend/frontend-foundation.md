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

## Interface copy and page hierarchy

Page headers lead with the destination's title. Do not prepend decorative uppercase labels, repeat the navigation category or add a slogan. Supporting text must explain an action, scope, state or consequence that is useful on that screen; counts and library paths remain appropriate context. Use typography and existing spacing tokens for hierarchy, without ornamental accent rules beneath every title.

Page titles use the existing editorial serif stack through `--font-editorial`; section titles and controls keep the interface sans serif. A full-width neutral border separates the page heading from its content. The first catalog section starts directly below that heading, with `space-7` between subsequent sections. The main cover grid uses a 9rem minimum track, retaining the existing tablet and phone overrides. Compact reading cards show two per row when available width permits, using a 20rem minimum, a 6rem cover and existing spacing/radius tokens; horizontal overflow remains usable on smaller screens.

Login uses a centered 30rem panel with a wordmark header, one `h1`, labeled credentials, inline errors and submission status. The compatibility link occupies a separate footer. The panel uses existing surface, neutral border and radius tokens, without a promotional column or tagline. Preserve autocomplete, keyboard submission, initial focus and duplicate-submit protection.

Empty states describe what is missing and a practical next action. Before a search is submitted, show the labeled form and ordinary links to authors, series and genres using the existing taxonomy-list pattern. Show results, no-results or failure feedback only after a query. Keep permission, offline, storage and destructive-action guidance where it affects the user's decision. These changes apply to the modern web client; `/legacy` retains its conservative layout and shared domain behavior.

On phones, Home, Library, Favorites and Search retain an accessible `h1` but visually omit the repeated page header; the selected bottom tab identifies the destination. Pages reached through More, including filtered author/series/genre lists, keep their visible titles. Desktop and tablet retain the normal page headers.

Library and Favorites share one compact search row with an explicit icon submit action and a filter toggle on phones. Format and sorting use the existing `UiField`/native-select pattern inside an inline disclosure, closed initially; the toggle exposes its expanded state and indicates nondefault choices. The result count sits below the controls. Desktop shows the same select controls directly, without duplicating fields or filtering state. All controls use existing spacing, surface, border, radius and icon primitives; searching by Enter and screen-reader labels remain available.

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


## Reader and catalog motion follow-up

Phone bottom-tab activation overrides the generic vertical screen entry with a horizontal slide based on Favorites → Library → Home → Search → More. A supported same-document View Transition snapshots only main content; the bottom selection remains live. Without that API, the incoming main content uses a transform-only Vue transition. Book cards optionally share surface/cover geometry with their detail; Web Animations provides a bounded transform fallback. Existing duration/easing tokens and reduced-motion settings govern all paths. Ordinary modified links retain browser behavior.

`ReaderTypographyFields` reuses `UiField` and native selects/ranges in Reader Settings and Preferences. Font choices use local font stacks (including the book's own family); numeric margins and type/spacing ranges are reader preferences, not additions to the UI token scale. Font size is 80–200%; margins 12–80px, line height 1.2–2.4, letter spacing 0–0.12em and paragraph spacing 0.5–2em. Existing measure presets bound long desktop lines. EPUB text preferences are applied before restoring the semantic position and cached preparations include the complete appearance. PDF adapted content retains encoded font assets where necessary.


### Revisão de continuidade bidirecional

O router é responsável por iniciar/concluir as transições de catálogo, inclusive histórico. Detalhes retornam à origem do card, com contração da superfície/capa. Header e navegação inferior têm camadas próprias acima das capturas móveis; a expansão de fallback fica abaixo da barra fixa. Diálogos usam movimento inverso ao fechar e preservam o top layer/foco até terminar. A saída interrompida parte de sua transformação atual.

A estratégia de cópias EPUB descrita anteriormente foi substituída: View Transitions captura a saída visual real do frame e da página pronta, sem remontar texto em outro contexto CSS. As imagens deslizam em sentidos opostos, sem fade; controles do leitor ficam em camada separada. Ausência/falha da API mantém EPUB legível com troca direta, e PDF conserva seu fallback anterior. Timings/curvas continuam os tokens existentes; movimento reduzido cancela as apresentações opcionais.


Callbacks de View Transitions não aguardam rAF nem tarefas que dependam dele. Preparação EPUB acontece no frame oculto antes da captura; somente a troca pronta/scroll e um `nextTick` entram no callback. O router libera sua captura depois de restaurar scroll sincronamente, sem aguardar pintura. Preparações PDF com trabalho assíncrono continuam fora de callbacks que suspendem desenho.


Text reading also offers independent top/bottom margins, each 0–160px (4px range steps), defaulting to 80/96px to match the preceding reader spacing. These are persisted reader preferences shared by EPUB scrolling, viewport pages and adapted PDF. Paginated EPUB bounds effective padding on short viewports to retain at least a readable content area; images use that same remaining height. Reflow/PDF original source assets remain unchanged.

## Offline download feedback

`OfflineBookControl` groups download/cancel actions and reuses the shared spinner, native progress and field/status text. Preparation and final confirmation use indeterminate progress; transfer shows completed EPUB chapters or PDF pages, with at most 99% until final confirmation. Received bytes are separate from the semantic unit count. The live status announces phase changes; byte updates are supplementary text. Keep retry actionable and explain that a cancelled update preserves the previous download. Details: [ADR-0016](../decisions/ADR-0016-offline-download-pipeline.md).

## Home reading summary

The `stat-grid--reading` variant presents three personal counts in a compact, semantic definition list: books in progress, completed books and saved highlights. It reuses the editorial numeric type, secondary labels, spacing and border tokens, with subtle separators and no card backgrounds, shadows or counters in motion. All three columns remain on one row on phones. Missing statistics omit this optional summary; catalog loading/error states remain shared. Offline counts explicitly cover only books on this device. Legacy keeps the existing simplified Home.

## App update and connection feedback

Use the shared `UiDialog` for the global update offer, with primary update and secondary defer actions, existing loading spinner, inline error/retry and ordinary dialog entrance/exit/reduced motion. Defer automatic offers while the reader or another dialog is open. Preferences can reopen an available offer. Active downloads disable application of the update.

Connection/sync feedback is a compact, expandable status surface using existing spacing, surface, border, radius and elevation tokens. It stays out of catalog layout and above the mobile bottom navigation, with a short polite announcement and keyboard-accessible native disclosure. Details expose errors, pending count, explicit retry, sign-in or conflict resolution. No free-standing global status prose above page headings. See [ADR-0017](../decisions/ADR-0017-app-update-and-sync-feedback.md).

## Phone administrative navigation

Below 640px, administration uses the existing **More** sheet rather than a second drawer. More → Administration opens a nested list with Overview, Libraries, Users, Metadata, Jobs, Compatibility and System; the latter two share a System heading. A back action returns to the general More list without navigating away. Inside admin routes, More opens this list directly. The current route/parent section is highlighted exactly once; library details select Libraries, never Overview. Switching sheet levels focuses the shared dialog heading; closing/navigation keep the existing motion and focus behavior. Desktop retains its sidebar and tablet its drawer; breakpoint changes release old drawer state/scroll lock. Both menus share the same destination definition and administrator guard.
