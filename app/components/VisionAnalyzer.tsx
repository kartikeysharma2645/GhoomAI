"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Travel-oriented place identification UI (Phase 8 Prompt 1).
 *
 * The browser only talks to our own /api/vision/analyze endpoint.
 * Previews use temporary object URLs revoked on replace/remove/unmount.
 * Nothing is uploaded until Analyze is pressed; nothing is persisted.
 */

export type VisionStatus =
  | "IDENTIFIED"
  | "LIKELY"
  | "UNCERTAIN"
  | "UNIDENTIFIED"
  | "ERROR";

export interface VisionCandidateData {
  name: string;
  type: string;
  confidence: number;
  reasoning?: string;
}

export interface VisionResultData {
  analysisId: string;
  analyzedAt: string;
  status: VisionStatus;
  candidates: VisionCandidateData[];
  visualObservations: string[];
  warnings: string[];
}

/** Client-side pre-checks mirror the server limits (server re-validates). */
export const CLIENT_MAX_IMAGE_BYTES = 8_000_000;
const CLIENT_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function validateImageSelection(file: {
  size: number;
  type: string;
}): string | null {
  if (file.size === 0) return "Selected file is empty.";
  if (file.size > CLIENT_MAX_IMAGE_BYTES) {
    return "Selected image is too large. Choose a smaller file.";
  }
  if (file.type && !CLIENT_ALLOWED_TYPES.includes(file.type)) {
    return "Unsupported file type. Choose a JPEG, PNG, or WebP image.";
  }
  return null;
}

const STATUS_HEADING: Record<VisionStatus, string> = {
  IDENTIFIED: "Looks like…",
  LIKELY: "Possible match…",
  UNCERTAIN: "Not enough visual evidence…",
  UNIDENTIFIED: "Could not identify…",
  ERROR: "Analysis unavailable…",
};

