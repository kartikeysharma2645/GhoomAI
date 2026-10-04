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
- **Phase 4 (in progress — Step 1 completed):** Trip planning foundation.
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
- **Phase 4 (in progress — Step 1 completed):** Trip planning foundation (requirements, research, deterministic builder, plan API + UI).
- **Phase 5:** RealityCheck verification engine.
- **Phase 6:** Dynamic itinerary rescheduling and live trip functionality.
- **Phase 7:** Landmark/image intelligence and travel companion features.
- **Phase 8:** Production hardening, testing, and deployment.

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
