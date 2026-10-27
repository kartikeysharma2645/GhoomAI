/**
 * Accessibility preferences for trip planning.
 *
 * Accessibility preferences are user-stated needs (e.g. "wheelchair
 * accessible", "step-free access", "reduced walking"). They are used as
 * weak scoring signals — places whose title/type text contains matching
 * keywords receive a small boost, but places without any accessibility
 * information are never penalized. Missing information is treated as
 * unknown, never as a negative signal.
 *
 * These preferences never exclude candidates and never claim that a place
 * is confirmed accessible without supporting evidence.
 */

export const ACCESSIBILITY_PREFERENCES = [
  "wheelchair",
  "stepFree",
  "reducedWalking",
] as const;

export type AccessibilityPreference = (typeof ACCESSIBILITY_PREFERENCES)[number];

/** Keyword stems matched against candidate title/type text. These are weak
 * signals — a match suggests possible relevance but never confirms
 * accessibility. */
export const ACCESSIBILITY_MATCHERS: Record<AccessibilityPreference, RegExp> = {
  wheelchair: /wheelchair|accessible|ramp|lift|elevator|adapted/i,
  stepFree: /step.free|no.step|ground.level|entry.level/i,
  reducedWalking: /short.walk|near|close.by|minimal.walking|drop.off/i,
};

/** Scores one place against the user's accessibility preferences.
 * Each matched preference adds a small bonus. Missing fields contribute
 * zero — never treated as negative. Returns a non-negative score. */
export function scoreAccessibility(
  place: {
    title?: string;
    placeType?: string;
    placeTypes?: string[];
  },
  preferences: AccessibilityPreference[],
): number {
  if (preferences.length === 0) return 0;

  const text = `${place.title ?? ""} ${place.placeType ?? ""} ${
    (place.placeTypes ?? []).join(" ")
  }`.toLowerCase();

  let score = 0;
  for (const preference of preferences) {
    const matcher = ACCESSIBILITY_MATCHERS[preference];
    if (matcher && matcher.test(text)) {
      score += 10;
    }
  }
  return score;
}
