# SECURITY.md

Security is a release blocker, not a feature. This file lists the threat model and the controls that must exist before v1.0. Each control gets implemented + tested in the milestone noted; M8 verifies all with evidence.

## 1. Assets to Protect

1. User credentials and sessions.
2. Billing integrity (entitlements, credits, payment events).
3. User content privacy — especially local-mode text (invariant: it must never reach us).
4. Service availability and cloud-generation budget (cost attacks).
5. Brand trust (no malicious content injection, no data leaks).

## 2. Threat Model Summary

| Threat | Vector | Primary control |
| --- | --- | --- |
| Credential stuffing / brute force | login/register/reset endpoints | argon2id, per-IP+per-account rate limits (Redis), generic errors, optional CAPTCHA at M8 |
| Session theft | XSS, network | httpOnly Secure SameSite cookies, CSP, HSTS, session expiry + rotation on privilege change |
| Privilege escalation / IDOR | object references in API | server-side ownership checks on every resource route; integration tests |
| Forged entitlement | client tampering, replayed state | entitlements derived only from DB via webhooks; API re-checks every request |
| Webhook forgery / replay | public webhook endpoint | raw-body signature verification (provider secret), event-id idempotency ledger, timestamp tolerance |
| Payment abuse | stolen cards, refund loops | provider-side risk tools, spend caps, anomaly alerts, audit log |
| Cost attacks on cloud TTS | scripted premium generation | credit reservation pattern, per-user+IP rate limits, hard daily caps, alerting |
| Bot signup / free abuse | automated accounts | email verification, rate limits, heuristics/CAPTCHA as needed |
| Oversized/malformed requests | API DoS | Fastify bodyLimit, zod validation, upload size caps, request timeouts |
| XSS | user/project names, rendered text | React escaping by default, no `dangerouslySetInnerHTML` without sanitization audit, CSP (`default-src 'self'`, no unsafe-inline where feasible) |
| CSRF | cross-site form posts | SameSite=Lax/Strict + Origin check + double-submit token for cookie-authenticated mutations |
| SQL/injection | any input | parameterized queries only (Drizzle), zod-validated inputs |
| Supply chain | npm deps | lockfile-only installs, Dependabot/Renovate, `pnpm audit` in CI, pinned ORT/kokoro versions |
| Secret exposure | repo, bundles, logs | env-only secrets, separate frontend/server envs, log scrubbing, pre-commit secret scan (gitleaks) |
| Client-side analytics leakage | event payloads | schema-whitelisted events, CI assertion that payloads exclude content fields (D-011) |
| Model/cache tampering | corrupted cache → broken app | versioned model URLs w/ integrity expectations, cache-busting re-download path |

## 3. Transport & Headers

- HTTPS everywhere; HSTS preload on prod domains.
- CSP: `default-src 'self'`; explicit allowances for model CDN; WASM requires `'wasm-unsafe-eval'` (documented exception); frame-ancestors none.
- COOP/COEP per D-010; `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`; minimal Permissions-Policy.

## 4. Auth Requirements (implemented in M5)

- Passwords: argon2id (memory-hard params reviewed), min length 10, breach-list check (k-anonymity API) recommended.
- Email verification required before paid purchase; reset tokens hashed, single-use, ≤ 1 h TTL.
- Sessions: opaque token, hashed at rest, sliding expiry ≤ 30 d, revoke-all on password change, list + revoke active sessions in settings.
- Rate limits (Redis): login 5/15 min/IP+email, register 3/h/IP, reset 3/h/email, general API burst caps.

## 5. Payments Security (details in PAYMENTS.md)

- Webhook endpoint: constant-time signature compare, raw body, replay window, idempotency insert before processing.
- No prices/amounts accepted from client; checkout created server-side from plan config.
- Entitlement changes only via verified events or admin action (audited).

## 6. Local-Mode Privacy Invariant Controls

- Worker bundle contains no API-client code paths for content (architecture-level guarantee).
- E2E tests assert zero network requests containing text during local generation.
- Analytics CI guard (D-011).
- Server access logs must not capture local-mode content even if a bug routes traffic (defense in depth: request logging excludes bodies).

## 7. Verification Checklist Before v1.0

- [ ] OWASP ASVS-lite review of auth flows
- [ ] Dependency audit clean or waived-with-reason
- [ ] gitleaks scan clean
- [ ] Webhook replay/forgery tests pass
- [ ] IDOR test suite over all user-scoped resources passes
- [ ] CSP report clean for a week in report-only then enforced
- [ ] Backups restore-tested
