import { ConflictError, ValidationError } from "../../lib/errors";
import { normalizeName } from "../realitycheck/queries";
import { matchHotel, matchPlace } from "../realitycheck/queries";
import { SerpApiClient } from "../services/serpapi/client";
import type {
  NormalizedHotel,
  NormalizedMapsPlace,
  NormalizedSearchResultItem,
} from "../services/serpapi/types";
import { tripPlanSchema, type Evidence, type TripPlan } from "../trips/plan";
import { collectHandoffItems } from "./readiness";
import type {
  BookingLeadType,
  BookingOption,
  HandoffItem,
  ItemDiscovery,
} from "./types";
import {
  bookingDiscoveryResponseSchema,
  bookingOptionSchema,
} from "./types";

/**
 * Phase 9 Prompt 2 live booking-option discovery.
 *
 * Reuses the existing SerpApi gateway only — no second client, no new
 * engines. Per handoff-item kind:
 * - stay:        google_hotels (fixed dates only) + google search
 *                ("<hotel> <destination> booking") for provider corroboration
 * - attraction:  google_maps (preferred) + google search
 *                ("<place> <destination> tickets booking official")
 * - meal:        google_maps (preferred) + google search
 *                ("<place> <destination> reservations menu")
 *
 * Google Flights is not in the gateway; google_hotels never returns a
 * transactional booking API, so every option is an EXTERNAL handoff lead.
 * Prices and availability are deliberately omitted from options (deferred to
 * a pre-trip recheck where RealityCheck can compare them honestly).
 *
 * Fresh-verification boundary: the discovery calls themselves ARE fresh
 * live evidence (observedAt = now). Corroboration is computed from those
 * same calls by re-identifying planning evidence stable IDs — no
 * client-supplied RealityCheck is trusted, and no second verification
 * engine is built. Tradeoff: this is bounded per-item corroboration, not a
 * full checkTrip re-verification (which would double SerpApi spend).
 *
 * Bounds: at most MAX_DISCOVERY_ITEMS eligible items (stay first, plan
 * order otherwise), at most 2 SerpApi calls per item group, at most
 * MAX_OPTIONS_PER_ITEM options per item. Failures are per item and never
 * destroy sibling results.
 */

export const MAX_DISCOVERY_ITEMS = 5;
export const MAX_OPTIONS_PER_ITEM = 3;
/** Organic results requested per web search; only relevant ones are kept. */
export const SEARCH_RESULTS_PER_CALL = 5;

export interface DiscoverBookingOptionsInput {
  plan: TripPlan;
  /** Must be APPROVED — anything else is a state conflict. */
  status: string;
}

export interface DiscoverySearches {
  maps?: { query: string; location: string };
  hotels?: {
    query: string;
    checkIn: string;
    checkOut: string;
    adults: number;
    children: number;
    currency: string;
  };
  web?: { query: string; num: number };
}

/**
 * Builds bounded, specific gateway searches from structured itinerary data
 * (title, destination, dates, party). The Prompt 1 searchHint is only a
 * display string — queries are constructed here from validated fields.
 */
export function buildDiscoverySearches(
  item: Pick<HandoffItem, "kind" | "title">,
  plan: Pick<
    TripPlan,
    "destination" | "dateMode" | "startDate" | "endDate" | "party" | "totals"
  >,
): DiscoverySearches {
  const name = item.title.trim().slice(0, 200);
  const destination = plan.destination.trim().slice(0, 200);
  if (item.kind === "stay") {
    const searches: DiscoverySearches = {};
    if (
      plan.dateMode === "fixed" &&
      plan.startDate &&
      plan.endDate
    ) {
      searches.hotels = {
        query: name.slice(0, 300),
        checkIn: plan.startDate,
        checkOut: plan.endDate,
        adults: plan.party.adults,
        children: plan.party.children,
        currency: plan.totals.currency,
      };
    }
    searches.web = {
      query: `${name} ${destination} booking`.slice(0, 300),
      num: SEARCH_RESULTS_PER_CALL,
    };
    return searches;
  }
  const webQuery =
    item.kind === "meal"
      ? `${name} ${destination} reservations menu`.slice(0, 300)
      : `${name} ${destination} tickets booking official`.slice(0, 300);
  return {
    maps: {
      query: `${name} ${destination}`.slice(0, 300),
      location: destination,
    },
    web: { query: webQuery, num: SEARCH_RESULTS_PER_CALL },
  };
}

