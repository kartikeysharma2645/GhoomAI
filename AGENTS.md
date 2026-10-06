# AGENTS.md — GhoomAI

> This file is the source of truth for AI coding agents working on this repository.
> Read it before writing any code. Follow it over any conflicting default behavior.

## 1. Project Overview

**Name:** GhoomAI
**Tagline:** "Plan it. Check it. Experience it."

GhoomAI is an AI travel agent that can:

- Plan complete trips from scratch
- Analyze an existing itinerary
- Verify travel plans against live information
- Detect unrealistic timings, routes, prices, availability, and other issues
- Suggest corrections and re-check the corrected plan
- Dynamically reschedule an itinerary when the user is delayed
- Track the user's itinerary during a trip
- Discover nearby places and activities
- Identify landmarks from uploaded images and explain them
- Provide photography and pose suggestions
- Provide evidence for important travel recommendations

### Core Product Principle

GhoomAI must **not** simply generate an itinerary. It must:

1. Research (live data)
2. Verify (challenge its own recommendations)
3. Fix problems
4. Re-verify the updated plan

The main verification concept is called **`RealityCheck`**.

Every important travel recommendation (timings, routes, prices, opening hours,
availability, feasibility) should eventually be backed by evidence from live data.

## 2. Development Scope — Current Status

- **Milestone 0 (completed):** repository foundation and initial `AGENTS.md` setup.
- **Phase 1 (completed):** Technical Architecture & Environment Configuration.
- **Phase 2 Step 1 (completed):** Secure SerpApi Search Engine API integration
  and live connectivity test (Google Search gateway + test endpoint).
- **Phase 2 Step 2 (completed):** Google Maps search support, live-verified
  (gateway `searchMaps` + maps test endpoint).
- **Phase 2 Step 3 (completed):** Google Hotels support, live-verified
  (gateway `searchHotels` + hotels test endpoint).
- **Phase 2 (completed):** Secure SerpApi integration, live-verified across
  Google Search, Google Maps, and Google Hotels.
- **Phase 3 (in progress):** Basic GhoomAI interaction with live SerpApi data.
- **Phase 4 (in progress — Step 2 completed):** Trip planning foundation + enhanced research and itinerary quality.
- **Phase 5 (in progress — Steps 1–4 completed):** RealityCheck engine + report + fix proposals + user approval/apply (no auto-apply).
- **Phase 6 (completed):** Live Trip activation, itinerary tracking, and completion.
- **Phase 7 (in progress — Steps 1–3):** Live situation awareness, reschedule proposals, approval/apply (no auto-reschedule).
- **Phase 8 (in progress — Prompt 4):** Visual travel companion: vision provider optional and gracefully disabled (no key required; `VISION_NOT_CONFIGURED` when unset).
- **Phase 9 (completed):** Booking & Handoff / Pre-Trip Finalization:
  readiness domain + `POST /api/trips/booking-readiness` (Prompt 1),
  live SerpApi-backed `POST /api/trips/booking-discover` + `POST
  /api/trips/booking-select` stateless EXTERNAL receipts (Prompt 2,
  smoke-tested), and verification-only `POST /api/trips/booking-recheck`
  around the existing RealityCheck engine + panel UI (Prompt 3,
  smoke-tested). No booking performed, no database, all DoD items PASS
  (see §11).
- **Phase 10 (completed):** Unified Travel Agent Orchestration:
  deterministic intent taxonomy + client-held session contract (Prompt 1),
  single-action orchestrator + `POST /api/agent` with approval gates
  (Prompt 2, smoke-tested), unified conversational UI at `/agent`
  embedding existing viewers + end-to-end smoke (Prompt 3). No LLM, no
  hidden chains, all DoD items PASS (see §12).
- Application development is now permitted, strictly according to the phased
  plan in Section 3.
- Do **not** build the complete application yet — implement only what the
  current phase requires.
- Do **not** skip ahead to later phases without validating earlier phases.

## 3. Development Approach (Incremental Phases)

Build GhoomAI incrementally. Do not skip directly to later phases without
validating earlier phases.

- **Phase 1 (completed):** Project architecture and configuration.
- **Phase 2 (completed):** Secure SerpApi integration and a minimal connectivity test.
- **Phase 3 (in progress):** Basic GhoomAI interaction with live SerpApi data.
- **Phase 4 (in progress — Step 2 completed):** Trip planning foundation + enhanced research and itinerary quality.
- **Phase 5 (in progress — Steps 1–4 completed):** RealityCheck engine + report + fix proposals + user approval/apply (verify only; later phases next).
- **Phase 6 (completed):**
  - Step 1: Trip activation & state foundation.
  - Step 2: Live itinerary tracker.
  - Final integration/hardening audit completed.
