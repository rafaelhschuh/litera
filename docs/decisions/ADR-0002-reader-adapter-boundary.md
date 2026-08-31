# ADR-0002 — Litera-owned reader contract over mature format engines

## Status
Accepted

## Context

The reader is the product's main differentiator, but implementing EPUB/PDF parsing and rendering from zero would add substantial risk and duplicate mature standards work.

## Decision

Litera owns the reader shell, state model, progress semantics, navigation, preferences, accessibility behavior, and format adapter contracts. Mature parsing/rendering libraries may be used underneath those adapters after compatibility, security, and licensing review.

## Consequences

- The UX remains Litera-specific.
- Format-specific rendering can evolve independently.
- The project avoids unnecessary reimplementation of standards parsers.
- Dependencies must be audited for old-browser behavior and security.
