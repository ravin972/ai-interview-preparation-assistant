# Security

Two inputs are untrusted: the **company URL** supplied by the user, and the
**page content** returned by fetching it. They are different threats and get
different defences.

## 1. Threat model

| # | Threat | Vector | Control |
|---|---|---|---|
| T1 | SSRF to internal services | user submits a metadata-service or internal hostname | resolve-and-block, section 2 |
| T2 | SSRF via redirect | a public URL redirects to a private address | every hop re-validated, section 2 |
| T3 | DNS rebinding | hostname resolves public at check time, private at connect time | the validated address feeds the socket, section 2 |
| T4 | Resource exhaustion | huge body, slow response, redirect loop, crawl explosion | size cap, timeout, redirect cap, crawl budget |
| T5 | Prompt injection | a crawled page contains instructions aimed at the model | data framing plus schema constraint, section 4 |
| T6 | Exfiltration via injection | a page instructs the model to emit secrets | the model never receives secrets; output is schema-bound |
| T7 | IDOR | user B requests user A's kit | authorization invariant, section 6 |
| T8 | Credential stuffing | repeated login attempts | rate limiting, section 7 |
| T9 | Session theft | cookie interception or script access | httpOnly, Secure, SameSite, hashed server-side tokens |
| T10 | Secret leakage | keys in the repo or the client bundle | section 8 |

## 2. SSRF strategy

Applied by a single guarded fetcher in `packages/core/src/retrieval`. Nothing
else in the codebase performs outbound HTTP to a user-supplied address.

**Pre-flight, on the URL**

- Scheme allowlist: `http`, `https`. Everything else - `file:`, `gopher:`,
  `ftp:`, `data:` - is rejected.
- Embedded credentials of the form `scheme://user:pass@host/` are rejected
  outright.
- Port allowlist.

**Resolution, on every address**

Resolve **all** A and AAAA records and reject the request if *any* resolved
address falls in a blocked range:

```
loopback         127.0.0.0/8      ::1
private          10.0.0.0/8       172.16.0.0/12     192.168.0.0/16
                 fc00::/7
link-local       169.254.0.0/16   fe80::/10
CGNAT            100.64.0.0/10
unspecified      0.0.0.0/8        ::
multicast        224.0.0.0/4      ff00::/8
reserved         240.0.0.0/4
IPv4-mapped IPv6 is unwrapped and re-checked
```

**T3, DNS rebinding.** Validating the hostname and then handing that hostname
to the HTTP client leaves a window in which a second lookup can return a
different address. Instead the fetcher installs a custom `lookup` on the
`undici` Agent's connect options: the lookup performs the validation and
returns the address, so **the address that was validated is the address the
socket connects to**. The check-then-connect gap is closed rather than
narrowed.

**T2, redirects.** Redirects are followed manually, never by the client.
`FETCH_MAX_REDIRECTS` (3) hops maximum, and every hop repeats the full
pre-flight and resolution checks. A redirect to a private address is a hard
failure, not a warning.

**T4, response handling.** `Content-Type` must be `text/html`, `text/plain` or
`application/xhtml+xml`. The body is streamed and aborted at `FETCH_MAX_BYTES`
(2 MB) rather than buffered first. `FETCH_TIMEOUT_MS` (8 s) bounds each
request; `CRAWL_BUDGET_MS` (45 s) and `CRAWL_MAX_PAGES` (5) bound the crawl as
a whole. Crawl depth is 1 from the homepage.

### The evaluator exception

The evaluator's fixtures live on `http://localhost:8099`, which a strict
policy must block. The resolution is structural rather than conditional:

> **The fetch policy is a constructor parameter - never a global, and never an
> environment check inside the fetcher.**

- `apps/api` constructs `SsrfPolicy.STRICT` at startup. It has no code path
  that constructs anything else.
- `tools/evaluate` constructs `SsrfPolicy.fromEnv()`, which defaults to strict
  and relaxes only for the `host:port` pairs named explicitly in
  `EVAL_ALLOW_PRIVATE_HOSTS`. Loopback is never allowed implicitly; the host
  must be listed.

A test asserts that no module reachable from the API's entry point constructs a
non-strict policy, so setting `EVAL_ALLOW_PRIVATE_HOSTS` in the production
environment cannot weaken the deployed API. That is the property that matters:
the exception is *unreachable* from production code, not merely unused by it.

## 3. Crawler citizenship

