# ADR-0010 — Android como host WebView do Litera

- Status: Accepted for implementation; physical acceptance pending
- Date: 2026-10-22
- Scope: Android preview, version derived from root package.json (0.5.5)

## Context

The user rejected the separate native Android preview before merge and explicitly requested a well-integrated WebView application in a new PR. Maintaining Kotlin catalogue screens, a second set of reading engines and a second progress queue would duplicate the existing web product and create recurring parity work. The complete Litera PWA already owns EPUB/PDF reading, themes, annotations, format-aware restoration, offline downloads and conflict resolution.

## Decision

Use a Kotlin Android host with the existing Litera application loaded as the top-level WebView document. Do not wrap the application in an iframe. Keep server setup, Android window/insets/IME, Back handling, lifecycle, adaptive icon and controlled external navigation in Kotlin. Keep product screens, reading engines, authentication, locators and IndexedDB/outbox in the web application.

Require AndroidX WebKit 1.15.0 multi-profile support at runtime (`WebViewFeature.MULTI_PROFILE`). Select a persistent profile per canonical origin with `WebViewCompat.setProfile` before navigation. Unsupported providers get an actionable update screen; never silently use the default profile. Profiles and storage are private to the APK and independent from Chrome/PWA.

HTTPS is the default; HTTP needs explicit opt-in and cannot promise a secure context or full offline support. Never bypass TLS errors. Disable mixed content, third-party cookies and file/content access. Restrict the trusted top-level document to the configured origin; external HTTP(S) links require a gesture and leave through the browser.

Use `WebViewCompat.addWebMessageListener` with exact origin allowlist, main-frame verification and trusted top-level document checks for bounded declarative appearance/reading state and opening the limited host settings dialog. Do not use `addJavascriptInterface` or expose privileged native capabilities. Derive system bar appearance from existing `theme-color`/CSS tokens. Keep the screen awake only during foreground reading with the preference enabled.

Send `litera-host-pause` to the existing reader persistence path, retaining the web outbox as the only local operation queue. Back must resolve overlays/fullscreen/router/history before leaving. Network errors must preserve a functioning offline shell instead of replacing it on any failed request.

## Alternatives

- A separate native UI with Readium/PdfRenderer was implemented as a preview but rejected before integration. It created parallel rendering, locator translation and offline capabilities to maintain.
- A minimal unrestricted WebView wrapper would reuse screens but leave session isolation, navigation, lifecycle, system appearance and network recovery unresolved.
- A Trusted Web Activity would depend on browser hosting and verified-origin association, complicating arbitrary self-hosted server configuration.

## Consequences and acceptance

Web improvements ship through the existing server/PWA implementation and remain shared across clients. The APK depends on a sufficiently capable, updated WebView provider and secure-origin browser constraints. Process termination can interrupt JavaScript/network work; no Android background delivery guarantee is introduced. Debug artifacts are previews without stable distribution signing.

The rejected native preview's tests do not validate this implementation. Android unit/lint/build/instrumentation and relevant web regressions must run; physical validation remains explicit in the [Android checklist](../../android/docs/testing.md). Keep the new PR in draft and do not merge until the user tests the APK and expressly authorizes integration.

See [Android contracts](../../android/AGENTS.md), [architecture](../../android/docs/architecture.md), [security](../../android/docs/security.md) and [ADR-0009](ADR-0009-offline-packages-and-outbox.md).
