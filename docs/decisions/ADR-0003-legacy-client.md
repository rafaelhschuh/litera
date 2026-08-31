# ADR-0003 — Dedicated `/legacy` client over the shared Litera API

## Status
Accepted

## Context

Litera must remain practical on an older physical iPad in the iOS 10.x / old WebKit generation while preserving a modern Vue application for current browsers. Forcing the complete modern application to the old browser baseline would constrain the product and still leave compatibility risk in framework/runtime dependencies.

## Decision

Litera will expose a dedicated reduced-capability client under `/legacy`.

- `/` is the modern application.
- `/legacy` is a separate conservative client for core reading flows.
- Both clients use the same authenticated application API, domain semantics, data, authorization, and progress model.
- There is no parallel legacy backend and no duplicated legacy API namespace.
- The legacy client is controlled by the server setting `legacy.enabled` and can be enabled/disabled by an administrator.
- When disabled, `/legacy/*` must fail in a controlled way instead of loading a broken modern application.
- Browser capability checks may recommend `/legacy`, but automatic permanent user-agent redirection is not required.

## Required legacy flows

At minimum:

- login;
- home/library browsing;
- search;
- book detail;
- EPUB reading;
- reading progress persistence/restoration;
- logout.

PDF reading is best-effort until validated against the physical reference device and selected PDF engine.

Administrative functions are not required in `/legacy`.

## Consequences

- Modern Vue code is not required to execute on the legacy browser.
- Reader/domain contracts must remain UI-framework independent where practical.
- The legacy bundle must use conservative JavaScript/CSS and avoid unnecessary dependencies.
- Compatibility is tested on the physical reference device when available.
- The exact device model and iOS version are recorded in the compatibility matrix once confirmed.
