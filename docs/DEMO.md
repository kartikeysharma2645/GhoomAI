# Demo Guide (under 3 minutes)

Primary route: **`/agent`** — one conversational flow, with explicit itinerary approval handled in the Trip Planner.

## Narrative

> "Travel plans are easy to generate. The hard part is knowing whether they're still true. GhoomAI plans with live data — then tries to break its own plan before you trust it."

## The flow (with timings)

**0:00–0:25 — Live discovery.** Type: *"Find hotels in Jaipur."*
Say: "Every number here — prices, ratings — is live from Google Hotels via SerpApi, labeled on each card."
Judge sees: hotel cards with live prices, ratings, amenities.
Do not claim: availability or booking.

**0:25–1:00 — Planning.** Type: *"Plan 2 days in Jaipur from 2026-11-10 to 2026-11-11."*
Say: "Researched live — every itinerary item keeps its source evidence."
Judge sees: day-by-day itinerary with evidence lines.

**1:00–1:40 — The differentiator.** Type: *"Is it realistic?"*
Say: "Now I'm asking GhoomAI to challenge its own itinerary — fresh live data, per-item verdicts."
Judge sees: RealityCheck counts and fresh-evidence reasons.

**1:40–2:20 — Approval + handoff.** Navigate to `/plan` and use the explicit "Approve itinerary" control (the agent never auto-approves), then return to `/agent` and ask: *"Find booking options for my hotel."*
Say: "Corroborated options with real provider pages — and note: GhoomAI never claims to book for me. I continue externally."
Judge sees: CORROBORATED vs SEARCH_LEAD labels, "Continue to provider" only where a real URL exists, the no-booking disclaimer.
Do not claim: booking completion, prices, availability.

**2:20–2:50 — Activation (if timing permits).** *"Start my trip"* → Confirm → *"What's next?"*
Say: "Explicit confirmation gates every consequential step — including this one."
Judge sees: ACTIVE trip, day progress.

## Fallback lines (slow upstream)

- "Live data can take a moment — the spinner means a real SerpApi call is in flight, with a 60-second timeout."
- If a call fails: "Upstream hiccup — the app says so honestly and keeps my trip intact. Let me retry once."

## Before recording

- [ ] Warm local server (`npm run dev` or `npm run start`), SerpApi key configured
- [ ] One full rehearsal with the exact prompts above
- [ ] Do not refresh mid-flow (sessions are client-held)
- [ ] Do not rapidly click or re-send (no hammering upstream)
- [ ] Confirm provider links resolve before recording
- [ ] Do not demo vision unless a provider credential is configured and verified
- [ ] Do not center the demo on `general_search`
- [ ] Never fake or pre-record API responses

## What not to show

Rescheduling (multi-step, slow), zero-result paths, vision without a provider, debug/test SerpApi endpoints, or any claim containing "guaranteed", "confirmed booking", "first", or "only".