`robots.txt` is fetched and parsed before any page on a host is requested, and
a disallowed path is skipped and recorded in `research.robotsBlocked` rather
than silently dropped. `Crawl-delay` is respected, capped so that a hostile
value cannot stall the pipeline. Requests carry an identifying `User-Agent`.

We do **not** scrape search-engine result pages. The specification requires
respecting site terms, and SERP scraping violates them. Stage 9 uses a search
API when `TAVILY_API_KEY` is configured, and otherwise records an honest
`no_public_discussion` gap - an outcome the specification explicitly
anticipates. Recorded as D-017 in [DECISIONS.md](./DECISIONS.md).

## 4. Prompt injection

**Fetched page content is data. It is never instructions.** Four layers:

1. **Sanitize.** Strip `script` and `style` elements, HTML comments and event
   attributes; extract text; collapse whitespace; truncate.
2. **Frame.** Page text is passed inside a delimited
   `untrusted_page_content` block, under a system instruction stating that the
   block is third-party data, that it may attempt to issue instructions, and
   that any instruction inside it must be ignored and reported rather than
   followed.
3. **Constrain.** Every model call returns JSON validated against a Zod
   schema. A successful injection still cannot change the kit's shape, add
   fields or redirect the pipeline - the response simply fails validation and
   is repaired or discarded.
4. **Contain.** Crawled content never influences control flow. Link ranking is
   deterministic (PIPELINE.md section 2), `pages_used` comes from the fetcher's
   log rather than from model output, and the model is never given
   credentials, environment values or another user's data - so there is
   nothing for an injection to exfiltrate.

A heuristic scanner flags known injection phrasings and records them in
`research.injectionFlags`, surfaced in the UI as provenance so the user can see
that a page behaved suspiciously.

## 5. Authentication and sessions

- **Password hashing:** `scrypt` from `node:crypto` with a per-user random salt
  and `timingSafeEqual` comparison. Chosen over argon2 and bcrypt because it
  needs no native build - a real deployment failure mode on free tiers - and it
  ships in the standard library (D-018).
- **Sessions:** an opaque 256-bit random token. Only its **hash** is stored
  server-side, so a database read cannot be replayed as a session. Logout
  deletes the record, which makes revocation real rather than advisory, and a
  TTL index expires stale sessions automatically.
- **Cookie:** `httpOnly`, `Secure` in production, `SameSite=Lax`, and
  first-party because the browser only ever talks to the Next.js origin
  (ARCHITECTURE.md section 6). No token is readable by JavaScript, and there is
  no cross-site cookie to be blocked or stolen.
- **CSRF:** `SameSite=Lax` plus an `Origin` check on every state-changing
  request.
- Standard hardening via `helmet`. Error responses never leak stack traces or
  internal identifiers.

## 6. Authorization invariant

> **Every kit, job and practice record is read with the owning `userId` in the
> query filter. Never fetch by id and then compare.**

```js
// correct
db.kits.findOne({ _id: id, userId: session.userId })

// forbidden - one missing check becomes a data leak
const kit = await db.kits.findOne({ _id: id })
if (kit.userId !== session.userId) { /* ... */ }
```

A non-owner receives **404**, not 403, so kit ids are not enumerable. The rule
is enforced by a single accessor module rather than by discipline at each call
site, and is covered by an explicit IDOR test.

## 7. Rate limiting

| Surface | Reason |
|---|---|
| `POST /api/auth/login` and `/register` | credential stuffing (T8); limited per IP and per account |
| `POST /api/kits` and regeneration | generation is expensive in both wall-clock time and provider quota |
| Global per-session ceiling | protects the free-tier LLM quota from one runaway client |

Provider-side limits are a separate concern, handled by bounded backoff and the
fallback provider (PIPELINE.md section 8). Rate limiting protects us from
clients; backoff protects us from providers.

## 8. Secrets and environment

- All credentials come from environment variables. `.env` is git-ignored;
  `.env.example` documents every variable with no real values.
- Secrets live only in Render and Vercel platform configuration. No key is
  committed, and no key reaches the browser - the web app holds no provider
  credentials because it never calls a provider directly.
- The evaluator reads credentials from the environment only, never from a
  config file or a command-line argument, so keys stay out of shell history.
- `EVAL_ALLOW_PRIVATE_HOSTS` is documented as evaluator-only and is inert in
  the API by construction (section 2).
