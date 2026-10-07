/**
 * Result cards for the Phase 3 single-turn Ask UI.
 * Renders normalized GhoomAI results only — every value shown originates
 * from the server-side SerpApi gateway. Missing optional fields render
 * nothing; nothing is ever fabricated.
 */
import React from "react";
import ExternalLink from "./ExternalLink";

export interface AskResultItem {
  title?: string;
  name?: string;
  link?: string;
  snippet?: string;
  displayedLink?: string;
  rating?: number;
  overallRating?: number;
  reviews?: number;
  address?: string;
  placeType?: string;
  placeTypes?: string[];
  thumbnail?: string;
  links?: Record<string, string>;
  nightlyLowest?: string;
  totalLowest?: string;
  amenities?: string[];
  checkInTime?: string;
  checkOutTime?: string;
  freeCancellation?: boolean;
}

export interface AskResponseData {
  intent: "find_hotels" | "discover_places" | "general_search";
  engine: "google" | "google_maps" | "google_hotels";
  message: string;
  destination?: string;
  resultCount: number;
  results: AskResultItem[];
  dates?: {
    checkIn: string;
    checkOut: string;
    source: "user" | "default";
    currency: string;
  };
}

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

function domainOf(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return link;
  }
}

function Rating({ value, reviews }: { value?: number; reviews?: number }) {
  if (typeof value !== "number") return null;
  return (
    <p className="mt-0.5 text-sm text-amber-700">
      <span aria-hidden="true">★ </span>
      {value.toFixed(1)}
      {typeof reviews === "number" && (
        <span className="text-stone-500"> · {formatCount(reviews)} reviews</span>
      )}
    </p>
  );
}

/**
 * Neutral fallback shown when the backend returned no image for a result.
 * A typographic monogram on a warm gradient — deliberately NOT a stock
 * photograph, so it can never be mistaken for the actual place or hotel.
 */
function PhotoFallback({ label }: { label: string }) {
  const initial = (label.trim().charAt(0) || "•").toUpperCase();
  return (
    <div
      aria-hidden="true"
      className="flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-stone-200 via-stone-300 to-teal-900/40"
    >
      <span className="text-2xl font-bold text-stone-600">{initial}</span>
    </div>
  );
}

function Thumbnail({ src, alt }: { src?: string; alt: string }) {
  if (!src) return <PhotoFallback label={alt} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className="h-24 w-24 shrink-0 rounded-xl object-cover"
      loading="lazy"
      onError={(e) => {
        // A broken provider thumbnail degrades to nothing rather than a
        // broken-image icon; the card's text content is the source of truth.
        e.currentTarget.style.display = "none";
      }}
    />
  );
}

