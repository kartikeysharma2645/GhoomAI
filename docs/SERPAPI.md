# SerpApi Integration

## Why SerpApi is central

GhoomAI treats live search as an **evidence layer**, not a search box.

"Every recommendation GhoomAI makes is re-queried against live Google Search, Maps, and Hotels data before you are allowed to trust it — the verification is the product."

That means: the same live data that builds the itinerary is fetched *again*, fresh, to challenge it. A stale or contradictory result blocks trust (PROBLEM), triggers bounded fix discovery, and requires re-verification after any change. This does not guarantee every item can always be verified — when evidence is unavailable the item is marked UNVERIFIED, never guessed.

## Google Search

- **Destination research** (`src/server/research/destination.ts`) — background snippets + sources when the place pool is thin; never scheduled as activities.
- **Booking-provider discovery and corroboration** (`src/server/booking/discovery.ts`) — provider pages per handoff item, gated by a significant-token relevance filter; URLs validated before display.
- **Live-trip watch signals** (`src/server/livetrip/liveCheck.ts`) — weather/disruption/event classification, explicitly capped at ATTENTION ("watch signal, not confirmed disruption").
- **Vision-place verification** (`src/server/vision/placeAnalysis.ts`) — name-mention corroboration leg alongside Maps.

## Google Maps

- **Place/attraction research** (`src/server/research/places.ts`) — bounded (max 3 calls: attractions + conditional food + one interest).
- **RealityCheck re-verification** (`src/server/realitycheck/service.ts`) — batched by discovery query; one result set verifies many items via stable place-ID matching.
- **Closure and open-state checks** — permanently-closed detection, open-state drift comparison.
- **Fix and reschedule candidate discovery** (`src/server/realitycheck/fixer.ts`, `src/server/livetrip/reschedule.ts`) — ranked live replacements, each re-verified before proposal.
- **Live situation checks** (`src/server/livetrip/liveCheck.ts`) — per-place re-identification during active trips.
- **Vision verification, nearby places, and photo spots** (`src/server/vision/placeAnalysis.ts`) — verification requires *both* the vision leg and the Maps leg.

## Google Hotels

- **Hotel/stay research** (`src/server/research/hotels.ts`) — one call per plan with explicit verified-vs-estimated price distinction (flexible-date prices are flagged unverified).
- **Stay re-verification** (`src/server/realitycheck/service.ts`) — fixed-date re-query with budget-drift detection; budget violation becomes PROBLEM.
- **Booking stay-option discovery** (`src/server/booking/discovery.ts`) — fixed dates only; prices deliberately omitted from handoff options.

## Verification loop

```
Plan → gather live evidence → build itinerary → RealityCheck →
compare against fresh evidence → flag contradictions →
discover candidates from live data → verify candidates →
user approval → recheck after change
```

Each arrow is a bounded, live SerpApi-backed step with per-item failure isolation: one failed search marks its item UNVERIFIED/SEARCH_FAILED without destroying sibling results.

## Evidence and honesty

- Evidence carries source engine, observed timestamps, stable IDs (place ID / property token), and the query that produced it.
- Live results can be unavailable — represented as UNVERIFIED, NO_RESULTS, or SEARCH_FAILED with reasons.
- Booking options distinguish **CORROBORATED** (stable-ID re-identification or cross-engine agreement) from **SEARCH_LEAD** (unverified lead, no direct page implied).
- No fabricated prices, availability, booking IDs, confirmations, or URLs. Provider links come only from validated live evidence.
- Booking remains external: selection returns a receipt stating GhoomAI did not book anything.

## What GhoomAI does not use

Google Flights, News, Reviews, and Lens are not integrated. The gateway (`src/server/services/serpapi/types.ts`) is extensible by design, but no claims are made about engines that are not wired.

## Operational considerations

- Live calls can be slow: planning, verification, and discovery fan out bounded concurrent requests (15s per-call timeout server-side, 60s client timeout, no browser retries).
- Upstream errors (timeouts, rate limits, 5xx) occur and are surfaced honestly as retryable failures with prior state preserved — never converted into fake success.
- Freshness is best-effort per call, not guaranteed; every finding carries the timestamp it was observed at.
- No secret is exposed to the client: the key lives only in `process.env.SERPAPI_KEY`, server-side, redacted from all error paths.

## Code map

- Gateway + normalizers: `src/server/services/serpapi/client.ts`, `src/server/services/serpapi/types.ts`
- Planning research: `src/server/research/places.ts`, `hotels.ts`, `destination.ts`
- Verification: `src/server/realitycheck/service.ts`, `queries.ts`, `compare.ts`, `fixer.ts`, `apply.ts`
- Live trip: `src/server/livetrip/liveCheck.ts`, `reschedule.ts`, `applyReschedule.ts`, `progress.ts`
- Booking: `src/server/booking/discovery.ts`, `selection.ts`, `recheck.ts`, `readiness.ts`
- Vision: `src/server/vision/placeAnalysis.ts`
- Agent dispatch: `src/server/agent/orchestrator.ts`, `responder.ts`
