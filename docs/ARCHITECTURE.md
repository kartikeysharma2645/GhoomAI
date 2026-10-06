# Architecture

## High-level flow

```
User
→ Next.js UI (/, /agent, /plan, /vision)
→ deterministic Agent Router (16 intents, keyword-based, clarification on ambiguity)
→ Orchestrator (exactly one capability action per turn + approval gates)
→ Domain Capability (trips / realitycheck / livetrip / booking / vision)
→ SerpApi gateway (google / google_maps / google_hotels)
→ normalized evidence (source + observed timestamps + stable IDs)
→ deterministic reasoning (compare, match, propose — no LLM)
→ typed response (message + data + follow-ups)
→ UI viewers and read-only adapters
```

## Client

- Next.js 15 App Router, React 19, TypeScript 5 (strict), Tailwind 3.
- Client-held `ConversationSession` (Zod-validated, ≤50 transcript entries): transcript, active plan, lifecycle status, selections, latest check/discovery, pending confirmation. No persistence; refresh starts a new conversation.
- Shared `request.ts` helper: same-origin POST only, 60s AbortController timeout, deterministic timeout error, no browser retries, no credentials.

## Server

- Deterministic intent router (`src/server/agent/router.ts`) and orchestrator (`src/server/agent/orchestrator.ts`).
- Domain services own all business logic; 24 thin API routes do JSON parse → Zod validate → service call → safe response.
- Zod validation at every boundary; typed error taxonomy (Configuration / Upstream / Validation / Conflict → 500 / 502-or-429 / 400 / 409).
- Single SerpApi gateway (`src/server/services/serpapi/client.ts`): key from `process.env.SERPAPI_KEY` only, 15s per-call timeout, redacted error paths, per-item failure isolation instead of retries.

## Domain modules

- **trips** — requirement resolution (with explicit documented defaults) and evidence-carrying plan assembly.
- **realitycheck** — batched fresh re-verification, fact comparison, bounded fix proposals, compatibility-gated apply.
- **livetrip** — linear lifecycle (DRAFT→…→COMPLETED), activation, progress tracking, live situation detection, disruption-driven rescheduling.
- **booking** — readiness evaluation, relevance-gated live discovery, evidence-bound selection receipts, verification-only final recheck. Never books.
- **vision** — optional provider (graceful `VISION_NOT_CONFIGURED`), calibrated candidates, dual-leg live verification.

## Safety model

- No autonomous booking, activation, or fix/reschedule application — every consequential action needs explicit user confirmation; stale proposals/options are rejected by content-compatibility checks.
- External handoff only: provider URLs come solely from validated live evidence and are user-clicked, never server-fetched.
- Secrets stay server-side; inputs validated; uploads transient and size-capped; no arbitrary privileged URL fetching.

## State model

One linear trip lifecycle; approval is always explicit and recorded client-side; applying a fix resets approval (re-verification required). Sessions never grant authority — `pendingConfirmation` is context, and execution revalidates everything.

## Testing

527 tests passing at documentation time (counts move with code changes), including service-wiring tests for `/api/ask`, `/api/trips/plan`, `/api/trips/active/live-check`, and `/api/trips/booking-select` proving request → service → response. Clean typecheck and production build alongside.