- **Phase 7 (in progress — Steps 1–3):**
  - Step 1: Live situation awareness & disruption detection — completed.
  - Step 2: Bounded rescheduling proposals — completed.
  - Step 3: User approval, apply, fresh recheck — this prompt.
- **Phase 8 (in progress — Prompt 4):** Visual travel companion: vision provider optional and gracefully disabled (no key required; `VISION_NOT_CONFIGURED` when unset).
- **Phase 9 (completed):** Booking & Handoff / Pre-Trip Finalization
  (readiness + live discovery + selection receipts + final recheck;
  verification-only, no transactions).
- **Phase 10 (completed):** Unified Travel Agent Orchestration
  (taxonomy + session + routing; orchestrator + `/api/agent` + approval
  gates; unified `/agent` UI; no LLM, verification-only handoffs).

Rules:

- Complete and validate one phase before starting the next.
- Prefer a small, tested, working slice over a large untested implementation.
- Do not implement all SerpApi engines immediately; add them incrementally.

## 4. Target Architecture

Prefer modular, maintainable architecture over a monolithic implementation.

Intended separation (to be created in Phase 1, not now):

```text
/ (repo root)
  AGENTS.md
  .env.example        # placeholder names only, no secrets
  README.md
  frontend/           # client-side UI only, no secrets
  backend/            # or server/ — API routes, services, secrets live here
    services/
      serpapi/        # all SerpApi access isolated here
```

### Frontend responsibilities

- User input, itinerary display, trip tracking UI, image upload UI.
- Calls backend APIs only.
- Must never import, reference, or receive raw API keys.

### Backend / server-side responsibilities

- Environment-based configuration.
- All SerpApi requests go through a server-side service layer.
- Validation, trip-planning logic, RealityCheck verification logic.
- Key handling, error handling, rate-limit handling, response normalization.

### Configuration

- Use environment-based configuration so the same application can run locally
  and in production.
- Frontend config: public, non-secret values only.
- Backend config: secrets loaded from environment, never bundled to frontend.

## 5. SerpApi Requirement

SerpApi is a core external data provider for GhoomAI.

The architecture must allow future use of relevant SerpApi capabilities
including:

- Google Search
- Google Maps / local places
- Google Flights
- Google Hotels
- Google News
- Google Reviews
- Google Lens or equivalent visual search where appropriate
- Other SerpApi engines when useful

Constraints:

- Do not implement all of these immediately.
- SerpApi integration will be built and tested incrementally (starting Phase 2).
- All SerpApi calls must go through the server-side service layer.
- The service layer should isolate engine-specific details so new engines can
  be added without changing frontend code.

## 6. Security Requirements (Mandatory)

1. Do not hardcode any API keys or credentials.
2. SerpApi credentials are provided ONLY through the server-side environment
   variable:
   - `SERPAPI_KEY`
3. Never expose `SERPAPI_KEY` to frontend/client-side code.
4. Never use `NEXT_PUBLIC_SERPAPI_KEY` or any other public-prefixed secret.
5. Never print, log, commit, or return the actual API key — not in responses,
   errors, tests, screenshots, or docs.
6. Create `.env.example` with placeholder variable names only. Example:
   `SERPAPI_KEY=your_key_here` (actual file to be created in Phase 1, not now).
7. Ensure `.env` and local secret files are ignored by Git
   (already covered by `.gitignore`: `.env`, `.env.*` except `.env.example`).
8. If the SerpApi key is unavailable, fail with a clear configuration error
   (e.g. HTTP 500 with generic message + server log) without asking the user
   to paste the key into the application UI.
9. Never expose secrets in GitHub, README files, screenshots, documentation,
   or frontend bundles.
10. No fake API responses: do not create fake API responses or pretend an
    external API is working if it has not been tested. Mark untested
    integrations as untested; use explicit mocks/stubs only in tests and label
    them as such.

Agents must verify security compliance before proposing any commit:

- [ ] No secret in diff (`git diff`, `git status`).
- [ ] No `SERPAPI_KEY` in any `frontend/` file.
- [ ] No `NEXT_PUBLIC_` secret.
- [ ] No key in logs or error payloads.

## 7. Coding Conventions

- Keep frontend and backend responsibilities clearly separated.
- Small, focused modules with single responsibilities
  (e.g. `serpapi/client`, `serpapi/flights`, `realitycheck/verifier`).
- Server-side SerpApi client must:
  - Read key from `process.env.SERPAPI_KEY` only.
  - Throw a configuration error at startup/request time if missing.
  - Never accept the key from client input.
- All external responses must be validated/normalized at the service boundary.
- Prefer explicit error types: `ConfigurationError`, `UpstreamError`,
  `ValidationError`.
