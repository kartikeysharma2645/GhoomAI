import { z } from "zod";
import type { VisionCandidate } from "./types";

/**
 * Phase 8 Prompt 3 context-aware photography assistant.
 *
 * Deterministic and fully testable: recommendations derive from the
 * detected subject category, live-verified place facts, and the image's
 * own visual observations. No LLM call, no invented camera metadata, and
 * no unsafe suggestions. Every claim is either generic craft or grounded
 * in supplied context.
 */

export const photographyAdviceSchema = z.object({
  subject: z.string().min(1).max(200),
  subjectCategory: z.string().min(1).max(100),
  groundedIn: z.enum(["verified_place", "visual_only"]),
  composition: z.array(z.string().max(300)).max(8),
  framing: z.array(z.string().max(300)).max(8),
  cameraTips: z.array(z.string().max(300)).max(8),
  lighting: z.array(z.string().max(300)).max(8),
  timing: z.array(z.string().max(300)).max(8),
  poseSuggestions: z.array(z.string().max(300)).max(6),
  caveats: z.array(z.string().max(300)).max(6),
});

export type PhotographyAdvice = z.infer<typeof photographyAdviceSchema>;

export interface PhotographyContext {
  subjectName: string;
  subjectCategory: string;
  verified: boolean;
  visualObservations: string[];
  candidateType?: string;
}

interface CategoryPlaybook {
  composition: string[];
  framing: string[];
  lighting: string[];
  timing: string[];
  poses: string[];
}

const MONUMENT_PLAYBOOK: CategoryPlaybook = {
  composition: [
    "Center the monument for symmetry, then try one off-center frame for a less static alternative.",
    "Use paths, rows of trees, or water edges as leading lines toward the monument.",
    "Separate the monument from the background by crouching slightly or shifting sideways.",
  ],
  framing: [
    "Step back and include foreground to give the monument scale.",
    "Try a vertical frame for tall structures so the top is not cut off.",
  ],
  lighting: [
    "Side light brings out stone texture; harsh midday sun flattens detail.",
    "Late afternoon generally gives softer directional light on facades.",
  ],
  timing: [
    "Early morning usually means fewer crowds in the frame.",
    "Golden hour suits sandstone and marble particularly well.",
  ],
  poses: [
    "Standing three-quarter view with the monument over one shoulder.",
    "Walking toward the camera along the approach path, candid style.",
    "Silhouette against the monument near sunset from a low angle.",
  ],
};

const LANDSCAPE_PLAYBOOK: CategoryPlaybook = {
  composition: [
    "Compose in foreground, midground, and background layers for depth.",
    "Place the horizon on the upper or lower third, not the middle.",
    "Use shorelines, trails, or ridgelines as natural leading lines.",
  ],
  framing: [
    "Go wide to capture the full scene, then isolate one detail for variety.",
    "Include a person or structure for scale when the scene feels vast.",
  ],
  lighting: [
    "Changing light transforms landscapes; the same view differs by hour.",
    "Overcast light suits forests and waterfalls by softening contrast.",
  ],
  timing: [
    "Sunrise and sunset add color and long shadows to open scenes.",
    "Midday is better spent scouting angles for a return visit.",
  ],
  poses: [
    "Small figure in a vast landscape, back to camera, looking outward.",
    "Seated on a rock or ledge, relaxed and off-center.",
  ],
};

const STREET_PLAYBOOK: CategoryPlaybook = {
  composition: [
    "Layer foreground, subject, and background to capture street energy.",
    "Use doorways, arches, and reflections to frame candid moments.",
    "Keep environmental context in the frame rather than zooming too tight.",
  ],
  framing: [
    "Shoot at eye level for an immersive street feel.",
    "Try reflections in shop windows, puddles, or vehicle panels.",
  ],
  lighting: [
    "Covered markets and lanes reward attention to pockets of light.",
    "Evening shop lights add warmth to street scenes.",
  ],
  timing: [
    "Mornings show markets setting up; evenings show them at their liveliest.",
  ],
  poses: [
    "Walking through the frame naturally, documentary style.",
    "Leaning in a doorway, looking down the street.",
  ],
};

const FOOD_PLAYBOOK: CategoryPlaybook = {
  composition: [
    "Shoot from directly above for flat dishes, or at 45 degrees for stacked food.",
    "Clear background clutter before shooting; move the plate near natural light.",
    "Take one close-up detail shot alongside the full-table frame.",
  ],
  framing: [
    "Fill the frame with the dish; leave little empty table visible.",
    "Include hands or a cup for scale in one frame.",
  ],
  lighting: [
    "Natural side light flatters food far better than overhead flash.",
    "Avoid flash, which flattens texture and creates harsh spots.",
  ],
  timing: [
    "Shoot food immediately when served, before steam and freshness fade.",
  ],
  poses: [],
};

