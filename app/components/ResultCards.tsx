/**
 * Result cards for the Phase 3 single-turn Ask UI.
 * Renders normalized GhoomAI results only — every value shown originates
 * from the server-side SerpApi gateway. Missing optional fields render
 * nothing; nothing is ever fabricated.
 */

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
    <p className="text-sm text-amber-700">
      {value.toFixed(1)}
      {typeof reviews === "number" && (
        <span className="text-neutral-500"> · {formatCount(reviews)} reviews</span>
      )}
    </p>
  );
}

function Thumbnail({ src, alt }: { src?: string; alt: string }) {
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className="h-20 w-20 shrink-0 rounded-lg object-cover"
      loading="lazy"
    />
  );
}

function HotelCard({ hotel, currency }: { hotel: AskResultItem; currency?: string }) {
  return (
    <article className="flex gap-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <Thumbnail src={hotel.thumbnail} alt={hotel.name ?? "Hotel"} />
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold text-neutral-900">{hotel.name}</h3>
        <Rating value={hotel.overallRating} reviews={hotel.reviews} />
        {(hotel.nightlyLowest || hotel.totalLowest) && (
          <p className="mt-1 text-sm text-neutral-800">
            {hotel.nightlyLowest && (
              <span>
                {hotel.nightlyLowest}
                <span className="text-neutral-500"> / night</span>
              </span>
            )}
            {hotel.nightlyLowest && hotel.totalLowest && <span> · </span>}
            {hotel.totalLowest && (
              <span>
                {hotel.totalLowest}
                <span className="text-neutral-500"> total</span>
              </span>
            )}
            {currency && (
              <span className="text-neutral-500"> ({currency})</span>
            )}
          </p>
        )}
        {hotel.amenities && hotel.amenities.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {hotel.amenities.slice(0, 5).map((a) => (
              <span
                key={a}
                className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600"
              >
                {a}
              </span>
            ))}
          </div>
        )}
        <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-neutral-500">
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

function PlaceCard({ place }: { place: AskResultItem }) {
  const website =
    place.links && typeof place.links.website === "string"
      ? place.links.website
      : undefined;
  const typeLabel = place.placeType ?? place.placeTypes?.[0];
  return (
    <article className="flex gap-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <Thumbnail src={place.thumbnail} alt={place.title ?? "Place"} />
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold text-neutral-900">{place.title}</h3>
        {typeLabel && <p className="text-xs text-neutral-500">{typeLabel}</p>}
        <Rating value={place.rating} reviews={place.reviews} />
        {place.address && (
          <p className="mt-1 text-sm text-neutral-600">{place.address}</p>
        )}
        {website && (
          <a
            href={website}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-sm font-medium text-sky-700 hover:underline"
          >
            {domainOf(website)}
          </a>
        )}
      </div>
    </article>
  );
}

function SearchCard({ item }: { item: AskResultItem }) {
  return (
    <article className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      {item.link ? (
        <a
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-sky-800 hover:underline"
        >
          {item.title}
        </a>
      ) : (
        <h3 className="font-semibold text-neutral-900">{item.title}</h3>
      )}
      {item.snippet && (
        <p className="mt-1 text-sm text-neutral-600">{item.snippet}</p>
      )}
      {item.link && (
        <p className="mt-1 text-xs text-neutral-500">{domainOf(item.link)}</p>
      )}
    </article>
  );
}

const ENGINE_LABEL: Record<AskResponseData["engine"], string> = {
  google_hotels: "Google Hotels",
  google_maps: "Google Maps",
  google: "Google Search",
};

export default function ResultCards({ data }: { data: AskResponseData }) {
  if (data.results.length === 0) {
    return (
      <section className="mt-6 space-y-3">
        <p className="text-xs font-medium uppercase tracking-widest text-neutral-500">
          Live via {ENGINE_LABEL[data.engine]}
        </p>
        <p className="rounded-xl border border-neutral-200 bg-white p-4 text-sm text-neutral-600 shadow-sm">
          No live results right now. Try a broader search or different wording —
          nothing is shown rather than guessed.
        </p>
      </section>
    );
  }
  return (
    <section className="mt-6 space-y-3">
      <p className="text-xs font-medium uppercase tracking-widest text-neutral-500">
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
          <PlaceCard key={`${place.title ?? "place"}-${i}`} place={place} />
        ))}
      {data.engine === "google" &&
        data.results.map((item, i) => (
          <SearchCard key={`${item.title ?? "result"}-${i}`} item={item} />
        ))}
    </section>
  );
}