- Use `async/await`, timeouts, and retries with backoff for external calls.
- No `console.log(apiKey)` or equivalent; redact secrets in logs.
- Environment-based config: `development` / `production` via `NODE_ENV`
  (or framework equivalent); no environment-specific hardcoded URLs/keys.
- Tests: unit-test service logic; integration tests for SerpApi must run
  explicitly (require live key) and must not commit cassettes containing keys.

## 8. RealityCheck Concept (Reserved for Phase 5)

`RealityCheck` is the verification engine name. Future behavior:

- Input: proposed itinerary + live SerpApi evidence.
- Checks: unrealistic timings, impossible routes, stale prices, closed venues,
  availability conflicts, and other feasibility issues.
- Output: per-item verdict (verified / suspicious / invalid) + evidence links
  + suggested corrections.
- Loop: suggest corrections → re-check the corrected plan until clean or
  explicitly flagged as unresolved.

Do not implement RealityCheck before Phases 1–4 are validated.

## 9. Git and Milestone Rules

- Create commits only at meaningful project milestones.
- Do not commit after every small change.
- Before a meaningful milestone is committed, explicitly tell the developer
  that it is a good checkpoint and provide a professional commit message.
- Never commit secrets. Verify with `git diff --cached` and `git status`
  before suggesting a commit.
- Suggested milestone commits (future):
  - `chore: define GhoomAI architecture and agent rules (AGENTS.md)`
  - `feat(phase-2): add secure server-side SerpApi client with connectivity check`
  - etc.

## 10. Definition of Done (for future phases)

- Phase passes only if: code runs locally via env config, no secret leakage,
  SerpApi path (if any) tested against live API or explicitly marked untested,
  and changes are modular with frontend/backend separation intact.

## 11. Phase 9 — Booking & Handoff / Pre-Trip Finalization Contract

Product goal: after a user has approved a verified itinerary, GhoomAI helps
the user move from an approved travel plan toward actual booking/handoff
without pretending that GhoomAI itself is a universal booking platform.

Core principle: "Search and verify the option; let the user complete
the booking."

### Scope

Phase 9 covers:

1. Approved-trip readiness for booking/handoff.
2. Live discovery of relevant booking/search options using existing SerpApi
   capabilities.
3. Evidence-backed option presentation.
4. Explicit distinction between:
   - live search result
   - estimated information
   - external booking/handoff
   - actual confirmed booking
5. External handoff rather than fake in-app booking.
6. A pre-trip finalization/recheck step so the itinerary can be checked
   again after the user has approved/booked.
7. Preservation of the existing lifecycle:
   DRAFT → PLANNED → VERIFIED → APPROVED → ACTIVE → COMPLETED.
   Do not invent a new lifecycle unless technically necessary.
8. Compatibility with the existing RealityCheck and Live Trip systems.
9. Security and honest-failure behavior.

### SerpApi rule

SerpApi/Search Engine APIs remain a core product capability. Phase 9 must
use the existing SerpApi gateway meaningfully for live discovery/search
where applicable. Do not replace live search with hardcoded examples or
decorative API calls. SerpApi is a search/data layer, not a universal
booking transaction API.

### Booking constraint

GhoomAI must NOT claim that it completed a booking unless an actual
supported booking integration exists. For providers without a
transactional integration, the correct behavior is external handoff:

- discover/search the relevant option
- show live evidence
- provide an appropriate provider/booking destination when available
- let the user complete the transaction externally
- allow the user to record/attach booking details afterward if the
  existing architecture supports it

### Architecture requirements

- Reuse the existing SerpApi client/gateway and normalizers.
- Reuse existing evidence conventions.
- Reuse RealityCheck rather than creating a second verification engine.
- Reuse existing itinerary/trip models where possible.
- Keep booking-provider-specific logic isolated behind clear server-side
  boundaries.
- No client-side API secrets.
- No fake booking confirmation.
- No invented availability, prices, URLs, or booking IDs.
- External provider links must be based on actual returned
  evidence/known supported destinations; never fabricate URLs.
- User approval must remain explicit for consequential actions.
- Partial failures must be represented honestly.

### Security requirements

- Never expose SERPAPI_KEY.
- Never accept arbitrary server-side URLs for privileged fetching.
- Validate all user input at API boundaries.
- Do not store sensitive booking credentials/payment details.
- Do not log secrets or unnecessary personal booking data.

### Definition of Done (Phase 9)

- Booking/handoff data contract established.
- Live SerpApi-backed discovery implemented where supported by existing
  gateway capabilities.