const GENERIC_PLAYBOOK: CategoryPlaybook = {
  composition: [
    "Identify one clear subject and remove competing elements from the frame.",
    "Take both a wide establishing shot and a closer detail shot.",
  ],
  framing: [
    "Try eye-level, low, and high angles of the same subject for variety.",
  ],
  lighting: [
    "Face the light source toward the subject rather than shooting into glare where possible.",
  ],
  timing: [
    "Softer morning and late-afternoon light is generally more flattering.",
  ],
  poses: [
    "Natural standing pose with the subject over one shoulder.",
    "Candid walking shot rather than a stiff posed frame.",
  ],
};

const SAFETY_CAVEAT =
  "Stay in public areas, respect barriers and no-photography signs, and avoid roads, edges, and restricted structures.";

function playbookFor(category: string): {
  playbook: CategoryPlaybook;
  label: string;
} {
  const normalized = category.toUpperCase();
  if (normalized === "TEMPLE" || normalized === "MONUMENT" || normalized === "MUSEUM") {
    return { playbook: MONUMENT_PLAYBOOK, label: "monument" };
  }
  if (normalized === "NATURAL_SITE") {
    return { playbook: LANDSCAPE_PLAYBOOK, label: "landscape" };
  }
  if (normalized === "STREET") {
    return { playbook: STREET_PLAYBOOK, label: "street scene" };
  }
  if (normalized === "RESTAURANT") {
    return { playbook: FOOD_PLAYBOOK, label: "food" };
  }
  if (normalized === "BUILDING" || normalized === "LANDMARK") {
    return { playbook: MONUMENT_PLAYBOOK, label: "landmark" };
  }
  return { playbook: GENERIC_PLAYBOOK, label: "general" };
}

/**
 * Derives image-specific notes from visual observations using
 * conservative keyword signals. Never claims camera metadata.
 */
export function imageSpecificTips(observations: string[]): string[] {
  const text = observations.join(" ").toLowerCase();
  const tips: string[] = [];
  if (/center|symmetr|middle/.test(text)) {
    tips.push(
      "The subject sits centered; one off-center variation adds visual interest.",
    );
  }
  if (/clutter|crowd|busy|foreground/.test(text)) {
    tips.push(
      "The frame looks busy; stepping sideways or crouching can reduce foreground clutter.",
    );
  }
  if (/tall|tower|vertical|high/.test(text)) {
    tips.push("Tall subjects suit a vertical frame to avoid cutting the top.");
  }
  if (/dark|night|evening|dim/.test(text)) {
    tips.push(
      "Low light is visible; brace the camera steady rather than using flash.",
    );
  }
  return tips.slice(0, 4);
}

export function buildPhotographyAdvice(
  candidate: Pick<VisionCandidate, "name" | "type" | "confidence">,
  context: Omit<PhotographyContext, "subjectName" | "subjectCategory"> & {
    subjectName?: string;
    subjectCategory?: string;
  },
): PhotographyAdvice {
  const subjectName =
    context.subjectName?.trim() || candidate.name;
  const subjectCategory =
    context.subjectCategory?.trim() || candidate.type || "UNKNOWN";
  const { playbook, label } = playbookFor(subjectCategory);
  const specific = imageSpecificTips(context.visualObservations);
  const advice = {
    subject: subjectName.slice(0, 200),
    subjectCategory: label.slice(0, 100),
    groundedIn: context.verified ? ("verified_place" as const) : ("visual_only" as const),
    composition: [...playbook.composition, ...specific.slice(0, 2)].slice(0, 8),
    framing: [...playbook.framing].slice(0, 8),
    cameraTips: [
      "No camera metadata is available, so no specific focal length, shutter, or aperture is suggested.",
      ...specific.slice(2, 4),
    ].slice(0, 8),
    lighting: [...playbook.lighting].slice(0, 8),
    timing: [...playbook.timing].slice(0, 8),
    poseSuggestions: (label === "food" ? [] : [...playbook.poses]).slice(0, 6),
    caveats: [
      SAFETY_CAVEAT,
      ...(context.verified
        ? []
        : [
            "Advice is based on the image and general craft only; the place itself is not verified.",
          ]),
    ].slice(0, 6),
  };
  return photographyAdviceSchema.parse(advice);
}
