import { NextResponse } from "next/server";
import { isSerpApiConfigured } from "@/src/lib/env";

/**
 * Phase 1 health check.
 * Reports whether server-side SerpApi configuration is present
 * WITHOUT exposing the key value.
 */
export async function GET() {
  let serpapiConfigured = false;
  try {
    serpapiConfigured = isSerpApiConfigured();
  } catch {
    serpapiConfigured = false;
  }

  return NextResponse.json({
    status: "ok",
    phase: 1,
    serpapiConfigured,
    timestamp: new Date().toISOString(),
  });
}