/**
 * Accepts only absolute http(s) URLs from live evidence. Returns the
 * normalized URL, or undefined for anything else. URLs are never
 * constructed from user input — only validated here.
 */
export function safeExternalUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > 2000) {
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return undefined;
  }
  return parsed.toString();
}

/** Source label for an organic result: its verified hostname, else a generic label. */
export function providerLabelForLink(link: string): string {
  try {
    const host = new URL(link).hostname.replace(/^www\./, "");
    if (host) return host.slice(0, 100);
  } catch {
    // Fall through to the generic label.
  }
  return "web result";
}

function significantTokens(name: string): string[] {
  return normalizeName(name)
    .split(" ")
    .filter((t) => t.length >= 4);
}

/**
 * Relevance gate for organic results: every significant (≥4 chars) token
 * of the place name must appear in the normalized title+snippet. Guards
 * against returning arbitrary unrelated results as options.
 */
export function isRelevantResult(
  name: string,
  title: string,
  snippet: string,
): boolean {
  const haystack = normalizeName(`${title} ${snippet}`);
  const want = normalizeName(name);
  if (!want) return false;
  const significant = significantTokens(name);
  if (significant.length === 0) return haystack.includes(want);
  return significant.every((token) => haystack.includes(token));
}

/** Stable deterministic option id; recomputed identically by selection validation. */
export function toOptionId(
  itemId: string,
  engine: string,
  ref: string,
): string {
  return `${itemId}:${engine}:${ref}`.slice(0, 160);
}

function optionRefForMaps(
  place: NormalizedMapsPlace,
  url: string | undefined,
): string {
  // Priority mirrors selection validation: only refs carried in evidence
  // (placeId, sourceUrl) round-trip exactly; otherwise a position fallback.
  return place.placeId ?? url ?? `pos-${place.position}`;
}

function optionRefForHotel(hotel: NormalizedHotel): string {
  return (
    hotel.propertyToken ?? `pos-${hotel.position}`
  );
}

function optionRefForOrganic(
  result: NormalizedSearchResultItem,
  url: string | undefined,
): string {
  return url ?? (result.link || `pos-${result.position}`);
}

function baseEvidence(
  engine: Evidence["engine"],
  observedAt: string,
  query: string,
  purpose: Evidence["purpose"],
): Evidence {
  return { engine, observedAt, query, purpose, facts: {} };
}

export function optionFromMapsPlace(args: {
  itemId: string;
  place: NormalizedMapsPlace;
  sentQuery: string;
  purpose: Evidence["purpose"];
  observedAt: string;
  leadType: BookingLeadType;
}): BookingOption {
  const { itemId, place, sentQuery, purpose, observedAt, leadType } = args;
  const url = safeExternalUrl(place.links?.website);
  return bookingOptionSchema.parse({
    optionId: toOptionId(itemId, "google_maps", optionRefForMaps(place, url)),
    itemId,
    title: place.title || sentQuery,
    provider: "Google Maps",
    ...(url ? { url } : {}),
    ...(place.description ? { snippet: place.description.slice(0, 500) } : {}),
    leadType,
    handoffType: "EXTERNAL",
    evidence: {
      ...baseEvidence("google_maps", observedAt, sentQuery, purpose),
      ...(place.placeId ? { placeId: place.placeId } : {}),
      ...(url ? { sourceUrl: url } : {}),
      facts: {
        ...(typeof place.rating === "number" ? { rating: place.rating } : {}),
        ...(typeof place.reviews === "number" ? { reviews: place.reviews } : {}),
        ...(place.address ? { address: place.address } : {}),
        ...(place.openState ? { openState: place.openState } : {}),
      },
    },
    observedAt,
  });
}

