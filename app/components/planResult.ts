import { tripPlanSchema, type TripPlan } from "../../src/server/trips/plan";

/**
 * Parses the `data` payload of POST /api/trips/plan into either a validated
 * TripPlan or a needs_input request.
 *
 * The endpoint returns the PlanTripResult envelope
 * (`{ status: "ready", plan }` or `{ status: "needs_input", ... }`), NOT a
 * bare plan. Storing the envelope itself as the plan drops required fields
 * (notably `party`) and crashes every downstream consumer, so the plan is
 * validated with the canonical TripPlan schema before it may enter UI state.
 * Throws on anything else — callers surface the message as an error and
 * keep plan state null.
 */

export interface PlanNeedsInput {
  status: "needs_input";
  missing: string[];
  message: string;
}

export type ParsedPlanResult =
  | { kind: "ready"; plan: TripPlan }
  | { kind: "needs_input"; input: PlanNeedsInput };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePlanResponse(data: unknown): ParsedPlanResult {
  if (!isRecord(data) || typeof data.status !== "string") {
    throw new Error("Unexpected planning response. Please try again.");
  }
  if (data.status === "needs_input") {
    if (
      typeof data.message !== "string" ||
      !Array.isArray(data.missing) ||
      !data.missing.every((m): m is string => typeof m === "string")
    ) {
      throw new Error("Unexpected planning response. Please try again.");
    }
    return {
      kind: "needs_input",
      input: { status: "needs_input" as const, missing: data.missing, message: data.message },
    };
  }
  if (data.status === "ready") {
    const parsed = tripPlanSchema.safeParse((data as { plan?: unknown }).plan);
    if (!parsed.success) {
      throw new Error("Unexpected planning response. Please try again.");
    }
    return { kind: "ready", plan: parsed.data };
  }
  throw new Error("Unexpected planning response. Please try again.");
}
