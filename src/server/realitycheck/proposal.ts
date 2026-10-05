import { z } from "zod";
import { itineraryItemSchema } from "../trips/plan";
import { itemCheckSchema, VERIFICATION_STATUSES } from "./checks";

/**
 * Phase 5 Step 3 replan proposal contracts.
 *
 * A ReplanProposal is a user-approvable suggestion, never a modified plan.
 * The original TripPlan and RealityCheckResult are immutable inputs.
 * Every change carries its original failure context plus a confirmatory
 * re-verification of the replacement through the real verification path.
 */

export const PROPOSAL_ACTIONS = [
  "replace_attraction",
  "replace_meal",
  "replace_stay",
] as const;

export const originalFindingSchema = z.object({
  status: z.enum(VERIFICATION_STATUSES),
  summary: z.string().min(1).max(500),
});

export type OriginalFinding = z.infer<typeof originalFindingSchema>;

export const proposedChangeSchema = z.object({
  itemId: z.string().min(1).max(100),
  dayNumber: z.number().int().min(1),
  action: z.enum(PROPOSAL_ACTIONS),
  originalTitle: z.string().min(1).max(300),
  originalFinding: originalFindingSchema,
  replacement: itineraryItemSchema,
  candidatesConsidered: z.number().int().min(1),
  reasons: z.array(z.string().max(500)),
  recheck: itemCheckSchema,
});

export type ProposedChange = z.infer<typeof proposedChangeSchema>;

export const unfixableIssueSchema = z.object({
  itemId: z.string().min(1).max(100),
  title: z.string().min(1).max(300),
  status: z.enum(VERIFICATION_STATUSES),
  reason: z.string().min(1).max(500),
});

export type UnfixableIssue = z.infer<typeof unfixableIssueSchema>;

export const replanProposalSchema = z.object({
  basedOnCheckedAt: z.string(),
  changes: z.array(proposedChangeSchema),
  unchangedItemIds: z.array(z.string()),
  unfixable: z.array(unfixableIssueSchema),
  /** Counts cover ONLY confirmatory rechecks of proposed replacements. */
  recheckSummary: z.object({
    verified: z.number().int().nonnegative(),
    needsAttention: z.number().int().nonnegative(),
    problem: z.number().int().nonnegative(),
    unverified: z.number().int().nonnegative(),
  }),
  warnings: z.array(z.string()),
});

export type ReplanProposal = z.infer<typeof replanProposalSchema>;
