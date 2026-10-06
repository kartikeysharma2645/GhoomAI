import { z } from "zod";
import { SerpApiClient } from "../services/serpapi/client";
import type {
  NormalizedMapsPlace,
  NormalizedSearchResultItem,
} from "../services/serpapi/types";
import { matchPlace, normalizeName } from "../realitycheck/queries";
import {
  analyzeImage,
  type VisionAnalysisResult,
} from "./service";
import {
  buildPhotographyAdvice,
  photographyAdviceSchema,
  type PhotographyAdvice,
} from "./photography";
import type { VisionCandidate } from "./types";

/**
 * Phase 8 Prompt 2 visual place analysis orchestration.
 *
 * IMAGE → vision provider → candidates → SerpApi Search + Maps
 * verification → explanation → nearby discovery.
 *
 * Vision identifies; Search verifies. A high vision confidence score
 * alone never produces VERIFIED — only agreeing live evidence does.
 * Every stage degrades independently with honest statuses.
 */

export const VERIFICATION_STATUSES = [
  "VERIFIED",
  "PARTIALLY_VERIFIED",
  "UNVERIFIED",
] as const;

export type PlaceVerificationStatus =
  (typeof VERIFICATION_STATUSES)[number];

/** At most this many vision candidates enter verification. */
export const MAX_VERIFY_CANDIDATES = 2;
/** Search results requested per verification query. */
export const SEARCH_RESULT_COUNT = 5;
/** Nearby recommendations returned. */
export const NEARBY_COUNT = 5;

export const searchEvidenceSchema = z.object({
  source: z.enum(["google_search", "google_maps"]),
  query: z.string().min(1).max(300),
  observedAt: z.string(),
  title: z.string().optional(),
  snippet: z.string().optional(),
  link: z.string().optional(),
  rating: z.number().optional(),
  address: z.string().optional(),
});

export type SearchEvidence = z.infer<typeof searchEvidenceSchema>;

export const verifiedPlaceSchema = z.object({
  name: z.string().min(1).max(200),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  address: z.string().max(500).optional(),
  rating: z.number().optional(),
  reviews: z.number().optional(),
  placeId: z.string().optional(),
  thumbnail: z.string().optional(),
});

export type VerifiedPlace = z.infer<typeof verifiedPlaceSchema>;

export const explanationSchema = z.object({
  summary: z.string().max(600),
  culturalContext: z.string().max(1000),
  fullyVerified: z.boolean(),
  sources: z.array(z.string().url().or(z.string())).max(5),
});

export type PlaceExplanation = z.infer<typeof explanationSchema>;

export const nearbyPlaceSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().max(100).optional(),
  rating: z.number().optional(),
  reviews: z.number().optional(),
  address: z.string().max(500).optional(),
  thumbnail: z.string().optional(),
});

export type NearbyPlace = z.infer<typeof nearbyPlaceSchema>;

export const photoSpotSchema = nearbyPlaceSchema.extend({
  corroborated: z.boolean(),
  reason: z.string().max(300),
});

export type PhotoSpot = z.infer<typeof photoSpotSchema>;

export const visualPlaceAnalysisSchema = z.object({
  analysisId: z.string().min(1).max(100),
  analyzedAt: z.string(),
  visual: z.object({
    status: z.string(),
    candidates: z.array(z.unknown()),
  }),
  verification: z.object({
    status: z.enum(VERIFICATION_STATUSES),
    matchedPlace: verifiedPlaceSchema.optional(),
    evidence: z.array(searchEvidenceSchema),
    notes: z.array(z.string().max(300)),
  }),
  explanation: explanationSchema,
  nearby: z.array(nearbyPlaceSchema),
  photography: z
    .object({
      advice: photographyAdviceSchema,
      photoSpots: z.array(photoSpotSchema),
    })
    .optional(),
  warnings: z.array(z.string().max(300)),
});

export type VisualPlaceAnalysis = z.infer<typeof visualPlaceAnalysisSchema>;

function candidateQuery(candidate: VisionCandidate): string {
  return [candidate.name, candidate.city, candidate.country]
    .filter((part): part is string => !!part && part.trim().length > 0)
    .join(" ")
    .slice(0, 300);
}

