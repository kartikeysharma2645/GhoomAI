import { z } from "zod";
import { evidenceSchema } from "../trips/plan";

/**
 * Phase 5 Step 1 RealityCheck contracts.
 *
 * RealityCheckResult is a SEPARATE auditable object — TripPlan is never
 * mutated. Original planning evidence is snapshotted per item; fresh
 * verification evidence is stored alongside, never merged.
 */

export const VERIFICATION_STATUSES = [
  "VERIFIED",
  "NEEDS_ATTENTION",
  "PROBLEM",
  "UNVERIFIED",
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/**
 * Centralized verification capability matrix.
 * Supported facts are actually checked; anything else stays UNVERIFIED.
 */
export const SUPPORTED_FACTS = [
  "discoverability",
  "rating",
  "reviews",
  "address",
  "openState",
  "openHours",
  "hotelPrice",
  "hotelAvailability",
] as const;

export const UNSUPPORTED_FACTS = [
  "travelTime",
  "subjectiveQuality",
  "guaranteedAvailability",
  "routeFeasibility",
  "futureCertainty",
  "preferenceSatisfaction",
] as const;

export const FACT_OUTCOMES = [
  "matched",
  "changed",
  "missing",
  "conflicting",
  "unverifiable",
] as const;

export type FactOutcome = (typeof FACT_OUTCOMES)[number];

export const factCheckSchema = z.object({
  fact: z.string().min(1).max(100),
  supported: z.boolean(),
  planned: z.unknown().optional(),
  fresh: z.unknown().optional(),
  outcome: z.enum(FACT_OUTCOMES),
  detail: z.string().max(500).optional(),
});

export type FactCheck = z.infer<typeof factCheckSchema>;

export const itemCheckSchema = z.object({
  itemId: z.string().min(1).max(100),
  kind: z.string().min(1).max(50),
  title: z.string().min(1).max(300),
  status: z.enum(VERIFICATION_STATUSES),
  /** Snapshot of the planning evidence — never mutated. */
  plannedEvidence: evidenceSchema.optional(),
  /** Fresh normalized verification evidence, when obtained. */
  freshEvidence: evidenceSchema.optional(),
  facts: z.array(factCheckSchema),
  reasons: z.array(z.string().max(500)),
});

export type ItemCheck = z.infer<typeof itemCheckSchema>;

export const realityCheckResultSchema = z.object({
  checkedAt: z.string(),
  summary: z.object({
    verified: z.number().int().nonnegative(),
    needsAttention: z.number().int().nonnegative(),
    problem: z.number().int().nonnegative(),
    unverified: z.number().int().nonnegative(),
  }),
  items: z.array(itemCheckSchema),
  warnings: z.array(z.string()),
});

export type RealityCheckResult = z.infer<typeof realityCheckResultSchema>;
