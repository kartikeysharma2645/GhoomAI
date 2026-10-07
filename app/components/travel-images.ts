/**
 * Curated travel imagery for GhoomAI discovery surfaces (UI Phase 1.5/2).
 *
 * Presentation only — these are generic inspirational photographs, never
 * tied to a specific live result. Per-item result photos still come only
 * from server-returned data (`thumbnail`); when the backend provides no
 * image, result cards use a neutral typographic fallback, never a stock
 * photo masquerading as the real place.
 *
 * Delivery: direct Unsplash CDN URLs (`images.unsplash.com` photo IDs)
 * rendered with plain `<img>` elements, so no Next.js remote-image
 * configuration is required. Every usage pairs the image with meaningful
 * alt text and a warm gradient fallback that remains if loading fails.
 *
 * Interactive discovery (Phase 2): each category carries a deterministic
 * `prompt` sent verbatim through the EXISTING agent (`/agent?discover=key`
 * auto-submits it). Prompt wording is chosen against the deterministic
 * router in `src/server/agent/router.ts` + `intent.ts`:
 * - every prompt contains "destinations" (travel-domain signal, so it is
 *   never `out_of_scope`) and "visit"/"visiting" (Phase 3 place keyword,
 *   so it routes to `discover_places` → Google Maps → real results);
 * - no prompt contains capability triggers (plan/fix/check/re-?check/
 *   book/reschedul/...) or hotel keywords, so it cannot misroute;
 * - nothing is capitalized mid-sentence, so destination extraction stays
 *   empty and the full prompt becomes the live search query — no invented
 *   destination. See `tests/visual-discovery.test.ts`, which pins this.
 */

export interface TravelImage {
  src: string;
  alt: string;
}

function unsplash(id: string, width: number): string {
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${width}&q=60`;
}

export const HERO_IMAGE: TravelImage = {
  src: unsplash("photo-1506905925346-21bda4d32df4", 2000),
  alt: "Snow-covered Himalayan peaks rising above a valley at dawn",
};

export const WORKSPACE_BANNER_IMAGE: TravelImage = {
  src: unsplash("photo-1501785888041-af3ef285b470", 1600),
  alt: "Alpine lake reflecting mountain peaks at sunset",
};

export interface DiscoveryCategory {
  key: string;
  category: string;
  title: string;
  image: TravelImage;
  /** Verbatim agent prompt auto-submitted for this category. */
  prompt: string;
  /** Workspace header shown while exploring this category. */
  heading: string;
}

export const DISCOVERY_CATEGORIES: DiscoveryCategory[] = [
  {
    key: "mountains",
    category: "Mountains",
    title: "High escapes, thin air",
    image: {
      src: unsplash("photo-1464822759023-fed622ff2c3b", 800),
      alt: "Layered mountain ranges fading into morning mist",
    },
    prompt: "Show me mountain destinations worth visiting",
    heading: "Mountain escapes",
  },
  {
    key: "beaches",
    category: "Beaches",
    title: "Slow days by the sea",
    image: {
      src: unsplash("photo-1507525428034-b723cf961d3e", 800),
      alt: "Turquoise waves washing over white tropical sand",
    },
    prompt: "Show me beach destinations worth visiting",
    heading: "Beach escapes",
  },
  {
    key: "lakes",
    category: "Lakes",
    title: "Still water mornings",
    image: {
      src: unsplash("photo-1439066615861-d1af74d74000", 800),
      alt: "Wooden jetty stretching across a calm mountain lake",
    },
    prompt: "Show me lake destinations worth visiting",
    heading: "Lake escapes",
  },
  {
    key: "forests",
    category: "Forests",
    title: "Walks under tall trees",
    image: {
      src: unsplash("photo-1441974231531-c6227db76b6e", 800),
      alt: "Sunlight filtering through a dense pine forest",
    },
    prompt: "Show me nature and forest destinations worth visiting",
    heading: "Forest escapes",
  },
  {
    key: "villages",
    category: "Villages",
    title: "Countryside rhythms",
    image: {
      src: unsplash("photo-1500382017468-9049fed747ef", 800),
      alt: "Open countryside road winding through golden fields",
    },
    prompt: "Show me countryside destinations worth visiting",
    heading: "Village escapes",
  },
  {
    key: "heritage",
    category: "Heritage",
    title: "Stories in stone",
    image: {
      src: unsplash("photo-1524492412937-b28074a5d7da", 800),
      alt: "Marble monument glowing warm at sunrise",
    },
    prompt: "Show me heritage destinations worth visiting",
    heading: "Heritage escapes",
  },
  {
    key: "luxury",
    category: "Luxury stays",
    title: "Check in, slow down",
    image: {
      src: unsplash("photo-1566073771259-6a8506099945", 800),
      alt: "Resort pool lined with loungers at dusk",
    },
    prompt: "Show me destinations famous for luxury retreats worth visiting",
    heading: "Luxury stay escapes",
  },
  {
    key: "roads",
    category: "Roads",
    title: "Journeys between places",
    image: {
      src: unsplash("photo-1469854523086-cc02fe5d8800", 800),
      alt: "Open road stretching toward distant hills",
    },
    prompt: "Show me scenic road trip destinations worth visiting",
    heading: "Road trip escapes",
  },
];

export function discoveryCategory(key: string | null | undefined): DiscoveryCategory | null {
  if (!key) return null;
  return DISCOVERY_CATEGORIES.find((c) => c.key === key) ?? null;
}

export interface InspirationCard {
  category: string;
  title: string;
  image: TravelImage;
}

export const INSPIRATION_CARDS: InspirationCard[] = DISCOVERY_CATEGORIES.map(
  ({ category, title, image }) => ({ category, title, image }),
);
