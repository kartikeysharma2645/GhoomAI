import { Suspense } from "react";
import AgentChat from "../components/AgentChat";

export default function AgentPage() {
  return (
    <main className="min-h-screen bg-[#f7f4ee]">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
        {/* Suspense boundary: AgentChat reads ?discover= for visual
            discovery deep-links; required for static prerendering. */}
        <Suspense
          fallback={
            <div className="mx-auto w-full max-w-5xl rounded-3xl bg-stone-900 px-6 py-16 text-center">
              <p className="text-sm text-stone-300">Loading your travel companion…</p>
            </div>
          }
        >
          <AgentChat />
        </Suspense>

        <nav aria-label="Specialized surfaces" className="mt-6 space-y-1 text-sm text-stone-500">
          <p>
            Prefer the focused tools?{" "}
            <a href="/plan" className="font-medium text-teal-900 hover:underline">
              Trip planner
            </a>{" "}
            ·{" "}
            <a href="/vision" className="font-medium text-teal-900 hover:underline">
              Photo identification
            </a>{" "}
            ·{" "}
            <a href="/" className="font-medium text-teal-900 hover:underline">
              Quick search
            </a>
          </p>
        </nav>

        <footer className="mt-auto pt-4 text-xs text-stone-400">
          Live travel data via SerpApi · GhoomAI never completes bookings.
        </footer>
      </div>
    </main>
  );
}