export function optionFromHotel(args: {
  itemId: string;
  hotel: NormalizedHotel;
  sentQuery: string;
  currency: string;
  observedAt: string;
  leadType: BookingLeadType;
}): BookingOption {
  const { itemId, hotel, sentQuery, currency, observedAt, leadType } = args;
  return bookingOptionSchema.parse({
    optionId: toOptionId(itemId, "google_hotels", optionRefForHotel(hotel)),
    itemId,
    title: hotel.name || sentQuery,
    provider: "Google Hotels",
    leadType,
    handoffType: "EXTERNAL",
    evidence: {
      ...baseEvidence("google_hotels", observedAt, sentQuery, "stay_selection"),
      ...(hotel.propertyToken ? { propertyToken: hotel.propertyToken } : {}),
      currency,
      facts: {
        ...(typeof hotel.overallRating === "number"
          ? { rating: hotel.overallRating }
          : {}),
        ...(typeof hotel.reviews === "number" ? { reviews: hotel.reviews } : {}),
      },
    },
    observedAt,
  });
}

export function optionFromOrganic(args: {
  itemId: string;
  result: NormalizedSearchResultItem;
  sentQuery: string;
  purpose: Evidence["purpose"];
  observedAt: string;
  leadType: BookingLeadType;
}): BookingOption | null {
  const { itemId, result, sentQuery, purpose, observedAt, leadType } = args;
  // Links are validated, never trusted blindly; empty links carry no handoff.
  const url = result.link ? safeExternalUrl(result.link) : undefined;
  if (!result.title && !result.snippet) return null;
  return bookingOptionSchema.parse({
    optionId: toOptionId(itemId, "google", optionRefForOrganic(result, url)),
    itemId,
    title: result.title || result.displayedLink || sentQuery,
    provider: result.link ? providerLabelForLink(result.link) : "web result",
    ...(url ? { url } : {}),
    ...(result.snippet ? { snippet: result.snippet.slice(0, 500) } : {}),
    leadType,
    handoffType: "EXTERNAL",
    evidence: {
      ...baseEvidence("google", observedAt, sentQuery, purpose),
      ...(url ? { sourceUrl: url } : {}),
      facts: {},
    },
    observedAt,
  });
}

interface GroupWork {
  items: HandoffItem[];
  name: string;
  kind: HandoffItem["kind"];
  searches: DiscoverySearches;
}

