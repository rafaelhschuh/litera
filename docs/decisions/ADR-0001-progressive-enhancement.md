# ADR-0001 — Progressive enhancement as a core compatibility strategy

## Status
Accepted

## Context

The product explicitly targets modern devices while preserving practical usability on old hardware, with a physical iOS 10.x / old WebKit iPad as the current compatibility reference. A modern SPA can accidentally make old browsers unusable through unsupported JavaScript/CSS APIs or excessive payloads.

## Decision

Litera will use progressive enhancement and a reduced-capability presentation path. Core library navigation and reading must not depend on optional modern visual effects. Capability detection should be preferred to browser-name detection where practical, with a small compatibility profile for known problematic environments.

## Consequences

- Frontend architecture must isolate modern-only enhancements.
- Reader rendering must be incremental and memory-conscious.
- Compatibility tests are part of product acceptance.
- The modern UI cannot be the only implementation of core navigation semantics.
