# Threat Model

## Assets

- Book files and private library organization.
- User accounts and credentials.
- Reading history and progress.
- Metadata and configuration.
- Server filesystem and secrets.

## Main threats

1. Path traversal or arbitrary filesystem access through library APIs.
2. Malicious or malformed EPUB/PDF content exploiting parsers/renderers.
3. Stored XSS through book metadata, filenames, descriptions, or rendered ebook HTML.
4. Unauthorized access to another user's library/progress.
5. Credential theft/session abuse.
6. SSRF or abuse of metadata provider configuration.
7. Resource exhaustion through huge/corrupt files, scans, or provider requests.
8. Metadata poisoning or untrusted external content.

## Controls

- Canonicalize and constrain all filesystem paths to configured library roots.
- Treat book files and embedded metadata as untrusted input.
- Sanitize/contain rendered EPUB HTML and isolate active content; do not permit arbitrary scripts from books to execute in the application origin.
- Enforce authorization server-side on every protected resource.
- Use secure password hashing, secure session/token handling, CSRF protection where applicable, and rate limiting on authentication endpoints.
- Restrict outbound provider requests to known provider contracts; use timeouts and bounded retries.
- Bound scan/parser resources and isolate expensive work from request handling.
- Never trust client-supplied progress ownership.
- Keep secrets out of logs and repository.

## Privacy

Litera should operate locally without requiring a telemetry service. External metadata lookups are optional integrations and should be transparent in documentation.

## Beta implementation review — 2026-08-26

| Threat | Implemented control | Regression evidence |
|---|---|---|
| Traversal / arbitrary filesystem | `realpath` constrained to configured roots, symlinks skipped, resolved book path checked again before serving | `beta.test.ts` outside-root rejection; protected content authorization test |
| Malicious EPUB content / stored XSS | bounded ZIP entries, `sanitize-html`, links/images transformed, same-origin content only inside `iframe sandbox=""`, CSP blocks script/object | smoke chapter assertion removes `<script>` |
| Cross-user data exposure | session-derived user id, centralized admin middleware, library access join on catalog/content and progress key `(user,book)` | multi-user/library and progress-isolation tests |
| Session abuse / CSRF | random tokens stored as SHA-256, `HttpOnly; SameSite=Lax`, configurable Secure, Origin enforcement on mutations, login rate limit, revocation on password/deactivation | integration auth boundary and Beta session-revocation tests |
| Provider outage / SSRF | fixed Open Library origins only, no arbitrary URL config, 5s timeout, bounded retry, rate-limit handling, cache, minimal matching fields | provider-offline integration test |
| Resource exhaustion | 128 KiB JSON limit, configurable per-book size limit, bounded ZIP entry sizes, serialized per-library jobs, bounded provider/search results | job deduplication/recovery and corrupt-file tests |
| Sensitive logs | JSON request metadata only; no bodies/tokens/content; internal error message replaced by derived id | manual log review in final gate |

Residual items are documented in `docs/security/privacy-and-operations.md` and the compatibility matrix. They are not P0/P1 blockers for the self-hosted Beta profile.