/** Groups eligible items sharing one normalized name so one search serves all. */
export function groupDiscoveryItems(items: HandoffItem[]): GroupWork[] {
  const groups = new Map<string, GroupWork>();
  for (const item of items) {
    const key = `${item.kind}:${normalizeName(item.title)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(key, {
        items: [item],
        name: item.title,
        kind: item.kind,
        // searches filled by the caller (needs plan); placeholder never used.
        searches: {},
      });
    }
  }
  return [...groups.values()];
}

function purposeFor(kind: HandoffItem["kind"]): Evidence["purpose"] {
  if (kind === "stay") return "stay_selection";
  if (kind === "meal") return "meal";
  return "attraction";
}

function planningEvidenceFor(
  plan: TripPlan,
  item: HandoffItem,
): Pick<Evidence, "placeId" | "propertyToken"> {
  if (item.itemId === "stay" && plan.stay) {
    return { placeId: undefined, propertyToken: plan.stay.evidence.propertyToken };
  }
  for (const day of plan.days) {
    const found = day.items.find((i) => i.id === item.itemId);
    if (found?.evidence[0]) {
      return {
        placeId: found.evidence[0].placeId,
        propertyToken: found.evidence[0].propertyToken,
      };
    }
  }
  return { placeId: undefined, propertyToken: undefined };
}

async function discoverGroup(
  client: SerpApiClient,
  plan: TripPlan,
  group: GroupWork,
  observedAt: string,
): Promise<Map<string, BookingOption[]>> {
  const perItem = new Map<string, BookingOption[]>();
  for (const item of group.items) perItem.set(item.itemId, []);

  const push = (itemId: string, option: BookingOption | null) => {
    if (!option) return;
    const list = perItem.get(itemId) ?? [];
    if (list.length >= MAX_OPTIONS_PER_ITEM) return;
    if (list.some((o) => o.optionId === option.optionId)) return;
    // Retarget the shared-group option id to the owning item.
    const engine = option.evidence.engine;
    const ref = option.optionId.split(":").slice(2).join(":");
    list.push({ ...option, itemId, optionId: toOptionId(itemId, engine, ref) });
    perItem.set(itemId, list);
  };

  const { searches } = group;
  const purpose = purposeFor(group.kind);

  if (searches.maps) {
    const res = await client.searchMaps({
      query: searches.maps.query,
      location: searches.maps.location,
    });
    for (const item of group.items) {
      const evidence = planningEvidenceFor(plan, item);
      const match = matchPlace(res.results, evidence, item.title);
      if (match.matched) {
        push(
          item.itemId,
          optionFromMapsPlace({
            itemId: item.itemId,
            place: match.place,
            sentQuery: res.query,
            purpose,
            observedAt,
            leadType: match.confident ? "CORROBORATED" : "SEARCH_LEAD",
          }),
        );
      }
    }
    // Cross-engine corroboration anchor: confidently matched place titles.
    const anchored = new Set(
      group.items.flatMap((item) => {
        const evidence = planningEvidenceFor(plan, item);
        const match = matchPlace(res.results, evidence, item.title);
        return match.matched && match.confident
          ? [normalizeName(match.place.title)]
          : [];
      }),
    );
    if (searches.web) {
      const web = await client.search({
        engine: "google",
        query: searches.web.query,
        num: searches.web.num,
      });
      for (const item of group.items) {
        let kept = 0;
        for (const result of web.results) {
          if (kept >= MAX_OPTIONS_PER_ITEM - 1) break;
          if (!result.link && !result.snippet) continue;
          if (!isRelevantResult(item.title, result.title, result.snippet)) continue;
          const corroborated = anchored.has(normalizeName(result.title));
          push(
            item.itemId,
            optionFromOrganic({
              itemId: item.itemId,
              result,
              sentQuery: web.query,
              purpose,
              observedAt,
              leadType: corroborated ? "CORROBORATED" : "SEARCH_LEAD",
            }),
          );
          kept += 1;
        }
      }
    }
    return perItem;
  }

  if (searches.hotels) {
    const res = await client.searchHotels({
      query: searches.hotels.query,
      checkIn: searches.hotels.checkIn,
      checkOut: searches.hotels.checkOut,
      adults: searches.hotels.adults,
      children: searches.hotels.children,
      currency: searches.hotels.currency,
    });
    const anchored = new Set<string>();
    for (const item of group.items) {
      const evidence = planningEvidenceFor(plan, item);
      const match = matchHotel(res.results, evidence, item.title);
      if (match.matched) {
        if (match.confident) anchored.add(normalizeName(match.hotel.name));
        push(
          item.itemId,
          optionFromHotel({
            itemId: item.itemId,
            hotel: match.hotel,
            sentQuery: res.query,
            currency: res.currency,
            observedAt,
            leadType: match.confident ? "CORROBORATED" : "SEARCH_LEAD",
          }),
        );
      }
    }
    if (searches.web) {
      const web = await client.search({
        engine: "google",
        query: searches.web.query,
        num: searches.web.num,
      });
      for (const item of group.items) {
        let kept = 0;
        for (const result of web.results) {
          if (kept >= MAX_OPTIONS_PER_ITEM - 1) break;
          if (!result.link && !result.snippet) continue;
          if (!isRelevantResult(item.title, result.title, result.snippet)) continue;
          const corroborated = anchored.has(normalizeName(result.title));
          push(
            item.itemId,
            optionFromOrganic({
              itemId: item.itemId,
              result,
              sentQuery: web.query,
              purpose,
              observedAt,
              leadType: corroborated ? "CORROBORATED" : "SEARCH_LEAD",
            }),
          );
          kept += 1;
        }
      }
    }
    return perItem;
  }

  if (searches.web) {
    const web = await client.search({
      engine: "google",
      query: searches.web.query,
      num: searches.web.num,
    });
    for (const item of group.items) {
      let kept = 0;
      for (const result of web.results) {
        if (kept >= MAX_OPTIONS_PER_ITEM) break;
        if (!result.link && !result.snippet) continue;
        if (!isRelevantResult(item.title, result.title, result.snippet)) continue;
        push(
          item.itemId,
          optionFromOrganic({
            itemId: item.itemId,
            result,
            sentQuery: web.query,
            purpose,
            observedAt,
            leadType: "SEARCH_LEAD",
          }),
        );
        kept += 1;
      }
    }
    return perItem;
  }

  return perItem;
}

/**
 * Discovers live external options for an APPROVED trip's eligible handoff
 * items. Throws ValidationError (bad plan), ConflictError (wrong state or
 * nothing eligible), or the first gateway error when EVERY group failed
 * (never a fake empty success). Partial failures yield per-item
 * SEARCH_FAILED entries with honest reasons.
 */
export async function discoverBookingOptions(
  input: DiscoverBookingOptionsInput,
  client?: SerpApiClient,
  now: Date = new Date(),
) {
  const parsed = tripPlanSchema.safeParse(input.plan);
  if (!parsed.success) {
    throw new ValidationError("Invalid trip plan.");
  }
  const plan = parsed.data;
  if (input.status !== "APPROVED") {
    throw new ConflictError(
      `Booking discovery requires an APPROVED trip; got ${input.status}.`,
    );
  }
  // Lazily constructed AFTER state validation so wrong-state and
  // nothing-eligible requests fail with 409 even when no SerpApi key
  // is configured.
  const eligible = collectHandoffItems(plan).filter((i) => i.handoffEligible);
  if (eligible.length === 0) {
    throw new ConflictError("Itinerary has no actionable items to discover.");
  }
  const gateway = client ?? new SerpApiClient();
  const capped = eligible.slice(0, MAX_DISCOVERY_ITEMS);
  const warnings: string[] = [];
  if (eligible.length > capped.length) {
    warnings.push(
      `${eligible.length - capped.length} eligible item(s) exceed the discovery cap and were not searched.`,
    );
  }
  for (const item of capped) {
    if (
      item.kind === "stay" &&
      (plan.dateMode !== "fixed" || !plan.startDate || !plan.endDate)
    ) {
      warnings.push(
        `Exact travel dates are unavailable; hotel availability search skipped for "${item.title.slice(0, 80)}" (web search only).`,
      );
    }
  }

  const groups = groupDiscoveryItems(capped);
  for (const group of groups) {
    const representative = group.items[0];
    if (!representative) continue;
    group.name = representative.title;
    group.kind = representative.kind;
    group.searches = buildDiscoverySearches(
      { kind: representative.kind, title: representative.title },
      plan,
    );
  }

  const observedAt = now.toISOString();
  const settled = await Promise.all(
    groups.map(async (group) => {
      try {
        return { group, options: await discoverGroup(gateway, plan, group, observedAt) };
      } catch (err) {
        return { group, error: err };
      }
    }),
  );

  const items: ItemDiscovery[] = [];
  let firstGatewayError: unknown = null;
  let successGroups = 0;
  for (const entry of settled) {
    if ("error" in entry) {
      const err = entry.error;
      if (
        firstGatewayError === null &&
        err instanceof Error &&
        err.name !== "ValidationError"
      ) {
        firstGatewayError = err;
      }
      for (const item of entry.group.items) {
        items.push({
          itemId: item.itemId,
          kind: item.kind,
          title: item.title,
          status: "SEARCH_FAILED",
          options: [],
          reason:
            err instanceof Error
              ? err.message.slice(0, 500)
              : "Search failed; nothing could be retrieved.",
        });
      }
      continue;
    }
    successGroups += 1;
    for (const item of entry.group.items) {
      const options = entry.options.get(item.itemId) ?? [];
      // Corroborated options first for stable, useful ordering.
      options.sort((a, b) =>
        a.leadType === b.leadType ? 0 : a.leadType === "CORROBORATED" ? -1 : 1,
      );
      items.push({
        itemId: item.itemId,
        kind: item.kind,
        title: item.title,
        status: options.length > 0 ? "READY" : "NO_RESULTS",
        options,
        ...(options.length > 0
          ? {}
          : {
              reason:
                "No usable booking/search options were returned for this item.",
            }),
      });
    }
  }

  if (successGroups === 0 && firstGatewayError !== null) {
    throw firstGatewayError;
  }
  if (successGroups < groups.length) {
    warnings.push(
      "Discovery partially succeeded; some items could not be searched. See per-item reasons.",
    );
  }

  return bookingDiscoveryResponseSchema.parse({
    tripStatus: input.status,
    discoveredAt: observedAt,
    items,
    warnings,
    booking: { performed: false, bookingId: null, confirmationCode: null },
    disclaimer:
      "GhoomAI does not complete bookings. Options are live search leads for you to continue externally; no booking was made and nothing is confirmed.",
  });
}
