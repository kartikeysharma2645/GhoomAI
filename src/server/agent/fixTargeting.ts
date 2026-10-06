import type { TripPlan } from "../trips/plan";

/**
 * Deterministic day/item targeting for user-requested itinerary changes.
 *
 * Pure: resolves which plan item(s) a message refers to ("Replace Hawa
 * Mahal on Day 2…", "remove City Palace…") without any I/O or guessing.
 * Ambiguity resolves to an explicit candidate list for clarification —
 * never to a silently picked item.
 */

export interface FixCandidate {
  itemId: string;
  title: string;
  dayNumber: number;
}

export type FixTargeting =
  | { kind: "targets"; itemIds: string[] }
  | { kind: "ambiguous"; dayNumber?: number; candidates: FixCandidate[] }
  | { kind: "none" };

/** Item kinds the fixer pipeline can replace. Notes are never replaceable. */
const REPLACEABLE_KINDS = new Set(["attraction", "meal", "stay"]);

const REPLACE_VERBS =
  /\b(replace|replacement|swap|swapping|substitut(e|ion|ing))\b/i;
const REMOVE_FOR_ALTERNATIVE =
  /\bremove\b.{0,80}\b(alternative|another|replacement|instead)\b/i;
const CHANGE_ACTIVITY = /\bchange\b.{0,30}\bactivit(y|ies)\b/i;

/** Whether the message asks to swap something out (vs. a generic fix). */
export function hasReplacementLanguage(message: string): boolean {
  return (
    REPLACE_VERBS.test(message) ||
    REMOVE_FOR_ALTERNATIVE.test(message) ||
    CHANGE_ACTIVITY.test(message)
  );
}

const PACE_CHANGE =
  /\btoo\s+packed\b|\bmore\s+relaxed\b|\bless\s+hectic\b|\bslower\s+pace\b/i;

/** Whether the message asks to change trip pacing rather than an item. */
export function hasPaceChangeLanguage(message: string): boolean {
  return PACE_CHANGE.test(message);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokens long enough to identify a place without false positives. */
function significantTokens(value: string): string[] {
  return normalize(value)
    .split(" ")
    .filter((t) => t.length >= 4);
}

function titleMatches(
  title: string | undefined,
  placeName: string | undefined,
  message: string,
): boolean {
  const text = normalize(message);
  for (const name of [title, placeName]) {
    if (!name) continue;
    const want = normalize(name);
    if (want.length >= 4 && text.includes(want)) return true;
    const tokens = significantTokens(name);
    if (
      tokens.length > 0 &&
      tokens.every((t) => text.split(" ").includes(t))
    ) {
      return true;
    }
  }
  return false;
}

interface ScopedItem {
  itemId: string;
  title: string;
  dayNumber: number;
  placeName?: string;
}

function replaceableItems(plan: TripPlan): ScopedItem[] {
  const items: ScopedItem[] = [];
  for (const day of plan.days) {
    for (const item of day.items) {
      if (!REPLACEABLE_KINDS.has(item.kind)) continue;
      items.push({
        itemId: item.id,
        title: item.title,
        dayNumber: day.dayNumber,
        placeName: item.place?.name,
      });
    }
  }
  return items;
}

const MAX_CANDIDATES = 8;

function toCandidates(items: ScopedItem[], dayNumber?: number): FixTargeting {
  return {
    kind: "ambiguous",
    ...(dayNumber !== undefined ? { dayNumber } : {}),
    candidates: items.slice(0, MAX_CANDIDATES).map((i) => ({
      itemId: i.itemId,
      title: i.title,
      dayNumber: i.dayNumber,
    })),
  };
}

/**
 * Resolves a replacement request to plan item IDs. Returns `targets` when
 * the reference is unambiguous (a named title, or a day with exactly one
 * replaceable item), `ambiguous` with a capped candidate list otherwise,
 * and `none` when the message carries no replacement targeting at all.
 */
export function resolveFixTargets(
  plan: TripPlan,
  message: string,
): FixTargeting {
  if (!hasReplacementLanguage(message)) return { kind: "none" };
  const items = replaceableItems(plan);
  if (items.length === 0) return { kind: "none" };

  const named = items.filter((i) => titleMatches(i.title, i.placeName, message));
  if (named.length === 1 && named[0]) {
    return { kind: "targets", itemIds: [named[0].itemId] };
  }
  if (named.length > 1) {
    return toCandidates(named);
  }

  const day = message.match(/\bday\s+(\d+)\b/i);
  const dayNumber = day?.[1] ? Number.parseInt(day[1], 10) : undefined;
  if (dayNumber !== undefined) {
    const scoped = items.filter((i) => i.dayNumber === dayNumber);
    if (scoped.length === 1 && scoped[0]) {
      return { kind: "targets", itemIds: [scoped[0].itemId] };
    }
    return toCandidates(scoped, dayNumber);
  }
  return toCandidates(items);
}
