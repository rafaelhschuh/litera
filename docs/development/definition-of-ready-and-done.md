# Definition of Ready and Definition of Done

## Definition of Ready (feature/work item)

A work item is ready when:

- the user-visible objective is clear;
- affected requirements/acceptance criteria are identified;
- authorization and data ownership are known;
- expected loading, loaded, empty, error and disabled/read-only states are identified where applicable;
- existing UI primitives/components/patterns have been searched before proposing new ones;
- modern vs legacy behavior is classified when the work touches a core library/reader flow;
- risky external dependency or architectural choices are either already decided or explicitly documented for an ADR during implementation;
- test expectations are known.

## Definition of Done (feature/work item)

A work item is done only when:

- the behavior works end-to-end through the real application path, not only through isolated mocks;
- frontend, API/backend, persistence and authorization changes required by the behavior are integrated;
- no critical path depends on placeholder data, fake success responses or unimplemented TODOs;
- UI uses existing tokens/primitives/components/patterns or documents why a new one is needed;
- loading, empty and error behavior exists where relevant;
- modern responsive behavior is usable on desktop and touch-sized viewports;
- legacy behavior is implemented, intentionally reduced, or explicitly marked unavailable according to the UI spec;
- security-sensitive inputs and authorization boundaries are handled server-side;
- tests covering the acceptance criteria pass;
- typecheck, lint, tests and production build pass;
- Docker/container smoke test passes when the change affects runtime/deployment;
- relevant docs/ADR/config examples are updated.

## Release-stage rule

Each Codex implementation stage (MVP, Beta, RC) must finish with a runnable integrated product. A stage is not complete if only one architectural layer is substantially implemented while another required layer remains scaffolding.

## Android host gate

Changes under `android/` or the shared host integration also follow [android/AGENTS.md](../../android/AGENTS.md), [ADR-0010](../decisions/ADR-0010-android-webview-host.md) and the [Android validation checklist](../../android/docs/testing.md). Verify origin/profile isolation, bounded appearance messaging, Back/overlays/fullscreen, pause/restoration, bars/cutout/IME and offline on a secure origin through the real shared web flow. Do not duplicate screens, engines or outbox in Kotlin.

Run unit tests, lint, APK build, instrumentation and pertinent web gates. Record exact evidence separately for browser, emulator and physical device; prior native-preview results do not validate the WebView host. The new preview PR remains in draft without merge until the user tests its APK and expressly authorizes integration.