const STATUS_STYLE: Record<VisionStatus, string> = {
  IDENTIFIED: "bg-emerald-100 text-emerald-900",
  LIKELY: "bg-sky-100 text-sky-900",
  UNCERTAIN: "bg-amber-100 text-amber-900",
  UNIDENTIFIED: "bg-neutral-100 text-neutral-600",
  ERROR: "bg-red-100 text-red-900",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseVisionResponse(json: unknown): VisionResultData | null {
  if (!isRecord(json) || json.ok !== true || !isRecord(json.data)) return null;
  const data = json.data;
  if (
    typeof data.analysisId !== "string" ||
    typeof data.status !== "string" ||
    !Array.isArray(data.candidates)
  ) {
    return null;
  }
  return data as unknown as VisionResultData;
}

function errorMessage(json: unknown, fallback: string): string {
  if (
    isRecord(json) &&
    isRecord(json.error) &&
    typeof json.error.message === "string"
  ) {
    return json.error.message;
  }
  return fallback;
}

export const VISION_NOT_CONFIGURED_CODE = "VISION_NOT_CONFIGURED";

/** True when an API payload reports the vision provider as unconfigured. */
export function isVisionUnavailable(json: unknown): boolean {
  return (
    isRecord(json) &&
    isRecord(json.error) &&
    json.error.code === VISION_NOT_CONFIGURED_CODE
  );
}

export interface VisionPlaceVerification {
  status: "VERIFIED" | "PARTIALLY_VERIFIED" | "UNVERIFIED";
  matchedPlace?: {
    name: string;
    city?: string;
    country?: string;
    address?: string;
    rating?: number;
    reviews?: number;
  };
  evidence: Array<{
    source: string;
    query: string;
    title?: string;
    snippet?: string;
    link?: string;
    rating?: number;
    address?: string;
  }>;
}

export interface VisionPlaceData {
  verification: VisionPlaceVerification;
  explanation: {
    summary: string;
    culturalContext: string;
    fullyVerified: boolean;
    sources: string[];
  };
  nearby: Array<{
    name: string;
    category?: string;
    rating?: number;
    reviews?: number;
    address?: string;
    thumbnail?: string;
  }>;
  photography?: {
    advice: {
      subject: string;
      subjectCategory: string;
      groundedIn: string;
      composition: string[];
      framing: string[];
      cameraTips: string[];
      lighting: string[];
      timing: string[];
      poseSuggestions: string[];
      caveats: string[];
    };
    photoSpots: Array<{
      name: string;
      category?: string;
      rating?: number;
      reviews?: number;
      address?: string;
      corroborated: boolean;
      reason: string;
    }>;
  };
  warnings: string[];
}

export function parsePlaceResponse(json: unknown): VisionPlaceData | null {
  if (!isRecord(json) || json.ok !== true || !isRecord(json.data)) return null;
  const data = json.data;
  if (
    !isRecord(data.verification) ||
    typeof data.verification.status !== "string" ||
    !isRecord(data.explanation) ||
    !Array.isArray(data.nearby)
  ) {
    return null;
  }
  return data as unknown as VisionPlaceData;
}

const VERIFY_LABEL: Record<VisionPlaceVerification["status"], string> = {
  VERIFIED: "Verified",
  PARTIALLY_VERIFIED: "Partially verified",
  UNVERIFIED: "Unverified",
};

const VERIFY_STYLE: Record<VisionPlaceVerification["status"], string> = {
  VERIFIED: "bg-emerald-100 text-emerald-900",
  PARTIALLY_VERIFIED: "bg-amber-100 text-amber-900",
  UNVERIFIED: "bg-neutral-100 text-neutral-600",
};

export default function VisionAnalyzer() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VisionResultData | null>(null);
  const [placeLoading, setPlaceLoading] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [place, setPlace] = useState<VisionPlaceData | null>(null);
  const [visionUnavailable, setVisionUnavailable] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function clearSelection() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setFile(null);
    setResult(null);
    setPlace(null);
    setPlaceError(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function onSelect(next: File | null) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setFile(null);
    setResult(null);
    setPlace(null);
    setPlaceError(null);
    if (!next) {
      setError(null);
      return;
    }
    const problem = validateImageSelection({ size: next.size, type: next.type });
    if (problem) {
      setError(problem);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setError(null);
    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
  }

  async function onAnalyze() {
    if (loading || !file) return;
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch("/api/vision/analyze", {
        method: "POST",
        body: form,
      });
      const json: unknown = await res.json();
      if (isVisionUnavailable(json)) {
        setVisionUnavailable(true);
      }
      if (res.status !== 200) {
        throw new Error(errorMessage(json, "Something went wrong."));
      }
      const parsed = parseVisionResponse(json);
      if (!parsed) throw new Error("Unexpected response. Please retry.");
      setVisionUnavailable(false);
      setResult(parsed);
      setPlace(null);
      setPlaceError(null);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  async function onVerify() {
    if (placeLoading || !file) return;
    setPlaceLoading(true);
    setPlaceError(null);
    try {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch("/api/vision/place", {
        method: "POST",
        body: form,
      });
      const json: unknown = await res.json();
      if (isVisionUnavailable(json)) {
        setVisionUnavailable(true);
      }
      if (res.status !== 200) {
        throw new Error(errorMessage(json, "Something went wrong."));
      }
      const parsed = parsePlaceResponse(json);
      if (!parsed) throw new Error("Unexpected response. Please retry.");
      setVisionUnavailable(false);
      setPlace(parsed);
    } catch (err) {
      setPlace(null);
      setPlaceError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setPlaceLoading(false);
    }
  }

  return (
    <div>
      <label
        htmlFor="vision-image"
        className="block text-sm font-medium text-neutral-700"
      >
        Photo of a place
      </label>
      <input
        ref={inputRef}
        id="vision-image"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={loading}
        onChange={(e) => onSelect(e.target.files?.[0] ?? null)}
        className="mt-1 block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border file:border-neutral-300 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-neutral-700 hover:file:border-neutral-500 disabled:opacity-60"
      />

      {previewUrl && (
        <div className="mt-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Selected photo preview"
            className="max-h-64 w-auto rounded-xl border border-neutral-200 object-cover"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void onAnalyze()}
              disabled={loading || !file}
              className="rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
            >
              {loading ? "Analyzing…" : "Identify this place"}
            </button>
            <button
              type="button"
              onClick={clearSelection}
              disabled={loading}
              className="rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm text-neutral-600 hover:border-neutral-500 disabled:opacity-60"
            >
              Remove
            </button>
          </div>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      {visionUnavailable && (
        <div
          role="status"
          className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700"
        >
          <p className="font-medium text-neutral-900">
            Live image recognition is currently unavailable.
          </p>
          <p className="mt-1">
            Add a vision provider/API key to enable landmark identification.
            You can still browse trips, plans, and live travel data elsewhere
            in GhoomAI.
          </p>
        </div>
      )}

      {result && (
        <section
          aria-live="polite"
          className="mt-4 space-y-3 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold text-neutral-900">
              {STATUS_HEADING[result.status] ?? "Result…"}
            </h3>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                STATUS_STYLE[result.status] ?? "bg-neutral-100 text-neutral-600"
              }`}
            >
              {result.status.charAt(0) + result.status.slice(1).toLowerCase()}
            </span>
          </div>

          {result.candidates.length > 0 ? (
            <ol className="space-y-3">
              {result.candidates.map((c) => (
                <li
                  key={`${c.name}-${Math.round(c.confidence * 100)}`}
                  className="rounded-xl border border-neutral-100 bg-neutral-50/60 p-3"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-medium text-neutral-900">{c.name}</p>
                    <p className="shrink-0 text-xs text-neutral-500">
                      {Math.round(c.confidence * 100)}%
                    </p>
                  </div>
                  <div
                    className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-200"
                    role="img"
                    aria-label={`Confidence ${Math.round(c.confidence * 100)} percent`}
                  >
                    <div
                      className="h-full rounded-full bg-sky-600"
                      style={{ width: `${Math.round(c.confidence * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">{c.type}</p>
                  {c.reasoning && (
                    <p className="mt-1 text-sm text-neutral-600">{c.reasoning}</p>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-neutral-600">
              Not enough visual evidence to suggest a place. Try a clearer
              photo showing the landmark or its surroundings.
            </p>
          )}

          {result.visualObservations.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-neutral-700">
                What can be seen
              </h4>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-neutral-600">
                {result.visualObservations.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </div>
          )}

          {result.warnings.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-xs text-amber-800">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}

          <p className="text-xs text-neutral-400">
            Identification is a starting point, not a verified location.
          </p>

          {result.candidates.length > 0 && !place && (
            <button
              type="button"
              onClick={() => void onVerify()}
              disabled={placeLoading || !file}
              className="w-full rounded-xl bg-sky-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50"
            >
              {placeLoading ? "Verifying with live search…" : "Verify with live search"}
            </button>
          )}
        </section>
      )}

      {placeError && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {placeError}
        </p>
      )}

      {place && (
        <section
          aria-live="polite"
          className="mt-4 space-y-3 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold text-neutral-900">Live verification</h3>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                VERIFY_STYLE[place.verification.status] ?? "bg-neutral-100 text-neutral-600"
              }`}
            >
              {VERIFY_LABEL[place.verification.status] ?? place.verification.status}
            </span>
          </div>

          {place.verification.matchedPlace ? (
            <div>
              <p className="font-medium text-neutral-900">
                {place.verification.matchedPlace.name}
                {[place.verification.matchedPlace.city, place.verification.matchedPlace.country]
                  .filter(Boolean)
                  .join(", ") && (
                  <>
                    {" "}
                    <span className="font-normal text-neutral-500">
                      ({[place.verification.matchedPlace.city, place.verification.matchedPlace.country].filter(Boolean).join(", ")})
                    </span>
                  </>
                )}
              </p>
              {typeof place.verification.matchedPlace.rating === "number" && (
                <p className="text-sm text-amber-700">
                  Rated {place.verification.matchedPlace.rating}
                  {typeof place.verification.matchedPlace.reviews === "number" &&
                    ` · ${place.verification.matchedPlace.reviews.toLocaleString("en-US")} reviews`}
                </p>
              )}
              {place.verification.matchedPlace.address && (
                <p className="text-sm text-neutral-600">
                  {place.verification.matchedPlace.address}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-neutral-600">
              AI suggests{" "}
              {result?.candidates[0]?.name ?? "a place"}
              , but live sources could not fully verify the identification.
            </p>
          )}

          <div>
            <h4 className="text-sm font-medium text-neutral-700">
              About this place
            </h4>
            <p className="mt-1 text-sm text-neutral-600">
              <span className="font-medium">Visual: </span>
              {result?.candidates[0]
                ? `The image appears to show ${result.candidates[0].name}.`
                : "Visual identification was inconclusive."}
            </p>
            <p className="mt-1 text-sm text-neutral-600">
              <span className="font-medium">Researched: </span>
              {place.explanation.summary}
            </p>
            <p className="mt-1 text-sm text-neutral-600">
              {place.explanation.culturalContext}
            </p>
          </div>

          {place.nearby.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-neutral-700">Nearby</h4>
              <ol className="mt-1 space-y-2">
                {place.nearby.map((n) => (
                  <li
                    key={n.name}
                    className="rounded-xl border border-neutral-100 bg-neutral-50/60 p-3"
                  >
                    <p className="font-medium text-neutral-900">{n.name}</p>
                    <p className="text-xs text-neutral-500">
                      {[n.category, typeof n.rating === "number" ? `rated ${n.rating}` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {n.address && (
                      <p className="text-xs text-neutral-500">{n.address}</p>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {place.photography && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-neutral-700">
                Photography assistant
              </h4>
              <p className="text-xs text-neutral-500">
                {place.photography.advice.groundedIn === "verified_place"
                  ? "Based on this image and the verified place."
                  : "Based on this image only — the place is not verified."}
              </p>

              <div>
                <h5 className="text-sm font-medium text-neutral-700">
                  How to shoot
                </h5>
                {(
                  [
                    ["Composition", place.photography.advice.composition],
                    ["Framing", place.photography.advice.framing],
                    ["Lighting", place.photography.advice.lighting],
                    ["Timing", place.photography.advice.timing],
                    ["Camera", place.photography.advice.cameraTips],
                  ] as Array<[string, string[]]>
                ).map(
                  ([label, tips]) =>
                    tips.length > 0 && (
                      <div key={label} className="mt-1">
                        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                          {label}
                        </p>
                        <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-sm text-neutral-600">
                          {tips.map((t, i) => (
                            <li key={i}>{t}</li>
                          ))}
                        </ul>
                      </div>
                    ),
                )}
              </div>

              {place.photography.advice.poseSuggestions.length > 0 && (
                <div>
                  <h5 className="text-sm font-medium text-neutral-700">
                    Pose ideas
                  </h5>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-neutral-600">
                    {place.photography.advice.poseSuggestions.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}

              {place.photography.advice.caveats.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-xs text-amber-800">
                  {place.photography.advice.caveats.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              )}

              <div>
                <h5 className="text-sm font-medium text-neutral-700">
                  Photo spots nearby
                </h5>
                {place.photography.photoSpots.length > 0 ? (
                  <ol className="mt-1 space-y-2">
                    {place.photography.photoSpots.map((s) => (
                      <li
                        key={s.name}
                        className="rounded-xl border border-neutral-100 bg-neutral-50/60 p-3"
                      >
                        <p className="font-medium text-neutral-900">{s.name}</p>
                        <p className="text-xs text-neutral-500">
                          {[
                            s.category,
                            typeof s.rating === "number" ? `rated ${s.rating}` : null,
                            s.corroborated ? "found using live Maps/Search" : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        <p className="mt-0.5 text-xs text-neutral-500">{s.reason}</p>
                        {s.address && (
                          <p className="text-xs text-neutral-500">{s.address}</p>
                        )}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-1 text-sm text-neutral-600">
                    No photo spots found in live Maps data right now.
                  </p>
                )}
              </div>
            </div>
          )}

          {place.warnings.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-xs text-amber-800">
              {place.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