function HotelCard({ hotel, currency }: { hotel: AskResultItem; currency?: string }) {
  return (
    <article className="flex gap-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <Thumbnail src={hotel.thumbnail} alt={hotel.name ?? "Hotel"} />
      <div className="min-w-0 flex-1">
        <h3 className="break-words font-semibold leading-snug text-stone-900">{hotel.name}</h3>
        <Rating value={hotel.overallRating} reviews={hotel.reviews} />
        {(hotel.nightlyLowest || hotel.totalLowest) && (
          <p className="mt-1 text-sm text-stone-800">
            {hotel.nightlyLowest && (
              <span>
                {hotel.nightlyLowest}
                <span className="text-stone-500"> / night</span>
              </span>
            )}
            {hotel.nightlyLowest && hotel.totalLowest && <span> · </span>}
            {hotel.totalLowest && (
              <span>
                {hotel.totalLowest}
                <span className="text-stone-500"> total</span>
              </span>
            )}
            {currency && (
              <span className="text-stone-500"> ({currency})</span>
            )}
          </p>
        )}
        {hotel.amenities && hotel.amenities.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {hotel.amenities.slice(0, 5).map((a) => (
              <span
                key={a}
                className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600"
              >
                {a}
              </span>
            ))}
          </div>
        )}
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-stone-500">
          {hotel.checkInTime && <span>Check-in {hotel.checkInTime}</span>}
          {hotel.checkOutTime && <span>Check-out {hotel.checkOutTime}</span>}
          {hotel.freeCancellation === true && (
            <span className="font-medium text-emerald-700">Free cancellation</span>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * Builds the destination-bearing agent message for a place result's
 * "Plan a trip here" action (Phase 2.5 Fix 2). Uses only fields actually
 * present in the result — the place name plus its real address when one
 * exists. Never invents a city or location: with a name alone the
 * message carries just the name, and the router's multi-turn planning
 * flow asks for anything still missing. Returns null when there is no
 * usable name, in which case no action renders.
 */
export function buildPlanHereMessage(item: AskResultItem): string | null {
  const name = (item.title ?? item.name ?? "").trim();
  if (!name) return null;
  const address = (item.address ?? "").trim();
  const message = address ? `Plan a trip to ${name} in ${address}` : `Plan a trip to ${name}`;
  return message.slice(0, 500);
}

function PlaceCard({
  place,
  onPlanHere,
}: {
  place: AskResultItem;
  onPlanHere?: (message: string) => void;
}) {
  const website =
    place.links && typeof place.links.website === "string"
      ? place.links.website
      : undefined;
  const typeLabel = place.placeType ?? place.placeTypes?.[0];
  const planMessage = buildPlanHereMessage(place);
  return (
    <article className="flex gap-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <Thumbnail src={place.thumbnail} alt={place.title ?? "Place"} />
      <div className="min-w-0 flex-1">
        <h3 className="break-words font-semibold leading-snug text-stone-900">{place.title}</h3>
        {typeLabel && <p className="mt-0.5 text-xs text-stone-500">{typeLabel}</p>}
        <Rating value={place.rating} reviews={place.reviews} />
        {place.address && (
          <p className="mt-1 break-words text-sm text-stone-600">{place.address}</p>
        )}
        {(website || (onPlanHere && planMessage)) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {website && (
              <ExternalLink
                href={website}
                className="inline-flex min-h-[36px] items-center rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-[13px] font-medium text-teal-800 shadow-sm hover:border-teal-700"
              >
                View Place ↗ · {domainOf(website)}
              </ExternalLink>
            )}
            {onPlanHere && planMessage && (
              <button
                type="button"
                onClick={() => onPlanHere(planMessage)}
                aria-label={`Plan a trip to ${place.title ?? "this place"}`}
                className="inline-flex min-h-[36px] items-center rounded-lg bg-stone-900 px-3 py-1.5 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-2"
              >
                Plan a trip here
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function SearchCard({ item }: { item: AskResultItem }) {
  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      {item.link ? (
        <ExternalLink
          href={item.link}
          className="break-words font-semibold leading-snug text-teal-800 hover:underline"
        >
          {item.title}
        </ExternalLink>
      ) : (
        <h3 className="break-words font-semibold leading-snug text-stone-900">{item.title}</h3>
      )}
      {item.snippet && (
        <p className="mt-1 break-words text-sm leading-relaxed text-stone-600">{item.snippet}</p>
      )}
      {item.link && (
        <p className="mt-1.5 truncate text-xs text-stone-500">{domainOf(item.link)}</p>
      )}
    </article>
  );
}

const ENGINE_LABEL: Record<AskResponseData["engine"], string> = {
  google_hotels: "Google Hotels",
  google_maps: "Google Maps",
  google: "Google Search",
};

export default function ResultCards({
  data,
  onPlanHere,
}: {
  data: AskResponseData;
  /**
   * Place-level action available only where the caller can send an agent
   * message (the /agent workspace). Home quick-search omits it, so its
   * single-turn results keep no misleading action.
   */
  onPlanHere?: (message: string) => void;
}) {
  if (data.results.length === 0) {
    return (
      <section aria-label="Live results" className="space-y-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
          Live via {ENGINE_LABEL[data.engine]}
        </p>
        <p className="rounded-2xl border border-stone-200 bg-white p-4 text-sm leading-relaxed text-stone-600 shadow-sm">
          No live results right now. Try a broader search or different wording —
          nothing is shown rather than guessed.
        </p>
      </section>
    );
  }
  return (
    <section aria-label="Live results" className="space-y-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
        Live via {ENGINE_LABEL[data.engine]}
      </p>
      {data.engine === "google_hotels" &&
        data.results.map((hotel, i) => (
          <HotelCard
            key={`${hotel.name ?? "hotel"}-${i}`}
            hotel={hotel}
            currency={data.dates?.currency}
          />
        ))}
      {data.engine === "google_maps" &&
        data.results.map((place, i) => (
          <PlaceCard
            key={`${place.title ?? "place"}-${i}`}
            place={place}
            onPlanHere={onPlanHere}
          />
        ))}
      {data.engine === "google" &&
        data.results.map((item, i) => (
          <SearchCard key={`${item.title ?? "result"}-${i}`} item={item} />
        ))}
    </section>
  );
}
