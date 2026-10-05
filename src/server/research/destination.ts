import type { SerpApiClient } from "../services/serpapi/client";

/**
 * Destination research: one bounded Google Search for destination-level
 * background context. Snippets are trimmed and source-linked; nothing is
 * synthesized. Context is background only — never scheduled as activities.
 */

export interface DestinationContext {
  query: string;
  summary: string[];
  sources: Array<{ title: string; link: string }>;
}

const MAX_SNIPPETS = 3;
const MAX_SNIPPET_LENGTH = 280;
const RESULT_COUNT = 5;

function trimSnippet(snippet: string): string {
  const cleaned = snippet.replace(/\s+/g, " ").trim();
  return cleaned.length > MAX_SNIPPET_LENGTH
    ? `${cleaned.slice(0, MAX_SNIPPET_LENGTH - 1).trimEnd()}…`
    : cleaned;
}

export async function researchDestination(
  client: SerpApiClient,
  destination: string,
): Promise<DestinationContext> {
  const query = `${destination} travel guide`;
  const data = await client.search({
    engine: "google",
    query,
    num: RESULT_COUNT,
  });
  const withSnippets = data.results.filter(
    (r) => r.snippet && r.snippet.trim().length > 0 && r.title && r.link,
  );
  return {
    query,
    summary: withSnippets
      .slice(0, MAX_SNIPPETS)
      .map((r) => trimSnippet(r.snippet as string)),
    sources: withSnippets.slice(0, MAX_SNIPPETS).map((r) => ({
      title: r.title as string,
      link: r.link as string,
    })),
  };
}
