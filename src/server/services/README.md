# Server services (Phase 1 placeholder)

No service implementations live here yet. This directory reserves the modular
layout for future phases. All SerpApi access must be isolated under
`src/server/services/serpapi/` (server-side only) starting in Phase 2.

## Planned services

| Service               | Phase | Notes                                              |
| --------------------- | ----- | -------------------------------------------------- |
| SerpApiService        | 2     | Single gateway for all SerpApi engines             |
| SearchService         | 3+    | Google Search via SerpApiService                   |
| MapsService           | 3+    | Places / local discovery via SerpApiService        |
| NewsService           | 3+    | Travel news via SerpApiService                     |
| FlightsService        | 4+    | Google Flights via SerpApiService                  |
| HotelsService         | 4+    | Google Hotels via SerpApiService                   |
| ReviewsService        | 4+    | Google Reviews via SerpApiService                  |
| TripPlanningService   | 4     | Itinerary assembly (uses services above)           |
| RealityCheckService   | 5     | Verification engine (uses services above)          |
| ReschedulingService   | 6     | Dynamic rescheduling (uses RealityCheckService)    |
| BookingService        | 6+    | Booking-related flows (uses Flights/HotelsService) |
| VisionService         | 7     | Landmark/image intelligence (Lens where suitable)  |

## Rules

- Frontend must never import from `src/server/`.
- Services must never accept API keys from client input.
- No fake provider responses — untested integrations stay unimplemented.