- Honest external handoff behavior.
- Pre-trip final RealityCheck/recheck path.
- Appropriate UI for booking/handoff state.
- Tests covering successful discovery, unavailable/failed search,
  stale/changed results, no fake booking confirmation, and invalid input.
- Full existing test suite remains green.
- Typecheck/build pass.
- Controlled live smoke test where credentials and existing SerpApi
  capabilities permit.
- Documentation updated.
- No commit/push by OpenCode.

## 12. Phase 10 — Unified Travel Agent Orchestration Contract

Status:
- Phase 10 completed (Prompts 1–3; all Definition of Done items PASS).

Product goal:
Turn the separate Phase 1–9 capabilities into one coherent deterministic
travel-agent workflow where a user's natural-language request can invoke
the appropriate existing GhoomAI capability without requiring manual
navigation between separate product surfaces.

Core principle:
"Route deterministically; act transparently; never guess."

Core user problem:
The current product contains planning, RealityCheck, fixing, live-trip,
vision, and booking/handoff capabilities, but the user must manually
navigate their separate surfaces. The existing NL Ask surface only
supports limited single-shot search intents.

### Scope

1. Extended deterministic intent taxonomy covering:
   - plan_trip
   - check_trip
   - fix_trip
   - booking_discover
   - booking_select
   - booking_recheck
   - activate_trip
   - trip_status/progress
   - reschedule_advice
   - identify_place
   - existing search intents
   - explicit out_of_scope
2. Client-held conversation session:
   - transcript
   - active plan
   - lifecycle status
   - selections
   - relevant latest verification state
3. Server-side deterministic orchestrator:
   - intent
   - validation
   - exactly one existing capability action per turn
   - typed response
   - capability invoked
   - returned data
   - suggested next actions
4. Unified conversational UI that embeds existing viewers instead of
   rebuilding them.
5. Explicit approval gates remain mandatory for consequential actions.

### Non-goals

- No LLM integration.
- No autonomous hidden multi-step execution.
- No new lifecycle.
- No database/persistence.
- No new SerpApi engines solely for orchestration.
- No trip mutation outside existing services.
- No redesign/reimplementation of existing panels.
- No general-purpose chit-chat persona.

### Reuse

- existing `agent/intent.ts`
- existing `agent/responder.ts`
- trip planning services
- RealityCheck services
- fix/apply services
- Live Trip services
- booking/handoff services
- vision services
- existing SerpApi gateway
- existing evidence/error/schema conventions
- existing viewer components

### SerpApi role

The orchestrator does not become a second SerpApi client. Existing
capabilities continue to perform their established live-data calls
through the shared gateway.

### Architecture

`src/server/agent/orchestrator.ts`

Conceptual contract:
`(session, message) -> { intent, action, data, followUps }`

The router must remain deterministic.

Low-confidence or ambiguous input must produce a clarification rather
than guessing.

Only one capability action executes per turn.

Consequential actions such as activation, applying fixes/reschedules,
and selecting external handoff options require explicit user
confirmation.

### State

No new lifecycle.

Session is client-held and validated with Zod. It may contain:
- transcript
- active plan
- trip status
- selections
- latest relevant verification state

### Security

- secrets remain server-side
- Zod validation at API boundaries
- no arbitrary URL fetching
- no payment data
- session/transcript size limits
- no unnecessary transcript logging
- existing SerpApi security remains unchanged

### Failure behavior

- unknown intent → explicit `out_of_scope` / clarification
- action failures reuse existing error taxonomy
- failed actions do not corrupt client session state
- upstream failures remain explicit/retryable
- no invented actions or results

### Testing

- complete deterministic intent matrix
- out_of_scope
- clarification/low-confidence behavior
- session schema validation
- orchestrator dispatch
- approval-gate enforcement
- no-action-without-required-data
- existing service failures
- full regression suite
- typecheck
- production build
- controlled live smoke using existing SerpApi-backed capabilities

### Definition of Done (Phase 10)

- intent taxonomy covers the existing Phase 1–9 capabilities
- deterministic single-action-per-turn orchestration works
- conversation carries plan/status across turns
- all approval gates remain intact
- existing surfaces continue to work independently
- full tests pass
- typecheck/build pass
- live smoke passes
- documentation updated
- no commit/push by OpenCode

### Recommended three-prompt implementation breakdown

1. Intent taxonomy + session contract + routing tests.
2. Orchestrator dispatch + conversational API + approval-gate enforcement.
3. Unified conversational UI + end-to-end smoke + final audit.

### Risks/limitations

- deterministic keyword routing can be brittle
- ambiguity must resolve to clarification rather than guessed intent
- conversational UI complexity
- strict scope boundary against autonomous hidden chains
- future LLM classification could fit the same typed router boundary, but
  is explicitly out of scope for Phase 10.