function mentionsName(
  text: string | undefined,
  name: string,
): boolean {
  if (!text) return false;
  const normalized = normalizeName(text);
  const want = normalizeName(name);
  return (
    want.length > 0 && (normalized.includes(want) || want.includes(normalized))
  );
}

function domainOf(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return link;
  }
}

function trimSnippet(snippet: string, max = 300): string {
  const cleaned = snippet.replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1).trimEnd()}…` : cleaned;
}

interface CandidateVerification {
  candidate: VisionCandidate;
  status: PlaceVerificationStatus;
  matchedPlace?: NormalizedMapsPlace;
  searchHits: NormalizedSearchResultItem[];
  mapsQuery: string;
  searchQuery: string;
  observedAt: string;
}

async function verifyCandidate(
  candidate: VisionCandidate,
  client: SerpApiClient,
  observedAt: string,
  locationHint?: string,
): Promise<CandidateVerification> {
  const baseQuery = candidateQuery(candidate);
  const mapsQuery = baseQuery;
  // Maps location biases toward the candidate city without trusting it.
  const location =
    candidate.city || candidate.country || locationHint || undefined;

  let mapsResults: NormalizedMapsPlace[] = [];
  try {
    const maps = await client.searchMaps({ query: mapsQuery, location });
    mapsResults = maps.results;
  } catch {
    mapsResults = [];
  }
  const mapsMatch = matchPlace(mapsResults, {}, candidate.name);

  let searchHits: NormalizedSearchResultItem[] = [];
  const searchQuery = baseQuery;
  try {
    const search = await client.search({
      engine: "google",
      query: searchQuery,
      num: SEARCH_RESULT_COUNT,
    });
    searchHits = search.results.filter(
      (r) => mentionsName(r.title, candidate.name) || mentionsName(r.snippet, candidate.name),
    );
  } catch {
    searchHits = [];
  }

  const hasMaps = mapsMatch.matched;
  const hasSearch = searchHits.length > 0;
  const status: PlaceVerificationStatus =
    hasMaps && hasSearch
      ? "VERIFIED"
      : hasMaps || hasSearch
        ? "PARTIALLY_VERIFIED"
        : "UNVERIFIED";
  return {
    candidate,
    status,
    matchedPlace: hasMaps && mapsMatch.matched ? mapsMatch.place : undefined,
    searchHits,
    mapsQuery,
    searchQuery,
    observedAt,
  };
}

function describePlace(
  verification: CandidateVerification,
): VerifiedPlace | undefined {
  const place = verification.matchedPlace;
  if (!place) return undefined;
  return {
    name: place.title || verification.candidate.name,
    city: verification.candidate.city,
    country: verification.candidate.country,
    address: place.address,
    rating: place.rating,
    reviews: place.reviews,
    placeId: place.placeId,
    thumbnail: place.thumbnail,
  };
}

function describeEvidence(
  verification: CandidateVerification,
): SearchEvidence[] {
  const evidence: SearchEvidence[] = [];
  if (verification.matchedPlace) {
    const place = verification.matchedPlace;
    evidence.push({
      source: "google_maps",
      query: verification.mapsQuery,
      observedAt: verification.observedAt,
      title: place.title,
      rating: place.rating,
      address: place.address,
    });
  }
  for (const hit of verification.searchHits.slice(0, 3)) {
    evidence.push({
      source: "google_search",
      query: verification.searchQuery,
      observedAt: verification.observedAt,
      title: hit.title,
      snippet: trimSnippet(hit.snippet),
      link: hit.link,
    });
  }
  return evidence;
}

function explainPlace(
  candidate: VisionCandidate,
  verification: CandidateVerification,
): PlaceExplanation {
  const sources: string[] = [];
  const contexts: string[] = [];
  for (const hit of verification.searchHits.slice(0, 2)) {
    if (hit.snippet) contexts.push(trimSnippet(hit.snippet, 400));
    if (hit.link) sources.push(hit.link);
  }
  const fullyVerified = verification.status === "VERIFIED";
  const summary =
    contexts[0] ??
    (verification.matchedPlace?.address
      ? `Maps places it at ${verification.matchedPlace.address}.`
      : "No researched description is available.");
  const culturalContext =
    contexts.length > 1
      ? contexts.slice(1).join(" ")
      : fullyVerified
        ? `Search evidence corroborates ${candidate.name} as a real place worth visiting.`
        : "The historical explanation could not be fully verified from live search evidence.";
  return {
    summary: `Researched: ${summary} (via ${sources.length > 0 ? domainOf(sources[0] as string) : "live search"}).`,
    culturalContext,
    fullyVerified,
    sources: sources.slice(0, 5),
  };
}

async function discoverNearby(
  place: NormalizedMapsPlace | undefined,
  candidate: VisionCandidate,
  client: SerpApiClient,
  locationHint?: string,
): Promise<{ nearby: NearbyPlace[]; warnings: string[] }> {
  const location = (
    [candidate.city, candidate.country].find(
      (part) => !!part && part.trim().length > 0,
    ) ?? locationHint
  )?.trim() || undefined;
  const queries = place?.title
    ? [`tourist attractions near ${place.title}`, `restaurants near ${place.title}`]
    : [`tourist attractions in ${candidate.city ?? candidate.country ?? candidate.name}`];
  const seen = new Set<string>();
  const nearby: NearbyPlace[] = [];
  const warnings: string[] = [];
  for (const query of queries.slice(0, 2)) {
    let results: NormalizedMapsPlace[] = [];
    try {
      const res = await client.searchMaps({
        query: query.slice(0, 300),
        location,
      });
      results = res.results;
    } catch {
      warnings.push(`Nearby discovery failed for "${query}".`);
      continue;
    }
    for (const item of results) {
      if (nearby.length >= NEARBY_COUNT) break;
      if (!item.title) continue;
      const key = normalizeName(item.title);
      if (place?.title && normalizeName(place.title) === key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      nearby.push({
        name: item.title.slice(0, 200),
        category: item.placeType ?? item.placeTypes?.[0],
        rating: item.rating,
        reviews: item.reviews,
        address: item.address,
        thumbnail: item.thumbnail,
      });
    }
    if (nearby.length >= NEARBY_COUNT) break;
  }
  return { nearby, warnings };
}

/** Exactly one dedicated photo-spot query per analysis (quota-bounded). */
export const PHOTO_SPOT_COUNT = 5;

async function discoverPhotoSpots(
  place: NormalizedMapsPlace,
  candidate: VisionCandidate,
  searchCorpus: string[],
  client: SerpApiClient,
  locationHint?: string,
): Promise<{ spots: PhotoSpot[]; warnings: string[] }> {
  const location =
    [candidate.city, candidate.country].find(
      (part) => !!part && part.trim().length > 0,
    ) ??
    locationHint ??
    undefined;
  const query = `viewpoints near ${place.title}`.slice(0, 300);
  let results: NormalizedMapsPlace[] = [];
  try {
    const res = await client.searchMaps({ query, location });
    results = res.results;
  } catch {
    return {
      spots: [],
      warnings: ["Photo-spot discovery failed; no photo spots available."],
    };
  }
  const corpus = searchCorpus.map((t) => normalizeName(t)).join(" ");
  const seen = new Set<string>([normalizeName(place.title ?? "")]);
  const spots: PhotoSpot[] = [];
  for (const item of results) {
    if (spots.length >= PHOTO_SPOT_COUNT) break;
    if (!item.title) continue;
    const key = normalizeName(item.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const corroborated =
      corpus.length > 0 && (corpus.includes(key) || key.split(" ").some((w) => w.length > 4 && corpus.includes(w)));
    spots.push({
      name: item.title.slice(0, 200),
      category: item.placeType ?? item.placeTypes?.[0],
      rating: item.rating,
      reviews: item.reviews,
      address: item.address,
      thumbnail: item.thumbnail,
      corroborated,
      reason: corroborated
        ? "Mentioned in live search results for the area."
        : "Maps-listed viewpoint nearby; treat as a lead, not a verified photo spot.",
    });
  }
  return { spots, warnings: [] };
}

export async function analyzeVisualPlace(input: {
  bytes: Uint8Array;
  declaredMimeType?: string;
  sizeBytes?: number;
  client?: SerpApiClient;
  cityHint?: string;
  countryHint?: string;
}): Promise<VisualPlaceAnalysis> {
  const visual: VisionAnalysisResult = await analyzeImage({
    bytes: input.bytes,
    declaredMimeType: input.declaredMimeType,
    sizeBytes: input.sizeBytes,
  });
  const client = input.client ?? new SerpApiClient();
  const observedAt = new Date().toISOString();
  const warnings: string[] = [...visual.warnings];

  const ranked = [...visual.candidates]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_VERIFY_CANDIDATES);

  const verifications: CandidateVerification[] = [];
  const locationHint =
    input.cityHint || input.countryHint || undefined;
  for (const candidate of ranked) {
    try {
      verifications.push(
        await verifyCandidate(candidate, client, observedAt, locationHint),
      );
    } catch {
      warnings.push(
        `Live verification failed for "${candidate.name}"; it remains unverified.`,
      );
    }
  }

  const best =
    verifications.find((v) => v.status === "VERIFIED") ??
    verifications.find((v) => v.status === "PARTIALLY_VERIFIED") ??
    verifications[0];
  if (!best) {
    return visualPlaceAnalysisSchema.parse({
      analysisId: `vp_${Date.now().toString(36)}`,
      analyzedAt: observedAt,
      visual: { status: visual.status, candidates: visual.candidates },
      verification: {
        status: "UNVERIFIED",
        evidence: [],
        notes: ["No visual candidates to verify."],
      },
      explanation: {
        summary: "Nothing identifiable to research.",
        culturalContext:
          "The historical explanation could not be fully verified from live search evidence.",
        fullyVerified: false,
        sources: [],
      },
      nearby: [],
      warnings,
    });
  }

  const explanation = explainPlace(best.candidate, best);
  let nearby: NearbyPlace[] = [];
  if (best.status !== "UNVERIFIED" && best.matchedPlace) {
    try {
      const found = await discoverNearby(
        best.matchedPlace,
        best.candidate,
        client,
        locationHint,
      );
      nearby = found.nearby;
      warnings.push(...found.warnings);
    } catch {
      warnings.push("Nearby discovery failed; no recommendations available.");
    }
  }

  // Photography context: advice is always built when a visual candidate
  // exists; live photo spots require a Maps-matched place.
  const adviceCandidate = best.matchedPlace
    ? best.candidate
    : visual.candidates[0];
  let photography: VisualPlaceAnalysis["photography"];
  if (adviceCandidate) {
    const advice = buildPhotographyAdvice(adviceCandidate, {
      subjectName:
        best.matchedPlace?.title ?? adviceCandidate.name,
      subjectCategory: adviceCandidate.type ?? "UNKNOWN",
      verified: best.status === "VERIFIED" && !!best.matchedPlace,
      visualObservations: visual.visualObservations,
    });
    let photoSpots: PhotoSpot[] = [];
    if (best.matchedPlace) {
      try {
        const searchCorpus = best.searchHits.flatMap((h) => [
          h.title,
          h.snippet,
        ]);
        const found = await discoverPhotoSpots(
          best.matchedPlace,
          best.candidate,
          searchCorpus,
          client,
          locationHint,
        );
        photoSpots = found.spots;
        warnings.push(...found.warnings);
      } catch {
        warnings.push("Photo-spot discovery failed; advice stands on its own.");
      }
    }
    photography = { advice, photoSpots };
  }

  return visualPlaceAnalysisSchema.parse({
    analysisId: `vp_${Date.now().toString(36)}`,
    analyzedAt: observedAt,
    visual: { status: visual.status, candidates: visual.candidates },
    verification: {
      status: best.status,
      matchedPlace: describePlace(best),
      evidence: describeEvidence(best),
      notes:
        best.status === "UNVERIFIED"
          ? ["Live sources could not confirm the visual identification."]
          : [],
    },
    explanation,
    nearby,
    ...(photography ? { photography } : {}),
    warnings,
  });
}
