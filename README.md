## 🚀 Live Demo

🌐 **Try GhoomAI:** https://ghoomai.netlify.app

> No installation required. Open the link and start planning your trip.

### Quick Demo

Try asking:

- "Find interesting places in Jaipur"
- "Plan a 4-day trip to Jaipur for 2 adults and 1 teenager"
- "Find hotels in Jaipur"
- "Check this itinerary against live information"

---

# GhoomAI
## Plan it. Check it. Experience it.

GhoomAI is a **verification-first deterministic AI travel agent**. It plans trips using live search data — and then tries to break its own plan against fresh live information before you trust it.

- Plans itineraries from live Google Search, Maps, and Hotels data (via SerpApi)
- **RealityChecks** every itinerary against fresh live evidence
- Proposes bounded, verified fixes when reality contradicts the plan
- Requires your explicit approval before consequential changes
- Hands booking off to external providers — it never books for you
- Activates approved trips and monitors them live, proposing reschedules when situations change
- Includes a visual travel companion and a unified conversational agent (`/agent`)

No LLM orchestration. No autonomous booking. Deterministic routing, typed contracts, and evidence you can inspect.

---

## The problem

Travel itineraries go stale fast: places close or change hours, schedules and availability shift, prices move, and recommendations age. A generated plan — or a page of search results — does not prove the trip is still realistic. The traveler discovers the contradiction at the gate, not before.

## The solution

GhoomAI runs every trip through an evidence loop:

```
PLAN → REALITYCHECK → FIX → APPROVE → BOOK/HANDOFF → START TRIP → LIVE MONITOR → RESCHEDULE → RECHECK
```

Live search data is not a search box here; it is the **evidence layer** the plan is checked against. Not every trip needs every stage — a quick search can stay a search — but anything you are asked to trust has been re-queried fresh.

## Core differentiator: verification-first deterministic agent

Most planners stop after generating an itinerary. GhoomAI attempts to verify its own recommendations against fresh live information **before you trust them**:

1. It builds the itinerary from live evidence.
2. RealityCheck re-queries live data per item (ratings, open state, hours, address, hotel prices vs budget).
3. On a strong contradiction it flags the item, discovers replacement candidates from live data, and re-verifies each candidate.
4. It proposes a bounded fix and **waits for your approval**.
5. After any change, it rechecks.

SerpApi is not decorative in GhoomAI; live search data is part of the verification loop.

## Key features

- **Live travel discovery** — hotels, places, and web results from live SerpApi data, labeled by engine, with empty states instead of guesses.
- **Deterministic trip planning** — destination/dates/party/budget/interests into a day-by-day itinerary where every item carries its source evidence.
- **RealityCheck** — per-item VERIFIED / NEEDS_ATTENTION / PROBLEM / UNVERIFIED verdicts with fresh evidence and reasons; never contradictory on a mere miss.
- **Bounded itinerary fixes** — ranked live replacement candidates, each re-verified before proposal; capped counts, honest "no alternative" states.
- **User-approved changes** — fixes, reschedules, activation, and handoff selections execute only after explicit confirmation; stale proposals are rejected.
- **Booking discovery & external handoff** — live provider options labeled CORROBORATED vs SEARCH_LEAD with real, validated provider URLs; selection returns a receipt, never a booking.
- **Active trip tracking** — day-by-day progress (upcoming/in-progress/completed/skipped) on a client-held snapshot.
- **Live situation awareness** — bounded live checks for closures, schedule changes, and watch-signal events.
- **Dynamic rescheduling** — disruption-driven replacement proposals with the same verify-then-approve discipline.
- **Visual Travel Companion** — photo-based place identification with calibrated confidence, live verification, nearby/photo-spot discovery, and photography advice. Requires an optional configured provider; otherwise reports `VISION_NOT_CONFIGURED` honestly.
- **Unified conversational agent** (`/agent`) — a 16-intent deterministic router + single-action-per-turn orchestrator over all of the above, with a client-held session. No LLM.

## Product lifecycle

```
PLAN
 ↓
REALITYCHECK
 ↓
FIX (only when problems are found)
 ↓
APPROVE (always explicit, always by you — via the approval control in `/plan`; the agent never auto-approves)
 ↓
BOOK / HANDOFF (external providers; GhoomAI never books)
 ↓
START TRIP
 ↓
LIVE MONITOR
 ↓
RESCHEDULE (only on disruption, only with approval)
 ↓
RECHECK
```

Not every trip executes every stage. Search stays search; verification runs when trust is required.

## SerpApi integration

| Engine | Actual role in GhoomAI |
|---|---|
| Google Search | Destination research; booking-provider discovery and corroboration; live-trip watch signals; vision-place verification |
| Google Maps | Place/attraction research; RealityCheck re-verification with stable-ID matching; closure and open-state checks; fix/reschedule candidate discovery; live situation checks; vision verification, nearby places, and photo spots |
| Google Hotels | Hotel/stay research with verified-vs-estimated price distinction; stay re-verification with budget-drift detection; booking stay-option discovery |

All SerpApi traffic flows through one server-side gateway (`src/server/services/serpapi/client.ts`); the key never leaves the server. Details: [`docs/SERPAPI.md`](docs/SERPAPI.md).

## Architecture overview

User → Next.js UI → deterministic Agent Router → Orchestrator → Domain Capability → SerpApi gateway → normalized evidence → deterministic reasoning → typed response → UI.

Concise map: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Setup

Requirements: **Node >= 20**, npm.

```bash
npm install
npm run dev     # local dev server
npm test        # full test suite (vitest)
npm run typecheck
npm run build
npm run start   # serve the production build
```

Environment:

- `SERPAPI_KEY` — **required, server-side only**, for all live SerpApi functionality. Put it in `.env.local` (local-only, git-ignored). Never expose it through `NEXT_PUBLIC_*`.
- Vision provider — **optional, unconfigured by default**. Without a configured provider credential, image recognition honestly reports `VISION_NOT_CONFIGURED` instead of fabricating results.

Copy `.env.example` to `.env.local` and fill in `SERPAPI_KEY` to run everything live.

## Demo

Primary demo route: **`/agent`** — plan, verify, hand off, and track in one conversational flow, with explicit itinerary approval handled in the Trip Planner (`/plan`). After approving, return to the agent to continue booking discovery.

Full under-3-minute flow, narration, and fallback lines: [`docs/DEMO.md`](docs/DEMO.md).

## Limitations / honesty

- GhoomAI **does not complete bookings**. Handoff is external; selection receipts say so explicitly.
- Prices and availability are **not guaranteed**; flexible-date prices are flagged unverified and handoff options omit prices by design.
- Route timing/distance is not treated as universally verified.
- Vision recognition needs an optional configured provider; otherwise unavailable is reported, not worked around.
- Sessions are client-held and stateless; a page refresh starts a new conversation.
- Live data depends on upstream availability — calls can be slow, rate-limited, or stale, and the UI says so instead of guessing.

## Testing status

527 tests passing at the time of documentation, with a clean typecheck and clean production build. (Counts reflect the suite at documentation time and will move with future code changes.) Critical routes additionally carry service-wiring tests proving request → service → response.

## AI-Assisted Development

AI coding agents were used throughout development, organized through phased contracts and implementation prompts in `AGENTS.md`, with human review validating architecture, behavior, security, tests, and live smoke checks. SerpApi data used by the application is live; it is not fabricated by the AI coding process.
