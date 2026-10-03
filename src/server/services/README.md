# Server services

`src/server/services/serpapi/` holds the Phase 2 SerpApi gateway
(`SerpApiClient` + types). All SerpApi access must be isolated there
(server-side only). Supported engines: `google` (Search) and `google_maps`
(Maps search). No other service implementations live here yet.

## Google Maps search (Phase 2 Step 2)

- Method: `SerpApiClient.searchMaps({ query, location?, language?, country?, start? })`
- SerpApi request: `engine=google_maps`, `type=search`, `q`, optional
  `location`/`hl`/`gl`, optional service-level `start` offset (no pagination UI yet).
  SerpApi requires `z`/`m` with `location`: the client sends caller `zoom`
  or a city-level `z=13` default.
- Test route: `GET /api/serpapi/maps-test?q=...&location=...`
  (defaults: "tourist attractions in Jaipur" / "Jaipur").
- Normalized place fields: title, place_id, data_id/data_cid, rating,
  reviews, price, type/types, address, description, open_state, hours,
  gps_coordinates, thumbnail, links. Every field except title/position is
  optional — SerpApi results vary by place.
- GhoomAI usage: place/attraction discovery feeds Phase 3 interaction and,
  later, Phase 4 trip planning and Phase 5 RealityCheck evidence
  (ratings, hours, addresses verified against live data).

## Planned services

| Service               | Phase | Notes                                              |
| --------------------- | ----- | -------------------------------------------------- |
| SerpApiService        | 2     | Implemented: gateway in `serpapi/` (Google Search + Google Maps search) |
| SearchService         | 3+    | Google Search via SerpApiService                   |
| MapsService           | 3+    | Places / local discovery via SerpApiService `searchMaps` |
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
